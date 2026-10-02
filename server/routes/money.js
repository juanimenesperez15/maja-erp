import { Router } from 'express';
import { db, tx } from '../db.js';
import {
  auth, adminOnly, staffOnly, notSeller, bad, notFound, forbidden, scopeBrand, requireBrand, moveStock, str, num, round2, today, currentPeriod,
  shiftPeriod, isPeriod, settlementFor, brandPeriods, isPeriodClosed, majaPosCollections, creditOf, audit, notify,
} from '../lib.js';
import { PAYMENT_METHODS, credentialsFor, emitForSale, emitVoidCreditNote, pdfForSale } from '../billing.js';

export const moneyRouter = Router();
moneyRouter.use(auth);

const DOC_TYPES = ['CI', 'RUT', 'PASAPORTE', 'DNI', 'OTRO'];

// ---------- ventas ----------
moneyRouter.get('/sales', (req, res) => {
  const brandId = scopeBrand(req, req.query.brand_id);
  let from = str(req.query.from) || `${currentPeriod()}-01`;
  const to = str(req.query.to) || today();
  // la vendedora consulta lo reciente (para cambios y devoluciones), no el historial de la tienda
  const sellerFrom = new Date(Date.parse(`${today()}T12:00:00Z`) - 6 * 864e5).toISOString().slice(0, 10);
  if (req.user.role === 'vendedora' && from < sellerFrom) from = sellerFrom;
  const where = ['s.date BETWEEN ? AND ?'];
  const args = [from, to];
  if (brandId) { where.push('si.brand_id = ?'); args.push(brandId); }
  if (req.user.role === 'marca' || req.query.include_voided !== '1') where.push('s.voided = 0');
  const rows = db.prepare(`
    SELECT si.*, s.date, s.payment_method, s.pos, s.installments, s.authorization, s.charged, s.exchange_id, s.notes, s.voided, s.cfe_kind, s.customer_doc_type, s.customer_doc, s.customer_name,
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

/**
 * Valida una venta (o una devolución) y arma lo que se va a guardar. No escribe nada.
 * opts.payment / opts.charged permiten forzar el medio y el monto cobrado (cambios de prenda).
 */
function planSale(req, body, opts = {}) {
  const date = str(body.date) || today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw bad('Fecha inválida');
  if (date > today()) throw bad('La fecha no puede ser futura');
  const brandId = Number(body.brand_id);
  const brand = db.prepare('SELECT * FROM brands WHERE id = ?').get(brandId);
  if (!brand) throw bad('Elegí a nombre de qué marca se factura');
  if (!brand.active) throw bad('La marca está inactiva');
  const payment = opts.payment ?? str(body.payment_method);
  if (!PAYMENT_METHODS.includes(payment) && payment !== 'Cambio') throw bad('Elegí el medio de pago');
  const items = Array.isArray(opts.items ?? body.items) ? (opts.items ?? body.items) : [];
  if (!items.length) throw bad('La venta no tiene artículos');
  // con tarjeta: en qué POS se pasó (cada marca tiene el suyo y MAJA el propio) y el n° de autorización del voucher
  const card = ['Débito', 'Crédito'].includes(payment);
  const pos = card ? (['maja', 'marca'].includes(body.pos) ? body.pos : null) : null;
  if (card && !pos) throw bad('Indicá en qué POS se pasó la tarjeta: el de MAJA o el de la marca');
  const authorization = card ? str(body.authorization)?.replace(/\s/g, '') ?? null : null;
  if (card && !authorization) throw bad('Anotá el n° de autorización que figura en el voucher de la tarjeta');
  if (card && !/^[A-Za-z0-9]{3,12}$/.test(authorization)) throw bad('El n° de autorización tiene que ser el código del voucher (solo letras y números)');
  const installments = payment === 'Crédito' ? Math.max(1, Math.min(36, Math.trunc(num(body.installments, 1)))) : null;

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
  const kind = body.cfe_kind === 'factura' ? 'factura' : 'ticket';
  const docType = DOC_TYPES.includes(body.customer_doc_type) ? body.customer_doc_type : null;
  const doc = str(body.customer_doc);
  const customerName = str(body.customer_name);
  if (kind === 'factura' && (docType !== 'RUT' || !doc || !customerName)) throw bad('La e-Factura necesita el RUT y la razón social del cliente');

  const electronic = brand.billing_mode !== 'manual';
  if (electronic) credentialsFor(brand); // valida la configuración antes de guardar nada
  const negatives = clean.filter((c) => c.qty < 0).length;
  let refSaleId = null;
  if (negatives) {
    if (electronic && negatives !== clean.length) throw bad('Con factura electrónica la devolución va sola: usá "Cambio" para devolver y llevar otra prenda');
    refSaleId = Number(body.ref_sale_id) || null;
    if (electronic || refSaleId) {
      const orig = refSaleId && db.prepare('SELECT * FROM sales WHERE id = ?').get(refSaleId);
      if (!orig || orig.brand_id !== brandId) throw bad('Indicá el número de la venta original (de esta marca) que se devuelve');
      if (orig.voided) throw bad(`La venta #${refSaleId} está anulada`);
      if (electronic && !orig.cfe_id) throw bad(`La venta #${refSaleId} no tiene comprobante electrónico emitido`);
      // no se puede devolver más de lo que se vendió (contando devoluciones anteriores)
      const sold = Object.fromEntries(db.prepare('SELECT product_id, SUM(qty) AS n FROM sale_items WHERE sale_id = ? AND qty > 0 AND product_id IS NOT NULL GROUP BY product_id').all(orig.id).map((r) => [r.product_id, r.n]));
      const back = Object.fromEntries(db.prepare(`SELECT si.product_id, -SUM(si.qty) AS n FROM sale_items si JOIN sales s ON s.id = si.sale_id
        WHERE s.ref_sale_id = ? AND s.voided = 0 AND si.qty < 0 AND si.product_id IS NOT NULL GROUP BY si.product_id`).all(orig.id).map((r) => [r.product_id, r.n]));
      for (const c of clean.filter((x) => x.qty < 0 && x.product_id)) {
        const left = (sold[c.product_id] ?? 0) - (back[c.product_id] ?? 0);
        if (-c.qty > left) throw bad(left > 0 ? `De ${c.description} solo quedan ${left} por devolver en la venta #${orig.id}` : `${c.description} no está en la venta #${orig.id} o ya se devolvió`);
      }
    }
  }
  const invoiceNumber = opts.invoiceNumber !== undefined ? opts.invoiceNumber : str(body.invoice_number);
  // en una devolución de una marca que factura a mano, el n° de la nota de crédito es opcional
  if (!electronic && !invoiceNumber && opts.requireInvoice !== false && !(negatives && negatives === clean.length)) throw bad(`${brand.name} factura a mano: anotá el número de la factura`);
  if (isPeriodClosed(brandId, date.slice(0, 7))) throw bad(`La liquidación de ${brand.name} de ese mes ya está cerrada. Reabrila para cargar la venta.`);

  return { date, brand, payment, pos, installments, authorization, clean, kind, docType, doc, customerName, email: str(body.customer_email), electronic, refSaleId, invoiceNumber, charged: opts.charged ?? null, notes: str(body.notes) };
}

