import { Router } from 'express';
import crypto from 'node:crypto';
import { db, tx } from '../db.js';
import {
  auth, adminOnly, staffOnly, bad, notFound, forbidden, str, num, round2, isPeriod, today, moveStock, audit, notify, hashPassword, settlementFor, HttpError,
} from '../lib.js';
import { emitBrandInvoice, brandInvoicePdf } from '../billing.js';
import { sendMail, mailEnabled, appUrl } from '../mail.js';

export const extraRouter = Router();

// ---------- historial de cambios (solo la dueña) ----------
extraRouter.get('/audit', auth, adminOnly, (req, res) => {
  const where = ['1 = 1'];
  const args = [];
  if (str(req.query.from)) { where.push("date(a.created_at, '-3 hours') >= ?"); args.push(req.query.from); }
  if (str(req.query.to)) { where.push("date(a.created_at, '-3 hours') <= ?"); args.push(req.query.to); }
  if (str(req.query.action)) { where.push('a.action = ?'); args.push(req.query.action); }
  if (Number(req.query.brand_id)) { where.push('a.brand_id = ?'); args.push(Number(req.query.brand_id)); }
  if (Number(req.query.user_id)) { where.push('a.user_id = ?'); args.push(Number(req.query.user_id)); }
  if (str(req.query.q)) { where.push('a.summary LIKE ?'); args.push(`%${str(req.query.q)}%`); }
  const rows = db.prepare(`SELECT a.*, b.name AS brand_name FROM audit_log a LEFT JOIN brands b ON b.id = a.brand_id
    WHERE ${where.join(' AND ')} ORDER BY a.id DESC LIMIT 500`).all(...args);
  const actions = db.prepare('SELECT action, COUNT(*) AS n FROM audit_log GROUP BY action ORDER BY n DESC').all();
  const users = db.prepare('SELECT DISTINCT user_id AS id, user_name AS name FROM audit_log WHERE user_id IS NOT NULL ORDER BY user_name').all();
  res.json({ rows, actions, users });
});

// ---------- avisos ----------
function visibleNotifications(user) {
  if (user.role === 'marca') return { sql: "n.audience = 'brand' AND n.brand_id = ?", args: [user.brand_id] };
  if (user.role === 'admin') return { sql: "n.audience IN ('staff','owner')", args: [] };
  return { sql: "n.audience = 'staff'", args: [] };
}
extraRouter.get('/notifications', auth, (req, res) => {
  const v = visibleNotifications(req.user);
  // solo los posteriores al alta del usuario (no hereda los de antes de que existiera)
  const rows = db.prepare(`SELECT n.*, (r.user_id IS NOT NULL) AS read FROM notifications n
    LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = ?
    WHERE ${v.sql} AND n.created_at >= ? ORDER BY n.id DESC LIMIT 40`).all(req.user.id, ...v.args, req.user.created_at);
  res.json({ rows: rows.map((r) => ({ ...r, read: !!r.read })), unread: rows.filter((r) => !r.read).length });
});
extraRouter.post('/notifications/read', auth, (req, res) => {
  if (req.user.preview) return res.json({ ok: true }); // en vista previa no se marcan
  const v = visibleNotifications(req.user);
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number) : db.prepare(`SELECT n.id FROM notifications n WHERE ${v.sql}`).all(...v.args).map((r) => r.id);
  const ins = db.prepare('INSERT OR IGNORE INTO notification_reads (notification_id, user_id) VALUES (?, ?)');
  tx(() => ids.forEach((id) => ins.run(id, req.user.id)));
  res.json({ ok: true });
});

// ---------- recuperar contraseña ----------
const hashTok = (t) => crypto.createHash('sha256').update(t).digest('hex');
function newResetLink(userId, hours) {
  const token = crypto.randomBytes(24).toString('base64url');
  const expires = new Date(Date.now() + hours * 3600e3).toISOString();
  db.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(hashTok(token), userId, expires);
  return { link: appUrl(`/?reset=${token}`), expires };
}
// pedido desde la pantalla de entrada: siempre responde igual, exista o no el email
extraRouter.post('/auth/forgot', async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(str(req.body.email) || '');
  if (user && mailEnabled()) {
    const { link } = newResetLink(user.id, 2);
    await sendMail([user.email], 'Cambiá tu contraseña de MAJA', `Entrá a este link para elegir una contraseña nueva. Vence en 2 horas. Si no lo pediste, ignorá este mail.\n\n${link}`).catch(() => {});
  }
  res.json({ ok: true, mail: mailEnabled() });
});
// la dueña genera el link para mandarlo por WhatsApp
extraRouter.post('/users/:id/reset-link', auth, adminOnly, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
  if (!user) throw notFound('Usuario inexistente');
  const r = newResetLink(user.id, 48);
  audit(req, 'usuario', { entity: 'usuario', entityId: user.id, summary: `Generó un link para cambiar la contraseña de ${user.email}` });
  res.json(r);
});
extraRouter.post('/auth/reset', (req, res) => {
  const row = db.prepare('SELECT * FROM password_resets WHERE token_hash = ?').get(hashTok(String(req.body.token || '')));
  if (!row || row.used_at || row.expires_at < new Date().toISOString()) throw new HttpError(400, 'El link venció o ya se usó. Pedí uno nuevo.');
  if (String(req.body.password || '').length < 8) throw bad('La contraseña tiene que tener al menos 8 caracteres');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(req.body.password), row.user_id);
  db.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE token_hash = ?").run(row.token_hash);
  res.json({ ok: true });
});

