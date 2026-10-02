import { Router } from 'express';
import { db, tx } from '../db.js';
import {
  auth, adminOnly, staffOnly, notSeller, bad, notFound, forbidden, scopeBrand, requireBrand, moveStock, str, num, round2, today, currentPeriod,
  shiftPeriod, isPeriod, settlementFor, brandPeriods, isPeriodClosed, majaPosCollections, creditOf,
} from '../lib.js';
import { PAYMENT_METHODS, credentialsFor, emitForSale, emitVoidCreditNote, pdfForSale } from '../billing.js';

export const moneyRouter = Router();
moneyRouter.use(auth);

const DOC_TYPES = ['CI', 'RUT', 'PASAPORTE', 'DNI', 'OTRO'];

// ---------- ventas ----------
moneyRouter.get('/sales', (req, res) => {
  const brandId = scopeBrand(req, req.query.brand_id);
  const from = str(req.query.from) || `${currentPeriod()}-01`;
  const to = str(req.query.to) || today();
  const where = ['s.date BETWEEN ? AND ?'];
  const args = [from, to];
  if (brandId) { where.push('si.brand_id = ?'); args.push(brandId); }
  if (req.user.role === 'marca' || req.query.include_voided !== '1') where.push('s.voided = 0');
  const rows = db.prepare(`
    SELECT si.*, s.date, s.payment_method, s.pos, s.installments, s.notes, s.voided, s.cfe_kind, s.customer_doc_type, s.customer_doc, s.customer_name,
      s.invoice_status, s.invoice_number, s.invoice_error, s.cfe_id, s.cfe_mode, s.ref_sale_id, s.void_cfe_id, s.void_cfe_number,
      b.name AS brand_name, p.variant,
      (SELECT pt.owner FROM card_txns c JOIN pos_terminals pt ON pt.terminal = c.terminal WHERE c.sale_id = s.id AND c.ignored = 0 LIMIT 1) AS handy_pos,
      (SELECT c.id FROM card_txns c WHERE c.sale_id = s.id AND c.ignored = 0 LIMIT 1) AS handy_txn_id
    FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN brands b ON b.id = si.brand_id
    LEFT JOIN products p ON p.id = si.product_id
    WHERE ${where.join(' AND ')} ORDER BY s.date DESC, s.id DESC, si.id`).all(...args);
  if (req.user.role === 'marca') rows.forEach((r) => { delete r.notes; });
  res.json({ from, to, rows, payment_methods: PAYMENT_METHODS });
});

