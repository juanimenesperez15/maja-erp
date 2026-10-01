import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import './db.js';
import { HttpError } from './lib.js';
import { accessRouter } from './routes/access.js';
import { stockRouter } from './routes/stock.js';
import { ordersRouter } from './routes/orders.js';
import { moneyRouter } from './routes/money.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '5mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api', accessRouter, stockRouter, ordersRouter, moneyRouter);
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Ruta inexistente')));

const dist = path.resolve('dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err, _req, res, _next) => {
  const status = err.status || (err instanceof SyntaxError ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Error interno del servidor' : err.message });
});

const port = Number(process.env.PORT) || 4310;
app.listen(port, () => console.log(`MAJA ERP escuchando en http://localhost:${port}`));
