import { Router } from 'express';
import { db, tx } from '../db.js';
import {
  auth, adminOnly, bad, notFound, scopeBrand, requireBrand, moveStock, str, num, round2, today, currentPeriod,
  shiftPeriod, isPeriod, settlementFor, brandPeriods, isPeriodClosed,
} from '../lib.js';

export const moneyRouter = Router();
moneyRouter.use(auth);

const PAYMENT_METHODS = ['Efectivo', 'Débito', 'Crédito', 'Transferencia', 'Mercado Pago', 'Otro'];

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
    SELECT si.*, s.date, s.ticket, s.payment_method, s.notes, s.voided, b.name AS brand_name, p.variant
    FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN brands b ON b.id = si.brand_id
    LEFT JOIN products p ON p.id = si.product_id
    WHERE ${where.join(' AND ')} ORDER BY s.date DESC, s.id DESC, si.id`).all(...args);
  // la marca no ve qué más se llevó el cliente de otras marcas
  if (req.user.role === 'marca') rows.forEach((r) => { delete r.notes; });
  res.json({ from, to, rows, payment_methods: PAYMENT_METHODS });
});

moneyRouter.post('/sales', adminOnly, (req, res) => {
  const date = str(req.body.date) || today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw bad('Fecha inválida');
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) throw bad('La venta no tiene artículos');

  const clean = items.map((it) => {
    const qty = Math.trunc(num(it.qty));
    if (!qty) throw bad('Hay una línea con cantidad 0');
    const unit = num(it.unit_price);
    if (unit < 0) throw bad('Precio negativo');
    const disc = Math.min(100, Math.max(0, num(it.discount_pct)));
    let line;
    if (it.product_id) {
      const p = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(it.product_id));
      if (!p) throw bad('Artículo inexistente');
      line = { brand_id: p.brand_id, product_id: p.id, sku: p.sku, description: p.name };
    } else {
      const b = db.prepare('SELECT id FROM brands WHERE id = ?').get(Number(it.brand_id));
      if (!b || !str(it.description)) throw bad('Las líneas sin artículo necesitan marca y descripción');
      line = { brand_id: b.id, product_id: null, sku: str(it.sku), description: str(it.description) };
    }
    return { ...line, qty, unit_price: unit, discount_pct: disc, total: round2(qty * unit * (1 - disc / 100)) };
  });

  const period = date.slice(0, 7);
  for (const bId of new Set(clean.map((c) => c.brand_id))) {
    if (isPeriodClosed(bId, period)) throw bad('La liquidación de ese mes ya está cerrada para una de las marcas. Reabrila para cargar la venta.');
  }

  const id = tx(() => {
    const r = db.prepare('INSERT INTO sales (date, ticket, payment_method, notes, created_by) VALUES (?, ?, ?, ?, ?)')
      .run(date, str(req.body.ticket), str(req.body.payment_method), str(req.body.notes), req.user.id);
    const sid = Number(r.lastInsertRowid);
    const ins = db.prepare('INSERT INTO sale_items (sale_id, brand_id, product_id, sku, description, qty, unit_price, discount_pct, total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const c of clean) {
      ins.run(sid, c.brand_id, c.product_id, c.sku, c.description, c.qty, c.unit_price, c.discount_pct, c.total);
      // venta descuenta stock; devolución (cantidad negativa) lo repone
      if (c.product_id) moveStock({ productId: c.product_id, brandId: c.brand_id, qty: -c.qty, reason: c.qty > 0 ? 'venta' : 'devolucion', refType: 'sale', refId: sid, userId: req.user.id });
    }
    return sid;
  });
  res.json({ id });
});

moneyRouter.post('/sales/:id/void', adminOnly, (req, res) => {
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(Number(req.params.id));
  if (!sale) throw notFound('Venta inexistente');
  if (sale.voided) throw bad('La venta ya estaba anulada');
  const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(sale.id);
  for (const bId of new Set(items.map((i) => i.brand_id))) {
    if (isPeriodClosed(bId, sale.date.slice(0, 7))) throw bad('El mes de esta venta ya está liquidado. Reabrí la liquidación primero.');
  }
  tx(() => {
    for (const it of items) {
      if (it.product_id) moveStock({ productId: it.product_id, brandId: it.brand_id, qty: it.qty, reason: 'anulacion', refType: 'sale', refId: sale.id, note: str(req.body.reason), userId: req.user.id });
    }
    db.prepare('UPDATE sales SET voided = 1, notes = TRIM(COALESCE(notes, \'\') || ? ) WHERE id = ?').run(` [Anulada: ${str(req.body.reason) || 'sin motivo'}]`, sale.id);
  });
  res.json({ ok: true });
});

// ---------- liquidaciones (comisiones + cuotas) ----------
moneyRouter.get('/settlements', (req, res) => {
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

moneyRouter.get('/settlements/detail', (req, res) => {
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
  res.json({ settlement, payments, products });
});

moneyRouter.post('/settlements/close', adminOnly, (req, res) => {
  const brandId = requireBrand(req, req.body.brand_id);
  const period = req.body.period;
  if (!isPeriod(period)) throw bad('Mes inválido');
  if (isPeriodClosed(brandId, period)) throw bad('Ese mes ya está cerrado');
  const brand = db.prepare('SELECT * FROM brands WHERE id = ?').get(brandId);
  const s = settlementFor(brand, period);
  db.prepare(`INSERT INTO settlements (brand_id, period, sales_total, units, commission_pct, commission, fee, iva, total, closed_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(brandId, period, s.sales_total, s.units, s.commission_pct, s.commission, s.fee, s.iva, s.total, req.user.id);
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
    const owed = brandPeriods(b).reduce((acc, p) => acc + Math.max(0, settlementFor(b, p).balance), 0);
    return { brand_id: b.id, brand_name: b.name, sales: s?.sales_total ?? 0, units: s?.units ?? 0, commission: s?.commission ?? 0, fee: s?.fee ?? 0, total: s?.total ?? 0, owed: round2(owed) };
  });

  res.json({
    period, prev_period: prev,
    kpis: {
      sales: round2(cur.total), units: cur.units, tickets: cur.tickets, avg_ticket: cur.tickets ? round2(cur.total / cur.tickets) : 0,
      prev_sales: round2(before.total), prev_units: before.units,
      commission: round2(byBrand.reduce((a, b) => a + b.commission, 0)),
      fees: round2(byBrand.reduce((a, b) => a + b.fee, 0)),
      to_pay: round2(byBrand.reduce((a, b) => a + b.total, 0)),
      owed: round2(byBrand.reduce((a, b) => a + b.owed, 0)),
    },
    daily: daily.map((d) => ({ ...d, total: round2(d.total) })),
    months, stock, low_stock: lowStock,
    open_orders: Object.fromEntries(openOrders.map((o) => [o.type, o.n])),
    pickups, top_products: topProducts, by_brand: byBrand,
  });
});
