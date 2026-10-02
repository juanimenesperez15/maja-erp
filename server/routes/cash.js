import { Router } from 'express';
import { db } from '../db.js';
import { auth, adminOnly, staffOnly, bad, notFound, num, round2, str, today, audit, notify } from '../lib.js';

/*
 * Caja diaria: la vendedora abre la caja con el fondo, anota las entradas y salidas de efectivo
 * que no son ventas y al cerrar cuenta la plata. El sistema compara contra lo que debería haber.
 */
export const cashRouter = Router();
cashRouter.use('/cash', auth, staffOnly);

const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d));

/** Lo que se cobró en el día por medio de pago (con lo cobrado real: en un cambio puede ser solo la diferencia). */
function dayTotals(date) {
  const rows = db.prepare(`SELECT s.id, s.payment_method, s.pos, COALESCE(s.charged, (SELECT SUM(total) FROM sale_items WHERE sale_id = s.id)) AS amount
    FROM sales s WHERE s.voided = 0 AND s.date = ?`).all(date);
  const by = {};
  for (const r of rows) {
    const key = ['Débito', 'Crédito'].includes(r.payment_method) ? `${r.payment_method} · ${r.pos === 'maja' ? 'POS de MAJA' : r.pos === 'marca' ? 'POS de la marca' : 'sin POS'}` : r.payment_method || 'Sin dato';
    (by[key] ??= { method: key, count: 0, total: 0 });
    by[key].count++;
    by[key].total = round2(by[key].total + (r.amount || 0));
  }
  const cash = round2(rows.filter((r) => r.payment_method === 'Efectivo').reduce((a, r) => a + (r.amount || 0), 0));
  return { cash, by_method: Object.values(by).sort((a, b) => b.total - a.total) };
}

function sessionView(session) {
  const movements = db.prepare(`SELECT m.*, u.name AS user_name FROM cash_movements m LEFT JOIN users u ON u.id = m.user_id WHERE m.session_id = ? ORDER BY m.id`).all(session.id);
  const ins = round2(movements.filter((m) => m.kind === 'ingreso').reduce((a, m) => a + m.amount, 0));
  const outs = round2(movements.filter((m) => m.kind === 'retiro').reduce((a, m) => a + m.amount, 0));
  const totals = dayTotals(session.date);
  const expected = round2(session.opening_float + totals.cash + ins - outs);
  const names = Object.fromEntries(db.prepare('SELECT id, name FROM users WHERE id IN (?, ?)').all(session.opened_by ?? 0, session.closed_by ?? 0).map((u) => [u.id, u.name]));
  return {
    ...session, opened_by_name: names[session.opened_by] ?? null, closed_by_name: names[session.closed_by] ?? null,
    card_summary: session.card_summary ? JSON.parse(session.card_summary) : null,
    movements, ins, outs, cash_sales: totals.cash, by_method: totals.by_method,
    // cerrada: lo que se calculó al cerrar; abierta: en vivo
    expected_now: expected,
  };
}

cashRouter.get('/cash', (req, res) => {
  const date = isDate(req.query.date) ? req.query.date : today();
  const session = db.prepare('SELECT * FROM cash_sessions WHERE date = ?').get(date);
  // la vendedora ve las últimas cajas; la dueña, el último mes con sus diferencias
  const history = db.prepare(`SELECT cs.date, cs.status, cs.opening_float, cs.expected_cash, cs.counted_cash, cs.difference, u.name AS closed_by_name
    FROM cash_sessions cs LEFT JOIN users u ON u.id = cs.closed_by ORDER BY cs.date DESC LIMIT ?`).all(req.user.role === 'admin' ? 31 : 5);
  res.json({ date, session: session ? sessionView(session) : null, day: dayTotals(date), history });
});

