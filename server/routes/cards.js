import { Router } from 'express';
import { db, tx } from '../db.js';
import { auth, adminOnly, bad, notFound, round2, str, today } from '../lib.js';

/*
 * Conciliación de tarjetas contra los reportes de actividad de Handy.
 * Cada marca tiene su POS en la tienda y MAJA tiene el suyo. Al registrar una venta con tarjeta
 * se anota en cuál se pasó; el reporte de Handy dice en qué terminal se cobró de verdad.
 * Cruzando los dos aparecen las ventas anotadas en el POS equivocado.
 */
export const cardsRouter = Router();
cardsRouter.use('/cards', auth, adminOnly);

const CARD_METHODS = ['Débito', 'Crédito'];
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12, ene: 1, abr: 4, ago: 8, set: 9, dic: 12 };

const norm = (h) => String(h ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
// encabezados del reporte de Handy → campo (tolera tildes rotas)
const COLUMNS = [
  ['txn_at', (h) => h.startsWith('fechatransacc')],
  ['sucursal', (h) => h === 'sucursal'],
  ['terminal', (h) => h === 'terminal'],
  ['medio', (h) => h === 'medio'],
  ['card', (h) => h === 'nrotarjeta'],
  ['foreign_card', (h) => h === 'extranjera'],
  ['network', (h) => h === 'sello'],
  ['bank', (h) => h === 'bancoemisor'],
  ['movement', (h) => h === 'tipodemovimiento'],
  ['verification', (h) => h.startsWith('nrodeverificac')],
  ['payout_date', (h) => h === 'cobroencuentahandy'],
  ['ticket', (h) => h === 'nroticket'],
  ['authorization', (h) => h.startsWith('autorizac')],
  ['invoice_number', (h) => h === 'nrofactura'],
  ['currency', (h) => h === 'moneda'],
  ['amount', (h) => h === 'importe'],
  ['iva_refund', (h) => /^devoluc.*iva$/.test(h)],
  ['fee_service', (h) => h === 'serviciohandy'],
  ['fee_service_iva', (h) => h === 'ivaserviciohandy'],
  ['fee_fin', (h) => h === 'recargosfinancieros'],
  ['fee_fin_iva', (h) => h === 'ivarecargosfinancieros'],
  ['fee_ret', (h) => h === 'retenciones'],
  ['fee_third', (h) => h === 'cargosdeterceros'],
  ['net_amount', (h) => h.startsWith('importeacobrarencuenta')],
];

/** "24-Sep-2026 18:12" → "2026-09-24 18:12" (también acepta fechas de Excel). */
function parseDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') {
    const d = new Date(Math.round((v - 25569) * 864e5));
    return d.toISOString().slice(0, 16).replace('T', ' ');
  }
  const m = String(v).trim().match(/^(\d{1,2})[-/ ]([A-Za-z]{3}|\d{1,2})[-/ ](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const mon = /^\d+$/.test(m[2]) ? Number(m[2]) : MONTHS[m[2].toLowerCase()];
  if (!mon) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${m[3]}-${pad(mon)}-${pad(m[1])}${m[4] ? ` ${pad(m[4])}:${m[5]}` : ''}`;
}
const n = (v) => (v === null || v === undefined || v === '' || v === 'N/A' ? 0 : Number(String(v).replace(',', '.')) || 0);
const isCredit = (mv) => /cr[eé]dito/i.test(mv || '');
const isDebit = (mv) => /d[eé]bito/i.test(mv || '');
const isRefund = (mv, amount) => amount < 0 || /devoluc|anulac/i.test(mv || '');
const installmentsOf = (mv) => { const m = String(mv || '').match(/(\d+)\s*cuotas?/i); return m ? Number(m[1]) : isCredit(mv) ? 1 : null; };

/** De las hojas del Excel (filas como arrays) a transacciones. */
export function parseHandySheets(sheets) {
  const out = [];
  let declaredFrom = null;
  let declaredTo = null;
  for (const sheet of sheets) {
    const rows = sheet.rows || [];
    for (const r of rows.slice(0, 10)) {
      const h = norm(r?.[0]);
      if (h.startsWith('fechainicio')) declaredFrom = parseDate(r[1])?.slice(0, 10) ?? declaredFrom;
      if (h.startsWith('fechafin')) declaredTo = parseDate(r[1])?.slice(0, 10) ?? declaredTo;
    }
    const hi = rows.findIndex((r) => Array.isArray(r) && r.some((c) => norm(c).startsWith('fechatransacc')));
    if (hi < 0) continue;
    const headers = rows[hi].map(norm);
    const idx = {};
    for (const [field, test] of COLUMNS) {
      const i = headers.findIndex((h) => test(h));
      if (i >= 0) idx[field] = i;
    }
    if (idx.txn_at === undefined || idx.terminal === undefined || idx.amount === undefined) continue;
    for (const r of rows.slice(hi + 1)) {
      if (!r || r.every((c) => c === null || c === '')) continue;
      const get = (f) => (idx[f] === undefined ? null : r[idx[f]]);
      const txnAt = parseDate(get('txn_at'));
      if (!txnAt || !str(get('terminal'))) continue;
      const fees = ['fee_service', 'fee_service_iva', 'fee_fin', 'fee_fin_iva', 'fee_ret', 'fee_third'].reduce((a, f) => a + n(get(f)), 0);
      out.push({
        terminal: String(get('terminal')).trim(), sucursal: str(get('sucursal')), txn_at: txnAt, date: txnAt.slice(0, 10),
        medio: str(get('medio')), card: str(get('card')), foreign_card: /^s/i.test(String(get('foreign_card') ?? '')) ? 1 : 0,
        network: str(get('network')), bank: str(get('bank')), movement: str(get('movement')), installments: installmentsOf(get('movement')),
        verification: get('verification') === null ? null : String(get('verification')), ticket: str(get('ticket')),
        authorization: str(get('authorization')), invoice_number: str(get('invoice_number')),
        currency: str(get('currency')) || 'UYU', amount: n(get('amount')), iva_refund: round2(n(get('iva_refund'))),
        fees: round2(fees), net_amount: round2(n(get('net_amount'))), payout_date: parseDate(get('payout_date')),
      });
    }
  }
  out.declaredFrom = declaredFrom;
  out.declaredTo = declaredTo;
  return out;
}

// ---------- cruce automático ----------
const saleTotals = () => Object.fromEntries(db.prepare('SELECT sale_id, SUM(total) AS t FROM sale_items GROUP BY sale_id').all().map((r) => [r.sale_id, r.t]));
const digits = (s) => String(s ?? '').replace(/\D/g, '').replace(/^0+/, '');
// las ventas se guardan con datetime('now') en UTC; el reporte viene en hora de Uruguay (UTC−3)
const minutesBetween = (txnAtLocal, createdUtc) => Math.abs(Date.parse(`${txnAtLocal.replace(' ', 'T')}:00-03:00`) - Date.parse(`${createdUtc.replace(' ', 'T')}Z`)) / 60000;
const shiftDate = (d, days) => new Date(Date.parse(`${d}T12:00:00Z`) + days * 864e5).toISOString().slice(0, 10);

function candidatesFor(t, totals, taken, terminals) {
  if (isRefund(t.movement, t.amount) || t.currency !== 'UYU') return [];
  const term = terminals[t.terminal];
  const sales = db.prepare('SELECT * FROM sales WHERE voided = 0 AND date BETWEEN ? AND ?').all(shiftDate(t.date, -1), shiftDate(t.date, 1));
  return sales
    .filter((s) => !taken.has(s.id) && Math.abs((totals[s.id] ?? 0) - t.amount) < 0.5)
    .map((s) => {
      let score = 0;
      if (s.date === t.date) score += 3;
      const mins = minutesBetween(t.txn_at, s.created_at);
      if (mins <= 30) score += 2; else if (mins <= 180) score += 1;
      const inv = digits(t.invoice_number);
      if (inv && [s.invoice_number, s.cfe_numero].some((x) => digits(x) && (digits(x) === inv || digits(x).endsWith(inv)))) score += 3;
      if (CARD_METHODS.includes(s.payment_method)) score += 1;
      if ((isDebit(t.movement) && s.payment_method === 'Débito') || (isCredit(t.movement) && s.payment_method === 'Crédito')) score += 1;
      if (term?.owner === 'marca' && term.brand_id === s.brand_id) score += 2;
      return { sale: s, score, minutes: Math.round(mins) };
    })
    .sort((a, b) => b.score - a.score);
}

export function autoMatch() {
  const totals = saleTotals();
  const terminals = Object.fromEntries(db.prepare('SELECT * FROM pos_terminals').all().map((t) => [t.terminal, t]));
  const taken = new Set(db.prepare('SELECT sale_id FROM card_txns WHERE sale_id IS NOT NULL').all().map((r) => r.sale_id));
  const pending = db.prepare('SELECT * FROM card_txns WHERE sale_id IS NULL AND ignored = 0 ORDER BY txn_at').all();
  // todos los pares cobro-venta posibles, del más seguro al menos: así un cobro de otro día
  // con el mismo importe no se queda con la venta que tiene misma fecha y mismo n° de factura
  const pairs = [];
  for (const t of pending) for (const c of candidatesFor(t, totals, taken, terminals)) if (c.score >= 3) pairs.push({ t, ...c });
  pairs.sort((a, b) => b.score - a.score || a.minutes - b.minutes);
  const usedTxn = new Set();
  let matched = 0;
  tx(() => {
    for (const p of pairs) {
      if (usedTxn.has(p.t.id) || taken.has(p.sale.id)) continue;
      // con empate (otra venta libre con el mismo puntaje para este cobro) lo decide la dueña a mano
      const rival = pairs.find((q) => q !== p && q.t.id === p.t.id && q.score === p.score && !taken.has(q.sale.id));
      if (rival) continue;
      db.prepare("UPDATE card_txns SET sale_id = ?, match_kind = 'auto' WHERE id = ?").run(p.sale.id, p.t.id);
      taken.add(p.sale.id);
      usedTxn.add(p.t.id);
      matched++;
    }
  });
  return matched;
}

// ---------- estado de cada cobro ----------
function statusOf(t, sale, term) {
  if (t.ignored) return 'ignorada';
  if (isRefund(t.movement, t.amount) && !sale) return 'devolucion';
  if (!term?.owner) return 'sin_asignar';
  if (!sale) return 'sin_venta';
  if (sale.voided) return 'venta_anulada';
  if (!CARD_METHODS.includes(sale.payment_method)) return 'medio_equivocado';
  if (term.owner === 'marca' && term.brand_id !== sale.brand_id) return 'otra_marca';
  if (sale.pos !== term.owner) return 'pos_equivocado';
  if ((isDebit(t.movement) && sale.payment_method !== 'Débito') || (isCredit(t.movement) && sale.payment_method !== 'Crédito')) return 'tipo_equivocado';
  return 'ok';
}

function loadTxns(from, to) {
  const terminals = Object.fromEntries(db.prepare(`SELECT pt.*, b.name AS brand_name FROM pos_terminals pt LEFT JOIN brands b ON b.id = pt.brand_id`).all().map((t) => [t.terminal, t]));
  const totals = saleTotals();
  const rows = db.prepare('SELECT * FROM card_txns WHERE date BETWEEN ? AND ? ORDER BY txn_at DESC').all(from, to);
  const saleStmt = db.prepare('SELECT s.*, b.name AS brand_name FROM sales s LEFT JOIN brands b ON b.id = s.brand_id WHERE s.id = ?');
  const taken = new Set(db.prepare('SELECT sale_id FROM card_txns WHERE sale_id IS NOT NULL').all().map((r) => r.sale_id));
  return rows.map((t) => {
    const term = terminals[t.terminal];
    const sale = t.sale_id ? saleStmt.get(t.sale_id) : null;
    const status = statusOf(t, sale, term);
    const out = {
      ...t, owner: term?.owner ?? null, owner_brand_id: term?.brand_id ?? null, owner_label: term?.owner === 'maja' ? 'POS de MAJA' : term?.owner === 'marca' ? `POS de ${term.brand_name}` : 'POS sin asignar',
      status,
      sale: sale && { id: sale.id, date: sale.date, brand_id: sale.brand_id, brand_name: sale.brand_name, payment_method: sale.payment_method, pos: sale.pos, installments: sale.installments, invoice_number: sale.invoice_number, voided: !!sale.voided, total: round2(totals[sale.id] ?? 0) },
    };
    if (!sale && ['sin_venta', 'sin_asignar'].includes(status)) {
      out.candidates = candidatesFor(t, totals, taken, terminals).slice(0, 5).map((c) => ({
        id: c.sale.id, date: c.sale.date, brand_id: c.sale.brand_id, payment_method: c.sale.payment_method, pos: c.sale.pos, minutes: c.minutes,
        brand_name: db.prepare('SELECT name FROM brands WHERE id = ?').get(c.sale.brand_id)?.name, invoice_number: c.sale.invoice_number,
      }));
    }
    return out;
  });
}

// ---------- rutas ----------
cardsRouter.post('/cards/import', (req, res) => {
  const txns = parseHandySheets(Array.isArray(req.body.sheets) ? req.body.sheets : []);
  if (!txns.length) throw bad('No encontré transacciones: ¿es el reporte de Actividad de Handy?');
  const dates = txns.map((t) => t.date).sort();
  // el período que dice el reporte (puede tener días sin cobros en las puntas)
  if (txns.declaredFrom && txns.declaredFrom < dates[0]) dates.unshift(txns.declaredFrom);
  if (txns.declaredTo && txns.declaredTo > dates[dates.length - 1]) dates.push(txns.declaredTo);
  const result = tx(() => {
    const imp = db.prepare('INSERT INTO card_imports (filename, rows, new_rows, date_from, date_to, created_by) VALUES (?, ?, 0, ?, ?, ?)')
      .run(str(req.body.filename), txns.length, dates[0], dates[dates.length - 1], req.user.id);
    const importId = Number(imp.lastInsertRowid);
    const ins = db.prepare(`INSERT OR IGNORE INTO card_txns (import_id, terminal, sucursal, txn_at, date, medio, card, foreign_card, network, bank, movement, installments,
      verification, ticket, authorization, invoice_number, currency, amount, iva_refund, fees, net_amount, payout_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    let added = 0;
    for (const t of txns) {
      added += Number(ins.run(importId, t.terminal, t.sucursal, t.txn_at, t.date, t.medio, t.card, t.foreign_card, t.network, t.bank, t.movement, t.installments,
        t.verification, t.ticket, t.authorization, t.invoice_number, t.currency, t.amount, t.iva_refund, t.fees, t.net_amount, t.payout_date).changes);
      // terminal nueva: se registra sin asignar y, si la sucursal se llama como una marca, se sugiere esa marca
      if (!db.prepare('SELECT 1 FROM pos_terminals WHERE terminal = ?').get(t.terminal)) {
        const suc = (t.sucursal || '').toLowerCase();
        const brand = suc ? db.prepare('SELECT id, name FROM brands').all().find((b) => suc.includes(b.name.toLowerCase()) || b.name.toLowerCase().includes(suc)) : null;
        const owner = /maja/.test(suc) ? 'maja' : brand ? 'marca' : null;
        db.prepare('INSERT INTO pos_terminals (terminal, sucursal, owner, brand_id) VALUES (?, ?, ?, ?)').run(t.terminal, t.sucursal, owner, owner === 'marca' ? brand.id : null);
      }
    }
    db.prepare('UPDATE card_imports SET new_rows = ? WHERE id = ?').run(added, importId);
    return { rows: txns.length, added, from: dates[0], to: dates[dates.length - 1] };
  });
  const matched = autoMatch();
  res.json({ ...result, matched });
});

