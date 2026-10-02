import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const dataDir = process.env.DATA_DIR || path.resolve('data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, 'maja.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS brands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  contact_name TEXT, email TEXT, phone TEXT, rut TEXT,
  commission_pct REAL NOT NULL DEFAULT 0,
  monthly_fee REAL NOT NULL DEFAULT 0,
  plus_iva INTEGER NOT NULL DEFAULT 0,
  start_period TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','marca')),
  brand_id INTEGER REFERENCES brands(id),
  active INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  variant TEXT,
  price REAL NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  min_stock INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (brand_id, sku)
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  qty INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref_type TEXT, ref_id INTEGER,
  note TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  type TEXT NOT NULL CHECK (type IN ('ingreso','pickup','retiro')),
  status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','listo','completado','cancelado')),
  customer_name TEXT, customer_phone TEXT, external_ref TEXT,
  notes TEXT, admin_notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  sku TEXT, description TEXT, variant TEXT,
  price REAL,
  qty INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  ticket TEXT,
  payment_method TEXT,
  notes TEXT,
  voided INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  product_id INTEGER REFERENCES products(id),
  sku TEXT, description TEXT,
  qty INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  discount_pct REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS settlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  period TEXT NOT NULL,
  sales_total REAL NOT NULL, units INTEGER NOT NULL,
  commission_pct REAL NOT NULL, commission REAL NOT NULL,
  fee REAL NOT NULL, iva REAL NOT NULL, total REAL NOT NULL,
  closed_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_by INTEGER REFERENCES users(id),
  UNIQUE (brand_id, period)
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  period TEXT NOT NULL,
  amount REAL NOT NULL,
  method TEXT,
  paid_at TEXT NOT NULL,
  note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS ix_products_brand ON products(brand_id);
CREATE INDEX IF NOT EXISTS ix_moves_product ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS ix_orders_brand ON orders(brand_id, type, status);
CREATE INDEX IF NOT EXISTS ix_sales_date ON sales(date);
CREATE INDEX IF NOT EXISTS ix_sale_items_brand ON sale_items(brand_id);
CREATE INDEX IF NOT EXISTS ix_payments_brand ON payments(brand_id, period);
`);

// ---------- columnas agregadas después de la primera versión ----------
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}
// facturación de cada marca
ensureColumn('brands', 'razon_social', 'TEXT');
ensureColumn('brands', 'billing_mode', "TEXT NOT NULL DEFAULT 'manual'"); // manual | cuenta_ajena | biller_marca
ensureColumn('brands', 'iva_mode', "TEXT NOT NULL DEFAULT 'basica'"); // basica | minimo | exento
ensureColumn('brands', 'biller_token', 'TEXT');
ensureColumn('brands', 'biller_sucursal', 'TEXT');
ensureColumn('brands', 'biller_env', "TEXT NOT NULL DEFAULT 'produccion'");
// cada venta se factura a nombre de una sola marca
ensureColumn('sales', 'brand_id', 'INTEGER REFERENCES brands(id)');
ensureColumn('sales', 'cfe_kind', "TEXT NOT NULL DEFAULT 'ticket'"); // ticket | factura
ensureColumn('sales', 'customer_doc_type', 'TEXT');
ensureColumn('sales', 'customer_doc', 'TEXT');
ensureColumn('sales', 'customer_name', 'TEXT');
ensureColumn('sales', 'customer_email', 'TEXT');
ensureColumn('sales', 'invoice_status', "TEXT NOT NULL DEFAULT 'manual'"); // manual | emitida | error
ensureColumn('sales', 'invoice_number', 'TEXT');
ensureColumn('sales', 'invoice_error', 'TEXT');
ensureColumn('sales', 'cfe_id', 'TEXT');
ensureColumn('sales', 'cfe_tipo', 'INTEGER');
ensureColumn('sales', 'cfe_serie', 'TEXT');
ensureColumn('sales', 'cfe_numero', 'TEXT');
ensureColumn('sales', 'cfe_mode', 'TEXT');
ensureColumn('sales', 'ref_sale_id', 'INTEGER REFERENCES sales(id)');
ensureColumn('sales', 'void_cfe_id', 'TEXT');
ensureColumn('sales', 'void_cfe_number', 'TEXT');
// armado de pedidos y quién retiró
ensureColumn('order_items', 'picked_qty', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('orders', 'picked_up_by', 'TEXT');
ensureColumn('settlements', 'card_credit', 'REAL NOT NULL DEFAULT 0');
// código de barras de la etiqueta (EAN), aparte del SKU: es lo que lee el escáner
ensureColumn('products', 'barcode', 'TEXT');
ensureColumn('order_items', 'barcode', 'TEXT');
db.exec('CREATE INDEX IF NOT EXISTS ix_products_barcode ON products(barcode)');
// perfil de vendedora: la tabla users se creó con CHECK (role IN ('admin','marca')) y SQLite no deja cambiarlo
const usersSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get()?.sql ?? '';
if (!usersSql.includes('vendedora')) {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec(`BEGIN;
    CREATE TABLE users_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin','vendedora','marca')),
      brand_id INTEGER REFERENCES brands(id),
      active INTEGER NOT NULL DEFAULT 1,
      last_login_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO users_new SELECT id, email, name, password_hash, role, brand_id, active, last_login_at, created_at FROM users;
    DROP TABLE users;
    ALTER TABLE users_new RENAME TO users;
    COMMIT;`);
  db.exec('PRAGMA foreign_keys = ON');
}

// conciliación de tarjetas: en qué POS se pasó cada venta con tarjeta (el de MAJA o el de la marca)
ensureColumn('sales', 'pos', 'TEXT'); // maja | marca | NULL (no fue con tarjeta)
ensureColumn('sales', 'installments', 'INTEGER');
db.exec(`
CREATE TABLE IF NOT EXISTS pos_terminals (
  terminal TEXT PRIMARY KEY,
  sucursal TEXT,
  owner TEXT,                          -- maja | marca | NULL (sin asignar)
  brand_id INTEGER REFERENCES brands(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS card_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT, rows INTEGER, new_rows INTEGER, date_from TEXT, date_to TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS card_txns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_id INTEGER REFERENCES card_imports(id),
  terminal TEXT NOT NULL,
  sucursal TEXT,
  txn_at TEXT NOT NULL,                -- hora de Uruguay, AAAA-MM-DD HH:MM
  date TEXT NOT NULL,
  medio TEXT, card TEXT, foreign_card INTEGER, network TEXT, bank TEXT,
  movement TEXT,                       -- Débito, Crédito 3 cuotas, Devolución…
  installments INTEGER,
  verification TEXT, ticket TEXT, authorization TEXT, invoice_number TEXT,
  currency TEXT NOT NULL DEFAULT 'UYU',
  amount REAL NOT NULL,
  iva_refund REAL, fees REAL, net_amount REAL, payout_date TEXT,
  sale_id INTEGER REFERENCES sales(id),
  match_kind TEXT,                     -- auto | manual
  ignored INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  UNIQUE (terminal, verification, txn_at, amount)
);
CREATE INDEX IF NOT EXISTS ix_card_txns_date ON card_txns(date);
CREATE INDEX IF NOT EXISTS ix_card_txns_sale ON card_txns(sale_id);
`);

// ---------- historial de cambios ----------
db.exec(`CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  user_name TEXT, role TEXT,
  action TEXT NOT NULL,                -- ej. precio, ajuste_stock, anulacion, pago…
  entity TEXT, entity_id INTEGER, brand_id INTEGER,
  summary TEXT NOT NULL,
  detail TEXT,                         -- JSON con antes/después
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_audit_created ON audit_log(created_at);`);

// ---------- tarjetas: n° de autorización del voucher y monto cobrado ----------
ensureColumn('sales', 'authorization', 'TEXT');
// lo que efectivamente se cobró con ese medio (en un cambio puede ser solo la diferencia); NULL = el total
ensureColumn('sales', 'charged', 'REAL');
ensureColumn('sales', 'exchange_id', 'INTEGER');

// ---------- caja diaria ----------
db.exec(`
CREATE TABLE IF NOT EXISTS cash_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  opening_float REAL NOT NULL DEFAULT 0,
  opened_by INTEGER REFERENCES users(id),
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  counted_cash REAL, expected_cash REAL, difference REAL,
  card_summary TEXT,                   -- JSON: lo anotado con tarjeta por POS
  notes TEXT,
  closed_by INTEGER REFERENCES users(id),
  closed_at TEXT,
  status TEXT NOT NULL DEFAULT 'abierta' CHECK (status IN ('abierta','cerrada'))
);
CREATE TABLE IF NOT EXISTS cash_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES cash_sessions(id),
  kind TEXT NOT NULL CHECK (kind IN ('ingreso','retiro')),
  amount REAL NOT NULL,
  reason TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);`);

// ---------- factura de MAJA a la marca por comisión + cuota ----------
ensureColumn('settlements', 'invoice_status', 'TEXT');
ensureColumn('settlements', 'invoice_number', 'TEXT');
ensureColumn('settlements', 'invoice_error', 'TEXT');
ensureColumn('settlements', 'cfe_id', 'TEXT');

// ---------- conteo de inventario ----------
db.exec(`
CREATE TABLE IF NOT EXISTS stock_counts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER REFERENCES brands(id),       -- NULL = toda la tienda
  status TEXT NOT NULL DEFAULT 'abierto' CHECK (status IN ('abierto','aplicado','descartado')),
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  applied_by INTEGER REFERENCES users(id),
  applied_at TEXT
);
CREATE TABLE IF NOT EXISTS stock_count_lines (
  count_id INTEGER NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  counted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (count_id, product_id)
);`);

// ---------- avisos ----------
db.exec(`
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audience TEXT NOT NULL CHECK (audience IN ('staff','owner','brand')),
  brand_id INTEGER REFERENCES brands(id),
  title TEXT NOT NULL, body TEXT, link TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS notification_reads (
  notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (notification_id, user_id)
);
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  used_at TEXT
);`);

// va después de rehacer la tabla users (si no, la migración la pierde)
// la dueña le puso una contraseña provisoria: al entrar tiene que elegir una propia
ensureColumn('users', 'must_change_password', 'INTEGER NOT NULL DEFAULT 0');

// objetivos de venta mensuales por marca
db.exec(`CREATE TABLE IF NOT EXISTS sales_goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  period TEXT NOT NULL,
  amount REAL NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (brand_id, period)
)`);

db.exec(`UPDATE sales SET brand_id = (SELECT si.brand_id FROM sale_items si WHERE si.sale_id = sales.id LIMIT 1) WHERE brand_id IS NULL`);
db.exec(`UPDATE sales SET invoice_number = ticket WHERE invoice_number IS NULL AND ticket IS NOT NULL`);

export function getSetting(key) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null;
}
export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function secret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  let s = getSetting('session_secret');
  if (!s) {
    s = crypto.randomBytes(32).toString('hex');
    setSetting('session_secret', s);
  }
  return s;
}
