# MAJA ERP — contexto para Claude

Sistema de gestión de **MAJA Multibrand**, una tienda multimarca en Uruguay: varias marcas de ropa venden en el local, MAJA tiene su mercadería en consignación, cobra una comisión sobre lo vendido y una cuota mensual. Todo el texto de la app está en español rioplatense (voseo) y los montos en pesos uruguayos.

## Cómo correrlo

- Requiere **Node 24** (usa `node:sqlite`, sin dependencias nativas).
- `npm install` y después:
  - `npm run dev` → API en :4310 y Vite en :5310 (con proxy a la API).
  - `npm test` → levanta el servidor sobre una base vacía y recorre todos los flujos (node:test, `tests/erp.test.mjs`). **Correrlo después de cada cambio.**
  - `npm run build` → corre las pruebas y compila el frontend en `dist/` (si una prueba falla, no compila).
  - `npm start` → sirve API + `dist/` en :4310.
- `abrir-prueba.bat` prende una base de PRUEBA (datos inventados) en :4399 desde `datos-prueba/`. `iniciar.bat` prende la real en :4310 desde `data/`.
- La base es SQLite en `DATA_DIR` (por defecto `./data/maja.db`). Las migraciones son `ensureColumn`/`CREATE TABLE IF NOT EXISTS` en `server/db.js`, al arrancar.

## Estructura

- `server/index.js` monta los routers en este orden: `access, extra, cash, cards, stock, orders, money, insights`. **Ojo:** `stock`, `orders`, `money` e `insights` hacen `router.use(auth)` sin ruta, así que cualquier ruta pública (sin sesión) tiene que estar en un router montado antes (ej. `/auth/forgot` y `/auth/reset` están en `extra.js`).
- `server/lib.js`: sesión (token HMAC propio), roles (`adminOnly`, `staffOnly`, `notSeller`, `scopeBrand`), liquidación (`settlementFor`), movimientos de stock (`moveStock`), historial (`audit`) y avisos (`notify`). `num()` lee números a la uruguaya ("1.234,50", "150.000").
- `server/billing.js`: facturación electrónica con Biller (API v3, `https://biller.uy` / `https://test.biller.uy`).
- `server/routes/`: `access` (login, marcas, usuarios, vista previa), `stock` (artículos), `orders` (ingresos, retiros, pick ups con armado), `money` (ventas, cambios, notas de crédito, liquidaciones, tablero), `insights` (rendimiento, objetivos, tablero de la vendedora), `cards` (conciliación con Handy), `cash` (caja diaria), `extra` (historial, avisos, contraseñas, conteo de inventario, factura a la marca).
- `src/` React + Vite + Tailwind 3. `lib/session.jsx` (sesión, roles, `useApi`), `components/ui.jsx` (botones, modales, tablas…), una página por sección en `pages/`.

## Perfiles (los controla el servidor, no solo la pantalla)

- **Dueña** (`role = 'admin'`): ve y configura todo. Tiene el selector **"Ver como"** para mirar la app como vendedora o como una marca (token de vista previa con `as = {role, brand_id}`, solo lectura: el servidor rechaza todo lo que no sea GET).
- **Vendedora** (`'vendedora'`): tablero del día (`/shift`), registra ventas, cambios y notas de crédito; ve ventas de los últimos 7 días sin totales ni exportar; consulta stock pero no crea artículos ni cambia precios; crea, arma, recibe y entrega pedidos pero no los cancela; abre y cierra la caja; cuenta inventario sin aplicar el ajuste. No ve comisiones, cuotas, saldos, liquidaciones, objetivos, tarjetas, historial ni usuarios. No anula ventas enteras.
- **Marca** (`'marca'`, con `brand_id`): solo lo suyo (tablero, ventas, stock, pedidos, pick ups, comisiones y cuotas con su resumen). No ve las notas internas de MAJA ni datos de otras marcas.

La tabla completa está en la página **Usuarios**. Si se cambia un permiso, actualizar esa tabla y `tests/erp.test.mjs`.

## Reglas de negocio ya decididas

- **Cada venta se factura a nombre de una sola marca** y lleva medio de pago. Con tarjeta: en qué POS se pasó (el de MAJA o el de la marca) y el **n° de autorización** del voucher (obligatorio).
- Facturación por marca (`brands.billing_mode`): `cuenta_ajena` (MAJA emite con su Biller e-Ticket/e-Factura 131/141 con la marca como mandante), `biller_marca` (con el token de la marca, 101/111) o `manual` (se anota el n°). **Nunca se emitió un comprobante real**: la primera prueba tiene que ser en el ambiente de pruebas de Biller.
- **Cambio de prenda** = dos comprobantes (devolución + venta nueva); `sales.charged` guarda lo que realmente se cobró o devolvió (la diferencia). **Nota de crédito** = devolución asociada a una venta (`ref_sale_id`); el servidor no deja devolver más de lo vendido.
- **Pedidos**: ingreso (la marca manda mercadería; entra al stock lo que MAJA cuenta al recibir), retiro (la marca se lleva), pick up (MAJA arma línea por línea, lo deja listo y anota quién retiró; baja el stock por lo armado). Los pick ups no son ventas de MAJA (no generan comisión).
- **Liquidación mensual por marca** = comisión % sobre lo vendido + cuota fija (+ IVA 22 % si la marca está marcada así) **− lo que se cobró con tarjeta en el POS de MAJA** por ventas de esa marca. Se descuenta lo que Handy acreditó (importe menos su comisión y la devolución de IVA del débito). Si da negativo, MAJA le debe a la marca; los pagos de MAJA a la marca se guardan en negativo. Cerrar el mes congela los montos.
- **Conciliación de tarjetas**: se sube el Excel de "Actividad" de Handy. Normalmente solo existe el del POS de MAJA, y alcanza para detectar ventas anotadas en el POS de la marca que se cobraron en el de MAJA. El cruce va por n° de autorización y, si no hay, por importe + fecha + hora + n° de factura, asignando primero los pares más seguros.
- **Caja diaria**: esperado = fondo + ventas en efectivo (lo cobrado) + entradas − salidas. Si al cerrar hay diferencia, le llega un aviso a la dueña.
- **Escáner**: tipea el código y manda Enter. Los artículos tienen SKU y código de barras (EAN); se busca por cualquiera. Cada lectura suma 1.

## Convenciones y trampas conocidas

- **No inventar datos**: la app arranca vacía; nada de ejemplos ni políticas inventadas en la base real. Los datos de prueba van solo en `datos-prueba/` o en bases temporales.
- En `src/index.css`, `.field` y `.tbl` tienen que quedar dentro de `@layer components`; si no, pisan las clases de Tailwind (íconos encima del texto, columnas mal alineadas).
- `font-variant-numeric: tabular-nums` solo en `.num`, no en todo el `body` (separa la puntuación del texto).
- La tabla `users` se rehace en `db.js` para agregar el rol vendedora: columnas nuevas de `users` van **después** de ese bloque o se pierden en una base nueva.
- Las fechas de las ventas son de Uruguay (UTC−3); `created_at` de SQLite está en UTC.
- Gráficos de Recharts con `isAnimationActive={false}` (en PCs con "reducir movimiento" quedaban en blanco).

## Pendiente

- Publicarla (Railway u otro): volumen persistente en `/data` con `DATA_DIR=/data`, y `SESSION_SECRET` fijo. Para avisos y recuperación de contraseña por mail: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` y `APP_URL`.
- Cargar el token y la sucursal de Biller de MAJA y confirmar su régimen de IVA (Marcas → Facturación de MAJA) antes de facturar.
- Confirmar con cada marca qué modalidad de facturación usa.