cardsRouter.get('/cards/terminals', (_req, res) => {
  res.json(db.prepare(`SELECT pt.*, b.name AS brand_name, (SELECT COUNT(*) FROM card_txns c WHERE c.terminal = pt.terminal) AS txns,
    (SELECT MAX(date) FROM card_txns c WHERE c.terminal = pt.terminal) AS last_date
    FROM pos_terminals pt LEFT JOIN brands b ON b.id = pt.brand_id ORDER BY pt.owner IS NULL DESC, pt.sucursal`).all());
});

cardsRouter.put('/cards/terminals/:terminal', (req, res) => {
  const term = db.prepare('SELECT * FROM pos_terminals WHERE terminal = ?').get(req.params.terminal);
  if (!term) throw notFound('Terminal inexistente');
  const owner = ['maja', 'marca'].includes(req.body.owner) ? req.body.owner : null;
  const brandId = owner === 'marca' ? Number(req.body.brand_id) : null;
  if (owner === 'marca' && !db.prepare('SELECT 1 FROM brands WHERE id = ?').get(brandId)) throw bad('Elegí la marca dueña del POS');
  db.prepare("UPDATE pos_terminals SET owner = ?, brand_id = ?, updated_at = datetime('now') WHERE terminal = ?").run(owner, brandId, term.terminal);
  autoMatch();
  res.json({ ok: true });
});

