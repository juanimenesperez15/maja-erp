import { useMemo, useState } from 'react';
import { Plus, Truck, ShoppingBag, Trash2, Phone, Minus, Check, CheckCheck, PackageCheck, Upload } from 'lucide-react';
import { api } from '../lib/api.js';
import { Link } from 'react-router-dom';
import { useApi, useSession } from '../lib/session.jsx';
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Loading, Modal, PageHeader, Select, Tabs, Textarea, useToast, cx, STATUS_LABEL, STATUS_TONE, TYPE_LABEL } from '../components/ui.jsx';
import ProductPicker from '../components/ProductPicker.jsx';
import ScanBox, { findByCode } from '../components/ScanBox.jsx';
import { fmtDateTime, fmtInt, parseNum, parseTable } from '../lib/format.js';

/** Estado a mostrar: un pedido pendiente con algo ya armado está "en armado". */
export function orderStatus(o) {
  const picked = o.picked_units ?? o.items?.reduce((a, i) => a + i.picked_qty, 0) ?? 0;
  if (o.status === 'pendiente' && picked > 0) return { label: o.type === 'ingreso' ? 'En control' : 'En armado', tone: 'accent' };
  return { label: STATUS_LABEL[o.type][o.status], tone: STATUS_TONE[o.status] };
}

