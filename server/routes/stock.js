import { Router } from 'express';
import { db, tx } from '../db.js';
import { auth, adminOnly, isStaff, bad, notFound, forbidden, scopeBrand, requireBrand, moveStock, str, num } from '../lib.js';

export const stockRouter = Router();
stockRouter.use(auth);

function canTouch(req, product) {
  if (req.user.role === 'marca' && product.brand_id !== req.user.brand_id) throw forbidden();
}

stockRouter.get('/products', (req, res) => {
  const brandId = scopeBrand(req, req.query.brand_id);
  const where = ['1 = 1'];
  const args = [];
  if (brandId) { where.push('p.brand_id = ?'); args.push(brandId); }
  if (req.query.include_inactive !== '1') where.push('p.active = 1');
  if (req.query.low === '1') where.push('p.stock <= p.min_stock');
  if (str(req.query.q)) {
    where.push('(p.sku LIKE ? OR p.name LIKE ? OR p.variant LIKE ? OR p.barcode LIKE ?)');
    const q = `%${str(req.query.q)}%`;
    args.push(q, q, q, q);
  }
  const rows = db.prepare(`
    SELECT p.*, b.name AS brand_name,
      (SELECT COALESCE(SUM(si.qty), 0) FROM sale_items si JOIN sales s ON s.id = si.sale_id
        WHERE si.product_id = p.id AND s.voided = 0 AND s.date >= date('now', '-30 day')) AS sold_30d
    FROM products p JOIN brands b ON b.id = p.brand_id
    WHERE ${where.join(' AND ')}
    ORDER BY b.name, p.name, p.variant
    LIMIT ${req.query.limit ? Math.min(Number(req.query.limit) || 50, 500) : 5000}`).all(...args);
  res.json(rows.map((r) => ({ ...r, active: !!r.active })));
});

function productBody(b) {
  const sku = str(b.sku);
  const name = str(b.name);
  if (!sku || !name) throw bad('El SKU y el nombre son obligatorios');
  if (num(b.price) < 0) throw bad('El precio no puede ser negativo');
  return { sku, name, variant: str(b.variant), barcode: str(b.barcode), price: num(b.price), min_stock: Math.max(0, Math.trunc(num(b.min_stock))), active: b.active === false ? 0 : 1 };
}

// la vendedora no crea ni edita artículos (precios): los nuevos entran con un ingreso de mercadería
const noSeller = (req) => { if (req.user.role === 'vendedora') throw forbidden('Las vendedoras no crean ni editan artículos'); };

stockRouter.post('/products', (req, res) => {
  noSeller(req);
  const brandId = requireBrand(req, req.body.brand_id);
  const p = productBody(req.body);
  if (db.prepare('SELECT 1 FROM products WHERE brand_id = ? AND sku = ?').get(brandId, p.sku)) throw bad(`El SKU ${p.sku} ya existe en esta marca`);
  if (p.barcode && db.prepare('SELECT 1 FROM products WHERE brand_id = ? AND barcode = ?').get(brandId, p.barcode)) throw bad(`El código de barras ${p.barcode} ya es de otro artículo`);
  const initial = Math.trunc(num(req.body.stock));
  if (initial && !isStaff(req.user)) throw bad('El stock entra con un pedido de ingreso de mercadería');
  const id = tx(() => {
    const r = db.prepare('INSERT INTO products (brand_id, sku, name, variant, barcode, price, min_stock, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(brandId, p.sku, p.name, p.variant, p.barcode, p.price, p.min_stock, p.active);
    const pid = Number(r.lastInsertRowid);
    if (initial) moveStock({ productId: pid, brandId, qty: initial, reason: 'ajuste', note: 'Stock inicial', userId: req.user.id });
    return pid;
  });
  res.json({ id });
});

stockRouter.put('/products/:id', (req, res) => {
  noSeller(req);
  const prod = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(req.params.id));
  if (!prod) throw notFound('Producto inexistente');
  canTouch(req, prod);
  const p = productBody(req.body);
  if (db.prepare('SELECT 1 FROM products WHERE brand_id = ? AND sku = ? AND id <> ?').get(prod.brand_id, p.sku, prod.id)) throw bad(`El SKU ${p.sku} ya existe en esta marca`);
  if (p.barcode && db.prepare('SELECT 1 FROM products WHERE brand_id = ? AND barcode = ? AND id <> ?').get(prod.brand_id, p.barcode, prod.id)) throw bad(`El código de barras ${p.barcode} ya es de otro artículo`);
  db.prepare('UPDATE products SET sku = ?, name = ?, variant = ?, barcode = ?, price = ?, min_stock = ?, active = ? WHERE id = ?')
    .run(p.sku, p.name, p.variant, p.barcode, p.price, p.min_stock, p.active, prod.id);
  res.json({ ok: true });
});