/** Guarda una venta ya validada (dentro de una transacción) y mueve el stock. */
function insertSale(req, plan, exchangeId = null) {
  const r = db.prepare(`INSERT INTO sales (date, brand_id, payment_method, pos, installments, authorization, charged, exchange_id, notes, created_by, cfe_kind,
      customer_doc_type, customer_doc, customer_name, customer_email, invoice_status, invoice_number, ref_sale_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(plan.date, plan.brand.id, plan.payment, plan.pos, plan.installments, plan.authorization, plan.charged, exchangeId, plan.notes, req.user.id, plan.kind,
      plan.docType, plan.doc, plan.customerName, plan.email, plan.electronic ? 'pendiente' : 'manual', plan.electronic ? null : plan.invoiceNumber, plan.refSaleId);
  const sid = Number(r.lastInsertRowid);
  const ins = db.prepare('INSERT INTO sale_items (sale_id, brand_id, product_id, sku, description, qty, unit_price, discount_pct, total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const c of plan.clean) {
    ins.run(sid, plan.brand.id, c.product_id, c.sku, c.description, c.qty, c.unit_price, c.discount_pct, c.total);
    // venta descuenta stock; devolución (cantidad negativa) lo repone
    if (c.product_id) moveStock({ productId: c.product_id, brandId: plan.brand.id, qty: -c.qty, reason: c.qty > 0 ? 'venta' : 'devolucion', refType: 'sale', refId: sid, userId: req.user.id });
  }
  return sid;
}

const saleResult = (s) => ({ id: s.id, invoice_status: s.invoice_status, invoice_number: s.invoice_number, invoice_error: s.invoice_error });

moneyRouter.post('/sales', staffOnly, async (req, res) => {
  const plan = planSale(req, req.body);
  const id = tx(() => insertSale(req, plan));
  // la venta queda guardada aunque Biller falle: la factura se puede reintentar
  const sale = plan.electronic ? await emitForSale(id) : db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
  res.json(saleResult(sale));
});

/**
 * Cambio de prenda en un paso: devuelve unas prendas y se lleva otras de la misma marca.
 * Se guardan dos comprobantes (la devolución y la venta nueva) y solo se cobra o devuelve la diferencia.
 */
moneyRouter.post('/sales/exchange', staffOnly, async (req, res) => {
  const b = req.body;
  const returns = (Array.isArray(b.returns) ? b.returns : []).map((it) => ({ ...it, qty: -Math.abs(Math.trunc(num(it.qty))) }));
  const takes = (Array.isArray(b.items) ? b.items : []).map((it) => ({ ...it, qty: Math.abs(Math.trunc(num(it.qty))) }));
  if (!returns.length) throw bad('Elegí qué prendas devuelve');
  if (!takes.length) throw bad('Elegí qué prendas se lleva');
  const sum = (list) => round2(list.reduce((a, it) => a + Math.abs(it.qty) * num(it.unit_price) * (1 - Math.min(100, Math.max(0, num(it.discount_pct))) / 100), 0));
  const diff = round2(sum(takes) - sum(returns));
  const method = str(b.payment_method);
  if (Math.abs(diff) > 0.009 && !PAYMENT_METHODS.includes(method)) throw bad(diff > 0 ? 'Elegí cómo paga la diferencia' : 'Elegí cómo se le devuelve la diferencia');
  // el medio y la tarjeta solo van en el comprobante por donde pasa la plata
  const noCard = { ...b, pos: null, authorization: null };
  const retPlan = planSale(req, diff < -0.009 ? b : noCard, { items: returns, payment: diff < -0.009 ? method : 'Cambio', charged: diff < -0.009 ? diff : 0, invoiceNumber: str(b.return_invoice_number), requireInvoice: false });
  const newPlan = planSale(req, { ...(diff > 0.009 ? b : noCard), ref_sale_id: null }, { items: takes, payment: diff > 0.009 ? method : 'Cambio', charged: diff > 0.009 ? diff : 0 });
  const [retId, newId] = tx(() => {
    const r = insertSale(req, retPlan);
    db.prepare('UPDATE sales SET exchange_id = ? WHERE id = ?').run(r, r);
    const n = insertSale(req, newPlan, r);
    return [r, n];
  });
  const ret = retPlan.electronic ? await emitForSale(retId) : db.prepare('SELECT * FROM sales WHERE id = ?').get(retId);
  const neu = newPlan.electronic ? await emitForSale(newId) : db.prepare('SELECT * FROM sales WHERE id = ?').get(newId);
  audit(req, 'cambio', { entity: 'venta', entityId: newId, brandId: newPlan.brand.id, summary: `Cambio: devolución #${retId} y venta #${newId} de ${newPlan.brand.name}, diferencia $ ${diff}` });
  res.json({ difference: diff, return_sale: saleResult(ret), new_sale: saleResult(neu) });
});

