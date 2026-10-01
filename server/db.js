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