// ---------- conteo de inventario ----------
function countScope(count) {
  return db.prepare(`SELECT p.id, p.sku, p.barcode, p.name, p.variant, p.stock, p.brand_id, b.name AS brand_name, COALESCE(l.counted, 0) AS counted, (l.product_id IS NOT NULL) AS touched
    FROM products p JOIN brands b ON b.id = p.brand_id LEFT JOIN stock_count_lines l ON l.product_id = p.id AND l.count_id = ?
    WHERE p.active = 1 AND b.active = 1 ${count.brand_id ? 'AND p.brand_id = ?' : ''} ORDER BY b.name, p.name, p.variant`).all(count.id, ...(count.brand_id ? [count.brand_id] : []));
}
function loadCount(id) {
  const c = db.prepare('SELECT sc.*, b.name AS brand_name, u.name AS created_by_name FROM stock_counts sc LEFT JOIN brands b ON b.id = sc.brand_id LEFT JOIN users u ON u.id = sc.created_by WHERE sc.id = ?').get(Number(id));
  if (!c) throw notFound('Conteo inexistente');
  return c;
}
extraRouter.get('/counts', auth, staffOnly, (_req, res) => {
  res.json(db.prepare(`SELECT sc.*, b.name AS brand_name, u.name AS created_by_name,
      (SELECT COALESCE(SUM(counted), 0) FROM stock_count_lines WHERE count_id = sc.id) AS units
    FROM stock_counts sc LEFT JOIN brands b ON b.id = sc.brand_id LEFT JOIN users u ON u.id = sc.created_by ORDER BY sc.id DESC LIMIT 30`).all());
});
extraRouter.post('/counts', auth, staffOnly, (req, res) => {
  const brandId = Number(req.body.brand_id) || null;
  if (brandId && !db.prepare('SELECT 1 FROM brands WHERE id = ?').get(brandId)) throw bad('Marca inexistente');
  const r = db.prepare('INSERT INTO stock_counts (brand_id, notes, created_by) VALUES (?, ?, ?)').run(brandId, str(req.body.notes), req.user.id);
  res.json({ id: Number(r.lastInsertRowid) });
});
extraRouter.get('/counts/:id', auth, staffOnly, (req, res) => {
  const c = loadCount(req.params.id);
  const lines = countScope(c).map((l) => ({ ...l, touched: !!l.touched, diff: l.counted - l.stock }));
  res.json({ count: c, lines });
});
// cada lectura del escáner suma 1 al artículo
extraRouter.post('/counts/:id/scan', auth, staffOnly, (req, res) => {
  const c = loadCount(req.params.id);
  if (c.status !== 'abierto') throw bad('Este conteo ya está cerrado');
  const code = String(req.body.code || '').trim().toLowerCase();
  const p = db.prepare(`SELECT p.* FROM products p WHERE p.active = 1 ${c.brand_id ? 'AND p.brand_id = ?' : ''}
    AND (lower(trim(p.barcode)) = ? OR lower(trim(p.sku)) = ?)`).all(...(c.brand_id ? [c.brand_id] : []), code, code);
  if (!p.length) return res.json({ ok: false, text: c.brand_id ? 'No es un artículo de esta marca' : 'Código desconocido' });
  if (p.length > 1) return res.json({ ok: false, text: 'Ese código lo tienen varias marcas: contá por marca' });
  const n = Math.trunc(num(req.body.qty, 1)) || 1;
  db.prepare(`INSERT INTO stock_count_lines (count_id, product_id, counted) VALUES (?, ?, ?)
    ON CONFLICT(count_id, product_id) DO UPDATE SET counted = counted + excluded.counted`).run(c.id, p[0].id, n);
  const counted = db.prepare('SELECT counted FROM stock_count_lines WHERE count_id = ? AND product_id = ?').get(c.id, p[0].id).counted;
  res.json({ ok: true, product_id: p[0].id, counted, text: `${p[0].name}${p[0].variant ? ` · ${p[0].variant}` : ''}: ${counted} contadas (sistema ${p[0].stock})` });
});
extraRouter.put('/counts/:id/lines', auth, staffOnly, (req, res) => {
  const c = loadCount(req.params.id);
  if (c.status !== 'abierto') throw bad('Este conteo ya está cerrado');
  const counted = Math.max(0, Math.trunc(num(req.body.counted)));
  db.prepare(`INSERT INTO stock_count_lines (count_id, product_id, counted) VALUES (?, ?, ?)
    ON CONFLICT(count_id, product_id) DO UPDATE SET counted = excluded.counted`).run(c.id, Number(req.body.product_id), counted);
  res.json({ ok: true });
});
// la dueña revisa y aplica: el stock queda igual a lo contado
extraRouter.post('/counts/:id/apply', auth, adminOnly, (req, res) => {
  const c = loadCount(req.params.id);
  if (c.status !== 'abierto') throw bad('Este conteo ya está cerrado');
  const lines = countScope(c).filter((l) => l.counted !== l.stock && (req.body.only_touched ? l.touched : true));
  tx(() => {
    for (const l of lines) moveStock({ productId: l.id, brandId: l.brand_id, qty: l.counted - l.stock, reason: 'ajuste', note: `Conteo de inventario #${c.id}`, userId: req.user.id });
    db.prepare("UPDATE stock_counts SET status = 'aplicado', applied_by = ?, applied_at = datetime('now') WHERE id = ?").run(req.user.id, c.id);
  });
  audit(req, 'conteo', { entity: 'conteo', entityId: c.id, brandId: c.brand_id, summary: `Aplicó el conteo #${c.id}${c.brand_name ? ` de ${c.brand_name}` : ''}: ${lines.length} artículos ajustados` });
  res.json({ ok: true, adjusted: lines.length });
});
extraRouter.post('/counts/:id/discard', auth, adminOnly, (req, res) => {
  const c = loadCount(req.params.id);
  db.prepare("UPDATE stock_counts SET status = 'descartado' WHERE id = ?").run(c.id);
  res.json({ ok: true });
});

