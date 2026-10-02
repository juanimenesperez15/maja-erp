import { Link } from 'react-router-dom';
import { AlertTriangle, ShoppingBag, Truck, Receipt, Plus } from 'lucide-react';
import { useApi, useSession } from '../lib/session.jsx';
import { Badge, Button, Card, Loading, PageHeader, Stat, cx, STATUS_LABEL, STATUS_TONE } from '../components/ui.jsx';
import { fmtDate, fmtDateTime, fmtInt, fmtMoney } from '../lib/format.js';

/** Tablero de la vendedora: lo que tiene que hacer hoy. Sin reportes, objetivos ni plata de las marcas. */
export default function SellerHome() {
  const { user } = useSession();
  const { data, loading } = useApi('/shift');
  if (loading && !data) return <Loading />;
  if (!data) return null;

  const pickups = data.orders.filter((o) => o.type === 'pickup');
  const toArm = pickups.filter((o) => o.status === 'pendiente');
  const ready = pickups.filter((o) => o.status === 'listo');
  const incoming = data.orders.filter((o) => o.type === 'ingreso');
  const leaving = data.orders.filter((o) => o.type === 'retiro');

  const List = ({ title, icon: Icon, rows, empty, to, kind }) => (
    <Card className="rise overflow-hidden">
      <div className="flex items-center justify-between px-5 pb-2 pt-5">
        <div className="eyebrow flex items-center gap-1.5"><Icon size={13} />{title}</div>
        <Link to={to} className="text-[12px] text-ink2 underline decoration-line underline-offset-2 hover:text-ink">Ver todos</Link>
      </div>
      {!rows.length ? <div className="px-5 pb-5 text-[13px] text-muted">{empty}</div> : (
        <ul className="divide-y divide-line">
          {rows.slice(0, 8).map((o) => {
            const armando = o.status === 'pendiente' && o.picked_units > 0;
            return (
              <li key={o.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-[13px]">
                <span className="min-w-0">
                  <span className="block truncate"><b className="font-medium">{o.brand_name}</b>{o.customer_name && <span className="text-ink2"> · {o.customer_name}</span>}{o.external_ref && <span className="text-muted"> · {o.external_ref}</span>}</span>
                  <span className="block text-[12px] text-muted">#{o.id} · {fmtInt(o.units)} unid. · {fmtDateTime(o.created_at)}</span>
                </span>
                <span className="shrink-0"><Badge tone={armando ? 'accent' : STATUS_TONE[o.status]}>{armando ? `Armado ${o.picked_units}/${o.units}` : STATUS_LABEL[kind][o.status]}</Badge></span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );

  return (
    <>
      <PageHeader eyebrow={user.preview ? 'Tablero de la vendedora' : `Hola, ${user.name.split(' ')[0]}`} title={<span className="capitalize">Hoy, {fmtDate(data.date)}</span>}>
        <Link to="/ventas"><Button><Plus size={16} />Registrar venta</Button></Link>
      </PageHeader>

      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Stat label="Tus ventas de hoy" value={fmtInt(data.mine.tickets)} sub={fmtMoney(data.mine.total)} />
        <Stat label="Ventas de la tienda hoy" value={fmtInt(data.store.tickets)} sub={`${fmtInt(data.store.units)} unidades`} delay={50} />
        <Stat label="Pick ups por armar" value={fmtInt(toArm.length)} tone={toArm.length ? 'accent' : undefined} sub={`${ready.length} listos para retirar`} delay={100} />
        <Stat label="Mercadería por recibir" value={fmtInt(incoming.length)} sub={`${leaving.length} retiros pedidos`} delay={150} />
      </div>

      {data.pending_invoices > 0 && (
        <Link to="/ventas" className="rise mb-6 flex items-center gap-2 rounded-xl border border-bad/30 bg-bad-soft px-4 py-3 text-[13px] text-bad">
          <Receipt size={16} />{data.pending_invoices} {data.pending_invoices === 1 ? 'venta quedó' : 'ventas quedaron'} sin factura: entrá a Ventas y tocá "Reintentar".
        </Link>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <List title="Pick ups por armar" icon={ShoppingBag} rows={toArm} empty="No hay pick ups para armar." to="/pickups" kind="pickup" />
        <List title="Listos para retirar" icon={ShoppingBag} rows={ready} empty="Nada esperando retiro." to="/pickups" kind="pickup" />
        <List title="Mercadería por recibir" icon={Truck} rows={incoming} empty="No hay ingresos avisados." to="/pedidos" kind="ingreso" />
        <List title="Retiros de mercadería" icon={Truck} rows={leaving} empty="Ninguna marca pidió retirar." to="/pedidos" kind="retiro" />
      </div>

      {data.low_stock.length > 0 && (
        <Card className="rise mt-6 p-5">
          <div className="mb-3 flex items-center gap-1.5 text-[12px] font-semibold text-warn"><AlertTriangle size={13} />Stock bajo o agotado</div>
          <ul className="grid gap-x-8 gap-y-1.5 sm:grid-cols-2">
            {data.low_stock.map((p) => (
              <li key={p.id} className="flex justify-between gap-2 text-[13px]">
                <span className="min-w-0 truncate">{p.name}{p.variant ? ` · ${p.variant}` : ''} <span className="text-muted">— {p.brand_name}</span></span>
                <span className={cx('num shrink-0 font-semibold', p.stock <= 0 ? 'text-bad' : 'text-warn')}>{p.stock}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
