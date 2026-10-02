import { Router } from 'express';
import { db, tx } from '../db.js';
import { auth, adminOnly, staffOnly, bad, num, round2, today, currentPeriod, shiftPeriod, isPeriod, settlementFor, brandPeriods } from '../lib.js';

export const insightsRouter = Router();
insightsRouter.use(auth);

const daysIn = (period) => { const [y, m] = period.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);

/** Ventas por marca en un rango de fechas (inclusive). */
function salesByBrand(from, to) {
  const rows = db.prepare(`SELECT si.brand_id, SUM(si.total) AS total, SUM(si.qty) AS units, COUNT(DISTINCT s.id) AS tickets
    FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE s.voided = 0 AND s.date BETWEEN ? AND ? GROUP BY si.brand_id`).all(from, to);
  return Object.fromEntries(rows.map((r) => [r.brand_id, r]));
}

// ---------- cómo va cada marca ----------
insightsRouter.get('/performance', adminOnly, (req, res) => {
  const period = isPeriod(req.query.period) ? req.query.period : currentPeriod();
  const now = today();
  const cur = currentPeriod();
  const total = daysIn(period);
  // parte del mes que ya pasó: 1 en meses cerrados, día de hoy / días del mes en el actual
  const dayNow = period === cur ? Number(now.slice(8)) : period < cur ? total : 0;
  const elapsed = dayNow / total;
  const lastDay = `${period}-${String(total).padStart(2, '0')}`;
  const prev = shiftPeriod(period, -1);
  const prevDayCut = Math.min(dayNow, daysIn(prev));

  const cur_ = salesByBrand(`${period}-01`, lastDay);
  // contra el mismo tramo del mes anterior (del 1 al mismo día), para no comparar medio mes con un mes entero
  const prevToDate = salesByBrand(`${prev}-01`, `${prev}-${String(Math.max(prevDayCut, 1)).padStart(2, '0')}`);
  const prevFull = salesByBrand(`${prev}-01`, `${prev}-${String(daysIn(prev)).padStart(2, '0')}`);
  const ly = shiftPeriod(period, -12);
  const lastYear = salesByBrand(`${ly}-01`, `${ly}-${String(daysIn(ly)).padStart(2, '0')}`);
  const goals = Object.fromEntries(db.prepare('SELECT brand_id, amount FROM sales_goals WHERE period = ?').all(period).map((g) => [g.brand_id, g.amount]));
  const lastSale = Object.fromEntries(db.prepare(`SELECT si.brand_id, MAX(s.date) AS d FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE s.voided = 0 AND si.qty > 0 GROUP BY si.brand_id`).all().map((r) => [r.brand_id, r.d]));
  const stock = Object.fromEntries(db.prepare(`SELECT brand_id, SUM(CASE WHEN stock > 0 THEN stock ELSE 0 END) AS units,
    SUM(CASE WHEN stock > 0 THEN stock * price ELSE 0 END) AS value FROM products WHERE active = 1 GROUP BY brand_id`).all().map((r) => [r.brand_id, r]));
  const sold30 = Object.fromEntries(db.prepare(`SELECT si.brand_id, SUM(si.qty) AS units FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE s.voided = 0 AND s.date > date(?, '-30 day') AND s.date <= ? GROUP BY si.brand_id`).all(now, now).map((r) => [r.brand_id, r.units]));

  const isOwner = req.user.role === 'admin';
  const brands = db.prepare('SELECT * FROM brands WHERE active = 1 ORDER BY name').all();
  const storeSales = Object.values(cur_).reduce((a, r) => a + r.total, 0);

  const rows = brands.map((b) => {
    const s = cur_[b.id] ?? { total: 0, units: 0, tickets: 0 };
    const goal = goals[b.id] ?? null;
    const projection = elapsed > 0 ? s.total / elapsed : 0;
    const prevCmp = (period === cur ? prevToDate[b.id]?.total : prevFull[b.id]?.total) ?? 0;
    const st = stock[b.id] ?? { units: 0, value: 0 };
    const daily30 = (sold30[b.id] ?? 0) / 30;
    const last = lastSale[b.id] ?? null;
    const row = {
      brand_id: b.id, brand_name: b.name,
      sales: round2(s.total), units: s.units, tickets: s.tickets, avg_ticket: s.tickets ? round2(s.total / s.tickets) : 0,
      share: storeSales ? s.total / storeSales : 0,
      goal, pct_goal: goal ? s.total / goal : null,
      // ritmo: 1 = va justo para llegar al objetivo; < 1 = va atrasada
      pace: goal && elapsed > 0 ? (s.total / goal) / elapsed : null,
      projection: round2(projection), pct_projection: goal ? projection / goal : null,
      prev_sales: round2(prevCmp), delta_prev: prevCmp ? (s.total - prevCmp) / prevCmp : null,
      last_year_sales: round2(lastYear[b.id]?.total ?? 0),
      last_sale: last, days_since_sale: last ? dayDiff(last, now) : null,
      stock_units: st.units, stock_value: round2(st.value),
      coverage_days: daily30 > 0 ? Math.round(st.units / daily30) : null,
    };
    if (isOwner && brandPeriods(b).includes(period)) {
      const sett = settlementFor(b, period);
      row.commission = sett.commission;
      row.fee = sett.fee;
    }
    return row;
  });

  // alertas, de la más grave a la más leve
  const alerts = [];
  const withPace = rows.filter((r) => r.pace !== null);
  if (withPace.length && period === cur) {
    const low = [...withPace].sort((a, b) => a.pace - b.pace)[0];
    if (low.pace < 1) alerts.push({ level: 'bad', brand_id: low.brand_id, text: `${low.brand_name} es la que va más baja: lleva el ${Math.round(low.pct_goal * 100)} % del objetivo con el ${Math.round(elapsed * 100)} % del mes.` });
    for (const r of withPace) if (r !== low && r.pace < 0.8) alerts.push({ level: 'warn', brand_id: r.brand_id, text: `${r.brand_name} va atrasada: proyecta ${Math.round(r.pct_projection * 100)} % del objetivo.` });
  }
  for (const r of rows) {
    if (r.days_since_sale !== null && r.days_since_sale >= 7) alerts.push({ level: 'warn', brand_id: r.brand_id, text: `${r.brand_name} no vende hace ${r.days_since_sale} días.` });
    else if (r.last_sale === null && r.stock_units > 0) alerts.push({ level: 'warn', brand_id: r.brand_id, text: `${r.brand_name} todavía no registró ventas.` });
    if (r.delta_prev !== null && r.delta_prev <= -0.3 && r.prev_sales > 0) alerts.push({ level: 'warn', brand_id: r.brand_id, text: `${r.brand_name} vende ${Math.round(-r.delta_prev * 100)} % menos que en el mismo tramo del mes pasado.` });
    if (r.stock_units === 0) alerts.push({ level: 'info', brand_id: r.brand_id, text: `${r.brand_name} no tiene stock en la tienda.` });
    else if (r.coverage_days !== null && r.coverage_days < 14) alerts.push({ level: 'info', brand_id: r.brand_id, text: `${r.brand_name} tiene stock para unos ${r.coverage_days} días al ritmo actual.` });
  }
  const noGoal = rows.filter((r) => r.goal === null).length;
  if (isOwner && noGoal && period >= cur) alerts.push({ level: 'info', text: `${noGoal} ${noGoal === 1 ? 'marca no tiene' : 'marcas no tienen'} objetivo para este mes.`, action: 'goals' });

  const storeGoal = rows.reduce((a, r) => a + (r.goal ?? 0), 0);
  const byPayment = db.prepare(`SELECT COALESCE(s.payment_method, 'Sin dato') AS method, SUM(si.total) AS total, COUNT(DISTINCT s.id) AS tickets
    FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.voided = 0 AND substr(s.date, 1, 7) = ? GROUP BY method ORDER BY total DESC`).all(period);
  const bySeller = db.prepare(`SELECT COALESCE(u.name, '—') AS seller, u.role, SUM(si.total) AS total, SUM(si.qty) AS units, COUNT(DISTINCT s.id) AS tickets
    FROM sale_items si JOIN sales s ON s.id = si.sale_id LEFT JOIN users u ON u.id = s.created_by
    WHERE s.voided = 0 AND substr(s.date, 1, 7) = ? GROUP BY s.created_by ORDER BY total DESC`).all(period);
  const todaySales = db.prepare(`SELECT COALESCE(SUM(si.total), 0) AS total, COUNT(DISTINCT s.id) AS tickets FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE s.voided = 0 AND s.date = ?`).get(now);

  res.json({
    period, elapsed, day: dayNow, days: total,
    store: {
      sales: round2(storeSales), goal: storeGoal || null, pct_goal: storeGoal ? storeSales / storeGoal : null,
      projection: round2(elapsed > 0 ? storeSales / elapsed : 0),
      prev_sales: round2(Object.values(period === cur ? prevToDate : prevFull).reduce((a, r) => a + r.total, 0)),
      today: round2(todaySales.total), today_tickets: todaySales.tickets,
    },
    rows, alerts,
    by_payment: byPayment.map((r) => ({ ...r, total: round2(r.total) })),
    by_seller: bySeller.map((r) => ({ ...r, total: round2(r.total) })),
  });
});