moneyRouter.post('/sales', staffOnly, async (req, res) => {
  const date = str(req.body.date) || today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw bad('Fecha inválida');
  if (date > today()) throw bad('La fecha no puede ser futura');
  const brandId = Number(req.body.brand_id);
  const brand = db.prepare('SELECT * FROM brands WHERE id = ?').get(brandId);
  if (!brand) throw bad('Elegí a nombre de qué marca se factura');
  if (!brand.active) throw bad('La marca está inactiva');
  const payment = str(req.body.payment_method);
  if (!PAYMENT_METHODS.includes(payment)) throw bad('Elegí el medio de pago');
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) throw bad('La venta no tiene artículos');
  // con tarjeta: en qué POS se pasó (cada marca tiene el suyo y MAJA el propio)
  const card = ['Débito', 'Crédito'].includes(payment);
  const pos = card ? (['maja', 'marca'].includes(req.body.pos) ? req.body.pos : null) : null;
  if (card && !pos) throw bad('Indicá en qué POS se pasó la tarjeta: el de MAJA o el de la marca');
  const installments = payment === 'Crédito' ? Math.max(1, Math.min(36, Math.trunc(num(req.body.installments, 1)))) : null;

  const clean = items.map((it) => {
    const qty = Math.trunc(num(it.qty));
    if (!qty) throw bad('Hay una línea con cantidad 0');
    const unit = num(it.unit_price);
    if (unit <= 0) throw bad('Cada línea necesita un precio mayor a 0');
    const disc = Math.min(100, Math.max(0, num(it.discount_pct)));
    let line;
    if (it.product_id) {
      const p = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(it.product_id));
      if (!p) throw bad('Artículo inexistente');
      if (p.brand_id !== brandId) throw bad(`${p.name} no es de ${brand.name}: cada venta se factura a nombre de una sola marca`);
      line = { product_id: p.id, sku: p.sku, description: p.name + (p.variant ? ` ${p.variant}` : '') };
    } else {
      if (!str(it.description)) throw bad('Las líneas sin artículo necesitan descripción');
      line = { product_id: null, sku: str(it.sku), description: str(it.description) };
    }
    return { ...line, qty, unit_price: unit, discount_pct: disc, total: round2(qty * unit * (1 - disc / 100)) };
  });

  // comprobante y cliente
  const kind = req.body.cfe_kind === 'factura' ? 'factura' : 'ticket';
  const docType = DOC_TYPES.includes(req.body.customer_doc_type) ? req.body.customer_doc_type : null;
  const doc = str(req.body.customer_doc);
  const customerName = str(req.body.customer_name);
  if (kind === 'factura' && (docType !== 'RUT' || !doc || !customerName)) throw bad('La e-Factura necesita el RUT y la razón social del cliente');

  const electronic = brand.billing_mode !== 'manual';
  if (electronic) credentialsFor(brand); // valida la configuración antes de guardar nada
  const negatives = clean.filter((c) => c.qty < 0).length;
  let refSaleId = null;
  if (negatives && electronic) {
    if (negatives !== clean.length) throw bad('Con factura electrónica la devolución va sola: registrá la devolución y la venta nueva por separado');
    refSaleId = Number(req.body.ref_sale_id);
    const orig = db.prepare('SELECT * FROM sales WHERE id = ?').get(refSaleId);
    if (!orig || orig.brand_id !== brandId) throw bad('Indicá el número de la venta original (de esta marca) que se devuelve');
    if (!orig.cfe_id) throw bad(`La venta #${refSaleId} no tiene comprobante electrónico emitido`);
  }
  if (!electronic && !str(req.body.invoice_number)) throw bad(`${brand.name} factura a mano: anotá el número de la factura`);
  if (isPeriodClosed(brandId, date.slice(0, 7))) throw bad(`La liquidación de ${brand.name} de ese mes ya está cerrada. Reabrila para cargar la venta.`);

  const id = tx(() => {
    const r = db.prepare(`INSERT INTO sales (date, brand_id, payment_method, pos, installments, notes, created_by, cfe_kind, customer_doc_type, customer_doc, customer_name, customer_email,
        invoice_status, invoice_number, ref_sale_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(date, brandId, payment, pos, installments, str(req.body.notes), req.user.id, kind, docType, doc, customerName, str(req.body.customer_email),
        electronic ? 'pendiente' : 'manual', electronic ? null : str(req.body.invoice_number), refSaleId);
    const sid = Number(r.lastInsertRowid);
    const ins = db.prepare('INSERT INTO sale_items (sale_id, brand_id, product_id, sku, description, qty, unit_price, discount_pct, total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const c of clean) {
      ins.run(sid, brandId, c.product_id, c.sku, c.description, c.qty, c.unit_price, c.discount_pct, c.total);
      // venta descuenta stock; devolución (cantidad negativa) lo repone
      if (c.product_id) moveStock({ productId: c.product_id, brandId, qty: -c.qty, reason: c.qty > 0 ? 'venta' : 'devolucion', refType: 'sale', refId: sid, userId: req.user.id });
    }
    return sid;
  });
  // la venta queda guardada aunque Biller falle: la factura se puede reintentar
  const sale = electronic ? await emitForSale(id) : db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
  res.json({ id, invoice_status: sale.invoice_status, invoice_number: sale.invoice_number, invoice_error: sale.invoice_error });
});

moneyRouter.post('/sales/:id/invoice', staffOnly, async (req, res) => {
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(Number(req.params.id));
  if (!sale) throw notFound('Venta inexistente');
  if (sale.voided) throw bad('La venta está anulada');
  if (sale.invoice_status === 'emitida') throw bad('Esta venta ya tiene comprobante');
  const s = await emitForSale(sale.id);
  res.json({ invoice_status: s.invoice_status, invoice_number: s.invoice_number, invoice_error: s.invoice_error });
});

moneyRouter.get('/sales/:id/pdf', async (req, res) => {
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(Number(req.params.id));
  if (!sale) throw notFound('Venta inexistente');
  if (req.user.role === 'marca' && sale.brand_id !== req.user.brand_id) throw forbidden();
  const pdf = await pdfForSale(sale, req.query.which === 'void' ? 'void' : 'main');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="venta-${sale.id}.pdf"`);
  res.send(pdf);
});

