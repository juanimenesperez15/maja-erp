import { useMemo, useState } from 'react';
import { Boxes, Download, History, Plus, Search, SlidersHorizontal, Upload, Pencil } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi, useSession } from '../lib/session.jsx';
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Loading, Modal, PageHeader, Select, Tabs, Textarea, useToast } from '../components/ui.jsx';
import { downloadCSV, fmtDateTime, fmtInt, fmtMoney, parseTable } from '../lib/format.js';

const REASON = { ingreso: 'Ingreso', venta: 'Venta', devolucion: 'Devolución', pickup: 'Pick up', retiro: 'Retiro', ajuste: 'Ajuste', anulacion: 'Venta anulada' };

export default function Stock() {
  const { isAdmin, isOwner, brandId, brands } = useSession();
  const [q, setQ] = useState('');
  const [view, setView] = useState('todos');
  const { data, error, loading, reload } = useApi('/products', { brand_id: brandId, include_inactive: view === 'inactivos' ? '1' : '' });
  const [modal, setModal] = useState(null);

  const rows = useMemo(() => {
    let r = data || [];
    if (view === 'bajo') r = r.filter((p) => p.stock <= p.min_stock);
    if (view === 'inactivos') r = r.filter((p) => !p.active);
    const t = q.trim().toLowerCase();
    if (t) r = r.filter((p) => `${p.sku} ${p.name} ${p.variant || ''} ${p.brand_name}`.toLowerCase().includes(t));
    return r;
  }, [data, q, view]);

  const totals = useMemo(() => rows.reduce((a, p) => ({ units: a.units + Math.max(0, p.stock), value: a.value + Math.max(0, p.stock) * p.price }), { units: 0, value: 0 }), [rows]);
  const lowCount = (data || []).filter((p) => p.stock <= p.min_stock).length;

  const exportCSV = () => downloadCSV(`stock-${new Date().toISOString().slice(0, 10)}.csv`, [
    ['Marca', 'SKU', 'Artículo', 'Variante', 'Precio', 'Stock', 'Vendido 30 días'],
    ...rows.map((p) => [p.brand_name, p.sku, p.name, p.variant || '', p.price, p.stock, p.sold_30d]),
  ]);

  return (
    <>
      <PageHeader eyebrow={isAdmin ? 'Inventario de la tienda' : 'Tu mercadería en MAJA'} title="Stock">
        <Button variant="outline" onClick={exportCSV} disabled={!rows.length}><Download size={15} />Exportar</Button>
        <Button variant="outline" onClick={() => setModal({ type: 'import' })}><Upload size={15} />Importar planilla</Button>
        <Button onClick={() => setModal({ type: 'product', product: { sku: '', name: '', variant: '', price: '', min_stock: '', stock: '', active: true, brand_id: brandId } })}><Plus size={16} />Artículo</Button>
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar SKU, artículo…" />
        </div>
        <Tabs value={view} onChange={setView} options={[{ value: 'todos', label: 'Todos' }, { value: 'bajo', label: 'Stock bajo', count: lowCount }, { value: 'inactivos', label: 'Inactivos' }]} />
        <div className="ml-auto text-[13px] text-muted"><b className="num text-ink">{fmtInt(totals.units)}</b> unidades · <b className="num text-ink">{fmtMoney(totals.value)}</b> a precio de venta</div>
      </div>

      <ErrorNote>{error}</ErrorNote>
      <Card className="rise overflow-hidden">
        {loading && !data ? <Loading /> : !rows.length ? (
          <Empty icon={Boxes} title={data?.length ? 'Nada coincide con el filtro' : 'Sin artículos todavía'}>
            {!data?.length && (isAdmin
              ? 'Cargá los artículos de cada marca uno por uno o importando su planilla (SKU, nombre, variante, precio, stock).'
              : 'Cargá tus artículos o importá tu planilla. El stock entra cuando MAJA recibe un pedido de ingreso de mercadería.')}
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr>{!brandId && <th>Marca</th>}<th>SKU</th><th>Artículo</th><th className="text-right">Precio</th><th className="text-right">Stock</th><th className="text-right">Vend. 30 d</th><th /></tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className={p.active ? '' : 'opacity-50'}>
                    {!brandId && <td className="text-ink2">{p.brand_name}</td>}
                    <td className="font-mono text-[12px] text-ink2">{p.sku}</td>
                    <td><span className="font-medium">{p.name}</span>{p.variant && <span className="text-muted"> · {p.variant}</span>}</td>
                    <td className="num text-right">{fmtMoney(p.price)}</td>
                    <td className="text-right">
                      <span className={`num font-semibold ${p.stock <= 0 ? 'text-bad' : p.stock <= p.min_stock ? 'text-warn' : ''}`}>{fmtInt(p.stock)}</span>
                    </td>
                    <td className="num text-right text-ink2">{fmtInt(p.sold_30d)}</td>
                    <td className="whitespace-nowrap text-right">
                      <button title="Movimientos" onClick={() => setModal({ type: 'moves', product: p })} className="rounded-md p-1.5 text-muted hover:bg-sunk hover:text-ink"><History size={15} /></button>
                      {isOwner && <button title="Ajustar stock" onClick={() => setModal({ type: 'adjust', product: p })} className="rounded-md p-1.5 text-muted hover:bg-sunk hover:text-ink"><SlidersHorizontal size={15} /></button>}
                      <button title="Editar" onClick={() => setModal({ type: 'product', product: { ...p, price: String(p.price), min_stock: String(p.min_stock) } })} className="rounded-md p-1.5 text-muted hover:bg-sunk hover:text-ink"><Pencil size={15} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {modal?.type === 'product' && <ProductModal product={modal.product} brands={brands} isAdmin={isAdmin} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />}
      {modal?.type === 'adjust' && <AdjustModal product={modal.product} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />}
      {modal?.type === 'moves' && <MovesModal product={modal.product} onClose={() => setModal(null)} />}
      {modal?.type === 'import' && <ImportModal brandId={brandId} brands={brands} isAdmin={isAdmin} isOwner={isOwner} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
    </>
  );
}

function BrandSelect({ value, onChange, brands }) {
  return (
    <Field label="Marca">
      <Select value={value || ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">Elegí…</option>
        {brands.filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </Select>
    </Field>
  );
}

function ProductModal({ product, brands, isAdmin, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(product);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      if (form.id) await api(`/products/${form.id}`, { method: 'PUT', body: form });
      else await api('/products', { method: 'POST', body: form });
      toast(form.id ? 'Artículo actualizado' : 'Artículo creado');
      onSaved();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal open title={form.id ? 'Editar artículo' : 'Nuevo artículo'} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={save} loading={busy}>Guardar</Button></>}>
      <div className="grid grid-cols-2 gap-4">
        {!form.id && isAdmin && <div className="col-span-2"><BrandSelect value={form.brand_id} onChange={(v) => setForm({ ...form, brand_id: v })} brands={brands} /></div>}
        <Field label="SKU / código"><Input value={form.sku} onChange={set('sku')} autoFocus /></Field>
        <Field label="Variante" hint="Talle, color…"><Input value={form.variant || ''} onChange={set('variant')} /></Field>
        <Field label="Nombre del artículo" className="col-span-2"><Input value={form.name} onChange={set('name')} /></Field>
        <Field label="Precio de venta ($)"><Input inputMode="decimal" value={form.price} onChange={set('price')} /></Field>
        <Field label="Avisar con stock ≤" hint="0 = avisa solo al agotarse"><Input inputMode="numeric" value={form.min_stock} onChange={set('min_stock')} /></Field>
        {!form.id && isAdmin && <Field label="Stock inicial" className="col-span-2" hint="Lo que hay hoy en la tienda"><Input inputMode="numeric" value={form.stock} onChange={set('stock')} /></Field>}
        {form.id && <label className="col-span-2 flex items-center gap-2 text-[13px]"><input type="checkbox" checked={form.active} onChange={set('active')} className="h-4 w-4 accent-[#1d1b18]" />Artículo activo</label>}
      </div>
      <div className="mt-4"><ErrorNote>{error}</ErrorNote></div>
    </Modal>
  );
}

function AdjustModal({ product, onClose, onSaved }) {
  const toast = useToast();
  const [setTo, setSetTo] = useState(String(product.stock));
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const diff = Number(setTo) - product.stock;

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await api(`/products/${product.id}/adjust`, { method: 'POST', body: { set_to: setTo, note } });
      toast('Stock ajustado');
      onSaved();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal open title="Ajustar stock" onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={save} loading={busy}>Guardar ajuste</Button></>}>
      <div className="mb-4 text-[13px] text-ink2"><b>{product.name}</b>{product.variant && ` · ${product.variant}`} <span className="text-muted">({product.sku} · {product.brand_name})</span></div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Stock en sistema"><Input value={product.stock} disabled /></Field>
        <Field label="Stock contado" hint={Number.isFinite(diff) && diff ? `${diff > 0 ? '+' : ''}${diff} unidades` : 'Sin diferencia'}><Input inputMode="numeric" value={setTo} onChange={(e) => setSetTo(e.target.value)} autoFocus /></Field>
        <Field label="Motivo" className="col-span-2"><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Conteo, prenda dañada, faltante…" /></Field>
      </div>
      <div className="mt-4"><ErrorNote>{error}</ErrorNote></div>
    </Modal>
  );
}

function MovesModal({ product, onClose }) {
  const { data, loading } = useApi(`/products/${product.id}/movements`);
  return (
    <Modal open wide title="Movimientos" onClose={onClose}>
      <div className="mb-4 text-[13px] text-ink2"><b>{product.name}</b>{product.variant && ` · ${product.variant}`} <span className="text-muted">({product.sku})</span> — stock actual <b className="num">{product.stock}</b></div>
      {loading ? <Loading /> : !data?.movements.length ? <div className="py-8 text-center text-[13px] text-muted">Sin movimientos</div> : (
        <div className="max-h-[55vh] overflow-y-auto">
          <table className="tbl">
            <thead><tr><th>Fecha</th><th>Movimiento</th><th className="text-right">Cantidad</th><th>Detalle</th></tr></thead>
            <tbody>
              {data.movements.map((m) => (
                <tr key={m.id}>
                  <td className="whitespace-nowrap text-[13px] text-muted">{fmtDateTime(m.created_at)}</td>
                  <td>{REASON[m.reason] || m.reason}{m.ref_type === 'order' && <span className="text-muted"> · pedido #{m.ref_id}</span>}{m.ref_type === 'sale' && <span className="text-muted"> · venta #{m.ref_id}</span>}</td>
                  <td className={`num text-right font-semibold ${m.qty > 0 ? 'text-ok' : 'text-bad'}`}>{m.qty > 0 ? '+' : ''}{m.qty}</td>
                  <td className="text-[13px] text-ink2">{m.note}{m.user_name && <span className="text-muted"> — {m.user_name}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

function ImportModal({ brandId: initialBrand, brands, isAdmin, isOwner, onClose, onDone }) {
  const toast = useToast();
  const [brandId, setBrandId] = useState(initialBrand);
  const [text, setText] = useState('');
  const [applyStock, setApplyStock] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => { try { return parseTable(text); } catch { return []; } }, [text]);
  const valid = rows.filter((r) => r.sku && r.name);

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (f) setText(await f.text());
  };

  const run = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api('/products/import', { method: 'POST', body: { brand_id: brandId, rows, apply_stock: applyStock } });
      toast(`${r.created} creados · ${r.updated} actualizados${r.errors.length ? ` · ${r.errors.length} con error` : ''}`);
      if (r.errors.length) setError(r.errors.slice(0, 5).join(' · '));
      else onDone();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal open wide title="Importar planilla" onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cerrar</Button><Button onClick={run} loading={busy} disabled={!valid.length || !brandId}>Importar {valid.length || ''} artículos</Button></>}>
      <div className="space-y-4">
        {isAdmin && <div className="max-w-xs"><BrandSelect value={brandId} onChange={setBrandId} brands={brands} /></div>}
        <p className="text-[13px] text-ink2">
          Subí un CSV o pegá las columnas copiadas desde Excel. Encabezados que se reconocen: <b>SKU</b> (o Código), <b>Nombre</b> (o Artículo), <b>Variante</b> (o Talle), <b>Precio</b>{isOwner && <>, <b>Stock</b></>}. Si el SKU ya existe, se actualiza.
        </p>
        <div className="flex items-center gap-3">
          <label className="cursor-pointer"><span className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-card px-4 text-[14px] hover:border-ink/40"><Upload size={15} />Elegir archivo</span><input type="file" accept=".csv,.txt,.tsv" className="hidden" onChange={onFile} /></label>
          <span className="text-[12px] text-muted">o pegá abajo</span>
        </div>
        <Textarea className="min-h-[140px] font-mono text-[12px]" value={text} onChange={(e) => setText(e.target.value)} placeholder={'SKU;Nombre;Variante;Precio' + (isOwner ? ';Stock' : '')} />
        {isOwner && (
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={applyStock} onChange={(e) => setApplyStock(e.target.checked)} className="h-4 w-4 accent-[#1d1b18]" />
            Tomar la columna Stock como stock actual (registra un ajuste por la diferencia)
          </label>
        )}
        {rows.length > 0 && (
          <div className="text-[13px]">
            <Badge tone={valid.length === rows.length ? 'ok' : 'warn'}>{valid.length} de {rows.length} filas válidas</Badge>
            <div className="mt-2 max-h-48 overflow-auto rounded-lg border border-line">
              <table className="tbl text-[12px]">
                <thead><tr><th>SKU</th><th>Nombre</th><th>Variante</th><th>Precio</th>{isOwner && <th>Stock</th>}</tr></thead>
                <tbody>{rows.slice(0, 30).map((r, i) => <tr key={i} className={r.sku && r.name ? '' : 'text-bad'}><td>{r.sku}</td><td>{r.name}</td><td>{r.variant}</td><td>{r.price}</td>{isOwner && <td>{r.stock}</td>}</tr>)}</tbody>
              </table>
            </div>
          </div>
        )}
        <ErrorNote>{error}</ErrorNote>
      </div>
    </Modal>
  );
}