// ---------- tablero de la vendedora: lo del día ----------
insightsRouter.get('/shift', staffOnly, (req, res) => {
  const now = today();
  const store = db.prepare(`SELECT COALESCE(SUM(si.total), 0) AS total, COUNT(DISTINCT s.id) AS tickets, COALESCE(SUM(si.qty), 0) AS units
    FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.voided = 0 AND s.date = ?`).get(now);
  const mine = db.prepare(`SELECT COALESCE(SUM(si.total), 0) AS total, COUNT(DISTINCT s.id) AS tickets
    FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.voided = 0 AND s.date = ? AND s.created_by = ?`).get(now, req.user.id);
  const orders = db.prepare(`SELECT o.id, o.type, o.status, o.customer_name, o.external_ref, o.created_at, b.name AS brand_name,
      (SELECT COALESCE(SUM(qty), 0) FROM order_items WHERE order_id = o.id) AS units,
      (SELECT COALESCE(SUM(picked_qty), 0) FROM order_items WHERE order_id = o.id) AS picked_units
    FROM orders o JOIN brands b ON b.id = o.brand_id WHERE o.status IN ('pendiente','listo') ORDER BY o.created_at`).all();
  const lowStock = db.prepare(`SELECT p.id, p.sku, p.name, p.variant, p.stock, b.name AS brand_name FROM products p JOIN brands b ON b.id = p.brand_id
    WHERE p.active = 1 AND b.active = 1 AND p.stock <= p.min_stock ORDER BY p.stock, p.name LIMIT 12`).all();
  const pendingInvoices = db.prepare(`SELECT COUNT(*) AS n FROM sales WHERE voided = 0 AND invoice_status IN ('error','pendiente')`).get().n;
  res.json({ date: now, store: { ...store, total: round2(store.total) }, mine: { ...mine, total: round2(mine.total) }, orders, low_stock: lowStock, pending_invoices: pendingInvoices });
});

