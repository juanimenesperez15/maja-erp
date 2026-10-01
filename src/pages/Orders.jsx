import { useState } from 'react';
import { Plus, Truck, ShoppingBag, Trash2, Phone } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi, useSession } from '../lib/session.jsx';
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Loading, Modal, PageHeader, Select, Tabs, Textarea, useToast, STATUS_LABEL, STATUS_TONE, TYPE_LABEL } from '../components/ui.jsx';
import ProductPicker from '../components/ProductPicker.jsx';
import { fmtDateTime, fmtInt } from '../lib/format.js';

const NEXT_ACTIONS = {
  ingreso: [['listo', 'Marcar en control'], ['completado', 'Recibir y sumar al stock']],
  pickup: [['listo', 'Marcar listo para retirar'], ['completado', 'Entregado al cliente']],
  retiro: [['listo', 'Marcar preparado'], ['completado', 'Retirado por la marca']],
};

export default function Orders({ kind }) {
  const isPickups = kind === 'pickups';
  const { isAdmin, brandId } = useSession();
  const [type, setType] = useState('');
  const [status, setStatus] = useState('abiertos');
  const { data, error, loading, reload } = useApi('/orders', { brand_id: brandId, type: isPickups ? 'pickup' : type, status: status === 'todos' ? '' : status });
  const rows = (data || []).filter((o) => isPickups || o.type !== 'pickup');
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState(null);

  return (
    <>
      <PageHeader eyebrow={isPickups ? 'Pedidos online que se retiran en MAJA' : 'Mercadería que entra y sale de la tienda'} title={isPickups ? 'Pick ups' : 'Pedidos'}>
        <Button onClick={() => setCreating(true)}><Plus size={16} />{isPickups ? 'Nuevo pick up' : 'Nuevo pedido'}</Button>
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={status} onChange={setStatus} options={[{ value: 'abiertos', label: 'Abiertos' }, { value: 'completado', label: isPickups ? 'Entregados' : 'Completados' }, { value: 'cancelado', label: 'Cancelados' }, { value: 'todos', label: 'Todos' }]} />
        {!isPickups && <Tabs value={type} onChange={setType} options={[{ value: '', label: 'Todos los tipos' }, { value: 'ingreso', label: 'Ingresos' }, { value: 'retiro', label: 'Retiros' }]} />}
      </div>

      <ErrorNote>{error}</ErrorNote>
      <Card className="rise overflow-hidden">
        {loading && !data ? <Loading /> : !rows.length ? (
          <Empty icon={isPickups ? ShoppingBag : Truck} title={status === 'abiertos' ? 'No hay nada pendiente' : 'Sin pedidos'}>
            {isPickups
              ? 'Cuando una marca vende online y el cliente elige retirar en MAJA, carga el pick up acá. MAJA lo prepara y lo marca como entregado.'
              : 'Las marcas avisan acá la mercadería que mandan (ingreso) o la que pasan a buscar (retiro). Al recibirla o entregarla, el stock se actualiza solo.'}
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>#</th>{!brandId && <th>Marca</th>}{!isPickups && <th>Tipo</th>}{isPickups && <th>Cliente</th>}<th>Referencia</th><th className="text-right">Unid.</th><th>Creado</th><th>Estado</th></tr></thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id} className="cursor-pointer" onClick={() => setOpenId(o.id)}>
                    <td className="num text-muted">{o.id}</td>
                    {!brandId && <td className="font-medium">{o.brand_name}</td>}
                    {!isPickups && <td>{TYPE_LABEL[o.type]}</td>}
                    {isPickups && <td className="font-medium">{o.customer_name}{o.customer_phone && <span className="block text-[12px] font-normal text-muted">{o.customer_phone}</span>}</td>}
                    <td className="text-ink2">{o.external_ref || '—'}</td>
                    <td className="num text-right">{fmtInt(o.units)}</td>
                    <td className="whitespace-nowrap text-[13px] text-muted">{fmtDateTime(o.created_at)}</td>
                    <td><Badge tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.type][o.status]}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {creating && <NewOrderModal isPickups={isPickups} isAdmin={isAdmin} brandId={brandId} onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); reload(); setOpenId(id); }} />}
      {openId && <OrderModal id={openId} isAdmin={isAdmin} onClose={() => setOpenId(null)} onChanged={reload} />}
    </>
  );
}

