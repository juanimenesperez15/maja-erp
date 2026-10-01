import { Router } from 'express';
import { db, tx } from '../db.js';
import { auth, bad, notFound, forbidden, scopeBrand, requireBrand, moveStock, str, num } from '../lib.js';

export const ordersRouter = Router();
ordersRouter.use(auth);

// ingreso: la marca manda mercadería → suma stock al recibirla
// pickup:  pedido online de la marca que el cliente retira en MAJA → descuenta stock al entregarse
// retiro:  la marca se lleva mercadería → descuenta stock al retirarse
const TYPES = ['ingreso', 'pickup', 'retiro'];
const SIGN = { ingreso: 1, pickup: -1, retiro: -1 };
const REASON = { ingreso: 'ingreso', pickup: 'pickup', retiro: 'retiro' };

function loadOrder(req, id) {
  const order = db.prepare(`SELECT o.*, b.name AS brand_name, u.name AS created_by_name
    FROM orders o JOIN brands b ON b.id = o.brand_id LEFT JOIN users u ON u.id = o.created_by WHERE o.id = ?`).get(Number(id));
  if (!order) throw notFound('Pedido inexistente');
  if (req.user.role === 'marca' && order.brand_id !== req.user.brand_id) throw forbidden();
  order.items = db.prepare(`SELECT oi.*, p.name AS product_name, p.variant AS product_variant, p.stock AS product_stock
    FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ? ORDER BY oi.id`).all(order.id);
  return order;
}

ordersRouter.get('/orders', (req, res) => {
  const brandId = scopeBrand(req, req.query.brand_id);
  const where = ['1 = 1'];
  const args = [];
  if (brandId) { where.push('o.brand_id = ?'); args.push(brandId); }
  if (TYPES.includes(req.query.type)) { where.push('o.type = ?'); args.push(req.query.type); }
  if (req.query.status === 'abiertos') where.push("o.status IN ('pendiente','listo')");
  else if (str(req.query.status)) { where.push('o.status = ?'); args.push(req.query.status); }
  const rows = db.prepare(`
    SELECT o.*, b.name AS brand_name,
      (SELECT COALESCE(SUM(qty), 0) FROM order_items WHERE order_id = o.id) AS units,
      (SELECT COALESCE(SUM(picked_qty), 0) FROM order_items WHERE order_id = o.id) AS picked_units,
      (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) AS lines
    FROM orders o JOIN brands b ON b.id = o.brand_id
    WHERE ${where.join(' AND ')}
    ORDER BY CASE o.status WHEN 'pendiente' THEN 0 WHEN 'listo' THEN 1 ELSE 2 END, o.created_at DESC
    LIMIT 500`).all(...args);
  res.json(rows);
});

ordersRouter.get('/orders/:id', (req, res) => res.json(loadOrder(req, req.params.id)));

