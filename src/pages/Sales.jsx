import { useMemo, useState } from 'react';
import { Plus, Receipt, Download, Trash2, Ban, Undo2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi, useSession } from '../lib/session.jsx';
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Loading, Modal, PageHeader, Select, Stat, useToast } from '../components/ui.jsx';
import ProductPicker from '../components/ProductPicker.jsx';
import { currentPeriod, downloadCSV, fmtDate, fmtInt, fmtMoney, todayISO } from '../lib/format.js';

const PAYMENT_METHODS = ['Efectivo', 'Débito', 'Crédito', 'Transferencia', 'Mercado Pago', 'Otro'];

export default function Sales() {
  const { isAdmin, brandId } = useSession();
  const [range, setRange] = useState({ from: `${currentPeriod()}-01`, to: todayISO() });
  const [showVoided, setShowVoided] = useState(false);
  const { data, error, loading, reload } = useApi('/sales', { brand_id: brandId, from: range.from, to: range.to, include_voided: showVoided ? '1' : '' });
  const [creating, setCreating] = useState(false);
  const toast = useToast();
  const rows = data?.rows || [];

  const live = rows.filter((r) => !r.voided);
  const totals = useMemo(() => ({
    amount: live.reduce((a, r) => a + r.total, 0),
    units: live.reduce((a, r) => a + r.qty, 0),
    tickets: new Set(live.map((r) => r.sale_id)).size,
    returns: live.filter((r) => r.qty < 0).reduce((a, r) => a + r.total, 0),
  }), [live]);

  // agrupado por venta (ticket)
  const groups = useMemo(() => {
    const m = new Map();
    rows.forEach((r) => { if (!m.has(r.sale_id)) m.set(r.sale_id, { ...r, items: [] }); m.get(r.sale_id).items.push(r); });
    return [...m.values()];
  }, [rows]);

  const voidSale = async (id) => {
    const reason = window.prompt('¿Por qué se anula la venta? (el stock vuelve a la tienda)');
    if (reason === null) return;
    try {
      await api(`/sales/${id}/void`, { method: 'POST', body: { reason } });
      toast('Venta anulada');
      reload();
    } catch (e) { toast(e.message, 'bad'); }
  };

  const exportCSV = () => downloadCSV(`ventas-${range.from}-a-${range.to}.csv`, [
    ['Fecha', 'Venta', 'Ticket', 'Marca', 'SKU', 'Artículo', 'Cantidad', 'Precio unitario', 'Descuento %', 'Total', ...(isAdmin ? ['Medio de pago', 'Anulada'] : [])],
    ...rows.map((r) => [fmtDate(r.date), r.sale_id, r.ticket || '', r.brand_name, r.sku || '', r.description, r.qty, r.unit_price, r.discount_pct, r.total, ...(isAdmin ? [r.payment_method || '', r.voided ? 'Sí' : ''] : [])]),
  ]);

  return (
    <>
      <PageHeader eyebrow={isAdmin ? 'Caja de la tienda' : 'Lo que vendió MAJA de tu marca'} title="Ventas">
        <Button variant="outline" onClick={exportCSV} disabled={!rows.length}><Download size={15} />Exportar</Button>
        {isAdmin && <Button onClick={() => setCreating(true)}><Plus size={16} />Registrar venta</Button>}
      </PageHeader>

      <div className="mb-5 flex flex-wrap items-end gap-3">
        <Field label="Desde"><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>
        <Field label="Hasta"><Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field>
        {isAdmin && <label className="mb-2 flex items-center gap-2 text-[13px] text-ink2"><input type="checkbox" checked={showVoided} onChange={(e) => setShowVoided(e.target.checked)} className="h-4 w-4 accent-[#1d1b18]" />Mostrar anuladas</label>}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Vendido" value={fmtMoney(totals.amount)} />
        <Stat label="Unidades" value={fmtInt(totals.units)} delay={50} />
        <Stat label="Tickets" value={fmtInt(totals.tickets)} sub={totals.tickets ? `Promedio ${fmtMoney(totals.amount / totals.tickets)}` : null} delay={100} />
        <Stat label="Devoluciones" value={fmtMoney(Math.abs(totals.returns))} delay={150} />
      </div>

      <ErrorNote>{error}</ErrorNote>
      <Card className="rise overflow-hidden">
        {loading && !data ? <Loading /> : !rows.length ? (
          <Empty icon={Receipt} title="Sin ventas en estas fechas">
            {isAdmin ? 'Registrá cada venta de la tienda: el stock de la marca baja y la venta suma a su liquidación del mes.' : 'Cuando MAJA venda artículos de tu marca, los vas a ver acá con fecha, cantidad y precio.'}
          </Empty>
        ) : isAdmin ? (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Fecha</th><th>Venta</th><th>Artículos</th><th>Pago</th><th className="text-right">Total</th><th /></tr></thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.sale_id} className={g.voided ? 'opacity-50' : ''}>
                    <td className="whitespace-nowrap align-top">{fmtDate(g.date)}</td>
                    <td className="whitespace-nowrap align-top"><span className="num text-muted">#{g.sale_id}</span>{g.ticket && <span className="block text-[12px] text-muted">Ticket {g.ticket}</span>}{g.voided ? <div className="mt-1"><Badge tone="bad">Anulada</Badge></div> : null}</td>
                    <td className="align-top">
                      <ul className="space-y-0.5">
                        {g.items.map((it) => (
                          <li key={it.id} className="text-[13px]">
                            <span className="num font-semibold">{it.qty}×</span> {it.description}{it.variant && <span className="text-muted"> · {it.variant}</span>} <span className="text-muted">— {it.brand_name}</span>
                            {it.discount_pct > 0 && <span className="ml-1 text-[12px] text-accent">−{it.discount_pct}%</span>}
                            {it.qty < 0 && <span className="ml-1"><Badge tone="warn">Devolución</Badge></span>}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="align-top text-ink2">{g.payment_method || '—'}</td>
                    <td className="num text-right align-top font-semibold">{fmtMoney(g.items.reduce((a, i) => a + i.total, 0))}</td>
                    <td className="text-right align-top">{!g.voided && <button title="Anular venta" onClick={() => voidSale(g.sale_id)} className="rounded-md p-1.5 text-muted hover:bg-bad-soft hover:text-bad"><Ban size={15} /></button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Fecha</th><th>SKU</th><th>Artículo</th><th className="text-right">Cant.</th><th className="text-right">Precio</th><th className="text-right">Desc.</th><th className="text-right">Total</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap">{fmtDate(r.date)}</td>
                    <td className="font-mono text-[12px] text-ink2">{r.sku || '—'}</td>
                    <td><span className="font-medium">{r.description}</span>{r.variant && <span className="text-muted"> · {r.variant}</span>}{r.qty < 0 && <span className="ml-2"><Badge tone="warn">Devolución</Badge></span>}</td>
                    <td className="num text-right">{r.qty}</td>
                    <td className="num text-right">{fmtMoney(r.unit_price)}</td>
                    <td className="num text-right text-muted">{r.discount_pct ? `${r.discount_pct}%` : '—'}</td>
                    <td className="num text-right font-semibold">{fmtMoney(r.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {creating && <NewSaleModal brandId={brandId} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload(); }} />}
    </>
  );
}

function NewSaleModal({ brandId, onClose, onSaved }) {
  const { brands } = useSession();
  const toast = useToast();
  const [head, setHead] = useState({ date: todayISO(), ticket: '', payment_method: 'Efectivo', notes: '' });
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const add = (p) => setItems((l) => {
    const i = l.findIndex((x) => x.product_id === p.id && Number(x.qty) > 0);
    if (i >= 0) return l.map((x, j) => (j === i ? { ...x, qty: String(Number(x.qty) + 1) } : x));
    return [...l, { product_id: p.id, brand_name: p.brand_name, sku: p.sku, description: p.name, variant: p.variant, stock: p.stock, qty: '1', unit_price: String(p.price), discount_pct: '' }];
  });
  const addFree = () => setItems((l) => [...l, { product_id: null, brand_id: brandId || '', description: '', qty: '1', unit_price: '', discount_pct: '', free: true }]);
  const upd = (i, k, v) => setItems((l) => l.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const lineTotal = (it) => (Number(it.qty) || 0) * (Number(String(it.unit_price).replace(',', '.')) || 0) * (1 - (Number(it.discount_pct) || 0) / 100);
  const total = items.reduce((a, it) => a + lineTotal(it), 0);

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await api('/sales', { method: 'POST', body: { ...head, items } });
      toast(`Venta registrada · ${fmtMoney(total)}`);
      onSaved();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal open wide title="Registrar venta" onClose={onClose}
      footer={<div className="flex w-full items-center justify-between">
        <div><span className="eyebrow mr-3">Total</span><span className="num font-display text-[30px] leading-none">{fmtMoney(total, true)}</span></div>
        <div className="flex gap-2"><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={save} loading={busy} disabled={!items.length}>Guardar venta</Button></div>
      </div>}>
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Fecha"><Input type="date" value={head.date} max={todayISO()} onChange={(e) => setHead({ ...head, date: e.target.value })} /></Field>
          <Field label="Medio de pago"><Select value={head.payment_method} onChange={(e) => setHead({ ...head, payment_method: e.target.value })}>{PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}</Select></Field>
          <Field label="N° de ticket / factura"><Input value={head.ticket} onChange={(e) => setHead({ ...head, ticket: e.target.value })} /></Field>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className="eyebrow">Artículos {brandId ? '' : '(de cualquier marca)'}</div>
            <Button size="sm" variant="ghost" onClick={addFree}><Plus size={14} />Línea sin artículo</Button>
          </div>
          <ProductPicker brandId={brandId} onPick={add} placeholder="Escaneá o buscá por SKU o nombre…" autoFocus />
          {items.length > 0 && (
            <div className="mt-3 overflow-x-auto rounded-lg border border-line">
              <table className="tbl">
                <thead><tr><th>Artículo</th><th className="w-20 text-right">Cant.</th><th className="w-28 text-right">Precio</th><th className="w-20 text-right">Desc. %</th><th className="text-right">Total</th><th /></tr></thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={i}>
                      <td>
                        {it.free ? (
                          <div className="flex gap-2">
                            <Select className="h-8 w-36 py-1" value={it.brand_id} onChange={(e) => upd(i, 'brand_id', e.target.value)}>
                              <option value="">Marca…</option>
                              {brands.filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                            </Select>
                            <Input className="h-8 py-1" value={it.description} onChange={(e) => upd(i, 'description', e.target.value)} placeholder="Descripción" />
                          </div>
                        ) : (
                          <>
                            <span className="font-medium">{it.description}</span>{it.variant && <span className="text-muted"> · {it.variant}</span>}
                            <span className="block text-[12px] text-muted">{it.sku} · {it.brand_name}{Number(it.qty) > it.stock && <span className="text-bad"> · hay {it.stock} en stock</span>}</span>
                          </>
                        )}
                        {Number(it.qty) < 0 && <span className="mt-1 inline-block"><Badge tone="warn">Devolución</Badge></span>}
                      </td>
                      <td><Input className="h-8 py-1 text-right" inputMode="numeric" value={it.qty} onChange={(e) => upd(i, 'qty', e.target.value)} /></td>
                      <td><Input className="h-8 py-1 text-right" inputMode="decimal" value={it.unit_price} onChange={(e) => upd(i, 'unit_price', e.target.value)} /></td>
                      <td><Input className="h-8 py-1 text-right" inputMode="decimal" value={it.discount_pct} onChange={(e) => upd(i, 'discount_pct', e.target.value)} placeholder="0" /></td>
                      <td className="num whitespace-nowrap text-right font-semibold">{fmtMoney(lineTotal(it), true)}</td>
                      <td className="whitespace-nowrap">
                        {!it.free && <button title="Pasar a devolución" onClick={() => upd(i, 'qty', String(-Math.abs(Number(it.qty) || 1)))} className="rounded-md p-1.5 text-muted hover:bg-sunk hover:text-ink"><Undo2 size={14} /></button>}
                        <button onClick={() => setItems((l) => l.filter((_, j) => j !== i))} className="rounded-md p-1.5 text-muted hover:bg-bad-soft hover:text-bad" aria-label="Quitar"><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-[12px] text-muted">Para una devolución o cambio, poné la cantidad en negativo (o tocá <Undo2 size={11} className="inline" />): el artículo vuelve al stock y se descuenta de lo vendido por la marca.</p>
        </div>
        <ErrorNote>{error}</ErrorNote>
      </div>
    </Modal>
  );
}