cardsRouter.get('/cards/txns', (req, res) => {
  const range = db.prepare('SELECT MIN(date_from) AS a, MAX(date_to) AS b FROM card_imports').get();
  const from = str(req.query.from) || range.a || today();
  const to = str(req.query.to) || range.b || today();
  const txns = loadTxns(from, to);

  // ventas con tarjeta del período que no aparecen en ningún reporte subido
  const linked = new Set(db.prepare('SELECT sale_id FROM card_txns WHERE sale_id IS NOT NULL').all().map((r) => r.sale_id));
  const totals = saleTotals();
  const unpaid = db.prepare(`SELECT s.*, b.name AS brand_name FROM sales s JOIN brands b ON b.id = s.brand_id
    WHERE s.voided = 0 AND s.payment_method IN ('Débito','Crédito') AND s.date BETWEEN ? AND ? ORDER BY s.date DESC, s.id DESC`).all(from, to)
    .filter((s) => !linked.has(s.id))
    .map((s) => ({ id: s.id, date: s.date, brand_id: s.brand_id, brand_name: s.brand_name, payment_method: s.payment_method, pos: s.pos, installments: s.installments, invoice_number: s.invoice_number, total: round2(totals[s.id] ?? 0) }));

  // por marca: cuánto de sus ventas cobró cada POS
  const byBrand = {};
  for (const t of txns) {
    if (!t.sale || t.status === 'ignorada') continue;
    const b = (byBrand[t.sale.brand_id] ??= { brand_id: t.sale.brand_id, brand_name: t.sale.brand_name, maja: 0, own: 0, other: 0, count: 0 });
    b.count++;
    if (t.owner === 'maja') b.maja += t.amount;
    else if (t.owner === 'marca' && t.owner_brand_id === t.sale.brand_id) b.own += t.amount;
    else if (t.owner === 'marca') b.other += t.amount;
  }
  const imports = db.prepare('SELECT ci.*, u.name AS user_name FROM card_imports ci LEFT JOIN users u ON u.id = ci.created_by ORDER BY ci.id DESC LIMIT 10').all();
  res.json({ from, to, txns, unpaid, by_brand: Object.values(byBrand).map((b) => ({ ...b, maja: round2(b.maja), own: round2(b.own), other: round2(b.other) })), imports });
});

