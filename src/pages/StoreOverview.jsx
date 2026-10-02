import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Info, Target, TrendingDown } from 'lucide-react';
import { useApi, useSession } from '../lib/session.jsx';
import { Badge, Button, Card, Empty, Loading, Tabs, cx } from '../components/ui.jsx';
import { DailyChart, MonthsChart, fillDays } from '../components/charts.jsx';
import { Delta, TopProducts, StockCard, PendingCard } from './Dashboard.jsx';
import { fmtDate, fmtInt, fmtMoney, fmtPeriod } from '../lib/format.js';

const pct = (x) => `${Math.round((x ?? 0) * 100)} %`;

/** Estado de una marca contra su objetivo, según el ritmo (1 = justo para llegar). */
function paceState(r, elapsed) {
  if (r.goal === null) return { tone: 'neutral', label: 'Sin objetivo' };
  if (r.pct_goal >= 1) return { tone: 'ok', label: 'Objetivo cumplido' };
  if (elapsed >= 1) return { tone: 'bad', label: 'No llegó' };
  if (r.pace >= 1) return { tone: 'ok', label: 'En ritmo' };
  if (r.pace >= 0.8) return { tone: 'warn', label: 'Un poco atrasada' };
  return { tone: 'bad', label: 'Atrasada' };
}
const BAR = { ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad', neutral: 'bg-ink/40' };

/** Barra de avance con una marca vertical en el punto del mes donde estamos. */
function GoalBar({ value, elapsed, tone, tall }) {
  return (
    <div className={cx('relative w-full rounded-full bg-sunk', tall ? 'h-3' : 'h-2')}>
      <div className={cx('h-full rounded-full', BAR[tone])} style={{ width: `${Math.min(100, (value ?? 0) * 100)}%` }} />
      {elapsed > 0 && elapsed < 1 && (
        <div className="absolute -top-1 bottom-[-4px] w-0.5 rounded bg-ink" style={{ left: `${elapsed * 100}%` }} title="Hoy" />
      )}
    </div>
  );
}

export default function StoreOverview({ period, dash }) {
  const { isOwner } = useSession();
  const { data: perf, loading } = useApi('/performance', { period });
  const [sort, setSort] = useState('avance');

  const rows = useMemo(() => {
    const r = [...(perf?.rows || [])];
    if (sort === 'ventas') return r.sort((a, b) => b.sales - a.sales);
    if (sort === 'variacion') return r.sort((a, b) => (a.delta_prev ?? 0) - (b.delta_prev ?? 0));
    // avance: las que van peor arriba; sin objetivo al final, ordenadas por ventas
    return r.sort((a, b) => {
      if (a.pace === null && b.pace === null) return a.sales - b.sales;
      if (a.pace === null) return 1;
      if (b.pace === null) return -1;
      return a.pace - b.pace;
    });
  }, [perf, sort]);

  if (loading && !perf) return <Loading />;
  if (!perf) return null;

  const { store, elapsed } = perf;
  const k = dash.kpis;
  const storeTone = store.goal ? paceState({ goal: store.goal, pct_goal: store.pct_goal, pace: elapsed > 0 ? store.pct_goal / elapsed : 0 }, elapsed).tone : 'neutral';
  const lowest = rows.find((r) => r.pace !== null && r.pace < 1);
  const daily = fillDays(period, dash.daily);
  const payTotal = perf.by_payment.reduce((a, r) => a + r.total, 0);

  return (
    <div className="space-y-6">
      {/* objetivo de la tienda */}
      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <Card className="rise p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="eyebrow">Vendido en {fmtPeriod(period)}</div>
              <div className="num mt-2 font-display text-[clamp(40px,5vw,60px)] leading-none">{fmtMoney(store.sales)}</div>
              <div className="mt-2 text-[13px] text-muted"><Delta now={store.sales} before={store.prev_sales} suffix={perf.day < perf.days ? 'vs. el mismo tramo del mes pasado' : 'vs. mes anterior'} /></div>
            </div>
            {store.goal ? (
              <div className="text-right">
                <div className="eyebrow">Objetivo de la tienda</div>
                <div className="num mt-2 font-display text-[30px] leading-none">{fmtMoney(store.goal)}</div>
                <div className="mt-1 text-[12px] text-muted">suma de los objetivos por marca</div>
              </div>
            ) : isOwner && (
              <Link to="/objetivos"><Button variant="outline"><Target size={15} />Definir objetivos</Button></Link>
            )}
          </div>
          {store.goal && (
            <div className="mt-6">
              <GoalBar value={store.pct_goal} elapsed={elapsed} tone={storeTone} tall />
              <div className="mt-2 flex flex-wrap justify-between gap-2 text-[13px]">
                <span><b className="num">{pct(store.pct_goal)}</b> del objetivo{elapsed < 1 && <span className="text-muted"> · pasó el {pct(elapsed)} del mes</span>}</span>
                {elapsed < 1 && <span className="text-muted">Proyección a fin de mes: <b className="num text-ink">{fmtMoney(store.projection)}</b> ({pct(store.projection / store.goal)})</span>}
              </div>
            </div>
          )}
        </Card>

        <div className="grid grid-cols-2 gap-4">
          <Stat2 label="Hoy" value={fmtMoney(store.today)} sub={`${store.today_tickets} ${store.today_tickets === 1 ? 'venta' : 'ventas'}`} />
          <Stat2 label="Ticket promedio" value={fmtMoney(k.avg_ticket)} sub={`${fmtInt(k.tickets)} ventas · ${fmtInt(k.units)} unid.`} />
          {isOwner ? <>
            <Stat2 label="Comisión + cuota" value={fmtMoney(k.to_pay)} sub={`Comisión ${fmtMoney(k.commission)} · cuota ${fmtMoney(k.fees)}`} />
            <Stat2 label="Saldo a cobrar" value={fmtMoney(k.owed)} accent={k.owed > 0} sub={<Link to="/liquidaciones" className="underline decoration-line underline-offset-2 hover:text-ink">Liquidaciones</Link>} />
          </> : <>
            <Stat2 label="Pick ups abiertos" value={fmtInt(dash.open_orders.pickup || 0)} sub={<Link to="/pickups" className="underline decoration-line underline-offset-2 hover:text-ink">Ver pick ups</Link>} />
            <Stat2 label="Ingresos por recibir" value={fmtInt(dash.open_orders.ingreso || 0)} sub={<Link to="/pedidos" className="underline decoration-line underline-offset-2 hover:text-ink">Ver pedidos</Link>} />
          </>}
        </div>
      </div>

      {/* alertas */}
      {perf.alerts.length > 0 && (
        <Card className="rise p-5" style={{ animationDelay: '80ms' }}>
          <div className="eyebrow mb-3">Para mirar</div>
          <ul className="grid gap-2 md:grid-cols-2">
            {perf.alerts.slice(0, 8).map((a, i) => {
              const Icon = a.level === 'bad' ? TrendingDown : a.level === 'warn' ? AlertTriangle : Info;
              return (
                <li key={i} className={cx('flex items-start gap-2.5 rounded-lg px-3 py-2 text-[13px]', a.level === 'bad' ? 'bg-bad-soft text-bad' : a.level === 'warn' ? 'bg-warn-soft text-warn' : 'bg-sunk text-ink2')}>
                  <Icon size={15} className="mt-0.5 shrink-0" />
                  <span className="min-w-0">{a.text}{a.action === 'goals' && isOwner && <Link to="/objetivos" className="ml-1 font-semibold underline">Definir</Link>}</span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {/* cómo va cada marca */}
      <Card className="rise overflow-hidden" style={{ animationDelay: '120ms' }}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3 pt-5">
          <div>
            <div className="eyebrow">Cómo va cada marca</div>
            <div className="mt-1 text-[13px] text-muted">La raya negra marca el día de hoy: si la barra no llega, la marca va atrasada.</div>
          </div>
          <Tabs value={sort} onChange={setSort} options={[{ value: 'avance', label: 'Más baja primero' }, { value: 'ventas', label: 'Más vendido' }, { value: 'variacion', label: 'Más caída' }]} />
        </div>
        {!rows.length ? <Empty title="Sin marcas activas" /> : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Marca</th><th className="text-right">Vendido</th><th className="min-w-[200px]">Avance del objetivo</th><th className="text-right">Proyección</th>
                  <th className="text-right">vs. mes ant.</th><th className="hidden text-right 2xl:table-cell">Ticket prom.</th><th className="text-right">Última venta</th><th className="text-right">Stock</th>
                  {isOwner && <th className="text-right">Comisión</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const st = paceState(r, elapsed);
                  return (
                    <tr key={r.brand_id} className={cx(lowest?.brand_id === r.brand_id && sort === 'avance' && 'bg-bad-soft/40')}>
                      <td>
                        <div className="whitespace-nowrap font-medium">{r.brand_name}</div>
                        <div className="whitespace-nowrap text-[12px] text-muted">{pct(r.share)} de la tienda</div>
                      </td>
                      <td className="num whitespace-nowrap text-right">{fmtMoney(r.sales)}<span className="block text-[11px] text-muted">{fmtInt(r.units)} unid.</span></td>
                      <td>
                        {r.goal !== null ? (
                          <>
                            <GoalBar value={r.pct_goal} elapsed={elapsed} tone={st.tone} />
                            <div className="mt-1.5 flex items-center justify-between gap-2 text-[12px]">
                              <span className="num whitespace-nowrap"><b>{pct(r.pct_goal)}</b> <span className="text-muted">de {fmtMoney(r.goal)}</span></span>
                              <Badge tone={st.tone}>{lowest?.brand_id === r.brand_id ? 'La más baja' : st.label}</Badge>
                            </div>
                          </>
                        ) : <span className="text-[12px] text-muted">Sin objetivo{isOwner && <> · <Link to="/objetivos" className="underline">definir</Link></>}</span>}
                      </td>
                      <td className="num whitespace-nowrap text-right">{elapsed < 1 && elapsed > 0 ? fmtMoney(r.projection) : '—'}{r.pct_projection !== null && elapsed < 1 && <span className={cx('block text-[11px]', r.pct_projection >= 1 ? 'text-ok' : 'text-bad')}>{pct(r.pct_projection)} del obj.</span>}</td>
                      <td className={cx('num whitespace-nowrap text-right text-[13px]', r.delta_prev === null ? 'text-muted' : r.delta_prev >= 0 ? 'text-ok' : 'text-bad')}>{r.delta_prev === null ? '—' : `${r.delta_prev >= 0 ? '+' : ''}${Math.round(r.delta_prev * 100)} %`}</td>
                      <td className="num hidden whitespace-nowrap text-right 2xl:table-cell">{r.tickets ? fmtMoney(r.avg_ticket) : '—'}</td>
                      <td className={cx('whitespace-nowrap text-right text-[13px]', r.days_since_sale >= 7 ? 'font-semibold text-bad' : 'text-ink2')}>
                        {r.last_sale ? (r.days_since_sale === 0 ? 'Hoy' : r.days_since_sale === 1 ? 'Ayer' : `Hace ${r.days_since_sale} días`) : 'Nunca'}
                        {r.last_sale && r.days_since_sale > 1 && <span className="block text-[11px] font-normal text-muted">{fmtDate(r.last_sale)}</span>}
                      </td>
                      <td className="num whitespace-nowrap text-right">{fmtInt(r.stock_units)}<span className={cx('block text-[11px]', !r.stock_units || (r.coverage_days !== null && r.coverage_days < 14) ? 'text-warn' : 'text-muted')}>{!r.stock_units ? 'sin stock' : r.coverage_days !== null ? `para ~${r.coverage_days} días` : 'sin ventas 30 d'}</span></td>
                      {isOwner && <td className="num whitespace-nowrap text-right">{r.commission !== undefined ? fmtMoney(r.commission) : '—'}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Card className="rise min-w-0 p-5" style={{ animationDelay: '160ms' }}>
          <div className="eyebrow">Ventas por día</div>
          <div className="mb-4 mt-1 text-[13px] text-muted">Toda la tienda</div>
          {dash.daily.length ? <DailyChart data={daily} /> : <Empty title="Sin ventas este mes" />}
        </Card>
        <Card className="rise min-w-0 p-5" style={{ animationDelay: '200ms' }}>
          <div className="eyebrow">Últimos 12 meses</div>
          <div className="mb-4 mt-1 text-[13px] text-muted">Vendido por mes</div>
          <MonthsChart data={dash.months} />
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="rise p-5" style={{ animationDelay: '220ms' }}>
          <div className="eyebrow mb-4">Por medio de pago</div>
          {!perf.by_payment.length ? <div className="text-[13px] text-muted">Sin ventas en el mes.</div> : (
            <ul className="space-y-3">
              {perf.by_payment.map((p) => (
                <li key={p.method} className="text-[13px]">
                  <div className="mb-1 flex justify-between gap-3"><span>{p.method} <span className="text-muted">· {p.tickets} {p.tickets === 1 ? 'venta' : 'ventas'}</span></span><span className="num font-semibold">{fmtMoney(p.total)} <span className="font-normal text-muted">{pct(payTotal ? p.total / payTotal : 0)}</span></span></div>
                  <div className="h-1.5 rounded-full bg-sunk"><div className="h-1.5 rounded-full bg-ink" style={{ width: `${payTotal ? (p.total / payTotal) * 100 : 0}%` }} /></div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="rise overflow-hidden" style={{ animationDelay: '240ms' }}>
          <div className="px-5 pb-2 pt-5"><div className="eyebrow">Por vendedora</div></div>
          {!perf.by_seller.length ? <div className="px-5 pb-6 text-[13px] text-muted">Sin ventas en el mes.</div> : (
            <table className="tbl">
              <thead><tr><th>Quién registró</th><th className="text-right">Ventas</th><th className="text-right">Unid.</th><th className="text-right">Importe</th></tr></thead>
              <tbody>
                {perf.by_seller.map((s) => (
                  <tr key={s.seller}>
                    <td className="font-medium">{s.seller}{s.role === 'admin' && <span className="ml-1.5 text-[12px] font-normal text-muted">(dueña)</span>}</td>
                    <td className="num text-right">{fmtInt(s.tickets)}</td>
                    <td className="num text-right">{fmtInt(s.units)}</td>
                    <td className="num text-right font-semibold">{fmtMoney(s.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <TopProducts className="lg:col-span-2" data={dash} brandId="" period={period} />
        <div className="space-y-6">
          <StockCard data={dash} brandId="" />
          <PendingCard data={dash} brandId="" />
        </div>
      </div>
    </div>
  );
}

function Stat2({ label, value, sub, accent }) {
  return (
    <div className="rise min-w-0 rounded-xl border border-line bg-card px-4 py-4">
      <div className="eyebrow leading-snug">{label}</div>
      <div className={cx('num mt-2 truncate font-display text-[clamp(22px,2.2vw,30px)] leading-none', accent && 'text-accent')}>{value}</div>
      {sub && <div className="mt-2 text-[12px] text-muted">{sub}</div>}
    </div>
  );
}
