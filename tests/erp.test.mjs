// Pruebas de punta a punta: levanta el servidor sobre una base vacía y recorre los flujos de MAJA.
// Correr con: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 4500 + Math.floor(Math.random() * 400);
const B = `http://127.0.0.1:${PORT}/api`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'maja-test-'));
let server;

async function call(method, p, body, tk) {
  const r = await fetch(B + p, { method, headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: body !== undefined && method !== 'GET' ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}
async function ok(method, p, body, tk) {
  const r = await call(method, p, body, tk);
  assert.ok(r.status < 300, `${method} ${p} → ${r.status} ${r.data.error ?? ''}`);
  return r.data;
}
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Montevideo' }).format(new Date());

const T = {}; // tokens
const S = {}; // ids que se van creando

before(async () => {
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, SMTP_HOST: '' }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${B}/health`)).ok) return; } catch { /* arrancando */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('El servidor no arrancó');
});
after(() => { server?.kill(); try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { /* lo tiene tomado */ } });

test('primer uso: crea la dueña y no deja repetirlo', async () => {
  assert.equal((await ok('GET', '/auth/status')).needsSetup, true);
  T.owner = (await ok('POST', '/auth/setup', { name: 'Dueña', email: 'duena@maja.test', password: 'clave-duena' })).token;
  assert.equal((await call('POST', '/auth/setup', { name: 'x', email: 'x@x.x', password: '12345678' })).status, 400);
});

test('marcas, usuarios y números a la uruguaya', async () => {
  S.A = (await ok('POST', '/brands', { name: 'Marca A', commission_pct: '20', monthly_fee: '1.000', plus_iva: false, rut: '219999990011', phone: '099123456' }, T.owner)).id;
  S.B = (await ok('POST', '/brands', { name: 'Marca B', commission_pct: 10, monthly_fee: 0 }, T.owner)).id;
  const brands = await ok('GET', '/brands', null, T.owner);
  assert.equal(brands.find((b) => b.id === S.A).monthly_fee, 1000, '"1.000" es mil');
  await ok('POST', '/users', { name: 'Vendedora', email: 'vende@maja.test', password: 'clave-vende', role: 'vendedora' }, T.owner);
  await ok('POST', '/users', { name: 'Usuaria A', email: 'a@maja.test', password: 'clave-marca-a', role: 'marca', brand_id: S.A }, T.owner);
  T.seller = (await ok('POST', '/auth/login', { email: 'vende@maja.test', password: 'clave-vende' })).token;
  T.brandA = (await ok('POST', '/auth/login', { email: 'a@maja.test', password: 'clave-marca-a' })).token;
  assert.equal((await call('POST', '/auth/login', { email: 'a@maja.test', password: 'mal' })).status, 401);
});

test('stock: la marca carga artículos, la vendedora no; planilla con precios "2.500,00"', async () => {
  const imp = await ok('POST', '/products/import', { rows: [{ sku: 'CHQ-M', name: 'Chaqueta', variant: 'M', price: '2.500,00', barcode: '7790001000011' }, { sku: 'BUZ-S', name: 'Buzo', price: '1800' }] }, T.brandA);
  assert.equal(imp.created, 2);
  const prods = await ok('GET', '/products', null, T.brandA);
  S.chq = prods.find((p) => p.sku === 'CHQ-M');
  S.buz = prods.find((p) => p.sku === 'BUZ-S');
  assert.equal(S.chq.price, 2500);
  assert.equal((await call('POST', '/products', { brand_id: S.A, sku: 'X', name: 'x', price: 1 }, T.seller)).status, 403);
  assert.equal((await ok('GET', '/products?q=7790001000011', null, T.owner))[0].sku, 'CHQ-M', 'busca por código de barras');
});

test('ingreso: se cuenta lo que llega y entra al stock lo recibido', async () => {
  const id = (await ok('POST', '/orders', { type: 'ingreso', items: [{ product_id: S.chq.id, qty: 5 }, { product_id: S.buz.id, qty: 5 }, { sku: 'FAL-L', description: 'Falda', price: 1500, qty: 2, barcode: '7790001000028' }] }, T.brandA)).id;
  const notes = await ok('GET', '/notifications', null, T.seller);
  assert.ok(notes.rows.some((n) => n.title.includes('ingreso')), 'la tienda recibe el aviso');
  assert.equal((await call('PUT', `/orders/${id}/status`, { status: 'completado' }, T.seller)).status, 400, 'sin contar no se recibe');
  const o = await ok('GET', `/orders/${id}`, null, T.seller);
  await ok('PUT', `/orders/${id}/pick`, { items: o.items.map((i) => ({ id: i.id, picked_qty: i.qty })) }, T.seller);
  await ok('PUT', `/orders/${id}/status`, { status: 'completado' }, T.seller);
  const prods = await ok('GET', '/products', null, T.owner);
  assert.equal(prods.find((p) => p.id === S.chq.id).stock, 5);
  assert.equal(prods.find((p) => p.sku === 'FAL-L')?.barcode, '7790001000028', 'el artículo nuevo se da de alta con su código');
});

test('pick up: se arma, queda listo, se registra quién retira y baja lo armado', async () => {
  const id = (await ok('POST', '/orders', { type: 'pickup', customer_name: 'Clienta', items: [{ product_id: S.chq.id, qty: 2 }] }, T.brandA)).id;
  const o = await ok('GET', `/orders/${id}`, null, T.seller);
  await ok('PUT', `/orders/${id}/pick`, { items: [{ id: o.items[0].id, picked_qty: 1 }] }, T.seller);
  assert.equal((await call('PUT', `/orders/${id}/status`, { status: 'cancelado' }, T.brandA)).status, 403, 'la marca no cancela lo que se está armando');
  assert.equal((await call('PUT', `/orders/${id}/status`, { status: 'cancelado' }, T.seller)).status, 403, 'la vendedora no cancela');
  await ok('PUT', `/orders/${id}/status`, { status: 'listo' }, T.seller);
  assert.ok((await ok('GET', '/notifications', null, T.brandA)).rows.some((n) => n.title.includes('listo para retirar')));
  assert.equal((await call('PUT', `/orders/${id}/status`, { status: 'completado' }, T.seller)).status, 400, 'hay que anotar quién retira');
  await ok('PUT', `/orders/${id}/status`, { status: 'completado', picked_up_by: 'Cadete' }, T.seller);
  assert.equal((await ok('GET', '/products', null, T.owner)).find((p) => p.id === S.chq.id).stock, 4);
});

test('ventas: a nombre de una marca, medio obligatorio, tarjeta con POS y autorización', async () => {
  const base = { brand_id: S.A, invoice_number: 'A-1', items: [{ product_id: S.chq.id, qty: 1, unit_price: 2500 }] };
  assert.equal((await call('POST', '/sales', base, T.seller)).status, 400, 'sin medio de pago');
  assert.equal((await call('POST', '/sales', { ...base, payment_method: 'Débito', pos: 'marca' }, T.seller)).status, 400, 'tarjeta sin autorización');
  assert.equal((await call('POST', '/sales', { ...base, brand_id: S.B, payment_method: 'Efectivo' }, T.seller)).status, 400, 'artículo de otra marca');
  assert.equal((await call('POST', '/sales', { ...base, payment_method: 'Efectivo' }, T.brandA)).status, 403, 'la marca no vende');
  S.saleCard = (await ok('POST', '/sales', { ...base, payment_method: 'Débito', pos: 'marca', authorization: '681898', date: today() }, T.seller)).id;
  const rows = (await ok('GET', '/sales', null, T.brandA)).rows;
  assert.ok(rows.every((r) => r.brand_id === S.A));
  assert.equal((await call('POST', `/sales/${S.saleCard}/void`, { reason: 'x' }, T.seller)).status, 403, 'la vendedora no anula');
});

test('caja: fondo + efectivo − salidas, cierre con diferencia avisa a la dueña', async () => {
  await ok('POST', '/cash/open', { opening_float: 1000 }, T.seller);
  await ok('POST', '/sales', { brand_id: S.A, payment_method: 'Efectivo', invoice_number: 'A-2', items: [{ product_id: S.buz.id, qty: 1, unit_price: 1800 }] }, T.seller);
  await ok('POST', '/cash/movements', { kind: 'retiro', amount: 300, reason: 'Flete' }, T.seller);
  const s = (await ok('GET', '/cash', null, T.seller)).session;
  assert.equal(s.expected_now, 2500);
  const r = await ok('POST', '/cash/close', { counted_cash: 2450, notes: 'faltan 50' }, T.seller);
  assert.equal(r.difference, -50);
  assert.ok((await ok('GET', '/notifications', null, T.owner)).rows.some((n) => n.title.includes('diferencia')));
  assert.equal((await call('POST', '/cash/reopen', { date: today() }, T.seller)).status, 403);
});

test('cambio de prenda: dos comprobantes y se cobra solo la diferencia', async () => {
  const orig = (await ok('POST', '/sales', { brand_id: S.A, payment_method: 'Efectivo', invoice_number: 'A-3', items: [{ product_id: S.buz.id, qty: 1, unit_price: 1800 }] }, T.seller)).id;
  const ex = await ok('POST', '/sales/exchange', { brand_id: S.A, ref_sale_id: orig, payment_method: 'Débito', pos: 'maja', authorization: '777777', invoice_number: 'A-4', returns: [{ product_id: S.buz.id, qty: 1, unit_price: 1800 }], items: [{ product_id: S.chq.id, qty: 1, unit_price: 2500 }] }, T.seller);
  assert.equal(ex.difference, 700);
  const sale = await ok('GET', `/sales/${ex.new_sale.id}`, null, T.seller);
  assert.equal(sale.charged, 700, 'la venta nueva registra que se cobraron 700');
  assert.equal((await ok('GET', `/sales/${orig}`, null, T.seller)).items[0].returned, 1, 'la venta original queda con la prenda devuelta');
});

test('nota de crédito: la vendedora devuelve parte de una venta y no puede devolver de más', async () => {
  const v = (await ok('POST', '/sales', { brand_id: S.A, payment_method: 'Efectivo', invoice_number: 'A-9', items: [{ product_id: S.buz.id, qty: 2, unit_price: 1800 }] }, T.seller)).id;
  const stock0 = (await ok('GET', '/products', null, T.owner)).find((p) => p.id === S.buz.id).stock;
  await ok('POST', '/sales', { brand_id: S.A, ref_sale_id: v, payment_method: 'Efectivo', notes: 'Devolución: talle', items: [{ product_id: S.buz.id, qty: -1, unit_price: 1800 }] }, T.seller);
  assert.equal((await ok('GET', '/products', null, T.owner)).find((p) => p.id === S.buz.id).stock, stock0 + 1, 'la prenda vuelve al stock');
  const otra = await call('POST', '/sales', { brand_id: S.A, ref_sale_id: v, payment_method: 'Efectivo', items: [{ product_id: S.buz.id, qty: -2, unit_price: 1800 }] }, T.seller);
  assert.equal(otra.status, 400, `no deja devolver más de lo vendido (${otra.data.error})`);
  assert.equal((await ok('GET', `/sales/${v}`, null, T.seller)).items[0].returned, 1);
});

test('tarjetas: el reporte del POS de MAJA detecta la venta anotada en el POS de la marca', async () => {
  const d = today().split('-');
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(d[1]) - 1];
  const fecha = `${d[2]}-${mon}-${d[0]}`;
  const header = ['Fecha transacción', 'Sucursal', 'Terminal', 'Nro. Serie', 'Medio', 'Nro. Tarjeta', 'Extranjera', 'Sello', 'Banco emisor', 'Tipo de movimiento', 'Nro. de verificación', 'Cobro en Cuenta Handy', 'Nro. Ticket', 'Autorización', 'Nro. Factura', 'Moneda', 'Importe', 'Propina', 'Importe con propina', 'Devolución IVA', 'Servicio Handy', 'IVA Servicio Handy', 'Recargos financieros', 'IVA Recargos financieros', 'Retenciones', 'Cargos de terceros', 'Importe a cobrar en Cuenta Handy', 'Devolución de impuestos', 'Identificador de pago Ecommerce'];
  const rows = [['Actividad-UYU'], ['Fecha inicio de transacción', fecha], ['Fecha fin de transacción', fecha], [], header,
    [`${fecha} 12:00`, 'maja', 'HYMAJA', '1', 'Fisico', '4010 XXXX 1111', 'NO', 'VISA', 'BROU', 'Débito', 1, fecha, '1', '681898', '', 'UYU', 2500, 0, 2500, -40.98, -60, -13.2, 0, 0, 0, 0, 2385.82, '', null],
    [`${fecha} 12:30`, 'maja', 'HYMAJA', '1', 'Fisico', '5491 XXXX 2222', 'NO', 'MASTER', 'ITAU', 'Débito', 2, fecha, '2', '777777', '', 'UYU', 700, 0, 700, 0, -20, -4.4, 0, 0, 0, 0, 675.6, '', null]];
  const imp = await ok('POST', '/cards/import', { filename: 'pos-maja.xlsx', sheets: [{ name: 'UYU', rows }] }, T.owner);
  assert.equal(imp.added, 2);
  assert.equal((await ok('POST', '/cards/import', { filename: 'otra vez', sheets: [{ name: 'UYU', rows }] }, T.owner)).added, 0, 'no duplica');
  const r = await ok('GET', '/cards/txns', null, T.owner);
  const t1 = r.txns.find((t) => t.authorization === '681898');
  assert.equal(t1.sale?.id, S.saleCard, 'se une por n° de autorización');
  assert.equal(t1.status, 'pos_equivocado');
  assert.equal(r.txns.find((t) => t.authorization === '777777').status, 'ok', 'el cambio cobrado en MAJA cruza por la diferencia');
  const det = await ok('GET', `/settlements/detail?brand_id=${S.A}&period=${today().slice(0, 7)}`, null, T.brandA);
  assert.equal(det.settlement.card_credit, Math.round((2385.82 + 675.6) * 100) / 100, 'la liquidación descuenta lo acreditado en el POS de MAJA');
  await ok('POST', `/cards/txns/${t1.id}/fix`, undefined, T.owner);
  assert.equal((await ok('GET', `/sales/${S.saleCard}`, null, T.owner)).pos, 'maja');
  assert.equal((await call('GET', '/cards/txns', null, T.seller)).status, 403);
});

test('conteo de inventario: la vendedora escanea, la dueña aplica', async () => {
  const c = (await ok('POST', '/counts', { brand_id: S.A }, T.seller)).id;
  for (let i = 0; i < 3; i++) await ok('POST', `/counts/${c}/scan`, { code: '7790001000011' }, T.seller);
  assert.equal((await call('POST', `/counts/${c}/apply`, { only_touched: true }, T.seller)).status, 403);
  await ok('POST', `/counts/${c}/apply`, { only_touched: true }, T.owner);
  assert.equal((await ok('GET', '/products', null, T.owner)).find((p) => p.id === S.chq.id).stock, 3, 'el stock queda en lo contado');
});

test('objetivos, rendimiento y permisos por perfil', async () => {
  await ok('PUT', '/goals', { period: today().slice(0, 7), goals: [{ brand_id: S.A, amount: '150.000' }] }, T.owner);
  const g = await ok('GET', `/goals?period=${today().slice(0, 7)}`, null, T.owner);
  assert.equal(g.rows.find((r) => r.brand_id === S.A).goal, 150000);
  for (const [p, seller, brand] of [['/performance', 403, 403], ['/goals', 403, 403], ['/users', 403, 403], ['/audit', 403, 403], ['/settlements', 403, 200], ['/shift', 200, 403], ['/dashboard', 403, 200]]) {
    assert.equal((await call('GET', p, null, T.seller)).status, seller, `vendedora ${p}`);
    assert.equal((await call('GET', p, null, T.brandA)).status, brand, `marca ${p}`);
  }
  const b = await ok('GET', '/brands', null, T.seller);
  assert.ok(b.every((x) => !('commission_pct' in x)), 'la vendedora no ve comisiones');
});

test('vista previa de la dueña: solo lectura y con los permisos del perfil', async () => {
  const pv = await ok('POST', '/auth/preview', { role: 'marca', brand_id: S.A }, T.owner);
  assert.equal((await call('GET', '/performance', null, pv.token)).status, 403);
  assert.equal((await call('POST', '/orders', { type: 'ingreso', items: [] }, pv.token)).status, 403);
  assert.ok((await ok('GET', '/sales', null, pv.token)).rows.every((r) => r.brand_id === S.A));
  assert.equal((await call('POST', '/auth/preview', { role: 'vendedora' }, T.seller)).status, 403);
});

test('liquidación: cierre, aviso a la marca e historial', async () => {
  const period = today().slice(0, 7);
  await ok('POST', '/settlements/close', { brand_id: S.A, period }, T.owner);
  assert.ok((await ok('GET', '/notifications', null, T.brandA)).rows.some((n) => n.title.includes('Liquidación')));
  const r = await call('POST', '/settlements/invoice', { brand_id: S.A, period }, T.owner);
  assert.equal(r.status, 400, 'sin Biller configurado no factura');
  const hist = await ok('GET', '/audit', null, T.owner);
  for (const a of ['caja_cierre', 'cambio', 'correccion_pos', 'conteo', 'liquidacion_cierre', 'objetivos']) assert.ok(hist.rows.some((x) => x.action === a), `historial: ${a}`);
});

test('contraseña: link de un solo uso', async () => {
  const users = await ok('GET', '/users', null, T.owner);
  const u = users.find((x) => x.email === 'a@maja.test');
  const { link } = await ok('POST', `/users/${u.id}/reset-link`, undefined, T.owner);
  const token = new URL(link).searchParams.get('reset');
  await ok('POST', '/auth/reset', { token, password: 'nueva-clave-a' });
  assert.equal((await call('POST', '/auth/reset', { token, password: 'otra-clave-a' })).status, 400);
  assert.ok((await ok('POST', '/auth/login', { email: 'a@maja.test', password: 'nueva-clave-a' })).token);
});
