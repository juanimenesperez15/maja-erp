import crypto from 'node:crypto';
import { db, secret } from './db.js';

export const IVA_RATE = 0.22;
const TOKEN_DAYS = 30;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const bad = (msg) => new HttpError(400, msg);
export const forbidden = (msg = 'No tenés permiso para esto') => new HttpError(403, msg);
export const notFound = (msg = 'No encontrado') => new HttpError(404, msg);

// ---------- contraseñas y sesión ----------
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
export function checkPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(pw, salt, 64);
  const ref = Buffer.from(hash, 'hex');
  return ref.length === test.length && crypto.timingSafeEqual(ref, test);
}
export function signToken(userId) {
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: Date.now() + TOKEN_DAYS * 864e5 })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
function readToken(token) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
  return data.exp > Date.now() ? data : null;
}

export function publicUser(u) {
  if (!u) return null;
  const brand = u.brand_id ? db.prepare('SELECT id, name FROM brands WHERE id = ?').get(u.brand_id) : null;
  return { id: u.id, email: u.email, name: u.name, role: u.role, brand_id: u.brand_id, brand_name: brand?.name ?? null, active: !!u.active, last_login_at: u.last_login_at };
}

export function auth(req, _res, next) {
  const h = req.headers.authorization || '';
  const data = readToken(h.startsWith('Bearer ') ? h.slice(7) : null);
  if (!data) return next(new HttpError(401, 'Sesión vencida, volvé a entrar'));
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(data.uid);
  if (!user || !user.active) return next(new HttpError(401, 'Usuario inactivo'));
  if (user.role === 'marca') {
    const brand = db.prepare('SELECT active FROM brands WHERE id = ?').get(user.brand_id);
    if (!brand?.active) return next(new HttpError(401, 'La marca está inactiva'));
  }
  req.user = user;
  next();
}
// admin = dueña (ve y configura todo) · vendedora = atiende la tienda · marca = solo lo suyo
export const isStaff = (u) => u?.role === 'admin' || u?.role === 'vendedora';
export function adminOnly(req, _res, next) {
  if (req.user?.role !== 'admin') return next(forbidden('Solo la dueña puede hacer esto'));
  next();
}
export function staffOnly(req, _res, next) {
  if (!isStaff(req.user)) return next(forbidden());
  next();
}
export function notSeller(req, _res, next) {
  if (req.user?.role === 'vendedora') return next(forbidden('Las vendedoras no ven comisiones ni cuotas'));
  next();
}

/** Marca sobre la que opera el pedido: una marca solo ve la suya; el admin elige (o null = todas). */
export function scopeBrand(req, requested) {
  if (req.user.role === 'marca') return req.user.brand_id;
  const id = Number(requested);
  return Number.isFinite(id) && id > 0 ? id : null;
}
export function requireBrand(req, requested) {
  const id = scopeBrand(req, requested);
  if (!id) throw bad('Elegí una marca');
  if (!db.prepare('SELECT 1 FROM brands WHERE id = ?').get(id)) throw notFound('Marca inexistente');
  return id;
}

// ---------- fechas (Uruguay) ----------
export function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Montevideo' }).format(new Date());
}
export const currentPeriod = () => today().slice(0, 7);
export function shiftPeriod(period, delta) {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}
export function isPeriod(p) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(p));
}
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// ---------- liquidaciones ----------
export function brandSalesFor(brandId, period) {
  return db.prepare(`
    SELECT COALESCE(SUM(si.total), 0) AS sales_total, COALESCE(SUM(si.qty), 0) AS units
    FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE si.brand_id = ? AND s.voided = 0 AND substr(s.date, 1, 7) = ?`).get(brandId, period);
}

/** Liquidación de una marca para un mes: congelada si el mes se cerró, calculada en vivo si no. */
export function settlementFor(brand, period) {
  const closed = db.prepare('SELECT * FROM settlements WHERE brand_id = ? AND period = ?').get(brand.id, period);
  let base;
  if (closed) {
    base = { sales_total: closed.sales_total, units: closed.units, commission_pct: closed.commission_pct, commission: closed.commission, fee: closed.fee, iva: closed.iva, total: closed.total, closed: true, closed_at: closed.closed_at };
  } else {
    const { sales_total, units } = brandSalesFor(brand.id, period);
    const commission = round2(sales_total * (brand.commission_pct || 0) / 100);
    const fee = round2(brand.monthly_fee || 0);
    const iva = brand.plus_iva ? round2((commission + fee) * IVA_RATE) : 0;
    base = { sales_total: round2(sales_total), units, commission_pct: brand.commission_pct || 0, commission, fee, iva, total: round2(commission + fee + iva), closed: false, closed_at: null };
  }
  const paid = round2(db.prepare('SELECT COALESCE(SUM(amount), 0) AS p FROM payments WHERE brand_id = ? AND period = ?').get(brand.id, period).p);
  const balance = round2(base.total - paid);
  const status = base.total <= 0 && paid <= 0 ? 'sin_cargo' : balance <= 0.009 ? 'pagada' : paid > 0 ? 'parcial' : 'pendiente';
  return { brand_id: brand.id, brand_name: brand.name, period, ...base, paid, balance, status, net_for_brand: round2(base.sales_total - base.total) };
}

/** Meses que corren para una marca: desde su mes de inicio hasta el actual. */
export function brandPeriods(brand) {
  const start = brand.start_period && isPeriod(brand.start_period) ? brand.start_period : brand.created_at.slice(0, 7);
  const out = [];
  let p = currentPeriod();
  while (p >= start && out.length < 120) {
    out.push(p);
    p = shiftPeriod(p, -1);
  }
  return out;
}

export function isPeriodClosed(brandId, period) {
  return !!db.prepare('SELECT 1 FROM settlements WHERE brand_id = ? AND period = ?').get(brandId, period);
}

// ---------- stock ----------
export function moveStock({ productId, brandId, qty, reason, refType = null, refId = null, note = null, userId = null }) {
  if (!qty) return;
  db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(qty, productId);
  db.prepare('INSERT INTO stock_movements (product_id, brand_id, qty, reason, ref_type, ref_id, note, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(productId, brandId, qty, reason, refType, refId, note, userId);
}

export const str = (v) => (v === undefined || v === null ? null : String(v).trim() || null);
export const num = (v, def = 0) => {
  if (v === undefined || v === null || v === '') return def;
  let s = String(v).replace(/[\s$]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); // formato uruguayo 1.234,50
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ''); // 150.000 = ciento cincuenta mil
  const n = Number(s);
  return Number.isFinite(n) ? n : def;
};