cardsRouter.post('/cards/reconcile', (_req, res) => res.json({ matched: autoMatch() }));

// unir a mano con una venta, desunir o descartar un cobro
cardsRouter.put('/cards/txns/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM card_txns WHERE id = ?').get(Number(req.params.id));
  if (!t) throw notFound('Cobro inexistente');
  if ('sale_id' in req.body) {
    const saleId = req.body.sale_id ? Number(req.body.sale_id) : null;
    if (saleId) {
      if (!db.prepare('SELECT 1 FROM sales WHERE id = ?').get(saleId)) throw bad(`No existe la venta #${saleId}`);
      const other = db.prepare('SELECT id FROM card_txns WHERE sale_id = ? AND id <> ?').get(saleId, t.id);
      if (other) throw bad(`La venta #${saleId} ya está unida a otro cobro`);
    }
    db.prepare('UPDATE card_txns SET sale_id = ?, match_kind = ?, ignored = 0 WHERE id = ?').run(saleId, saleId ? 'manual' : null, t.id);
  }
  if ('ignored' in req.body) db.prepare('UPDATE card_txns SET ignored = ?, note = COALESCE(?, note) WHERE id = ?').run(req.body.ignored ? 1 : 0, str(req.body.note), t.id);
  res.json({ ok: true });
});

