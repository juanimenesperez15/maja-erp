import { Router } from 'express';
import { db } from '../db.js';
import { publicBillingSettings, saveBillingSettings } from '../billing.js';
import { auth, adminOnly, bad, notFound, hashPassword, checkPassword, signToken, publicUser, str, num, isPeriod, HttpError } from '../lib.js';

export const accessRouter = Router();

// ---------- sesión ----------
accessRouter.get('/auth/status', (_req, res) => {
  const n = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  res.json({ needsSetup: n === 0 });
});

accessRouter.post('/auth/setup', (req, res) => {
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) throw bad('El sistema ya está configurado');
  const { name, email, password } = req.body;
  if (!str(name) || !str(email)) throw bad('Completá nombre y email');
  if (String(password || '').length < 8) throw bad('La contraseña tiene que tener al menos 8 caracteres');
  const r = db.prepare("INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, 'admin')").run(str(email), str(name), hashPassword(password));
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid);
  res.json({ token: signToken(user.id), user: publicUser(user) });
});

accessRouter.post('/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(str(email) || '');
  if (!user || !checkPassword(password || '', user.password_hash)) throw new HttpError(401, 'Email o contraseña incorrectos');
  if (!user.active) throw new HttpError(401, 'Tu usuario está desactivado');
  if (user.role === 'marca' && !db.prepare('SELECT active FROM brands WHERE id = ?').get(user.brand_id)?.active) throw new HttpError(401, 'La marca está inactiva');
  db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(user.id);
  res.json({ token: signToken(user.id), user: publicUser(user) });
});

accessRouter.get('/auth/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));

accessRouter.post('/auth/password', auth, (req, res) => {
  const { current, next } = req.body;
  if (!checkPassword(current || '', req.user.password_hash)) throw bad('La contraseña actual no es correcta');
  if (String(next || '').length < 8) throw bad('La nueva contraseña tiene que tener al menos 8 caracteres');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), req.user.id);
  res.json({ ok: true });
});

// ---------- marcas ----------
function brandBody(b) {
  const start = str(b.start_period);
  if (start && !isPeriod(start)) throw bad('El mes de inicio tiene que ser AAAA-MM');
  const pct = num(b.commission_pct);
  if (pct < 0 || pct > 100) throw bad('La comisión tiene que estar entre 0 y 100 %');
  if (num(b.monthly_fee) < 0) throw bad('La cuota no puede ser negativa');
  return {
    name: str(b.name), contact_name: str(b.contact_name), email: str(b.email), phone: str(b.phone), rut: str(b.rut),
    commission_pct: pct, monthly_fee: num(b.monthly_fee), plus_iva: b.plus_iva ? 1 : 0,
    start_period: start, notes: str(b.notes), active: b.active === false ? 0 : 1,
    razon_social: str(b.razon_social),
    billing_mode: ['manual', 'cuenta_ajena', 'biller_marca'].includes(b.billing_mode) ? b.billing_mode : 'manual',
    iva_mode: ['basica', 'minimo', 'exento'].includes(b.iva_mode) ? b.iva_mode : 'basica',
    biller_sucursal: str(b.biller_sucursal),
    biller_env: b.biller_env === 'test' ? 'test' : 'produccion',
  };
}

accessRouter.get('/brands', auth, (req, res) => {
  const where = req.user.role === 'marca' ? 'WHERE b.id = ?' : '';
  const args = req.user.role === 'marca' ? [req.user.brand_id] : [];
  const rows = db.prepare(`
    SELECT b.*,
      (SELECT COUNT(*) FROM products p WHERE p.brand_id = b.id AND p.active = 1) AS product_count,
      (SELECT COALESCE(SUM(p.stock), 0) FROM products p WHERE p.brand_id = b.id AND p.active = 1) AS stock_units,
      (SELECT COUNT(*) FROM users u WHERE u.brand_id = b.id AND u.active = 1) AS user_count
    FROM brands b ${where} ORDER BY b.active DESC, b.name`).all(...args);
  // el token de Biller nunca sale del servidor
  res.json(rows.map(({ biller_token, ...r }) => ({ ...r, has_biller_token: !!biller_token, plus_iva: !!r.plus_iva, active: !!r.active })));
});