// ---------- objetivos de venta ----------
insightsRouter.get('/goals', adminOnly, (req, res) => {
  const period = isPeriod(req.query.period) ? req.query.period : currentPeriod();
  const prev = shiftPeriod(period, -1);
  const ly = shiftPeriod(period, -12);
  const lastDayOf = (p) => `${p}-${String(daysIn(p)).padStart(2, '0')}`;
  const prevSales = salesByBrand(`${prev}-01`, lastDayOf(prev));
  const lySales = salesByBrand(`${ly}-01`, lastDayOf(ly));
  const curSales = salesByBrand(`${period}-01`, lastDayOf(period));
  const goals = Object.fromEntries(db.prepare('SELECT brand_id, amount FROM sales_goals WHERE period = ?').all(period).map((g) => [g.brand_id, g.amount]));
  const prevGoals = Object.fromEntries(db.prepare('SELECT brand_id, amount FROM sales_goals WHERE period = ?').all(prev).map((g) => [g.brand_id, g.amount]));
  const brands = db.prepare('SELECT id, name FROM brands WHERE active = 1 ORDER BY name').all();
  res.json({
    period,
    rows: brands.map((b) => ({
      brand_id: b.id, brand_name: b.name, goal: goals[b.id] ?? null, prev_goal: prevGoals[b.id] ?? null,
      sales: round2(curSales[b.id]?.total ?? 0), prev_sales: round2(prevSales[b.id]?.total ?? 0), last_year_sales: round2(lySales[b.id]?.total ?? 0),
    })),
  });
});

insightsRouter.put('/goals', adminOnly, (req, res) => {
  const period = req.body.period;
  if (!isPeriod(period)) throw bad('Mes inválido');
  const list = Array.isArray(req.body.goals) ? req.body.goals : [];
  tx(() => {
    for (const g of list) {
      const brandId = Number(g.brand_id);
      if (!db.prepare('SELECT 1 FROM brands WHERE id = ?').get(brandId)) continue;
      if (g.amount === '' || g.amount === null || g.amount === undefined) {
        db.prepare('DELETE FROM sales_goals WHERE brand_id = ? AND period = ?').run(brandId, period);
        continue;
      }
      const amount = round2(num(g.amount));
      if (amount < 0) throw bad('El objetivo no puede ser negativo');
      db.prepare(`INSERT INTO sales_goals (brand_id, period, amount) VALUES (?, ?, ?)
        ON CONFLICT(brand_id, period) DO UPDATE SET amount = excluded.amount, updated_at = datetime('now')`).run(brandId, period, amount);
    }
  });
  res.json({ ok: true });
});