cashRouter.post('/cash/open', (req, res) => {
  const date = today();
  if (db.prepare('SELECT 1 FROM cash_sessions WHERE date = ?').get(date)) throw bad('La caja de hoy ya está abierta');
  const float = round2(num(req.body.opening_float));
  if (float < 0) throw bad('El fondo no puede ser negativo');
  db.prepare('INSERT INTO cash_sessions (date, opening_float, opened_by) VALUES (?, ?, ?)').run(date, float, req.user.id);
  audit(req, 'caja_apertura', { entity: 'caja', summary: `Abrió la caja del ${date} con $ ${float}` });
  res.json({ ok: true });
});

cashRouter.post('/cash/movements', (req, res) => {
  const s = db.prepare("SELECT * FROM cash_sessions WHERE date = ? AND status = 'abierta'").get(today());
  if (!s) throw bad('Primero abrí la caja de hoy');
  const kind = req.body.kind === 'ingreso' ? 'ingreso' : 'retiro';
  const amount = round2(num(req.body.amount));
  if (amount <= 0) throw bad('Poné el monto');
  if (!str(req.body.reason)) throw bad('Contá el motivo (ej. pago de flete, cambio para la caja)');
  db.prepare('INSERT INTO cash_movements (session_id, kind, amount, reason, user_id) VALUES (?, ?, ?, ?, ?)').run(s.id, kind, amount, str(req.body.reason), req.user.id);
  audit(req, `caja_${kind}`, { entity: 'caja', entityId: s.id, summary: `${kind === 'ingreso' ? 'Ingreso' : 'Retiro'} de efectivo $ ${amount}: ${str(req.body.reason)}` });
  res.json({ ok: true });
});

cashRouter.post('/cash/close', (req, res) => {
  const s = db.prepare("SELECT * FROM cash_sessions WHERE date = ? AND status = 'abierta'").get(isDate(req.body.date) ? req.body.date : today());
  if (!s) throw bad('No hay caja abierta para cerrar');
  if (req.body.counted_cash === undefined || req.body.counted_cash === '') throw bad('Contá el efectivo y poné cuánto hay');
  const counted = round2(num(req.body.counted_cash));
  const view = sessionView(s);
  const difference = round2(counted - view.expected_now);
  db.prepare(`UPDATE cash_sessions SET status = 'cerrada', counted_cash = ?, expected_cash = ?, difference = ?, card_summary = ?, notes = ?,
    closed_by = ?, closed_at = datetime('now') WHERE id = ?`).run(counted, view.expected_now, difference, JSON.stringify(view.by_method), str(req.body.notes), req.user.id, s.id);
  audit(req, 'caja_cierre', { entity: 'caja', entityId: s.id, summary: `Cerró la caja del ${s.date}: contó $ ${counted}, esperado $ ${view.expected_now}, diferencia $ ${difference}` });
  if (Math.abs(difference) > 0.009) {
    notify({ audience: 'owner', title: `Caja del ${s.date.split('-').reverse().join('/')} con diferencia de $ ${difference}`, body: `${req.user.name} contó $ ${counted} y el sistema esperaba $ ${view.expected_now}.${str(req.body.notes) ? ` Nota: ${str(req.body.notes)}` : ''}`, link: '/caja' });
  }
  res.json({ ok: true, expected: view.expected_now, difference });
});

cashRouter.post('/cash/reopen', adminOnly, (req, res) => {
  const s = db.prepare("SELECT * FROM cash_sessions WHERE date = ? AND status = 'cerrada'").get(req.body.date);
  if (!s) throw notFound('No hay una caja cerrada en esa fecha');
  db.prepare("UPDATE cash_sessions SET status = 'abierta', counted_cash = NULL, expected_cash = NULL, difference = NULL, closed_by = NULL, closed_at = NULL WHERE id = ?").run(s.id);
  audit(req, 'caja_reapertura', { entity: 'caja', entityId: s.id, summary: `Reabrió la caja del ${s.date}` });
  res.json({ ok: true });
});
