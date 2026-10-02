import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight, Store, ShoppingBag, Truck, AlertTriangle } from 'lucide-react';
import { useSession, useApi } from '../lib/session.jsx';
import { Badge, Card, Empty, ErrorNote, Loading, PageHeader, Stat, STATUS_LABEL, STATUS_TONE, Button } from '../components/ui.jsx';
import { DailyChart, MonthsChart, fillDays } from '../components/charts.jsx';
import StoreOverview from './StoreOverview.jsx';
import SellerHome from './SellerHome.jsx';
import { currentPeriod, fmtInt, fmtMoney, fmtPeriod, fmtPeriodShort, shiftPeriod, fmtDateTime } from '../lib/format.js';

export function Delta({ now, before, suffix = 'vs. mes anterior' }) {
  if (!before) return <span>Sin ventas el mes anterior</span>;
  const d = ((now - before) / before) * 100;
  const up = d >= 0;
  return (
    <span className={up ? 'text-ok' : 'text-bad'}>
      {up ? <ArrowUpRight size={13} className="inline" /> : <ArrowDownRight size={13} className="inline" />}
      {Math.abs(d).toFixed(0)} % {suffix}
    </span>
  );
}

export default function Dashboard() {
  const { isAdmin, isSeller, brands, brandsLoaded, brandId, user } = useSession();
  const [period, setPeriod] = useState(currentPeriod());
  const { data, error, loading } = useApi(isSeller ? null : '/dashboard', { brand_id: brandId, period });
  const brandName = brandId ? brands.find((b) => String(b.id) === String(brandId))?.name ?? user.brand_name : null;

  // la vendedora tiene su tablero del día, sin reportes
  if (isSeller) return <SellerHome />;
  if (isAdmin && !brandsLoaded) return <Loading />;
  if (isAdmin && !brands.length) {
    return (
      <>
        <PageHeader eyebrow="Tablero" title="Bienvenida a MAJA" />
        <Card><Empty icon={Store} title="Todavía no hay marcas" action={!isSeller && <Link to="/marcas"><Button>Dar de alta la primera marca</Button></Link>}>
          {isSeller ? 'La dueña todavía no cargó las marcas.' : 'Empezá cargando las marcas que venden en la tienda, con su comisión y su cuota mensual. Después les creás el acceso desde Usuarios.'}
        </Empty></Card>
      </>
    );
  }

  const isCurrent = period === currentPeriod();
  const storeView = isAdmin && !brandId;

  return (
    <>
      <PageHeader eyebrow={brandName ? `Tablero · ${brandName}` : 'Tablero · toda la tienda'} title={<span className="capitalize">{fmtPeriod(period)}</span>}>
        <div className="flex items-center rounded-lg border border-line bg-card">
          <button className="p-2 text-ink2 hover:text-ink" onClick={() => setPeriod(shiftPeriod(period, -1))} aria-label="Mes anterior"><ChevronLeft size={16} /></button>
          <span className="min-w-[90px] text-center text-[13px] font-medium capitalize">{fmtPeriodShort(period)}</span>
          <button className="p-2 text-ink2 hover:text-ink disabled:opacity-30" disabled={isCurrent} onClick={() => setPeriod(shiftPeriod(period, 1))} aria-label="Mes siguiente"><ChevronRight size={16} /></button>
        </div>
      </PageHeader>
      <ErrorNote>{error}</ErrorNote>
      {loading && !data ? <Loading /> : data && (storeView ? <StoreOverview period={period} dash={data} /> : <BrandView period={period} data={data} brandId={brandId} isAdmin={isAdmin} isSeller={isSeller} />)}
    </>
  );
}

