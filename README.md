# MAJA ERP

Sistema de gestión de MAJA Multibrand: cada marca tiene su acceso y ve solo lo suyo.

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

El stock se mueve solo: suma al recibir un ingreso, baja con cada venta, pick up entregado o retiro, y vuelve con una devolución o una venta anulada. Cada movimiento queda en el historial del artículo.

Liquidación del mes de una marca = comisión % sobre lo vendido + cuota mensual (+ IVA 22 % si la marca está marcada así). Mientras el mes está abierto se recalcula; al cerrarlo se congela.

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