// corrige la venta según lo que dice Handy: medio de pago, POS y cuotas
cardsRouter.post('/cards/txns/:id/fix', (req, res) => {
  const t = db.prepare('SELECT * FROM card_txns WHERE id = ?').get(Number(req.params.id));
  if (!t?.sale_id) throw bad('Este cobro no está unido a una venta');
  const term = db.prepare('SELECT * FROM pos_terminals WHERE terminal = ?').get(t.terminal);
  if (!term?.owner) throw bad('Primero indicá de quién es este POS');
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(t.sale_id);
  if (term.owner === 'marca' && term.brand_id !== sale.brand_id) throw bad('Se cobró en el POS de otra marca: eso no se corrige en la venta, hay que arreglarlo entre las marcas');
  const method = isDebit(t.movement) ? 'Débito' : 'Crédito';
  db.prepare('UPDATE sales SET payment_method = ?, pos = ?, installments = ? WHERE id = ?').run(method, term.owner, method === 'Crédito' ? t.installments : null, sale.id);
  res.json({ ok: true, payment_method: method, pos: term.owner });
});

/** Para la liquidación: lo que se cobró en el POS de MAJA por ventas de una marca en un mes. */
export function cardCollectedByMaja(brandId, period) {
  const r = db.prepare(`SELECT COALESCE(SUM(c.amount), 0) AS total, COUNT(*) AS n FROM card_txns c
    JOIN pos_terminals pt ON pt.terminal = c.terminal JOIN sales s ON s.id = c.sale_id
    WHERE pt.owner = 'maja' AND c.ignored = 0 AND s.brand_id = ? AND s.voided = 0 AND substr(s.date, 1, 7) = ?`).get(brandId, period);
  return { total: round2(r.total), count: r.n };
}
