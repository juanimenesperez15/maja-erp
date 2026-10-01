import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight, Store, ShoppingBag, Truck, AlertTriangle } from 'lucide-react';
import { useSession, useApi } from '../lib/session.jsx';
import { Badge, Card, Empty, ErrorNote, Loading, PageHeader, Stat, STATUS_LABEL, STATUS_TONE, Button } from '../components/ui.jsx';
import { currentPeriod, fmtDateShort, fmtInt, fmtMoney, fmtPeriod, fmtPeriodShort, shiftPeriod, fmtDateTime } from '../lib/format.js';

const INK = '#1d1b18';
const ACCENT = '#7c2d23';
const GRID = '#e0d8ca';
const AXIS = { fontSize: 11, fill: '#857d71' };

function ChartTip({ active, payload, label, labelFmt }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-card px-3 py-2 text-[12px] shadow-lg">
      <div className="text-muted">{labelFmt ? labelFmt(label) : label}</div>
      <div className="num mt-0.5 text-[14px] font-semibold text-ink">{fmtMoney(payload[0].value)}</div>
      {payload[0].payload.units !== undefined && <div className="text-muted">{fmtInt(payload[0].payload.units)} unidades</div>}
    </div>
  );
}

function Delta({ now, before }) {
  if (!before) return <span>Sin ventas el mes anterior</span>;
  const d = ((now - before) / before) * 100;
  const up = d >= 0;
  return (
    <span className={up ? 'text-ok' : 'text-bad'}>
      {up ? <ArrowUpRight size={13} className="inline" /> : <ArrowDownRight size={13} className="inline" />}
      {Math.abs(d).toFixed(0)} % vs. mes anterior
    </span>
  );
}

