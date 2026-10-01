import { db, getSetting, setSetting } from './db.js';
import { bad, round2 } from './lib.js';

/*
 * Facturación electrónica con Biller (https://biller-labs.github.io/api-docs/).
 * Cada venta se factura a nombre de UNA marca, de una de tres formas:
 *  - manual:        la marca factura en su sistema y MAJA anota el número.
 *  - cuenta_ajena:  MAJA emite con SU Biller un e-Ticket/e-Factura de venta por cuenta
 *                   ajena (131/141) con la marca como mandante (complementoFiscal).
 *  - biller_marca:  se emite con el Biller de la marca (token propio): e-Ticket/e-Factura (101/111).
 */

const BASE = { produccion: 'https://biller.uy', test: 'https://test.biller.uy' };
const TIPOS = {
  biller_marca: { ticket: 101, ticket_nc: 102, factura: 111, factura_nc: 112 },
  cuenta_ajena: { ticket: 131, ticket_nc: 132, factura: 141, factura_nc: 142 },
};
const NOMBRE_TIPO = { 101: 'e-Ticket', 102: 'NC e-Ticket', 111: 'e-Factura', 112: 'NC e-Factura', 131: 'e-Ticket c/ajena', 132: 'NC e-Ticket c/ajena', 141: 'e-Factura c/ajena', 142: 'NC e-Factura c/ajena' };
const INDICADOR = { basica: 3, minimo: 16, exento: 1 };
const DOC_TIPO = { RUT: 2, CI: 3, OTRO: 4, PASAPORTE: 5, DNI: 6 };

export const PAYMENT_METHODS = ['Efectivo', 'Débito', 'Crédito', 'Transferencia', 'Mercado Pago', 'Otro'];
export const tipoNombre = (t) => NOMBRE_TIPO[t] || 'Comprobante';

// ---------- configuración del Biller de MAJA ----------
export function majaBiller() {
  return { token: getSetting('maja_biller_token'), sucursal: getSetting('maja_biller_sucursal'), env: getSetting('maja_biller_env') || 'produccion' };
}
export function publicBillingSettings() {
  const c = majaBiller();
  return { has_token: !!c.token, sucursal: c.sucursal || '', env: c.env };
}
export function saveBillingSettings(body) {
  if (body.token) setSetting('maja_biller_token', String(body.token).trim());
  if (body.clear_token) setSetting('maja_biller_token', '');
  setSetting('maja_biller_sucursal', String(body.sucursal ?? '').trim());
  setSetting('maja_biller_env', body.env === 'test' ? 'test' : 'produccion');
}

/** Credenciales con las que se factura a nombre de esta marca, o null si es manual. */
export function credentialsFor(brand) {
  if (brand.billing_mode === 'cuenta_ajena') {
    const c = majaBiller();
    if (!c.token || !c.sucursal) throw bad('Falta configurar el Biller de MAJA (token y sucursal) en Marcas → Facturación de MAJA');
    if (!brand.rut || !(brand.razon_social || brand.name)) throw bad(`A ${brand.name} le falta el RUT para facturar por cuenta ajena`);
    return c;
  }
  if (brand.billing_mode === 'biller_marca') {
    if (!brand.biller_token || !brand.biller_sucursal) throw bad(`A ${brand.name} le falta el token o la sucursal de su Biller`);
    return { token: brand.biller_token, sucursal: brand.biller_sucursal, env: brand.biller_env || 'produccion' };
  }
  return null;
}