// una venta con sus líneas (para un cambio o devolución, aunque sea de hace más de 7 días)
moneyRouter.get('/sales/:id', (req, res) => {
  const sale = db.prepare('SELECT s.*, b.name AS brand_name FROM sales s JOIN brands b ON b.id = s.brand_id WHERE s.id = ?').get(Number(req.params.id));
  if (!sale) throw notFound(`No existe la venta #${req.params.id}`);
  if (req.user.role === 'marca' && sale.brand_id !== req.user.brand_id) throw forbidden();
  const items = db.prepare(`SELECT si.*, p.variant, p.barcode, p.stock FROM sale_items si LEFT JOIN products p ON p.id = si.product_id WHERE si.sale_id = ? ORDER BY si.id`).all(sale.id);
  // cuánto de cada línea ya se devolvió en devoluciones o cambios posteriores
  const returned = Object.fromEntries(db.prepare(`SELECT si.product_id, -SUM(si.qty) AS n FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE s.ref_sale_id = ? AND s.voided = 0 AND si.qty < 0 GROUP BY si.product_id`).all(sale.id).map((r) => [r.product_id, r.n]));
  res.json({ ...sale, items: items.map((i) => ({ ...i, returned: returned[i.product_id] ?? 0 })) });
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
  const total = items.reduce((a, i) => a + i.total, 0);
  audit(req, 'anulacion', { entity: 'venta', entityId: sale.id, brandId: sale.brand_id, summary: `Anuló la venta #${sale.id} ($ ${total})${nc ? ` con ${nc.number}` : ''}: ${str(req.body.reason) || 'sin motivo'}` });
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
  audit(req, 'liquidacion_cierre', { entity: 'liquidacion', brandId, summary: `Cerró la liquidación de ${brand.name} de ${period}: total $ ${s.total}` });
  notify({ audience: 'brand', brandId, title: `Liquidación de ${period.split('-').reverse().join('/')} cerrada`, body: s.total >= 0 ? `Total a pagar a MAJA: $ ${s.total}` : `MAJA te debe $ ${-s.total}`, link: '/liquidaciones' });
  res.json(settlementFor(brand, period));
});