moneyRouter.post('/sales/:id/void', adminOnly, async (req, res) => {
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(Number(req.params.id));
  if (!sale) throw notFound('Venta inexistente');
  if (sale.voided) throw bad('La venta ya estaba anulada');
  const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(sale.id);
  if (isPeriodClosed(sale.brand_id, sale.date.slice(0, 7))) throw bad('El mes de esta venta ya está liquidado. Reabrí la liquidación primero.');
  if (sale.invoice_status === 'emitida' && items.some((i) => i.qty < 0)) throw bad('Una devolución ya facturada no se anula: registrá una venta nueva');
  // si salió factura electrónica, se anula con una nota de crédito total
  const nc = sale.invoice_status === 'emitida' ? await emitVoidCreditNote(sale) : null;
  tx(() => {
    for (const it of items) {
      if (it.product_id) moveStock({ productId: it.product_id, brandId: it.brand_id, qty: it.qty, reason: 'anulacion', refType: 'sale', refId: sale.id, note: str(req.body.reason), userId: req.user.id });
    }
    db.prepare("UPDATE sales SET voided = 1, void_cfe_id = ?, void_cfe_number = ?, notes = TRIM(COALESCE(notes, '') || ?) WHERE id = ?")
      .run(nc?.id ?? null, nc?.number ?? null, ` [Anulada: ${str(req.body.reason) || 'sin motivo'}]`, sale.id);
  });
  res.json({ ok: true, credit_note: nc?.number ?? null });
});

// ---------- liquidaciones (comisiones + cuotas) ----------
moneyRouter.get('/settlements', notSeller, (req, res) => {
  const brandId = scopeBrand(req, req.query.brand_id);
  if (brandId) {
    const brand = db.prepare('SELECT * FROM brands WHERE id = ?').get(brandId);
    if (!brand) throw notFound('Marca inexistente');
    return res.json({ mode: 'brand', brand: { id: brand.id, name: brand.name, commission_pct: brand.commission_pct, monthly_fee: brand.monthly_fee, plus_iva: !!brand.plus_iva }, rows: brandPeriods(brand).map((p) => settlementFor(brand, p)) });
  }
  const period = isPeriod(req.query.period) ? req.query.period : currentPeriod();
  const brands = db.prepare('SELECT * FROM brands WHERE active = 1 ORDER BY name').all();
  res.json({ mode: 'period', period, rows: brands.filter((b) => brandPeriods(b).includes(period)).map((b) => settlementFor(b, period)) });
});

moneyRouter.get('/settlements/detail', notSeller, (req, res) => {
  const brandId = requireBrand(req, req.query.brand_id);
  const period = req.query.period;
  if (!isPeriod(period)) throw bad('Mes inválido');
  const brand = db.prepare('SELECT * FROM brands WHERE id = ?').get(brandId);
  const settlement = settlementFor(brand, period);
  const payments = db.prepare(`SELECT pm.*, u.name AS created_by_name FROM payments pm LEFT JOIN users u ON u.id = pm.created_by
    WHERE pm.brand_id = ? AND pm.period = ? ORDER BY pm.paid_at, pm.id`).all(brandId, period);
  const products = db.prepare(`
    SELECT COALESCE(si.sku, '—') AS sku, si.description, SUM(si.qty) AS units, SUM(si.total) AS total
    FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE si.brand_id = ? AND s.voided = 0 AND substr(s.date, 1, 7) = ?
    GROUP BY si.sku, si.description ORDER BY total DESC`).all(brandId, period);
  const collections = majaPosCollections(brandId, period).map((c) => ({ ...c, credit: creditOf(c) }));
  res.json({ settlement, payments, products, collections });
});

