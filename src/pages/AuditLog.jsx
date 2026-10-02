import { useState } from 'react';
import { History } from 'lucide-react';
import { useApi, useSession } from '../lib/session.jsx';
import { Card, Empty, Field, Input, Loading, PageHeader, Select } from '../components/ui.jsx';
import { fmtDateTime } from '../lib/format.js';

const ACTION_LABEL = {
  precio: 'Cambio de precio', articulo: 'Edición de artículo', ajuste_stock: 'Ajuste de stock', importacion: 'Importación de planilla', conteo: 'Conteo de inventario',
  anulacion: 'Venta anulada', cambio: 'Cambio de prenda', correccion_pos: 'Corrección de POS', pago: 'Pago', pago_borrado: 'Pago borrado',
  liquidacion_cierre: 'Cierre de liquidación', liquidacion_reapertura: 'Reapertura de liquidación', factura_marca: 'Factura a marca',
  pedido_completado: 'Pedido completado', pedido_cancelado: 'Pedido cancelado', marca: 'Marca', usuario: 'Usuario', objetivos: 'Objetivos',
  caja_apertura: 'Apertura de caja', caja_cierre: 'Cierre de caja', caja_reapertura: 'Reapertura de caja', caja_ingreso: 'Entrada de efectivo', caja_retiro: 'Salida de efectivo',
};

export default function AuditLog() {
  const { brands } = useSession();
  const [f, setF] = useState({ from: '', to: '', action: '', brand_id: '', user_id: '', q: '' });
  const { data, loading } = useApi('/audit', f);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  return (
    <>
      <PageHeader eyebrow="Quién hizo qué y cuándo" title="Historial de cambios" />
      <div className="mb-5 grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Field label="Desde"><Input type="date" value={f.from} onChange={set('from')} /></Field>
        <Field label="Hasta"><Input type="date" value={f.to} onChange={set('to')} /></Field>
        <Field label="Qué">
          <Select value={f.action} onChange={set('action')}>
            <option value="">Todo</option>
            {(data?.actions || []).map((a) => <option key={a.action} value={a.action}>{ACTION_LABEL[a.action] || a.action} ({a.n})</option>)}
          </Select>
        </Field>
        <Field label="Quién">
          <Select value={f.user_id} onChange={set('user_id')}>
            <option value="">Todos</option>
            {(data?.users || []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        </Field>
        <Field label="Marca">
          <Select value={f.brand_id} onChange={set('brand_id')}>
            <option value="">Todas</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </Field>
        <Field label="Buscar"><Input value={f.q} onChange={set('q')} placeholder="SKU, venta #…" /></Field>
      </div>
      <Card className="rise overflow-hidden">
        {loading && !data ? <Loading /> : !data?.rows.length ? (
          <Empty icon={History} title="Sin cambios registrados">Acá queda cada cambio de precio, ajuste de stock, anulación, pago, cierre de caja y de liquidación, con quién lo hizo.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Cuándo</th><th>Quién</th><th>Qué</th><th>Detalle</th></tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap text-[13px] text-muted">{fmtDateTime(r.created_at)}</td>
                    <td className="whitespace-nowrap text-[13px]">{r.user_name || '—'}<span className="block text-[11px] text-muted">{{ admin: 'dueña', vendedora: 'vendedora', marca: 'marca' }[r.role] ?? ''}</span></td>
                    <td className="whitespace-nowrap text-[13px] font-medium">{ACTION_LABEL[r.action] || r.action}{r.brand_name && <span className="block text-[11px] font-normal text-muted">{r.brand_name}</span>}</td>
                    <td className="text-[13px] text-ink2">{r.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {data?.rows.length === 500 && <p className="mt-3 text-[12px] text-muted">Se muestran los últimos 500. Usá los filtros para buscar más atrás.</p>}
    </>
  );
}