async function billerFetch(cred, method, path, body) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(`${BASE[cred.env] || BASE.produccion}${path}`, {
      method,
      headers: { Authorization: `Bearer ${cred.token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    if (res.ok) return data;
    // Biller permite 1 comprobante por segundo por token
    if (res.status === 429 && attempt < 3) { await new Promise((r) => setTimeout(r, attempt * 1500)); continue; }
    lastErr = new Error(billerMessage(data, res.status));
    break;
  }
  throw lastErr;
}

function billerMessage(data, status) {
  if (Array.isArray(data)) return data.map((e) => `${e.field ?? ''}: ${[].concat(e.message ?? '').join(' ')}`.trim()).join(' · ') || `Biller respondió ${status}`;
  if (data && typeof data === 'object') return data.mensaje || data.message || data.error || JSON.stringify(data).slice(0, 300);
  return String(data || `Biller respondió ${status}`).slice(0, 300);
}

const ddmmyyyy = (iso) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
const concepto = (s) => { const t = String(s || 'Artículo'); return t.length > 80 ? `${t.slice(0, 79)}…` : t; };

function payloadFor({ brand, cred, sale, lines, tipo, referencias }) {
  const indicador = INDICADOR[brand.iva_mode] ?? 3;
  const conCliente = sale.customer_doc && sale.customer_doc_type;
  const cliente = conCliente ? {
    tipo_documento: DOC_TIPO[sale.customer_doc_type] ?? 4,
    documento: String(sale.customer_doc).replace(/[.\-\s]/g, ''),
    ...(sale.customer_doc_type === 'RUT' ? { razon_social: (sale.customer_name || '').slice(0, 70) } : { nombre_fantasia: (sale.customer_name || '').slice(0, 30) }),
    sucursal: { pais: 'UY', ...(sale.customer_email ? { emails: [sale.customer_email] } : {}) },
  } : '-';
  return {
    tipo_comprobante: tipo,
    numero_interno: `MAJA-${sale.id}${referencias ? '-NC' : ''}`,
    fecha_emision: ddmmyyyy(sale.date),
    forma_pago: 1,
    sucursal: Number(cred.sucursal),
    moneda: 'UYU',
    // los precios de la tienda son finales: con IVA incluido si la marca está en régimen general
    montos_brutos: indicador === 3 ? 1 : 0,
    ...(brand.iva_mode === 'minimo' ? { cae: { especial: 2 } } : {}),
    cliente,
    items: lines.map((l) => ({
      ...(l.sku ? { codigo: String(l.sku).slice(0, 35) } : {}),
      cantidad: Math.abs(l.qty),
      concepto: concepto(l.description),
      precio: round2(l.unit_price),
      indicador_facturacion: indicador,
      ...(l.discount_pct > 0 ? { descuento_tipo: '%', descuento_cantidad: l.discount_pct } : {}),
    })),
    ...(referencias ? { referencias } : {}),
    ...(brand.billing_mode === 'cuenta_ajena' ? {
      complementoFiscal: { nombre: (brand.razon_social || brand.name).slice(0, 255), tipo_documento: 2, documento: String(brand.rut).replace(/\D/g, ''), pais: 'UY' },
    } : {}),
    adenda: `Pago: ${sale.payment_method}`,
  };
}

/** Emite el comprobante de una venta ya guardada y deja el resultado en la venta. */
export async function emitForSale(saleId) {
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
  const brand = db.prepare('SELECT * FROM brands WHERE id = ?').get(sale.brand_id);
  const cred = credentialsFor(brand);
  if (!cred) return sale;
  const lines = db.prepare('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id').all(saleId);
  const isReturn = lines.every((l) => l.qty < 0);
  const tipos = TIPOS[brand.billing_mode];
  let tipo = tipos[sale.cfe_kind === 'factura' ? 'factura' : 'ticket'];
  let referencias;
  if (isReturn) {
    const orig = db.prepare('SELECT * FROM sales WHERE id = ?').get(sale.ref_sale_id);
    if (!orig?.cfe_id) throw bad('La venta original no tiene comprobante electrónico para referenciar');
    tipo = tipos[orig.cfe_kind === 'factura' ? 'factura_nc' : 'ticket_nc'];
    referencias = [Number(orig.cfe_id)];
  }
  try {
    const r = await billerFetch(cred, 'POST', '/v3/comprobantes/emitir', payloadFor({ brand, cred, sale, lines, tipo, referencias }));
    db.prepare(`UPDATE sales SET invoice_status = 'emitida', invoice_error = NULL, cfe_id = ?, cfe_tipo = ?, cfe_serie = ?, cfe_numero = ?, cfe_mode = ?, invoice_number = ? WHERE id = ?`)
      .run(String(r.id), tipo, r.serie ?? null, r.numero != null ? String(r.numero) : null, brand.billing_mode, `${tipoNombre(tipo)} ${r.serie ?? ''}-${r.numero ?? ''}`, saleId);
  } catch (e) {
    db.prepare(`UPDATE sales SET invoice_status = 'error', invoice_error = ?, cfe_mode = ? WHERE id = ?`).run(String(e.message).slice(0, 500), brand.billing_mode, saleId);
  }
  return db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
}

/** Nota de crédito total para anular una venta facturada electrónicamente. */
export async function emitVoidCreditNote(sale) {
  const brand = db.prepare('SELECT * FROM brands WHERE id = ?').get(sale.brand_id);
  const cred = sale.cfe_mode === 'cuenta_ajena' ? majaBiller() : { token: brand.biller_token, sucursal: brand.biller_sucursal, env: brand.biller_env };
  if (!cred.token) throw bad('No hay token de Biller para emitir la nota de crédito');
  const lines = db.prepare('SELECT * FROM sale_items WHERE sale_id = ? AND qty > 0 ORDER BY id').all(sale.id);
  const tipo = TIPOS[sale.cfe_mode][sale.cfe_kind === 'factura' ? 'factura_nc' : 'ticket_nc'];
  const r = await billerFetch(cred, 'POST', '/v3/comprobantes/emitir', payloadFor({ brand: { ...brand, billing_mode: sale.cfe_mode }, cred, sale: { ...sale, id: `${sale.id}-ANUL` }, lines, tipo, referencias: [Number(sale.cfe_id)] }));
  return { id: String(r.id), number: `${tipoNombre(tipo)} ${r.serie ?? ''}-${r.numero ?? ''}` };
}

export async function pdfForSale(sale, which = 'main') {
  const brand = db.prepare('SELECT * FROM brands WHERE id = ?').get(sale.brand_id);
  const cred = sale.cfe_mode === 'cuenta_ajena' ? majaBiller() : { token: brand.biller_token, sucursal: brand.biller_sucursal, env: brand.biller_env };
  const id = which === 'void' ? sale.void_cfe_id : sale.cfe_id;
  if (!id || !cred.token) throw bad('Este comprobante no tiene PDF en Biller');
  const data = await billerFetch(cred, 'GET', `/v2/comprobantes/pdf?id=${encodeURIComponent(id)}`);
  let b64 = typeof data === 'string' ? data : data?.pdf ?? data?.data ?? data?.base64 ?? '';
  b64 = String(b64).replace(/^data:application\/pdf;base64,/, '').replace(/\s+/g, '');
  const buf = Buffer.from(b64, 'base64');
  if (buf.subarray(0, 4).toString('latin1') !== '%PDF') throw bad('Biller no devolvió un PDF válido');
  return buf;
}