moneyRouter.post('/settlements/reopen', adminOnly, (req, res) => {
  const brandId = requireBrand(req, req.body.brand_id);
  db.prepare('DELETE FROM settlements WHERE brand_id = ? AND period = ?').run(brandId, req.body.period);
  audit(req, 'liquidacion_reapertura', { entity: 'liquidacion', brandId, summary: `Reabrió la liquidación de ${db.prepare('SELECT name FROM brands WHERE id = ?').get(brandId).name} de ${req.body.period}` });
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
  const bn = db.prepare('SELECT name FROM brands WHERE id = ?').get(brandId).name;
  audit(req, 'pago', { entity: 'pago', entityId: Number(r.lastInsertRowid), brandId, summary: amount > 0 ? `Registró pago de ${bn} a MAJA: $ ${amount} (${req.body.period})` : `Registró pago de MAJA a ${bn}: $ ${-amount} (${req.body.period})` });
  res.json({ id: Number(r.lastInsertRowid) });
});

moneyRouter.delete('/payments/:id', adminOnly, (req, res) => {
  const pm = db.prepare('SELECT pm.*, b.name AS brand_name FROM payments pm JOIN brands b ON b.id = pm.brand_id WHERE pm.id = ?').get(Number(req.params.id));
  db.prepare('DELETE FROM payments WHERE id = ?').run(Number(req.params.id));
  if (pm) audit(req, 'pago_borrado', { entity: 'pago', entityId: pm.id, brandId: pm.brand_id, summary: `Borró un pago de ${pm.brand_name} de $ ${pm.amount} (${pm.period})` });
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

moneyRouter.get('/dashboard', notSeller, (req, res) => {
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