export default function Dashboard() {
  const { isAdmin, brands, brandsLoaded, brandId, user } = useSession();
  const [period, setPeriod] = useState(currentPeriod());
  const { data, error, loading } = useApi('/dashboard', { brand_id: brandId, period });
  const brandName = brandId ? brands.find((b) => String(b.id) === String(brandId))?.name ?? user.brand_name : null;

  if (isAdmin && !brandsLoaded) return <Loading />;
  if (isAdmin && !brands.length) {
    return (
      <>
        <PageHeader eyebrow="Tablero" title="Bienvenida a MAJA" />
        <Card><Empty icon={Store} title="Todavía no hay marcas" action={<Link to="/marcas"><Button>Dar de alta la primera marca</Button></Link>}>
          Empezá cargando las marcas que venden en la tienda, con su comisión y su cuota mensual. Después les creás el acceso desde Usuarios.
        </Empty></Card>
      </>
    );
  }

  const isCurrent = period === currentPeriod();
  const k = data?.kpis;
  const daily = data ? fillDays(period, data.daily) : [];

  return (
    <>
      <PageHeader eyebrow={brandName ? `Tablero · ${brandName}` : 'Tablero · todas las marcas'} title={<span className="capitalize">{fmtPeriod(period)}</span>}>
        <div className="flex items-center rounded-lg border border-line bg-card">
          <button className="p-2 text-ink2 hover:text-ink" onClick={() => setPeriod(shiftPeriod(period, -1))} aria-label="Mes anterior"><ChevronLeft size={16} /></button>
          <span className="min-w-[90px] text-center text-[13px] font-medium capitalize">{fmtPeriodShort(period)}</span>
          <button className="p-2 text-ink2 hover:text-ink disabled:opacity-30" disabled={isCurrent} onClick={() => setPeriod(shiftPeriod(period, 1))} aria-label="Mes siguiente"><ChevronRight size={16} /></button>
        </div>
      </PageHeader>
      <ErrorNote>{error}</ErrorNote>
      {loading && !data ? <Loading /> : data && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Vendido" value={fmtMoney(k.sales)} sub={<Delta now={k.sales} before={k.prev_sales} />} />
            <Stat label="Unidades" value={fmtInt(k.units)} sub={`${fmtInt(k.tickets)} ${k.tickets === 1 ? 'ticket' : 'tickets'} · promedio ${fmtMoney(k.avg_ticket)}`} delay={60} />
            <Stat label={isAdmin && !brandId ? 'A cobrar a las marcas' : 'Comisión + cuota del mes'} value={fmtMoney(k.to_pay)}
              sub={`Comisión ${fmtMoney(k.commission)} · cuota ${fmtMoney(k.fees)}`} delay={120} />
            <Stat label={isAdmin && !brandId ? 'Saldo pendiente total' : 'Saldo a pagar a MAJA'} value={fmtMoney(k.owed)} tone={k.owed > 0 ? 'accent' : undefined}
              sub={<Link to="/liquidaciones" className="underline decoration-line underline-offset-2 hover:text-ink">Ver detalle</Link>} delay={180} />
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
            <Card className="rise p-5" style={{ animationDelay: '220ms' }}>
              <div className="mb-4 flex items-baseline justify-between">
                <div>
                  <div className="eyebrow">Ventas por día</div>
                  <div className="mt-1 text-[13px] text-muted">Importe vendido cada día del mes</div>
                </div>
              </div>
              {data.daily.length ? (
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={daily} margin={{ left: 0, right: 8, top: 8 }}>
                    <defs>
                      <linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={ACCENT} stopOpacity={0.22} /><stop offset="1" stopColor={ACCENT} stopOpacity={0} /></linearGradient>
                    </defs>
                    <CartesianGrid stroke={GRID} vertical={false} />
                    <XAxis dataKey="date" tickFormatter={(d) => Number(d.slice(8))} tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={12} />
                    <YAxis tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)} tick={AXIS} axisLine={false} tickLine={false} width={40} />
                    <Tooltip content={<ChartTip labelFmt={fmtDateShort} />} cursor={{ stroke: INK, strokeDasharray: '3 3' }} />
                    <Area type="monotone" dataKey="total" stroke={ACCENT} strokeWidth={2} fill="url(#g)" activeDot={{ r: 4, stroke: '#fbf9f5', strokeWidth: 2 }} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : <Empty title="Sin ventas este mes">Cuando MAJA registre ventas, aparecen acá día por día.</Empty>}
            </Card>

            <Card className="rise p-5" style={{ animationDelay: '260ms' }}>
              <div className="eyebrow">Últimos 12 meses</div>
              <div className="mb-4 mt-1 text-[13px] text-muted">Vendido por mes</div>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data.months} margin={{ left: 0, right: 0, top: 8 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="period" tickFormatter={(p) => fmtPeriodShort(p).split(' ')[0]} tick={AXIS} axisLine={false} tickLine={false} interval={0} />
                  <YAxis tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)} tick={AXIS} axisLine={false} tickLine={false} width={40} />
                  <Tooltip content={<ChartTip labelFmt={fmtPeriod} />} cursor={{ fill: 'rgba(236,230,219,.6)' }} />
                  <Bar dataKey="total" fill={INK} radius={[4, 4, 0, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>

          {isAdmin && !brandId && <BrandTable rows={data.by_brand} />}

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="rise lg:col-span-2" style={{ animationDelay: '300ms' }}>
              <div className="flex items-baseline justify-between px-5 pb-2 pt-5">
                <div className="eyebrow">Lo más vendido del mes</div>
              </div>
              {data.top_products.length ? (
                <table className="tbl">
                  <thead><tr><th>Artículo</th>{!brandId && <th>Marca</th>}<th className="text-right">Unid.</th><th className="text-right">Importe</th></tr></thead>
                  <tbody>
                    {data.top_products.map((p, i) => (
                      <tr key={i}>
                        <td><div className="font-medium">{p.description}</div><div className="text-[12px] text-muted">{p.sku}</div></td>
                        {!brandId && <td className="text-ink2">{p.brand_name}</td>}
                        <td className="num text-right">{fmtInt(p.units)}</td>
                        <td className="num text-right">{fmtMoney(p.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <div className="px-5 pb-6 text-[13px] text-muted">Todavía no hay ventas en {fmtPeriod(period)}.</div>}
            </Card>

            <div className="space-y-6">
              <Card className="rise p-5" style={{ animationDelay: '340ms' }}>
                <div className="eyebrow mb-3">Stock en tienda</div>
                <div className="grid grid-cols-2 gap-3">
                  <div><div className="num font-display text-[30px] leading-none">{fmtInt(data.stock.units)}</div><div className="mt-1 text-[12px] text-muted">unidades · {fmtInt(data.stock.skus)} artículos</div></div>
                  <div><div className="num font-display text-[30px] leading-none">{fmtMoney(data.stock.value)}</div><div className="mt-1 text-[12px] text-muted">a precio de venta</div></div>
                </div>
                {data.low_stock.length > 0 && (
                  <div className="mt-4 border-t border-line pt-3">
                    <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-warn"><AlertTriangle size={13} />Stock bajo o agotado</div>
                    <ul className="space-y-1.5">
                      {data.low_stock.map((p) => (
                        <li key={p.id} className="flex justify-between gap-2 text-[13px]">
                          <span className="truncate">{p.name}{p.variant ? ` · ${p.variant}` : ''}{!brandId && <span className="text-muted"> — {p.brand_name}</span>}</span>
                          <span className={`num font-semibold ${p.stock <= 0 ? 'text-bad' : 'text-warn'}`}>{p.stock}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>

              <Card className="rise p-5" style={{ animationDelay: '380ms' }}>
                <div className="eyebrow mb-3">Pendientes</div>
                <div className="space-y-2 text-[13px]">
                  <Link to="/pickups" className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-sunk"><span className="flex items-center gap-2"><ShoppingBag size={15} className="text-muted" />Pick ups abiertos</span><b className="num">{data.open_orders.pickup || 0}</b></Link>
                  <Link to="/pedidos" className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-sunk"><span className="flex items-center gap-2"><Truck size={15} className="text-muted" />Ingresos por recibir</span><b className="num">{data.open_orders.ingreso || 0}</b></Link>
                  <Link to="/pedidos" className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-sunk"><span className="flex items-center gap-2"><Truck size={15} className="text-muted -scale-x-100" />Retiros solicitados</span><b className="num">{data.open_orders.retiro || 0}</b></Link>
                </div>
                {data.pickups.length > 0 && (
                  <ul className="mt-3 space-y-2 border-t border-line pt-3">
                    {data.pickups.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-2 text-[13px]">
                        <span className="min-w-0 truncate"><b className="font-medium">{p.customer_name}</b>{p.external_ref && <span className="text-muted"> · {p.external_ref}</span>}<span className="block text-[12px] text-muted">{!brandId && `${p.brand_name} · `}{fmtDateTime(p.created_at)}</span></span>
                        <Badge tone={STATUS_TONE[p.status]}>{STATUS_LABEL.pickup[p.status]}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function BrandTable({ rows }) {
  const sorted = [...rows].sort((a, b) => b.sales - a.sales);
  const max = Math.max(1, ...sorted.map((r) => r.sales));
  return (
    <Card className="rise overflow-hidden" style={{ animationDelay: '280ms' }}>
      <div className="px-5 pb-2 pt-5"><div className="eyebrow">Por marca</div></div>
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>Marca</th><th className="w-[30%]">Vendido</th><th className="text-right">Unid.</th><th className="text-right">Comisión</th><th className="text-right">Cuota</th><th className="text-right">Saldo pendiente</th></tr></thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.brand_id}>
                <td className="font-medium">{r.brand_name}</td>
                <td>
                  <div className="flex items-center gap-3">
                    <div className="h-1.5 flex-1 rounded-full bg-sunk"><div className="h-1.5 rounded-full bg-ink" style={{ width: `${(r.sales / max) * 100}%` }} /></div>
                    <span className="num w-24 text-right">{fmtMoney(r.sales)}</span>
                  </div>
                </td>
                <td className="num text-right">{fmtInt(r.units)}</td>
                <td className="num text-right">{fmtMoney(r.commission)}</td>
                <td className="num text-right">{fmtMoney(r.fee)}</td>
                <td className={`num text-right font-semibold ${r.owed > 0 ? 'text-accent' : 'text-muted'}`}>{fmtMoney(r.owed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function fillDays(period, rows) {
  const [y, m] = period.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Montevideo' }).format(new Date());
  const map = Object.fromEntries(rows.map((r) => [r.date, r]));
  const out = [];
  for (let d = 1; d <= last; d++) {
    const date = `${period}-${String(d).padStart(2, '0')}`;
    if (date > today) break;
    out.push(map[date] ?? { date, total: 0, units: 0 });
  }
  return out;
}