function NewOrderModal({ isPickups, isAdmin, brandId: initialBrand, onClose, onSaved }) {
  const { brands } = useSession();
  const toast = useToast();
  const [form, setForm] = useState({ type: isPickups ? 'pickup' : 'ingreso', brand_id: initialBrand, customer_name: '', customer_phone: '', external_ref: '', notes: '' });
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const addProduct = (p) => {
    setItems((list) => {
      const i = list.findIndex((x) => x.product_id === p.id);
      if (i >= 0) return list.map((x, j) => (j === i ? { ...x, qty: String(Number(x.qty) + 1) } : x));
      return [...list, { product_id: p.id, sku: p.sku, description: p.name, variant: p.variant, stock: p.stock, qty: '1' }];
    });
  };
  const addNew = () => setItems((l) => [...l, { product_id: null, sku: '', description: '', variant: '', price: '', qty: '1', isNew: true }]);
  const upd = (i, k, v) => setItems((l) => l.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api('/orders', { method: 'POST', body: { ...form, items } });
      toast(isPickups ? 'Pick up cargado' : 'Pedido enviado a MAJA');
      onSaved(r.id);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const brandChosen = !!form.brand_id;
  return (
    <Modal open wide title={isPickups ? 'Nuevo pick up' : 'Nuevo pedido'} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={save} loading={busy} disabled={!items.length}>{isPickups ? 'Cargar pick up' : 'Enviar pedido'}</Button></>}>
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-3">
          {isAdmin && (
            <Field label="Marca">
              <Select value={form.brand_id || ''} onChange={(e) => { setForm({ ...form, brand_id: e.target.value }); setItems([]); }}>
                <option value="">Elegí…</option>
                {brands.filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </Field>
          )}
          {!isPickups && (
            <Field label="Tipo">
              <Select value={form.type} onChange={(e) => { setForm({ ...form, type: e.target.value }); setItems((l) => l.filter((x) => !x.isNew)); }}>
                <option value="ingreso">Ingreso de mercadería (la marca manda)</option>
                <option value="retiro">Retiro de mercadería (la marca se lleva)</option>
              </Select>
            </Field>
          )}
          {isPickups && <>
            <Field label="Cliente que retira"><Input value={form.customer_name} onChange={set('customer_name')} /></Field>
            <Field label="Teléfono"><Input value={form.customer_phone} onChange={set('customer_phone')} /></Field>
          </>}
          <Field label={isPickups ? 'N° de pedido web' : 'Referencia / remito'}><Input value={form.external_ref} onChange={set('external_ref')} /></Field>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className="eyebrow">Artículos</div>
            {form.type === 'ingreso' && brandChosen && <Button size="sm" variant="ghost" onClick={addNew}><Plus size={14} />Artículo nuevo</Button>}
          </div>
          {brandChosen ? <ProductPicker brandId={form.brand_id} onPick={addProduct} placeholder="Buscá el artículo por SKU o nombre…" autoFocus={!isAdmin} /> : <div className="rounded-md bg-sunk px-3 py-2 text-[13px] text-muted">Elegí la marca para buscar sus artículos.</div>}
          {items.length > 0 && (
            <div className="mt-3 overflow-x-auto rounded-lg border border-line">
              <table className="tbl">
                <thead><tr><th>SKU</th><th>Artículo</th><th>Variante</th>{form.type === 'ingreso' && <th>Precio</th>}<th className="w-24 text-right">Cant.</th><th /></tr></thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={i}>
                      {it.isNew ? <>
                        <td><Input className="h-8 py-1" value={it.sku} onChange={(e) => upd(i, 'sku', e.target.value)} placeholder="SKU" /></td>
                        <td><Input className="h-8 py-1" value={it.description} onChange={(e) => upd(i, 'description', e.target.value)} placeholder="Nombre" /></td>
                        <td><Input className="h-8 py-1" value={it.variant} onChange={(e) => upd(i, 'variant', e.target.value)} placeholder="Talle/color" /></td>
                        <td><Input className="h-8 w-24 py-1" inputMode="decimal" value={it.price} onChange={(e) => upd(i, 'price', e.target.value)} placeholder="$" /></td>
                      </> : <>
                        <td className="font-mono text-[12px] text-ink2">{it.sku}</td>
                        <td className="font-medium">{it.description}</td>
                        <td className="text-muted">{it.variant}</td>
                        {form.type === 'ingreso' && <td className="text-muted">—</td>}
                      </>}
                      <td className="text-right">
                        <Input className="ml-auto h-8 w-20 py-1 text-right" inputMode="numeric" value={it.qty} onChange={(e) => upd(i, 'qty', e.target.value)} />
                        {!it.isNew && form.type !== 'ingreso' && Number(it.qty) > it.stock && <div className="mt-1 text-[11px] text-bad">Hay {it.stock} en stock</div>}
                      </td>
                      <td><button onClick={() => setItems((l) => l.filter((_, j) => j !== i))} className="rounded-md p-1.5 text-muted hover:bg-bad-soft hover:text-bad" aria-label="Quitar"><Trash2 size={14} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <Field label="Notas para MAJA"><Textarea value={form.notes} onChange={set('notes')} placeholder={isPickups ? 'Horario en que pasa, quién retira…' : 'Cuándo llega, cuántas cajas…'} /></Field>
        <ErrorNote>{error}</ErrorNote>
      </div>
    </Modal>
  );
}

function OrderModal({ id, isAdmin, onClose, onChanged }) {
  const toast = useToast();
  const { data: o, loading, setData } = useApi(`/orders/${id}`);
  const [notes, setNotes] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const move = async (status) => {
    if (status === 'cancelado' && !window.confirm('¿Cancelar este pedido?')) return;
    setBusy(status);
    setError('');
    try {
      const r = await api(`/orders/${id}/status`, { method: 'PUT', body: { status, admin_notes: notes } });
      setData(r);
      onChanged();
      toast(status === 'completado' ? 'Listo, stock actualizado' : 'Estado actualizado');
    } catch (e) { setError(e.message); } finally { setBusy(''); }
  };

  const closed = o && (o.status === 'completado' || o.status === 'cancelado');
  const units = o?.items.reduce((a, i) => a + i.qty, 0) ?? 0;

  return (
    <Modal open wide title={o ? `${TYPE_LABEL[o.type]} #${o.id}` : 'Pedido'} onClose={onClose}
      footer={o && !closed && (
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          {(isAdmin || o.status === 'pendiente') ? <Button variant="danger" onClick={() => move('cancelado')} loading={busy === 'cancelado'}>Cancelar pedido</Button> : <span />}
          {isAdmin && (
            <div className="flex gap-2">
              {o.status === 'pendiente' && <Button variant="outline" onClick={() => move(NEXT_ACTIONS[o.type][0][0])} loading={busy === 'listo'}>{NEXT_ACTIONS[o.type][0][1]}</Button>}
              <Button variant="accent" onClick={() => move('completado')} loading={busy === 'completado'}>{NEXT_ACTIONS[o.type][1][1]}</Button>
            </div>
          )}
        </div>
      )}>
      {loading || !o ? <Loading /> : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
            <Badge tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.type][o.status]}</Badge>
            <span><span className="text-muted">Marca</span> <b>{o.brand_name}</b></span>
            {o.external_ref && <span><span className="text-muted">Ref.</span> <b>{o.external_ref}</b></span>}
            <span className="text-muted">Creado {fmtDateTime(o.created_at)}{o.created_by_name && ` por ${o.created_by_name}`}</span>
            {o.completed_at && <span className="text-muted">Cerrado {fmtDateTime(o.completed_at)}</span>}
          </div>
          {o.type === 'pickup' && (
            <div className="rounded-lg bg-sunk px-4 py-3">
              <div className="eyebrow">Retira</div>
              <div className="mt-1 font-display text-[24px] leading-tight">{o.customer_name}</div>
              {o.customer_phone && <a href={`tel:${o.customer_phone}`} className="mt-1 inline-flex items-center gap-1.5 text-[13px] text-ink2 hover:text-ink"><Phone size={13} />{o.customer_phone}</a>}
            </div>
          )}
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="tbl">
              <thead><tr><th>SKU</th><th>Artículo</th><th className="text-right">Cant.</th>{!closed && o.type !== 'ingreso' && <th className="text-right">En stock</th>}</tr></thead>
              <tbody>
                {o.items.map((it) => (
                  <tr key={it.id}>
                    <td className="font-mono text-[12px] text-ink2">{it.sku}</td>
                    <td><span className="font-medium">{it.product_name || it.description}</span>{(it.product_variant || it.variant) && <span className="text-muted"> · {it.product_variant || it.variant}</span>}{!it.product_id && <span className="ml-2"><Badge tone="accent">Nuevo</Badge></span>}</td>
                    <td className="num text-right font-semibold">{it.qty}</td>
                    {!closed && o.type !== 'ingreso' && <td className={`num text-right ${it.product_stock < it.qty ? 'font-semibold text-bad' : 'text-muted'}`}>{it.product_stock ?? '—'}</td>}
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={2} className="px-3 py-2 text-right text-[12px] text-muted">Total unidades</td><td className="num px-3 py-2 text-right font-semibold">{units}</td>{!closed && o.type !== 'ingreso' && <td />}</tr></tfoot>
            </table>
          </div>
          {o.notes && <div><div className="eyebrow mb-1">Notas de la marca</div><p className="whitespace-pre-wrap text-[13px] text-ink2">{o.notes}</p></div>}
          {isAdmin && !closed ? (
            <Field label="Nota de MAJA (la ve la marca)"><Textarea value={notes ?? o.admin_notes ?? ''} onChange={(e) => setNotes(e.target.value)} placeholder="Faltó una prenda, llegó dañada…" /></Field>
          ) : o.admin_notes && <div><div className="eyebrow mb-1">Nota de MAJA</div><p className="whitespace-pre-wrap text-[13px] text-ink2">{o.admin_notes}</p></div>}
          {!isAdmin && !closed && o.status !== 'pendiente' && <p className="text-[13px] text-muted">MAJA ya está trabajando en este pedido; si hay que cambiar algo, avisales.</p>}
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
    </Modal>
  );
}
