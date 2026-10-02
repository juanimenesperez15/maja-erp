# MAJA ERP

Sistema de gestión de MAJA Multibrand. Tres perfiles:
- **Dueña:** ve y configura todo: tablero con cómo va cada marca contra su objetivo, objetivos mensuales, liquidaciones, marcas y usuarios.
- **Vendedora:** registra ventas, arma pick ups, recibe mercadería y ve stock y avance de objetivos; no ve comisiones, cuotas ni saldos, no anula ventas ni ajusta stock.
- **Marca:** ve solo lo suyo.

| Módulo | MAJA (admin) | Marca |
|---|---|---|
| Tablero | Todas las marcas o una | El suyo: ventas, stock, pendientes, saldo |
| Ventas | Registra ventas y devoluciones, anula | Ve lo vendido de su marca |
| Stock | Ajusta stock, importa planillas | Carga artículos y planillas (sin stock) |
| Pedidos | Recibe ingresos y entrega retiros | Avisa ingresos y retiros de mercadería |
| Pick ups | Prepara y entrega | Carga pedidos online que se retiran en MAJA |
| Liquidaciones | Cierra meses y registra pagos | Ve comisiones, cuotas, pagos y saldo |
| Marcas / Usuarios | Alta de marcas (comisión %, cuota, IVA) y accesos | — |

Cada venta se factura a nombre de una sola marca y lleva medio de pago. Según cómo esté configurada la marca:
- **Biller de MAJA, por cuenta ajena:** e-Ticket/e-Factura 131/141 con la marca como mandante (`complementoFiscal`). Token y sucursal en Marcas → Facturación de MAJA.
- **Biller de la marca:** e-Ticket/e-Factura 101/111 con el token propio de la marca.
- **A mano:** MAJA anota el número de la factura.

Si Biller falla, la venta queda guardada como "sin facturar" y se reintenta desde Ventas. Anular una venta facturada emite una nota de crédito total; una devolución emite una NC que referencia la venta original.

Pick ups: la marca pide, MAJA arma artículo por artículo (puede quedar incompleto), lo marca listo y registra quién lo retiró. El stock baja por lo armado, no por lo pedido.

**Conciliación de tarjetas** (dueña): cada venta con débito o crédito guarda en qué POS se pasó (el de MAJA o el de la marca). Se sube el reporte de Actividad de Handy de cada POS (Excel); cada cobro se cruza con las ventas por importe, fecha, hora y n° de factura, y quedan marcadas las ventas anotadas en el POS equivocado, con el medio equivocado, cobradas en el POS de otra marca, cobros sin venta y ventas con tarjeta sin cobro. "Corregir venta" la deja como dice Handy. La liquidación de cada marca muestra cuánto de sus ventas se cobró en el POS de MAJA.

**Escáner de códigos de barras:** cada artículo puede tener su código de barras (EAN) además del SKU. En un pedido nuevo (ingreso, retiro o pick up) el modo Escáner suma 1 por lectura y agrega los códigos desconocidos como artículos nuevos (en ingresos); también se puede cargar desde planilla (SKU o código + cantidad). Al recibir o armar un pedido, escanear cada prenda la cuenta en su línea. En la caja, leer el código agrega el artículo a la venta.

**Caja diaria:** la vendedora abre con el fondo, anota entradas y salidas de efectivo y al cerrar cuenta la plata; el sistema compara con lo esperado (fondo + ventas en efectivo ± movimientos) y le avisa a la dueña si hay diferencia.

**Ventas con tarjeta:** además del POS se anota el n° de autorización del voucher; la conciliación lo usa para cruzar exacto. **Cambio de prenda** en un paso (devolución + venta nueva, se cobra o devuelve solo la diferencia) y **nota de crédito** asociada a una venta (la puede hacer la vendedora; no deja devolver más de lo vendido).

**Factura a la marca:** al cerrar el mes, la dueña emite con el Biller de MAJA la e-Factura de comisión + cuota (o anota el número si la hace a mano). Resumen mensual en PDF para cada marca y envío por WhatsApp.

**Etiquetas** con código de barras (rollo 50×30 o A4) para las prendas sin código, y **conteo de inventario** con escáner (la vendedora cuenta, la dueña aplica el ajuste).

**Avisos** dentro de la app (campana) y por mail si se configuran SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM y APP_URL. **Historial de cambios** (precios, ajustes, anulaciones, pagos, cierres). **Recuperar contraseña** por mail, o con un link que genera la dueña.

El stock se mueve solo: suma al recibir un ingreso, baja con cada venta, pick up entregado o retiro, y vuelve con una devolución o una venta anulada. Cada movimiento queda en el historial del artículo.

Liquidación del mes de una marca = comisión % sobre lo vendido + cuota mensual (+ IVA 22 % si la marca está marcada así). Mientras el mes está abierto se recalcula; al cerrarlo se congela.

## Pruebas

`npm test` levanta el servidor sobre una base vacía y recorre todos los flujos (perfiles, stock, pedidos, ventas, caja, cambios, notas de crédito, tarjetas, conteo, liquidación, contraseñas). `npm run build` corre las pruebas antes de compilar: si fallan, no se publica.

## Uso local

```
npm install
npm run build
npm start          # http://localhost:4310
```

Para desarrollo: `npm run dev` (API en 4310 y Vite en http://localhost:5310).

La primera vez pide crear el usuario administrador. La base es SQLite (`node:sqlite`, Node 24) en `data/maja.db`.

## Deploy (Railway)

- Build: `npm run build` · Start: `npm start`
- Variables: `DATA_DIR=/data` y un volumen montado en `/data` (sin volumen se pierde la base en cada deploy). Opcional `SESSION_SECRET`.
