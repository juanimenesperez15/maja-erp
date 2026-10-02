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
/** as = { role, brand_id }: vista previa de la dueña (ver la app como una vendedora o una marca). */
export function signToken(userId, as = null) {
  const exp = Date.now() + (as ? 12 * 3600e3 : TOKEN_DAYS * 864e5);
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp, ...(as ? { as } : {}) })).toString('base64url');
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
  return { id: u.id, email: u.email, name: u.name, role: u.role, brand_id: u.brand_id, brand_name: brand?.name ?? null, active: !!u.active, last_login_at: u.last_login_at, ...(u.preview ? { preview: true } : {}) };
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
  if (data.as) {
    // vista previa: solo la dueña la pide, y mientras dura no se puede modificar nada
    if (user.role !== 'admin') return next(new HttpError(401, 'Vista previa inválida'));
    if (data.as.role === 'marca' && !db.prepare('SELECT 1 FROM brands WHERE id = ?').get(data.as.brand_id)) return next(new HttpError(401, 'La marca ya no existe'));
    if (req.method !== 'GET') return next(new HttpError(403, 'Vista previa: solo lectura. Volvé a tu vista para hacer cambios.'));
    req.user = {
      ...user, role: data.as.role, brand_id: data.as.role === 'marca' ? data.as.brand_id : null, preview: true,
      name: data.as.role === 'vendedora' ? 'Vista de vendedora' : `Vista de ${db.prepare('SELECT name FROM brands WHERE id = ?').get(data.as.brand_id)?.name}`,
    };
    return next();
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

/**
 * Cobros con tarjeta de ventas de la marca que entraron por el POS de MAJA (según los reportes de Handy
 * ya conciliados). Es plata de la marca que quedó en MAJA: se descuenta de lo que la marca tiene que pagar.
 * Se toma lo que Handy acreditó (importe menos su comisión): es lo que efectivamente entró.
 */
export function majaPosCollections(brandId, period) {
  return db.prepare(`SELECT c.id, c.txn_at, c.amount, c.net_amount, c.fees, c.iva_refund, c.movement, c.network, c.card, c.terminal,
      s.id AS sale_id, s.date AS sale_date, s.pos AS registered_pos, s.payment_method
    FROM card_txns c JOIN pos_terminals pt ON pt.terminal = c.terminal JOIN sales s ON s.id = c.sale_id
    WHERE pt.owner = 'maja' AND c.ignored = 0 AND s.voided = 0 AND s.brand_id = ? AND substr(s.date, 1, 7) = ?
    ORDER BY c.txn_at`).all(brandId, period);
}
export const creditOf = (c) => round2(c.net_amount || c.amount);

/** Liquidación de una marca para un mes: congelada si el mes se cerró, calculada en vivo si no. */
export function settlementFor(brand, period) {
  const closed = db.prepare('SELECT * FROM settlements WHERE brand_id = ? AND period = ?').get(brand.id, period);
  const liveCredit = round2(majaPosCollections(brand.id, period).reduce((a, c) => a + creditOf(c), 0));
  let base;
  if (closed) {
    // en los meses viejos 'total' era solo comisión + cuota + IVA
    const charges = round2(closed.commission + closed.fee + closed.iva);
    base = { sales_total: closed.sales_total, units: closed.units, commission_pct: closed.commission_pct, commission: closed.commission, fee: closed.fee, iva: closed.iva, charges, card_credit: closed.card_credit || 0, closed: true, closed_at: closed.closed_at,
      invoice_status: closed.invoice_status, invoice_number: closed.invoice_number, invoice_error: closed.invoice_error, has_invoice_pdf: !!closed.cfe_id };
  } else {
    const { sales_total, units } = brandSalesFor(brand.id, period);
    const commission = round2(sales_total * (brand.commission_pct || 0) / 100);
    const fee = round2(brand.monthly_fee || 0);
    const iva = brand.plus_iva ? round2((commission + fee) * IVA_RATE) : 0;
    base = { sales_total: round2(sales_total), units, commission_pct: brand.commission_pct || 0, commission, fee, iva, charges: round2(commission + fee + iva), card_credit: liveCredit, closed: false, closed_at: null };
  }
  // total = lo que la marca le debe a MAJA en el mes; negativo = MAJA le debe a la marca
  const total = round2(base.charges - base.card_credit);
  const paid = round2(db.prepare('SELECT COALESCE(SUM(amount), 0) AS p FROM payments WHERE brand_id = ? AND period = ?').get(brand.id, period).p);
  const balance = round2(total - paid);
  const nothing = base.charges <= 0 && base.card_credit <= 0 && paid === 0;
  const status = nothing ? 'sin_cargo' : Math.abs(balance) <= 0.009 ? 'pagada' : balance < 0 ? 'a_favor_marca' : paid > 0 ? 'parcial' : 'pendiente';
  return {
    brand_id: brand.id, brand_name: brand.name, period, ...base, total, paid, balance, status,
    // si el mes está cerrado y después aparecieron más cobros en el POS de MAJA, avisar
    card_credit_live: liveCredit, card_credit_changed: base.closed && Math.abs(liveCredit - base.card_credit) > 0.009,
  };
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

// ---------- historial de cambios ----------
export function audit(req, action, { entity = null, entityId = null, brandId = null, summary, detail = null }) {
  const u = req.user || {};
  db.prepare('INSERT INTO audit_log (user_id, user_name, role, action, entity, entity_id, brand_id, summary, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(u.id ?? null, u.name ?? null, u.role ?? null, action, entity, entityId, brandId, summary, detail ? JSON.stringify(detail) : null);
}

// ---------- avisos dentro de la app ----------
/** audience: staff (dueña y vendedoras), owner (solo la dueña) o brand (los usuarios de esa marca). */
export function notify({ audience, brandId = null, title, body = null, link = null }) {
  db.prepare('INSERT INTO notifications (audience, brand_id, title, body, link) VALUES (?, ?, ?, ?, ?)').run(audience, brandId, title, body, link);
  notifyHooks.forEach((fn) => { try { fn({ audience, brandId, title, body, link }); } catch { /* el aviso por mail es opcional */ } });
}
const notifyHooks = [];
export const onNotify = (fn) => notifyHooks.push(fn);