accessRouter.post('/brands', auth, adminOnly, (req, res) => {
  const b = brandBody(req.body);
  if (!b.name) throw bad('Poné el nombre de la marca');
  if (db.prepare('SELECT 1 FROM brands WHERE name = ?').get(b.name)) throw bad('Ya existe una marca con ese nombre');
  const r = db.prepare(`INSERT INTO brands (name, contact_name, email, phone, rut, commission_pct, monthly_fee, plus_iva, start_period, notes, active,
      razon_social, billing_mode, iva_mode, biller_sucursal, biller_env, biller_token)
    VALUES (:name, :contact_name, :email, :phone, :rut, :commission_pct, :monthly_fee, :plus_iva, :start_period, :notes, :active,
      :razon_social, :billing_mode, :iva_mode, :biller_sucursal, :biller_env, :biller_token)`).run({ ...b, biller_token: str(req.body.biller_token) });
  res.json({ id: Number(r.lastInsertRowid) });
});

accessRouter.put('/brands/:id', auth, adminOnly, (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM brands WHERE id = ?').get(id)) throw notFound('Marca inexistente');
  const b = brandBody(req.body);
  if (!b.name) throw bad('Poné el nombre de la marca');
  if (db.prepare('SELECT 1 FROM brands WHERE name = ? AND id <> ?').get(b.name, id)) throw bad('Ya existe una marca con ese nombre');
  db.prepare(`UPDATE brands SET name = :name, contact_name = :contact_name, email = :email, phone = :phone, rut = :rut,
    commission_pct = :commission_pct, monthly_fee = :monthly_fee, plus_iva = :plus_iva, start_period = :start_period,
    notes = :notes, active = :active, razon_social = :razon_social, billing_mode = :billing_mode, iva_mode = :iva_mode,
    biller_sucursal = :biller_sucursal, biller_env = :biller_env WHERE id = :id`).run({ ...b, id });
  // el token solo se reemplaza si mandan uno nuevo
  if (str(req.body.biller_token)) db.prepare('UPDATE brands SET biller_token = ? WHERE id = ?').run(str(req.body.biller_token), id);
  res.json({ ok: true });
});

// ---------- usuarios ----------
accessRouter.get('/users', auth, adminOnly, (_req, res) => {
  const rows = db.prepare('SELECT * FROM users ORDER BY role, name').all();
  res.json(rows.map(publicUser));
});

function userBody(body, isNew) {
  const role = body.role === 'admin' ? 'admin' : 'marca';
  const brandId = role === 'marca' ? Number(body.brand_id) : null;
  if (!str(body.name) || !str(body.email)) throw bad('Completá nombre y email');
  if (role === 'marca' && !db.prepare('SELECT 1 FROM brands WHERE id = ?').get(brandId)) throw bad('Elegí la marca del usuario');
  if ((isNew || body.password) && String(body.password || '').length < 8) throw bad('La contraseña tiene que tener al menos 8 caracteres');
  return { name: str(body.name), email: str(body.email), role, brand_id: brandId, active: body.active === false ? 0 : 1 };
}

accessRouter.post('/users', auth, adminOnly, (req, res) => {
  const u = userBody(req.body, true);
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(u.email)) throw bad('Ya hay un usuario con ese email');
  const r = db.prepare('INSERT INTO users (email, name, password_hash, role, brand_id, active) VALUES (?, ?, ?, ?, ?, ?)')
    .run(u.email, u.name, hashPassword(req.body.password), u.role, u.brand_id, u.active);
  res.json({ id: Number(r.lastInsertRowid) });
});

accessRouter.put('/users/:id', auth, adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!current) throw notFound('Usuario inexistente');
  const u = userBody(req.body, false);
  if (db.prepare('SELECT 1 FROM users WHERE email = ? AND id <> ?').get(u.email, id)) throw bad('Ya hay un usuario con ese email');
  if (current.role === 'admin' && (u.role !== 'admin' || !u.active)) {
    const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id <> ?").get(id).n;
    if (admins === 0) throw bad('Tiene que quedar al menos un administrador activo');
  }
  db.prepare('UPDATE users SET name = ?, email = ?, role = ?, brand_id = ?, active = ? WHERE id = ?').run(u.name, u.email, u.role, u.brand_id, u.active, id);
  if (req.body.password) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(req.body.password), id);
  res.json({ ok: true });
});

// ---------- Biller de MAJA (para facturar por cuenta ajena) ----------
accessRouter.get('/settings/billing', auth, adminOnly, (_req, res) => res.json(publicBillingSettings()));
accessRouter.put('/settings/billing', auth, adminOnly, (req, res) => {
  saveBillingSettings(req.body);
  res.json(publicBillingSettings());
});