moneyRouter.post('/settlements/close', adminOnly, (req, res) => {
  const brandId = requireBrand(req, req.body.brand_id);
  const period = req.body.period;
  if (!isPeriod(period)) throw bad('Mes inválido');
  if (isPeriodClosed(brandId, period)) throw bad('Ese mes ya está cerrado');
  const brand = db.prepare('SELECT * FROM brands WHERE id = ?').get(brandId);
  const s = settlementFor(brand, period);
  db.prepare(`INSERT INTO settlements (brand_id, period, sales_total, units, commission_pct, commission, fee, iva, total, card_credit, closed_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(brandId, period, s.sales_total, s.units, s.commission_pct, s.commission, s.fee, s.iva, s.total, s.card_credit, req.user.id);
  res.json(settlementFor(brand, period));
});

moneyRouter.post('/settlements/reopen', adminOnly, (req, res) => {
  const brandId = requireBrand(req, req.body.brand_id);
  db.prepare('DELETE FROM settlements WHERE brand_id = ? AND period = ?').run(brandId, req.body.period);
  res.json({ ok: true });
});

moneyRouter.post('/payments', adminOnly, (req, res) => {
  const brandId = requireBrand(req, req.body.brand_id);
  if (!isPeriod(req.body.period)) throw bad('Mes inválido');
  // positivo: la marca le paga a MAJA · negativo: MAJA le paga a la marca
  const amount = round2(num(req.body.amount));
  if (!amount) throw bad('Poné el monto');
  const paidAt = str(req.body.paid_at) || today();
  const r = db.prepare('INSERT INTO payments (brand_id, period, amount, method, paid_at, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(brandId, req.body.period, amount, str(req.body.method), paidAt, str(req.body.note), req.user.id);
  res.json({ id: Number(r.lastInsertRowid) });
});

moneyRouter.delete('/payments/:id', adminOnly, (req, res) => {
  db.prepare('DELETE FROM payments WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ---------- tablero ----------
function salesSeries(brandId, from, to) {
  const brandFilter = brandId ? 'AND si.brand_id = ?' : '';
  const args = brandId ? [from, to, brandId] : [from, to];
  return db.prepare(`SELECT s.date, SUM(si.total) AS total, SUM(si.qty) AS units
    FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE s.voided = 0 AND s.date BETWEEN ? AND ? ${brandFilter} GROUP BY s.date ORDER BY s.date`).all(...args);
}
function periodTotals(brandId, period) {
  const brandFilter = brandId ? 'AND si.brand_id = ?' : '';
  const args = brandId ? [period, brandId] : [period];
  return db.prepare(`SELECT COALESCE(SUM(si.total), 0) AS total, COALESCE(SUM(si.qty), 0) AS units, COUNT(DISTINCT s.id) AS tickets
    FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE s.voided = 0 AND substr(s.date, 1, 7) = ? ${brandFilter}`).get(...args);
}
function lastDay(period) {
  const [y, m] = period.split('-').map(Number);
  return `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

moneyRouter.get('/dashboard', (req, res) => {
  const brandId = scopeBrand(req, req.query.brand_id);
  const period = isPeriod(req.query.period) ? req.query.period : currentPeriod();
  const prev = shiftPeriod(period, -1);
  const cur = periodTotals(brandId, period);
  const before = periodTotals(brandId, prev);

  const daily = salesSeries(brandId, `${period}-01`, lastDay(period));
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const p = shiftPeriod(period, -i);
    months.push({ period: p, total: round2(periodTotals(brandId, p).total) });
  }

  const bf = brandId ? 'AND brand_id = ?' : '';
  const ba = brandId ? [brandId] : [];
  const stock = db.prepare(`SELECT COUNT(*) AS skus, COALESCE(SUM(CASE WHEN stock > 0 THEN stock END), 0) AS units,
    COALESCE(SUM(CASE WHEN stock > 0 THEN stock * price END), 0) AS value,
    SUM(CASE WHEN stock <= min_stock THEN 1 ELSE 0 END) AS low
    FROM products WHERE active = 1 ${bf}`).get(...ba);
  const lowStock = db.prepare(`SELECT p.id, p.sku, p.name, p.variant, p.stock, p.min_stock, b.name AS brand_name
    FROM products p JOIN brands b ON b.id = p.brand_id WHERE p.active = 1 AND p.stock <= p.min_stock ${brandId ? 'AND p.brand_id = ?' : ''}
    ORDER BY p.stock, p.name LIMIT 8`).all(...ba);
  const openOrders = db.prepare(`SELECT type, COUNT(*) AS n FROM orders WHERE status IN ('pendiente','listo') ${bf} GROUP BY type`).all(...ba);
  const pickups = db.prepare(`SELECT o.id, o.customer_name, o.external_ref, o.status, o.created_at, b.name AS brand_name
    FROM orders o JOIN brands b ON b.id = o.brand_id WHERE o.type = 'pickup' AND o.status IN ('pendiente','listo') ${brandId ? 'AND o.brand_id = ?' : ''}
    ORDER BY o.created_at LIMIT 8`).all(...ba);

  const topProducts = db.prepare(`SELECT si.sku, si.description, b.name AS brand_name, SUM(si.qty) AS units, SUM(si.total) AS total
    FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN brands b ON b.id = si.brand_id
    WHERE s.voided = 0 AND substr(s.date, 1, 7) = ? ${brandId ? 'AND si.brand_id = ?' : ''}
    GROUP BY si.brand_id, si.sku, si.description ORDER BY units DESC, total DESC LIMIT 8`).all(period, ...ba);

  const brands = db.prepare(`SELECT * FROM brands WHERE active = 1 ${brandId ? 'AND id = ?' : ''} ORDER BY name`).all(...ba);
  const byBrand = brands.map((b) => {
    const s = brandPeriods(b).includes(period) ? settlementFor(b, period) : null;
    const balances = brandPeriods(b).map((p) => settlementFor(b, p).balance);
    const owed = balances.reduce((acc, x) => acc + Math.max(0, x), 0);
    const inFavor = balances.reduce((acc, x) => acc + Math.max(0, -x), 0);
    return { brand_id: b.id, brand_name: b.name, sales: s?.sales_total ?? 0, units: s?.units ?? 0, commission: s?.commission ?? 0, fee: s?.fee ?? 0, total: s?.charges ?? 0, card_credit: s?.card_credit ?? 0, owed: round2(owed), in_favor: round2(inFavor) };
  });

  // la vendedora ve ventas y stock, no comisiones, cuotas ni saldos
  if (req.user.role === 'vendedora') {
    byBrand.forEach((b) => { delete b.commission; delete b.fee; delete b.total; delete b.owed; delete b.in_favor; });
  }
  const money = req.user.role === 'vendedora' ? {} : {
    commission: round2(byBrand.reduce((a, b) => a + b.commission, 0)),
    fees: round2(byBrand.reduce((a, b) => a + b.fee, 0)),
    to_pay: round2(byBrand.reduce((a, b) => a + b.total, 0)),
    owed: round2(byBrand.reduce((a, b) => a + b.owed, 0)),
    in_favor: round2(byBrand.reduce((a, b) => a + b.in_favor, 0)),
  };
  res.json({
    period, prev_period: prev,
    kpis: {
      sales: round2(cur.total), units: cur.units, tickets: cur.tickets, avg_ticket: cur.tickets ? round2(cur.total / cur.tickets) : 0,
      prev_sales: round2(before.total), prev_units: before.units,
      ...money,
    },
    daily: daily.map((d) => ({ ...d, total: round2(d.total) })),
    months, stock, low_stock: lowStock,
    open_orders: Object.fromEntries(openOrders.map((o) => [o.type, o.n])),
    pickups, top_products: topProducts, by_brand: byBrand,
  });
});