ordersRouter.post('/orders', (req, res) => {
  const brandId = requireBrand(req, req.body.brand_id);
  const type = req.body.type;
  if (!TYPES.includes(type)) throw bad('Tipo de pedido inválido');
  const items = (Array.isArray(req.body.items) ? req.body.items : []).filter((it) => Math.trunc(num(it.qty)) > 0);
  if (!items.length) throw bad('Agregá al menos un artículo con cantidad');

  const clean = items.map((it) => {
    const qty = Math.trunc(num(it.qty));
    if (it.product_id) {
      const p = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(it.product_id));
      if (!p || p.brand_id !== brandId) throw bad('Hay un artículo que no es de esta marca');
      return { product_id: p.id, sku: p.sku, description: p.name, variant: p.variant, price: p.price, qty };
    }
    // artículo nuevo: solo tiene sentido en un ingreso (se da de alta al recibirlo)
    if (type !== 'ingreso') throw bad('En pick ups y retiros elegí artículos que ya estén en stock');
    if (!str(it.sku) || !str(it.description)) throw bad('Los artículos nuevos necesitan SKU y nombre');
    return { product_id: null, sku: str(it.sku), description: str(it.description), variant: str(it.variant), price: num(it.price), qty };
  });

  const id = tx(() => {
    const r = db.prepare(`INSERT INTO orders (brand_id, type, customer_name, customer_phone, external_ref, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(brandId, type, str(req.body.customer_name), str(req.body.customer_phone), str(req.body.external_ref), str(req.body.notes), req.user.id);
    const oid = Number(r.lastInsertRowid);
    const ins = db.prepare('INSERT INTO order_items (order_id, product_id, sku, description, variant, price, qty) VALUES (?, ?, ?, ?, ?, ?, ?)');
    clean.forEach((c) => ins.run(oid, c.product_id, c.sku, c.description, c.variant, c.price, c.qty));
    return oid;
  });
  res.json({ id });
});

// Armado / control: MAJA va marcando cuánto armó (pick up, retiro) o cuánto llegó (ingreso) de cada línea.
ordersRouter.put('/orders/:id/pick', (req, res) => {
  if (req.user.role !== 'admin') throw forbidden('El armado lo hace MAJA');
  const order = loadOrder(req, req.params.id);
  if (order.status === 'completado' || order.status === 'cancelado') throw bad('Este pedido ya está cerrado');
  const lines = Array.isArray(req.body.items) ? req.body.items : [];
  tx(() => {
    for (const l of lines) {
      const it = order.items.find((x) => x.id === Number(l.id));
      if (!it) continue;
      let q = Math.max(0, Math.trunc(num(l.picked_qty)));
      // de un ingreso puede llegar más de lo avisado; para entregar no se arma más de lo pedido
      if (order.type !== 'ingreso') q = Math.min(q, it.qty);
      db.prepare('UPDATE order_items SET picked_qty = ? WHERE id = ?').run(q, it.id);
    }
    db.prepare("UPDATE orders SET updated_at = datetime('now') WHERE id = ?").run(order.id);
  });
  res.json(loadOrder(req, order.id));
});

ordersRouter.put('/orders/:id/status', (req, res) => {
  const order = loadOrder(req, req.params.id);
  const next = req.body.status;
  if (!['pendiente', 'listo', 'completado', 'cancelado'].includes(next)) throw bad('Estado inválido');
  if (order.status === 'completado' || order.status === 'cancelado') throw bad('Este pedido ya está cerrado');
  const picked = order.items.reduce((a, i) => a + i.picked_qty, 0);
  if (req.user.role === 'marca' && !(next === 'cancelado' && order.status === 'pendiente' && picked === 0)) {
    throw forbidden('La marca solo puede cancelar pedidos que MAJA todavía no empezó a armar');
  }
  if ((next === 'listo' || next === 'completado') && picked === 0) {
    throw bad(order.type === 'ingreso' ? 'Marcá cuánto llegó de cada artículo' : 'Marcá lo que armaste de cada artículo');
  }
  const pickedUpBy = str(req.body.picked_up_by);
  if (next === 'completado' && order.type !== 'ingreso' && !pickedUpBy) throw bad('Anotá quién retiró');

  tx(() => {
    if (next === 'completado') {
      for (const it of order.items) {
        if (!it.picked_qty) continue;
        let pid = it.product_id;
        if (!pid) {
          // alta del artículo nuevo que vino en el ingreso
          const existing = db.prepare('SELECT id FROM products WHERE brand_id = ? AND sku = ?').get(order.brand_id, it.sku);
          pid = existing?.id ?? Number(db.prepare('INSERT INTO products (brand_id, sku, name, variant, price) VALUES (?, ?, ?, ?, ?)')
            .run(order.brand_id, it.sku, it.description, it.variant, it.price || 0).lastInsertRowid);
          db.prepare('UPDATE order_items SET product_id = ? WHERE id = ?').run(pid, it.id);
        }
        // se mueve lo armado/recibido, no lo pedido: lo que faltó queda a la vista de la marca
        moveStock({ productId: pid, brandId: order.brand_id, qty: SIGN[order.type] * it.picked_qty, reason: REASON[order.type], refType: 'order', refId: order.id, userId: req.user.id });
      }
    }
    db.prepare(`UPDATE orders SET status = ?, admin_notes = COALESCE(?, admin_notes), picked_up_by = COALESCE(?, picked_up_by), updated_at = datetime('now'),
      completed_at = CASE WHEN ? = 'completado' THEN datetime('now') ELSE completed_at END WHERE id = ?`)
      .run(next, req.user.role === 'admin' ? str(req.body.admin_notes) : null, next === 'completado' ? pickedUpBy : null, next, order.id);
  });
  res.json(loadOrder(req, order.id));
});