function Progress({ done, total }) {
  const pct = total ? Math.min(100, (done / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 rounded-full bg-sunk"><div className={cx('h-1.5 rounded-full', done >= total ? 'bg-ok' : 'bg-accent')} style={{ width: `${pct}%` }} /></div>
      <span className="num text-[12px] text-muted">{done}/{total}</span>
    </div>
  );
}

export default function Orders({ kind }) {
  const isPickups = kind === 'pickups';
  const { isAdmin, brandId } = useSession();
  const [type, setType] = useState('');
  const [status, setStatus] = useState(isPickups ? 'pendiente' : 'abiertos');
  const { data, error, loading, reload } = useApi('/orders', { brand_id: brandId, type: isPickups ? 'pickup' : type, status: status === 'todos' ? '' : status });
  const rows = (data || []).filter((o) => isPickups || o.type !== 'pickup');
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState(null);

  const tabs = isPickups
    ? [{ value: 'pendiente', label: 'Por armar' }, { value: 'listo', label: 'Listos para retirar' }, { value: 'completado', label: 'Retirados' }, { value: 'cancelado', label: 'Cancelados' }, { value: 'todos', label: 'Todos' }]
    : [{ value: 'abiertos', label: 'Abiertos' }, { value: 'completado', label: 'Completados' }, { value: 'cancelado', label: 'Cancelados' }, { value: 'todos', label: 'Todos' }];

  return (
    <>
      <PageHeader eyebrow={isPickups ? 'Pedidos que piden las marcas: MAJA los arma y se retiran' : 'Mercadería que entra y sale de la tienda'} title={isPickups ? 'Pick ups' : 'Pedidos'}>
        <Button onClick={() => setCreating(true)}><Plus size={16} />{isPickups ? 'Nuevo pick up' : 'Nuevo pedido'}</Button>
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={status} onChange={setStatus} options={tabs} />
        {!isPickups && <Tabs value={type} onChange={setType} options={[{ value: '', label: 'Todos los tipos' }, { value: 'ingreso', label: 'Ingresos' }, { value: 'retiro', label: 'Retiros' }]} />}
      </div>

      <ErrorNote>{error}</ErrorNote>
      <Card className="rise overflow-hidden">
        {loading && !data ? <Loading /> : !rows.length ? (
          <Empty icon={isPickups ? ShoppingBag : Truck} title={status === 'pendiente' || status === 'abiertos' ? 'No hay nada pendiente' : 'Sin pedidos'}>
            {isPickups
              ? 'La marca carga lo que hay que preparar. MAJA lo arma artículo por artículo, lo deja listo y registra quién lo retiró; el stock baja solo.'
              : 'Las marcas avisan acá la mercadería que mandan (ingreso) o la que pasan a buscar (retiro). Al recibirla o entregarla, el stock se actualiza solo.'}
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>#</th>{!brandId && <th>Marca</th>}{!isPickups && <th>Tipo</th>}{isPickups && <th>Para</th>}<th>Referencia</th><th>{isPickups ? 'Armado' : 'Unid.'}</th><th>Creado</th><th>Estado</th></tr></thead>
              <tbody>
                {rows.map((o) => {
                  const st = orderStatus(o);
                  return (
                    <tr key={o.id} className="cursor-pointer" onClick={() => setOpenId(o.id)}>
                      <td className="num text-muted">{o.id}</td>
                      {!brandId && <td className="font-medium">{o.brand_name}</td>}
                      {!isPickups && <td>{TYPE_LABEL[o.type]}</td>}
                      {isPickups && <td className="font-medium">{o.customer_name || <span className="font-normal text-muted">—</span>}{o.customer_phone && <span className="block text-[12px] font-normal text-muted">{o.customer_phone}</span>}</td>}
                      <td className="text-ink2">{o.external_ref || '—'}</td>
                      <td>{o.status === 'cancelado' ? <span className="num text-muted">{fmtInt(o.units)}</span> : isPickups || o.picked_units ? <Progress done={o.picked_units} total={o.units} /> : <span className="num">{fmtInt(o.units)}</span>}</td>
                      <td className="whitespace-nowrap text-[13px] text-muted">{fmtDateTime(o.created_at)}</td>
                      <td><Badge tone={st.tone}>{st.label}</Badge>{o.status === 'completado' && o.picked_up_by && <span className="block pt-0.5 text-[12px] text-muted">por {o.picked_up_by}</span>}</td>
                    </tr>
                  );
                })}
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
  // en la tienda se carga con el escáner; la marca desde su casa suele buscar o pegar su planilla
  const [mode, setMode] = useState(isAdmin ? 'scan' : 'search');
  const [sheet, setSheet] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const brandChosen = !!form.brand_id;
  const { data: catalog } = useApi(brandChosen ? '/products' : null, { brand_id: form.brand_id });
  const products = catalog || [];
  const isIngreso = form.type === 'ingreso';

  const addProduct = (p, n = 1) => {
    setItems((list) => {
      const i = list.findIndex((x) => x.product_id === p.id);
      if (i >= 0) return list.map((x, j) => (j === i ? { ...x, qty: String(Number(x.qty) + n) } : x));
      return [...list, { product_id: p.id, sku: p.sku, description: p.name, variant: p.variant, stock: p.stock, qty: String(n) }];
    });
  };
  const addNew = (fields = {}, n = 1) => setItems((l) => {
    const code = fields.barcode || fields.sku;
    const i = code ? l.findIndex((x) => x.isNew && (x.barcode || x.sku) === code) : -1;
    if (i >= 0) return l.map((x, j) => (j === i ? { ...x, qty: String(Number(x.qty) + n) } : x));
    return [...l, { product_id: null, sku: '', description: '', variant: '', price: '', barcode: '', qty: String(n), isNew: true, ...fields }];
  });
  const upd = (i, k, v) => setItems((l) => l.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const qtyOf = (pid) => Number(items.find((x) => x.product_id === pid)?.qty || 0);

  const onScan = (code) => {
    const p = findByCode(products, code);
    if (p) {
      addProduct(p);
      const n = qtyOf(p.id) + 1;
      const low = !isIngreso && n > p.stock;
      return { ok: !low, text: `${p.name}${p.variant ? ` · ${p.variant}` : ''} — van ${n}${low ? ` (hay ${p.stock} en stock)` : ''}` };
    }
    if (isIngreso) {
      addNew({ sku: code, barcode: /^\d{8,14}$/.test(code) ? code : '' });
      return { ok: false, text: 'Código nuevo: se agregó abajo, completá nombre y precio' };
    }
    return { ok: false, text: 'No es un artículo de esta marca' };
  };

  const sheetRows = useMemo(() => { try { return parseTable(sheet); } catch { return []; } }, [sheet]);
  const loadSheet = () => {
    let added = 0;
    const missing = [];
    for (const r of sheetRows) {
      const code = r.barcode || r.sku;
      const n = Math.max(1, Math.trunc(parseNum(r.stock ?? r.qty) ?? 1));
      const p = code ? findByCode(products, code) : null;
      if (p) { addProduct(p, n); added += n; }
      else if (isIngreso && r.sku && r.name) { addNew({ sku: r.sku, description: r.name, variant: r.variant || '', price: r.price || '', barcode: r.barcode || '' }, n); added += n; }
      else missing.push(code || '(sin código)');
    }
    toast(`${added} unidades agregadas${missing.length ? ` · ${missing.length} códigos sin artículo` : ''}`, missing.length ? 'bad' : 'ok');
    if (missing.length) setError(`No encontré: ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? '…' : ''}${isIngreso ? '. Para artículos nuevos agregá columnas Nombre y Precio.' : ''}`);
    else { setSheet(''); setError(''); }
  };
  const onFile = async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setSheet(await f.text()); };

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api('/orders', { method: 'POST', body: { ...form, items } });
      toast(isPickups ? 'Pick up cargado' : isAdmin ? 'Pedido creado' : 'Pedido enviado a MAJA');
      onSaved(r.id);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const units = items.reduce((a, i) => a + (Number(i.qty) || 0), 0);
  return (
    <Modal open wide title={isPickups ? 'Nuevo pick up' : 'Nuevo pedido'} onClose={onClose}
      footer={<>
        {units > 0 && <span className="mr-auto self-center text-[13px] text-muted"><b className="num text-ink">{units}</b> unidades · {items.length} artículos</span>}
        <Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={save} loading={busy} disabled={!items.length}>{isPickups ? 'Cargar pick up' : isAdmin ? 'Crear pedido' : 'Enviar pedido'}</Button>
      </>}>
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
                <option value="ingreso">Ingreso de mercadería (entra a la tienda)</option>
                <option value="retiro">Retiro de mercadería (sale de la tienda)</option>
              </Select>
            </Field>
          )}
          {isPickups && <>
            <Field label="Para (cliente o quién retira)" hint="Opcional"><Input value={form.customer_name} onChange={set('customer_name')} /></Field>
            <Field label="Teléfono"><Input value={form.customer_phone} onChange={set('customer_phone')} /></Field>
          </>}
          <Field label={isPickups ? 'N° de pedido web' : 'Referencia / remito'}><Input value={form.external_ref} onChange={set('external_ref')} /></Field>
        </div>

        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="eyebrow">Artículos</div>
            {brandChosen && (
              <div className="flex items-center gap-2">
                {isIngreso && <Button size="sm" variant="ghost" onClick={() => addNew()}><Plus size={14} />Artículo nuevo</Button>}
                <Tabs value={mode} onChange={setMode} options={[{ value: 'scan', label: 'Escáner' }, { value: 'search', label: 'Buscar' }, { value: 'sheet', label: 'Planilla' }]} />
              </div>
            )}
          </div>
          {!brandChosen ? <div className="rounded-md bg-sunk px-3 py-2 text-[13px] text-muted">Elegí la marca para cargar sus artículos.</div>
            : mode === 'scan' ? (
              <ScanBox onScan={onScan} hint={`Cada lectura suma 1. Lee el código de barras o el SKU.${isIngreso ? ' Un código que no existe se agrega como artículo nuevo.' : ''}`} />
            ) : mode === 'search' ? (
              <ProductPicker brandId={form.brand_id} onPick={(p) => addProduct(p)} placeholder="Buscá el artículo por SKU, código o nombre…" autoFocus />
            ) : (
              <div className="space-y-2 rounded-lg border border-line p-3">
                <div className="flex flex-wrap items-center gap-3 text-[13px] text-ink2">
                  <label className="cursor-pointer"><span className="inline-flex h-8 items-center gap-2 rounded-md border border-line bg-card px-3 text-[13px] hover:border-ink/40"><Upload size={14} />Subir CSV</span><input type="file" accept=".csv,.txt,.tsv" className="hidden" onChange={onFile} /></label>
                  <span>o pegá desde Excel. Columnas: <b>SKU</b> o <b>Código de barras</b>, y <b>Cantidad</b>{isIngreso && <> (para artículos nuevos, además <b>Nombre</b>, <b>Variante</b> y <b>Precio</b>)</>}.</span>
                </div>
                <Textarea className="min-h-[110px] font-mono text-[12px]" value={sheet} onChange={(e) => setSheet(e.target.value)} placeholder={'SKU;Cantidad\nCHQ-ROSA-M;4\nCHQ-ROSA-L;2'} />
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-muted">{sheetRows.length ? `${sheetRows.length} filas leídas` : ''}</span>
                  <Button size="sm" onClick={loadSheet} disabled={!sheetRows.length || !catalog}>Agregar al pedido</Button>
                </div>
              </div>
            )}
          {items.length > 0 && (
            <div className="mt-3 max-h-[42vh] overflow-auto rounded-lg border border-line">
              <table className="tbl">
                <thead><tr><th>SKU</th><th>Artículo</th><th>Variante</th>{isIngreso && <th>Precio</th>}<th className="w-24 text-right">Cant.</th><th /></tr></thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={i} className={cx(it.isNew && !it.description && 'bg-warn-soft/50')}>
                      {it.isNew ? <>
                        <td><Input className="h-8 py-1" value={it.sku} onChange={(e) => upd(i, 'sku', e.target.value)} placeholder="SKU" />{it.barcode && <div className="mt-0.5 font-mono text-[10px] text-muted">EAN {it.barcode}</div>}</td>
                        <td><Input className="h-8 py-1" value={it.description} onChange={(e) => upd(i, 'description', e.target.value)} placeholder="Nombre (nuevo)" /></td>
                        <td><Input className="h-8 py-1" value={it.variant} onChange={(e) => upd(i, 'variant', e.target.value)} placeholder="Talle/color" /></td>
                        <td><Input className="h-8 w-24 py-1" inputMode="decimal" value={it.price} onChange={(e) => upd(i, 'price', e.target.value)} placeholder="$" /></td>
                      </> : <>
                        <td className="font-mono text-[12px] text-ink2">{it.sku}</td>
                        <td className="font-medium">{it.description}</td>
                        <td className="text-muted">{it.variant}</td>
                        {isIngreso && <td className="text-muted">—</td>}
                      </>}
                      <td className="text-right">
                        <Input className="ml-auto h-8 w-20 py-1 text-right" inputMode="numeric" value={it.qty} onChange={(e) => upd(i, 'qty', e.target.value)} />
                        {!it.isNew && !isIngreso && Number(it.qty) > it.stock && <div className="mt-1 text-[11px] text-bad">Hay {it.stock} en stock</div>}
                      </td>
                      <td><button onClick={() => setItems((l) => l.filter((_, j) => j !== i))} className="rounded-md p-1.5 text-muted hover:bg-bad-soft hover:text-bad" aria-label="Quitar"><Trash2 size={14} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <Field label={isAdmin ? 'Notas' : 'Notas para MAJA'}><Textarea value={form.notes} onChange={set('notes')} placeholder={isPickups ? 'Cuándo pasan a retirar, cómo lo quieren armado…' : 'Cuándo llega, cuántas cajas…'} /></Field>
        <ErrorNote>{error}</ErrorNote>
      </div>
    </Modal>
  );
}

function OrderModal({ id, isAdmin, onClose, onChanged }) {
  const { isOwner } = useSession();
  const toast = useToast();
  const { data: o, loading, setData } = useApi(`/orders/${id}`);
  const [notes, setNotes] = useState(null);
  const [pickedUpBy, setPickedUpBy] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const closed = o && (o.status === 'completado' || o.status === 'cancelado');
  const isIngreso = o?.type === 'ingreso';
  const canPick = isAdmin && o && !closed;
  const requested = o?.items.reduce((a, i) => a + i.qty, 0) ?? 0;
  const picked = o?.items.reduce((a, i) => a + i.picked_qty, 0) ?? 0;
  const st = o ? orderStatus(o) : null;
  const verb = isIngreso ? 'Recibido' : 'Armado';

  // cada cambio del armado se guarda en el momento
  const pick = async (lines) => {
    setError('');
    setData((cur) => ({ ...cur, items: cur.items.map((it) => { const l = lines.find((x) => x.id === it.id); return l ? { ...it, picked_qty: l.picked_qty } : it; }) }));
    try {
      setData(await api(`/orders/${id}/pick`, { method: 'PUT', body: { items: lines } }));
      onChanged();
    } catch (e) { setError(e.message); }
  };
  const setLine = (it, q) => pick([{ id: it.id, picked_qty: Math.max(0, isIngreso ? q : Math.min(q, it.qty)) }]);
  const pickAll = () => pick(o.items.map((it) => ({ id: it.id, picked_qty: it.qty })));
  // cada lectura del escáner suma 1 a la línea de ese artículo
  const onScan = (code) => {
    const c = code.trim().toLowerCase();
    const it = o.items.find((x) => [x.sku, x.product_barcode, x.barcode].some((v) => v && String(v).trim().toLowerCase() === c));
    if (!it) return { ok: false, text: 'No está en este pedido' };
    const name = it.product_name || it.description;
    if (!isIngreso && it.picked_qty >= it.qty) return { ok: false, text: `${name}: ya están las ${it.qty}` };
    setLine(it, it.picked_qty + 1);
    const n = it.picked_qty + 1;
    return { ok: true, text: `${name}${it.product_variant || it.variant ? ` · ${it.product_variant || it.variant}` : ''}: ${n} de ${it.qty}${isIngreso && n > it.qty ? ' (llegó de más)' : ''}` };
  };

  const move = async (status) => {
    if (status === 'cancelado' && !window.confirm('¿Cancelar este pedido?')) return;
    setBusy(status);
    setError('');
    try {
      const r = await api(`/orders/${id}/status`, { method: 'PUT', body: { status, admin_notes: notes, picked_up_by: pickedUpBy } });
      setData(r);
      onChanged();
      toast(status === 'completado' ? (isIngreso ? 'Recibido, stock actualizado' : 'Retiro registrado, stock actualizado') : 'Estado actualizado');
    } catch (e) { setError(e.message); } finally { setBusy(''); }
  };

  const footer = o && !closed && (
    <div className="flex w-full flex-wrap items-center justify-between gap-2">
      {(isOwner || (!isAdmin && o.status === 'pendiente' && picked === 0)) ? <Button variant="danger" onClick={() => move('cancelado')} loading={busy === 'cancelado'}>Cancelar pedido</Button> : <span />}
      {isAdmin && (
        <div className="flex flex-wrap items-center gap-2">
          {isIngreso ? (
            <Button variant="accent" onClick={() => move('completado')} loading={busy === 'completado'} disabled={!picked}><PackageCheck size={15} />Recibir y sumar al stock</Button>
          ) : o.status === 'pendiente' ? (
            <Button variant="accent" onClick={() => move('listo')} loading={busy === 'listo'} disabled={!picked}><Check size={15} />{picked < requested ? `Listo con ${picked} de ${requested}` : 'Listo para retirar'}</Button>
          ) : (
            <>
              <Input className="h-9 w-56" placeholder="¿Quién retiró?" value={pickedUpBy ?? ''} onChange={(e) => setPickedUpBy(e.target.value)} />
              <Button variant="accent" onClick={() => move('completado')} loading={busy === 'completado'} disabled={!pickedUpBy?.trim()}><PackageCheck size={15} />Registrar retiro</Button>
            </>
          )}
        </div>
      )}
    </div>
  );

  return (
    <Modal open wide title={o ? `${TYPE_LABEL[o.type]} #${o.id}` : 'Pedido'} onClose={onClose} footer={footer}>
      {loading || !o ? <Loading /> : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
            <Badge tone={st.tone}>{st.label}</Badge>
            <span><span className="text-muted">Marca</span> <b>{o.brand_name}</b></span>
            {o.external_ref && <span><span className="text-muted">Ref.</span> <b>{o.external_ref}</b></span>}
            <span className="text-muted">Pedido {fmtDateTime(o.created_at)}{o.created_by_name && ` por ${o.created_by_name}`}</span>
            {o.completed_at && <span className="text-muted">{isIngreso ? 'Recibido' : 'Retirado'} {fmtDateTime(o.completed_at)}{o.picked_up_by && ` por ${o.picked_up_by}`}</span>}
          </div>

          {o.type === 'pickup' && (o.customer_name || o.customer_phone) && (
            <div className="rounded-lg bg-sunk px-4 py-3">
              <div className="eyebrow">Para</div>
              {o.customer_name && <div className="mt-1 font-display text-[24px] leading-tight">{o.customer_name}</div>}
              {o.customer_phone && <a href={`tel:${o.customer_phone}`} className="mt-1 inline-flex items-center gap-1.5 text-[13px] text-ink2 hover:text-ink"><Phone size={13} />{o.customer_phone}</a>}
            </div>
          )}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="eyebrow">{isIngreso ? 'Control de lo que llegó' : 'Armado'}</div>
                <Progress done={picked} total={requested} />
              </div>
              {canPick && picked < requested && <Button size="sm" variant="outline" onClick={pickAll}><CheckCheck size={14} />{isIngreso ? 'Llegó todo' : 'Marcar todo armado'}</Button>}
            </div>
            {canPick && <div className="mb-3"><ScanBox onScan={onScan} hint={isIngreso ? 'Escaneá cada prenda que llegó: se cuenta sola en su línea.' : 'Escaneá cada prenda que ponés en la bolsa: se tilda sola.'} /></div>}
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="tbl">
                <thead><tr><th className="w-8" /><th>Artículo</th><th className="text-right">Pedido</th>{!isIngreso && !closed && <th className="text-right">En stock</th>}<th className="text-center">{verb}</th></tr></thead>
                <tbody>
                  {o.items.map((it) => {
                    const done = it.picked_qty >= it.qty;
                    const short = closed && o.status === 'completado' && it.picked_qty < it.qty;
                    return (
                      <tr key={it.id} className={cx(done && !closed && 'bg-ok-soft/40')}>
                        <td>
                          {canPick ? (
                            <button onClick={() => setLine(it, done ? 0 : it.qty)} aria-label={done ? 'Desmarcar' : 'Marcar armado'}
                              className={cx('flex h-5 w-5 items-center justify-center rounded border transition', done ? 'border-ok bg-ok text-paper' : 'border-line bg-card hover:border-ink')}>
                              {done && <Check size={13} strokeWidth={3} />}
                            </button>
                          ) : done ? <Check size={15} className="text-ok" /> : null}
                        </td>
                        <td>
                          <span className="font-medium">{it.product_name || it.description}</span>{(it.product_variant || it.variant) && <span className="text-muted"> · {it.product_variant || it.variant}</span>}
                          {!it.product_id && <span className="ml-2"><Badge tone="accent">Nuevo</Badge></span>}
                          <span className="block font-mono text-[11px] text-muted">{it.sku}</span>
                        </td>
                        <td className="num text-right font-semibold">{it.qty}</td>
                        {!isIngreso && !closed && <td className={cx('num text-right', it.product_stock < it.qty ? 'font-semibold text-bad' : 'text-muted')}>{it.product_stock ?? '—'}</td>}
                        <td>
                          {canPick ? (
                            <div className="flex items-center justify-center gap-1">
                              <button onClick={() => setLine(it, it.picked_qty - 1)} disabled={!it.picked_qty} className="rounded-md p-1 text-ink2 hover:bg-sunk disabled:opacity-30" aria-label="Uno menos"><Minus size={14} /></button>
                              <span className={cx('num w-8 text-center text-[15px] font-semibold', done ? 'text-ok' : it.picked_qty ? 'text-accent' : 'text-muted')}>{it.picked_qty}</span>
                              <button onClick={() => setLine(it, it.picked_qty + 1)} disabled={!isIngreso && done} className="rounded-md p-1 text-ink2 hover:bg-sunk disabled:opacity-30" aria-label="Uno más"><Plus size={14} /></button>
                            </div>
                          ) : (
                            <div className="text-center"><span className={cx('num font-semibold', done ? 'text-ok' : 'text-muted')}>{it.picked_qty}</span>{short && <div className="text-[11px] font-semibold text-bad">Faltaron {it.qty - it.picked_qty}</div>}</div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {canPick && !isIngreso && o.status === 'listo' && <p className="mt-2 text-[12px] text-muted">Al registrar el retiro, el stock baja por lo armado ({picked} {picked === 1 ? 'unidad' : 'unidades'}).</p>}
            {canPick && isIngreso && <p className="mt-2 text-[12px] text-muted">Al recibir, entra al stock lo que marcaste como recibido.</p>}
          </div>

          {isAdmin && o.type === 'ingreso' && o.status === 'completado' && (
            <Link to={`/etiquetas?pedido=${o.id}`} className="inline-flex items-center gap-1.5 text-[13px] font-semibold underline decoration-line underline-offset-2 hover:decoration-ink">Imprimir etiquetas de lo recibido</Link>
          )}
          {isAdmin && o.type === 'pickup' && o.status === 'listo' && o.customer_phone && (
            <a href={`https://wa.me/${String(o.customer_phone).replace(/\D/g, '').replace(/^0/, '598')}?text=${encodeURIComponent(`Hola${o.customer_name ? ` ${o.customer_name}` : ''}! Tu pedido de ${o.brand_name}${o.external_ref ? ` (${o.external_ref})` : ''} ya está listo para retirar en MAJA.`)}`}
              target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[13px] font-semibold underline decoration-line underline-offset-2 hover:decoration-ink">Avisarle por WhatsApp que está listo</a>
          )}
          {o.notes && <div><div className="eyebrow mb-1">Notas de la marca</div><p className="whitespace-pre-wrap text-[13px] text-ink2">{o.notes}</p></div>}
          {isAdmin && !closed ? (
            <Field label="Nota de MAJA (la ve la marca)"><Textarea value={notes ?? o.admin_notes ?? ''} onChange={(e) => setNotes(e.target.value)} placeholder="Faltó una prenda, llegó dañada…" /></Field>
          ) : o.admin_notes && <div><div className="eyebrow mb-1">Nota de MAJA</div><p className="whitespace-pre-wrap text-[13px] text-ink2">{o.admin_notes}</p></div>}
          {!isAdmin && !closed && picked > 0 && <p className="text-[13px] text-muted">MAJA ya está armando este pedido; si hay que cambiar algo, avisales.</p>}
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
    </Modal>
  );
}