// ---------- factura de MAJA a la marca ----------
extraRouter.post('/settlements/invoice', auth, adminOnly, async (req, res) => {
  const brand = db.prepare('SELECT * FROM brands WHERE id = ?').get(Number(req.body.brand_id));
  if (!brand) throw notFound('Marca inexistente');
  const st = db.prepare('SELECT * FROM settlements WHERE brand_id = ? AND period = ?').get(brand.id, req.body.period);
  if (!st) throw bad('Primero cerrá el mes: la factura se hace sobre la liquidación cerrada');
  if (st.invoice_status === 'emitida') throw bad(`Este mes ya está facturado (${st.invoice_number})`);
  try {
    const r = await emitBrandInvoice(brand, st);
    db.prepare("UPDATE settlements SET invoice_status = 'emitida', invoice_number = ?, cfe_id = ?, invoice_error = NULL WHERE id = ?").run(r.number, r.id, st.id);
    audit(req, 'factura_marca', { entity: 'liquidacion', brandId: brand.id, summary: `Facturó a ${brand.name} la comisión y cuota de ${st.period}: ${r.number}` });
    notify({ audience: 'brand', brandId: brand.id, title: `MAJA emitió la factura de ${st.period.split('-').reverse().join('/')}: ${r.number}`, link: '/liquidaciones' });
    res.json({ ok: true, invoice_number: r.number });
  } catch (e) {
    db.prepare("UPDATE settlements SET invoice_status = 'error', invoice_error = ? WHERE id = ?").run(String(e.message).slice(0, 500), st.id);
    throw bad(`Biller no emitió la factura: ${e.message}`);
  }
});
extraRouter.post('/settlements/invoice-manual', auth, adminOnly, (req, res) => {
  const st = db.prepare('SELECT * FROM settlements WHERE brand_id = ? AND period = ?').get(Number(req.body.brand_id), req.body.period);
  if (!st) throw bad('Primero cerrá el mes');
  if (!str(req.body.invoice_number)) throw bad('Anotá el número de la factura');
  db.prepare("UPDATE settlements SET invoice_status = 'manual', invoice_number = ?, invoice_error = NULL WHERE id = ?").run(str(req.body.invoice_number), st.id);
  audit(req, 'factura_marca', { entity: 'liquidacion', brandId: st.brand_id, summary: `Anotó la factura ${str(req.body.invoice_number)} de la liquidación ${st.period}` });
  res.json({ ok: true });
});
extraRouter.get('/settlements/invoice-pdf', auth, async (req, res) => {
  const brandId = req.user.role === 'marca' ? req.user.brand_id : Number(req.query.brand_id);
  if (req.user.role === 'vendedora') throw forbidden();
  const st = db.prepare('SELECT * FROM settlements WHERE brand_id = ? AND period = ?').get(brandId, req.query.period);
  if (!st?.cfe_id) throw notFound('Esta liquidación no tiene factura electrónica');
  res.setHeader('Content-Type', 'application/pdf');
  res.send(await brandInvoicePdf(st.cfe_id));
});