// Ajuste manual (conteo, rotura, faltante): solo MAJA
stockRouter.post('/products/:id/adjust', adminOnly, (req, res) => {
  const prod = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(req.params.id));
  if (!prod) throw notFound('Producto inexistente');
  let qty;
  if (req.body.set_to !== undefined && req.body.set_to !== '') qty = Math.trunc(num(req.body.set_to)) - prod.stock;
  else qty = Math.trunc(num(req.body.qty));
  if (!qty) throw bad('No hay diferencia para ajustar');
  if (!str(req.body.note)) throw bad('Contá el motivo del ajuste');
  tx(() => moveStock({ productId: prod.id, brandId: prod.brand_id, qty, reason: 'ajuste', note: str(req.body.note), userId: req.user.id }));
  res.json({ ok: true, stock: prod.stock + qty });
});

stockRouter.get('/products/:id/movements', (req, res) => {
  const prod = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(req.params.id));
  if (!prod) throw notFound('Producto inexistente');
  canTouch(req, prod);
  const rows = db.prepare(`SELECT m.*, u.name AS user_name FROM stock_movements m LEFT JOIN users u ON u.id = m.user_id
    WHERE m.product_id = ? ORDER BY m.id DESC LIMIT 200`).all(prod.id);
  res.json({ product: prod, movements: rows });
});

// Alta masiva desde planilla: crea o actualiza por SKU. El stock solo lo carga MAJA.
stockRouter.post('/products/import', (req, res) => {
  noSeller(req);
  const brandId = requireBrand(req, req.body.brand_id);
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  if (!rows.length) throw bad('La planilla está vacía');
  if (rows.length > 5000) throw bad('Máximo 5000 filas por vez');
  const withStock = req.user.role === 'admin' && req.body.apply_stock;
  const result = { created: 0, updated: 0, errors: [] };
  tx(() => {
    rows.forEach((row, i) => {
      const sku = str(row.sku);
      const name = str(row.name);
      if (!sku || !name) { result.errors.push(`Fila ${i + 2}: falta SKU o nombre`); return; }
      const existing = db.prepare('SELECT * FROM products WHERE brand_id = ? AND sku = ?').get(brandId, sku);
      let pid;
      if (existing) {
        db.prepare('UPDATE products SET name = ?, variant = COALESCE(?, variant), barcode = COALESCE(?, barcode), price = ?, active = 1 WHERE id = ?')
          .run(name, str(row.variant), str(row.barcode), row.price === undefined || row.price === '' ? existing.price : num(row.price), existing.id);
        pid = existing.id;
        result.updated++;
      } else {
        pid = Number(db.prepare('INSERT INTO products (brand_id, sku, name, variant, barcode, price) VALUES (?, ?, ?, ?, ?, ?)')
          .run(brandId, sku, name, str(row.variant), str(row.barcode), num(row.price)).lastInsertRowid);
        result.created++;
      }
      if (withStock && row.stock !== undefined && row.stock !== '') {
        const current = db.prepare('SELECT stock FROM products WHERE id = ?').get(pid).stock;
        const diff = Math.trunc(num(row.stock)) - current;
        if (diff) moveStock({ productId: pid, brandId, qty: diff, reason: 'ajuste', note: 'Importación de planilla', userId: req.user.id });
      }
    });
  });
  res.json(result);
});