function BrandView({ period, data, brandId, isAdmin, isSeller }) {
  const k = data.kpis;
  const daily = fillDays(period, data.daily);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Stat label="Vendido" value={fmtMoney(k.sales)} sub={<Delta now={k.sales} before={k.prev_sales} />} />
        <Stat label="Unidades" value={fmtInt(k.units)} sub={`${fmtInt(k.tickets)} ${k.tickets === 1 ? 'venta' : 'ventas'} · promedio ${fmtMoney(k.avg_ticket)}`} delay={60} />
        {!isSeller && <>
          <Stat label="Comisión + cuota del mes" value={fmtMoney(k.to_pay)} sub={`Comisión ${fmtMoney(k.commission)} · cuota ${fmtMoney(k.fees)}`} delay={120} />
          <Stat label={isAdmin ? 'Saldo pendiente con MAJA' : 'Saldo a pagar a MAJA'} value={fmtMoney(k.owed)} tone={k.owed > 0 ? 'accent' : undefined}
            sub={<>{k.in_favor > 0 && <span className="block text-ok">{fmtMoney(k.in_favor)} a favor de la marca</span>}<Link to="/liquidaciones" className="underline decoration-line underline-offset-2 hover:text-ink">Ver detalle</Link></>} delay={180} />
        </>}
        {isSeller && <>
          <Stat label="Stock en tienda" value={fmtInt(data.stock.units)} sub={`${fmtInt(data.stock.skus)} artículos`} delay={120} />
          <Stat label="Pick ups abiertos" value={fmtInt(data.open_orders.pickup || 0)} sub={<Link to="/pickups" className="underline decoration-line underline-offset-2 hover:text-ink">Ver pick ups</Link>} delay={180} />
        </>}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Card className="rise min-w-0 p-5" style={{ animationDelay: '220ms' }}>
          <div className="eyebrow">Ventas por día</div>
          <div className="mb-4 mt-1 text-[13px] text-muted">Importe vendido cada día del mes</div>
          {data.daily.length ? <DailyChart data={daily} /> : <Empty title="Sin ventas este mes">Cuando MAJA registre ventas, aparecen acá día por día.</Empty>}
        </Card>
        <Card className="rise min-w-0 p-5" style={{ animationDelay: '260ms' }}>
          <div className="eyebrow">Últimos 12 meses</div>
          <div className="mb-4 mt-1 text-[13px] text-muted">Vendido por mes</div>
          <MonthsChart data={data.months} />
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <TopProducts className="lg:col-span-2" data={data} brandId={brandId} period={period} />
        <div className="space-y-6">
          <StockCard data={data} brandId={brandId} />
          <PendingCard data={data} brandId={brandId} />
        </div>
      </div>
    </div>
  );
}

export function TopProducts({ data, brandId, period, className = '' }) {
  return (
    <Card className={`rise min-w-0 ${className}`} style={{ animationDelay: '300ms' }}>
      <div className="px-5 pb-2 pt-5"><div className="eyebrow">Lo más vendido del mes</div></div>
      {data.top_products.length ? (
        <div className="overflow-x-auto">
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
        </div>
      ) : <div className="px-5 pb-6 text-[13px] text-muted">Todavía no hay ventas en {fmtPeriod(period)}.</div>}
    </Card>
  );
}

export function StockCard({ data, brandId }) {
  return (
    <Card className="rise p-5" style={{ animationDelay: '340ms' }}>
      <div className="eyebrow mb-3">Stock en tienda</div>
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        <div><div className="num font-display text-[28px] leading-none">{fmtInt(data.stock.units)}</div><div className="mt-1 text-[12px] text-muted">unidades · {fmtInt(data.stock.skus)} artículos</div></div>
        <div><div className="num font-display text-[28px] leading-none">{fmtMoney(data.stock.value)}</div><div className="mt-1 text-[12px] text-muted">a precio de venta</div></div>
      </div>
      {data.low_stock.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-warn"><AlertTriangle size={13} />Stock bajo o agotado</div>
          <ul className="space-y-1.5">
            {data.low_stock.map((p) => (
              <li key={p.id} className="flex justify-between gap-2 text-[13px]">
                <span className="min-w-0 truncate">{p.name}{p.variant ? ` · ${p.variant}` : ''}{!brandId && <span className="text-muted"> — {p.brand_name}</span>}</span>
                <span className={`num shrink-0 font-semibold ${p.stock <= 0 ? 'text-bad' : 'text-warn'}`}>{p.stock}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

export function PendingCard({ data, brandId }) {
  return (
    <Card className="rise p-5" style={{ animationDelay: '380ms' }}>
      <div className="eyebrow mb-3">Pendientes</div>
      <div className="space-y-1 text-[13px]">
        <Link to="/pickups" className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-sunk"><span className="flex items-center gap-2"><ShoppingBag size={15} className="text-muted" />Pick ups abiertos</span><b className="num">{data.open_orders.pickup || 0}</b></Link>
        <Link to="/pedidos" className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-sunk"><span className="flex items-center gap-2"><Truck size={15} className="text-muted" />Ingresos por recibir</span><b className="num">{data.open_orders.ingreso || 0}</b></Link>
        <Link to="/pedidos" className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-sunk"><span className="flex items-center gap-2"><Truck size={15} className="-scale-x-100 text-muted" />Retiros solicitados</span><b className="num">{data.open_orders.retiro || 0}</b></Link>
      </div>
      {data.pickups.length > 0 && (
        <ul className="mt-3 space-y-2 border-t border-line pt-3">
          {data.pickups.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 text-[13px]">
              <span className="min-w-0">
                <span className="block truncate"><b className="font-medium">{p.customer_name || `Pick up #${p.id}`}</b>{p.external_ref && <span className="text-muted"> · {p.external_ref}</span>}</span>
                <span className="block truncate text-[12px] text-muted">{!brandId && `${p.brand_name} · `}{fmtDateTime(p.created_at)}</span>
              </span>
              <span className="shrink-0"><Badge tone={STATUS_TONE[p.status]}>{STATUS_LABEL.pickup[p.status]}</Badge></span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
