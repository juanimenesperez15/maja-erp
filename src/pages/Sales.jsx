import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Receipt, Download, Trash2, Ban, Undo2, FileText, RotateCw, AlertCircle, CheckCircle2, Wrench } from 'lucide-react';
import { api, getToken } from '../lib/api.js';
import { useApi, useSession } from '../lib/session.jsx';
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Loading, Modal, PageHeader, Select, Stat, useToast, cx } from '../components/ui.jsx';
import ProductPicker from '../components/ProductPicker.jsx';
import { currentPeriod, downloadCSV, fmtDate, fmtDateTime, fmtInt, fmtMoney, parseNum, todayISO } from '../lib/format.js';

const PAYMENT_METHODS = ['Efectivo', 'Débito', 'Crédito', 'Transferencia', 'Mercado Pago', 'Otro'];
const BILLING_HINT = {
  cuenta_ajena: 'Se emite con el Biller de MAJA por cuenta de la marca',
  biller_marca: 'Se emite con el Biller de la marca',
  manual: 'La marca factura a mano: anotá el número',
};

async function openPdf(id, which) {
  const res = await fetch(`/api/sales/${id}/pdf${which ? `?which=${which}` : ''}`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'No se pudo bajar el PDF');
  window.open(URL.createObjectURL(await res.blob()), '_blank');
}

function InvoiceCell({ g, isAdmin, onRetry, toast }) {
  const pdf = (which) => openPdf(g.sale_id, which).catch((e) => toast(e.message, 'bad'));
  return (
    <div className="space-y-1 text-[13px]">
      {g.invoice_status === 'emitida' && (
        <button onClick={() => pdf()} className="inline-flex items-center gap-1 font-medium underline decoration-line underline-offset-2 hover:decoration-ink" title="Ver PDF"><FileText size={13} />{g.invoice_number}</button>
      )}
      {g.invoice_status === 'manual' && <span className="text-ink2">{g.invoice_number || '—'}</span>}
      {(g.invoice_status === 'error' || g.invoice_status === 'pendiente') && (
        <div>
          <Badge tone="bad"><AlertCircle size={11} />Sin facturar</Badge>
          {g.invoice_error && <div className="mt-1 max-w-[260px] text-[11px] leading-snug text-bad">{g.invoice_error}</div>}
          {isAdmin && !g.voided && <button onClick={onRetry} className="mt-1 inline-flex items-center gap-1 text-[12px] font-semibold text-ink hover:underline"><RotateCw size={12} />Reintentar</button>}
        </div>
      )}
      {g.void_cfe_number && <button onClick={() => pdf('void')} className="block text-[12px] text-muted underline decoration-line underline-offset-2">Anulada con {g.void_cfe_number}</button>}
      {g.customer_name && <div className="text-[12px] text-muted">{g.customer_name}{g.customer_doc && ` · ${g.customer_doc_type} ${g.customer_doc}`}</div>}
    </div>
  );
}

export default function Sales() {
  const { isAdmin, isOwner, brandId } = useSession();
  const [range, setRange] = useState({ from: `${currentPeriod()}-01`, to: todayISO() });
  const [showVoided, setShowVoided] = useState(false);
  const [onlyPosErrors, setOnlyPosErrors] = useState(false);
  const [evidence, setEvidence] = useState(null);
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

  const groups = useMemo(() => {
    const m = new Map();
    rows.forEach((r) => { if (!m.has(r.sale_id)) m.set(r.sale_id, { ...r, items: [] }); m.get(r.sale_id).items.push(r); });
    return [...m.values()];
  }, [rows]);
  // venta cuyo POS anotado no coincide con la terminal donde Handy registró el cobro
  const posError = (g) => !g.voided && g.handy_pos && g.pos && g.handy_pos !== g.pos;
  const posErrors = groups.filter(posError).length;
  const shownGroups = onlyPosErrors ? groups.filter(posError) : groups;
  const pendingInvoices = groups.filter((g) => !g.voided && (g.invoice_status === 'error' || g.invoice_status === 'pendiente')).length;

  const voidSale = async (g) => {
    const msg = g.invoice_status === 'emitida'
      ? `Se va a emitir una nota de crédito por ${g.invoice_number} y el stock vuelve a la tienda. ¿Motivo?`
      : '¿Por qué se anula la venta? (el stock vuelve a la tienda)';
    const reason = window.prompt(msg);
    if (reason === null) return;
    try {
      const r = await api(`/sales/${g.sale_id}/void`, { method: 'POST', body: { reason } });
      toast(r.credit_note ? `Venta anulada con ${r.credit_note}` : 'Venta anulada');
      reload();
    } catch (e) { toast(e.message, 'bad'); }
  };
  const retry = async (g) => {
    try {
      const r = await api(`/sales/${g.sale_id}/invoice`, { method: 'POST' });
      toast(r.invoice_status === 'emitida' ? `Emitida ${r.invoice_number}` : `Biller rechazó: ${r.invoice_error}`, r.invoice_status === 'emitida' ? 'ok' : 'bad');
      reload();
    } catch (e) { toast(e.message, 'bad'); }
  };

  const exportCSV = () => downloadCSV(`ventas-${range.from}-a-${range.to}.csv`, [
    ['Fecha', 'Venta', 'Facturado a nombre de', 'Comprobante', 'Cliente', 'SKU', 'Artículo', 'Cantidad', 'Precio unitario', 'Descuento %', 'Total', 'Medio de pago', ...(isAdmin ? ['Anulada'] : [])],
    ...rows.map((r) => [fmtDate(r.date), r.sale_id, r.brand_name, r.invoice_number || '', r.customer_name || '', r.sku || '', r.description, r.qty, r.unit_price, r.discount_pct, r.total, r.payment_method || '', ...(isAdmin ? [r.voided ? 'Sí' : ''] : [])]),
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
        {posErrors > 0 && <label className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-bad"><input type="checkbox" checked={onlyPosErrors} onChange={(e) => setOnlyPosErrors(e.target.checked)} className="h-4 w-4 accent-[#a2342a]" />Ver solo errores de POS ({posErrors})</label>}
        {isAdmin && pendingInvoices > 0 && <div className="mb-1.5 ml-auto"><Badge tone="bad"><AlertCircle size={11} />{pendingInvoices} {pendingInvoices === 1 ? 'venta sin facturar' : 'ventas sin facturar'}</Badge></div>}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Vendido" value={fmtMoney(totals.amount)} />
        <Stat label="Unidades" value={fmtInt(totals.units)} delay={50} />
        <Stat label="Ventas" value={fmtInt(totals.tickets)} sub={totals.tickets ? `Promedio ${fmtMoney(totals.amount / totals.tickets)}` : null} delay={100} />
        <Stat label="Devoluciones" value={fmtMoney(Math.abs(totals.returns))} delay={150} />
      </div>

      <ErrorNote>{error}</ErrorNote>
      <Card className="rise overflow-hidden">
        {loading && !data ? <Loading /> : !groups.length ? (
          <Empty icon={Receipt} title="Sin ventas en estas fechas">
            {isAdmin ? 'Cada venta se factura a nombre de una marca: baja su stock y suma a su liquidación del mes.' : 'Cuando MAJA venda artículos de tu marca, los vas a ver acá con su factura.'}
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Fecha</th><th>Venta</th>{!brandId && <th>A nombre de</th>}<th>Artículos</th><th>Pago</th><th>Comprobante</th><th className="text-right">Total</th>{isAdmin && <th />}</tr></thead>
              <tbody>
                {shownGroups.map((g) => (
                  <tr key={g.sale_id} className={g.voided ? 'opacity-50' : ''}>
                    <td className="whitespace-nowrap align-top">{fmtDate(g.date)}</td>
                    <td className="whitespace-nowrap align-top"><span className="num text-muted">#{g.sale_id}</span>{g.voided ? <div className="mt-1"><Badge tone="bad">Anulada</Badge></div> : null}{g.ref_sale_id && <div className="text-[12px] text-muted">devuelve #{g.ref_sale_id}</div>}</td>
                    {!brandId && <td className="align-top font-medium">{g.brand_name}</td>}
                    <td className="align-top">
                      <ul className="space-y-0.5">
                        {g.items.map((it) => (
                          <li key={it.id} className="text-[13px]">
                            <span className="num font-semibold">{it.qty}×</span> {it.description}
                            {it.discount_pct > 0 && <span className="ml-1 text-[12px] text-accent">−{it.discount_pct}%</span>}
                            {it.qty < 0 && <span className="ml-1"><Badge tone="warn">Devolución</Badge></span>}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="whitespace-nowrap align-top text-ink2">{g.payment_method || '—'}{g.payment_method === 'Crédito' && g.installments > 1 && ` ${g.installments} cuotas`}{g.pos && <span className="block text-[12px] text-muted">{g.pos === 'maja' ? 'POS de MAJA' : 'POS de la marca'}</span>}{posError(g) && <span className="mt-1 block">{isOwner
                      ? <button onClick={() => setEvidence(g.handy_txn_id)} title="Ver cómo se detectó" className="rounded-full transition hover:ring-2 hover:ring-bad/30"><Badge tone="bad">Handy: {g.handy_pos === 'maja' ? 'se cobró en el POS de MAJA' : 'se cobró en el POS de la marca'} ›</Badge></button>
                      : <Badge tone="bad">Handy: {g.handy_pos === 'maja' ? 'se cobró en el POS de MAJA' : 'se cobró en el POS de la marca'}</Badge>}</span>}</td>
                    <td className="align-top"><InvoiceCell g={g} isAdmin={isAdmin} onRetry={() => retry(g)} toast={toast} /></td>
                    <td className="num whitespace-nowrap text-right align-top font-semibold">{fmtMoney(g.items.reduce((a, i) => a + i.total, 0))}</td>
                    {isAdmin && <td className="text-right align-top">{!g.voided && isOwner && <button title="Anular venta" onClick={() => voidSale(g)} className="rounded-md p-1.5 text-muted hover:bg-bad-soft hover:text-bad"><Ban size={15} /></button>}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {evidence && <EvidenceModal txnId={evidence} onClose={() => setEvidence(null)} onFixed={() => { setEvidence(null); reload(); }} />}
      {creating && <NewSaleModal initialBrand={brandId} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload(); }} />}
    </>
  );
}

/** La prueba de un error de POS: lo que se anotó en la venta al lado de lo que dice el reporte de Handy. */
function EvidenceModal({ txnId, onClose, onFixed }) {
  const toast = useToast();
  const { data, loading } = useApi(`/cards/txns/${txnId}`);
  const [busy, setBusy] = useState(false);
  const t = data?.txn;
  const s = data?.sale;
  const posName = (pos) => (pos === 'maja' ? 'POS de MAJA' : pos === 'marca' ? `POS de ${s?.brand_name ?? 'la marca'}` : 'sin POS');
  const handyPos = data?.terminal?.owner === 'maja' ? 'POS de MAJA' : data?.terminal?.owner === 'marca' ? `POS de ${data.terminal.brand_name}` : 'POS sin asignar';
  const wrong = data && ['pos_equivocado', 'medio_equivocado', 'tipo_equivocado'].includes(data.status);

  const fix = async () => {
    setBusy(true);
    try {
      await api(`/cards/txns/${txnId}/fix`, { method: 'POST' });
      toast(`Venta #${s.id} corregida: ${handyPos}`);
      onFixed();
    } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };

  const Row = ({ label, a, b, bad }) => (
    <tr>
      <td className="text-[12px] font-semibold text-muted">{label}</td>
      <td className="text-[13px]">{a}</td>
      <td className={cx('text-[13px]', bad && 'font-semibold text-bad')}>{b}</td>
    </tr>
  );

  return (
    <Modal open wide title="Cómo se detectó" onClose={onClose}
      footer={data && <>
        <Link to="/tarjetas" className="mr-auto self-center text-[13px] text-ink2 underline decoration-line underline-offset-2 hover:text-ink">Ver la conciliación completa</Link>
        <Button variant="ghost" onClick={onClose}>Cerrar</Button>
        {wrong && <Button variant="accent" onClick={fix} loading={busy}><Wrench size={15} />Corregir la venta</Button>}
      </>}>
      {loading || !data ? <Loading /> : (
        <div className="space-y-5">
          <p className="text-[13px] text-ink2">
            En el reporte de Handy del <b>{handyPos}</b> hay un cobro que coincide con esta venta. La venta dice que se pasó en el <b>{posName(s.pos)}</b>.
            {data.terminal?.owner === 'maja' && s.pos === 'marca' && ' Es decir: la vendedora anotó el POS de la marca, pero la tarjeta se pasó en el de MAJA.'}
          </p>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="tbl">
              <thead><tr><th className="w-36" /><th>Lo que se anotó en la venta #{s.id}</th><th>Lo que dice Handy</th></tr></thead>
              <tbody>
                <Row label="POS" a={posName(s.pos)} b={`${handyPos} · terminal ${t.terminal}${data.terminal?.sucursal ? ` (${data.terminal.sucursal})` : ''}`} bad={data.status === 'pos_equivocado'} />
                <Row label="Medio" a={`${s.payment_method}${s.payment_method === 'Crédito' && s.installments > 1 ? ` ${s.installments} cuotas` : ''}`} b={t.movement} bad={['medio_equivocado', 'tipo_equivocado'].includes(data.status)} />
                <Row label="Importe" a={fmtMoney(s.total)} b={fmtMoney(t.amount)} />
                <Row label="Fecha y hora" a={`${fmtDate(s.date)} · cargada ${fmtDateTime(s.created_at)}`} b={fmtDateTime(`${t.txn_at.replace(' ', 'T')}:00-03:00`)} />
                <Row label="N° de factura" a={s.invoice_number || '—'} b={t.invoice_number || '—'} />
                <Row label="Tarjeta" a="—" b={`${t.network ?? ''} ···${String(t.card || '').slice(-4)}${t.bank ? ` · ${t.bank}` : ''} · autorización ${t.authorization ?? '—'}`} />
              </tbody>
            </table>
          </div>
          <div>
            <div className="eyebrow mb-2">Por qué se unieron {data.match_kind === 'manual' ? '(se unió a mano)' : '(automático)'}</div>
            <ul className="space-y-1.5">
              {data.reasons.map((r, i) => (
                <li key={i} className="flex items-start gap-2 text-[13px]">
                  {r.ok ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-ok" /> : <AlertCircle size={15} className="mt-0.5 shrink-0 text-muted" />}
                  <span className={r.ok ? '' : 'text-muted'}>{r.text}</span>
                </li>
              ))}
            </ul>
          </div>
          {wrong && <p className="text-[12px] text-muted">"Corregir la venta" la deja como dice Handy. Lo cobrado en el POS de MAJA ya se descuenta de lo que la marca tiene que pagar, se corrija o no.</p>}
        </div>
      )}
    </Modal>
  );
}

function NewSaleModal({ initialBrand, onClose, onSaved }) {
  const { brands } = useSession();
  const toast = useToast();
  const active = brands.filter((b) => b.active);
  const [brandId, setBrandId] = useState(initialBrand || (active.length === 1 ? String(active[0].id) : ''));
  const brand = active.find((b) => String(b.id) === String(brandId));
  const [head, setHead] = useState({ date: todayISO(), payment_method: '', pos: '', installments: '1', cfe_kind: 'ticket', customer_doc_type: 'CI', customer_doc: '', customer_name: '', customer_email: '', invoice_number: '', ref_sale_id: '', notes: '' });
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const setH = (k) => (e) => setHead({ ...head, [k]: e.target.value });

  const changeBrand = (v) => {
    if (items.length && !window.confirm('Cambiar la marca vacía los artículos cargados. ¿Seguimos?')) return;
    setBrandId(v);
    setItems([]);
  };
  const add = (p) => setItems((l) => {
    const i = l.findIndex((x) => x.product_id === p.id && Number(x.qty) > 0);
    if (i >= 0) return l.map((x, j) => (j === i ? { ...x, qty: String(Number(x.qty) + 1) } : x));
    return [...l, { product_id: p.id, sku: p.sku, description: p.name, variant: p.variant, stock: p.stock, qty: '1', unit_price: String(p.price), discount_pct: '' }];
  });
  const addFree = () => setItems((l) => [...l, { product_id: null, description: '', qty: '1', unit_price: '', discount_pct: '', free: true }]);
  const upd = (i, k, v) => setItems((l) => l.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const lineTotal = (it) => (Number(it.qty) || 0) * (parseNum(it.unit_price) || 0) * (1 - (Number(it.discount_pct) || 0) / 100);
  const total = items.reduce((a, it) => a + lineTotal(it), 0);
  const isReturn = items.length > 0 && items.some((it) => Number(it.qty) < 0);
  const electronic = brand && brand.billing_mode !== 'manual';

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api('/sales', { method: 'POST', body: { ...head, brand_id: brandId, items } });
      if (r.invoice_status === 'error') toast(`Venta guardada, pero Biller no emitió: ${r.invoice_error}`, 'bad');
      else toast(r.invoice_status === 'emitida' ? `Venta registrada · ${r.invoice_number}` : `Venta registrada · ${fmtMoney(total)}`);
      onSaved();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const ready = brand && head.payment_method && items.length && (!['Débito', 'Crédito'].includes(head.payment_method) || head.pos);
  return (
    <Modal open wide title="Registrar venta" onClose={onClose}
      footer={<div className="flex w-full items-center justify-between">
        <div><span className="eyebrow mr-3">Total</span><span className="num font-display text-[30px] leading-none">{fmtMoney(total, true)}</span></div>
        <div className="flex gap-2"><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={save} loading={busy} disabled={!ready}>{electronic ? (isReturn ? 'Guardar y emitir nota de crédito' : 'Guardar y facturar') : 'Guardar venta'}</Button></div>
      </div>}>
      <div className="space-y-5">
        {/* 1. a nombre de quién */}
        <div className="grid gap-4 sm:grid-cols-[1.4fr_1fr]">
          <Field label="Facturar a nombre de" hint={brand ? BILLING_HINT[brand.billing_mode] : 'Cada venta se factura a nombre de una sola marca'}>
            <Select value={brandId} onChange={(e) => changeBrand(e.target.value)} autoFocus={!brandId}>
              <option value="">Elegí la marca…</option>
              {active.map((b) => <option key={b.id} value={b.id}>{b.name}{b.razon_social ? ` — ${b.razon_social}` : ''}</option>)}
            </Select>
          </Field>
          <Field label="Fecha"><Input type="date" value={head.date} max={todayISO()} onChange={setH('date')} /></Field>
        </div>

        {/* 2. medio de pago */}
        <div>
          <div className="mb-1.5 text-[12px] font-semibold text-ink2">Medio de pago</div>
          <div className="flex flex-wrap gap-2">
            {PAYMENT_METHODS.map((m) => (
              <button key={m} type="button" onClick={() => setHead({ ...head, payment_method: m })}
                className={cx('h-9 rounded-md border px-3.5 text-[13px] font-medium transition', head.payment_method === m ? 'border-ink bg-ink text-paper' : 'border-line bg-card text-ink2 hover:border-ink/40')}>
                {m}
              </button>
            ))}
          </div>
          {['Débito', 'Crédito'].includes(head.payment_method) && brand && (
            <div className="fade mt-3 flex flex-wrap items-end gap-4 rounded-lg bg-sunk/70 px-3 py-3">
              <div>
                <div className="mb-1.5 text-[12px] font-semibold text-ink2">¿En qué POS se pasó la tarjeta?</div>
                <div className="inline-flex rounded-md border border-line bg-card p-0.5">
                  {[['maja', 'POS de MAJA'], ['marca', `POS de ${brand.name}`]].map(([v, l]) => (
                    <button key={v} type="button" onClick={() => setHead({ ...head, pos: v })}
                      className={cx('rounded px-3 py-1.5 text-[13px] font-medium', head.pos === v ? 'bg-ink text-paper' : 'text-ink2')}>{l}</button>
                  ))}
                </div>
              </div>
              {head.payment_method === 'Crédito' && (
                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-semibold text-ink2">Cuotas</span>
                  <select className="field h-9 w-24 py-1" value={head.installments} onChange={setH('installments')}>
                    {[1, 2, 3, 4, 5, 6, 8, 10, 12].map((c) => <option key={c} value={c}>{c === 1 ? 'Contado' : c}</option>)}
                  </select>
                </label>
              )}
              <p className="basis-full text-[12px] text-muted">Mirá el POS donde salió el comprobante: después se cruza con el reporte de Handy.</p>
            </div>
          )}
        </div>

        {/* 3. artículos */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className="eyebrow">Artículos {brand && `de ${brand.name}`}</div>
            {brand && <Button size="sm" variant="ghost" onClick={addFree}><Plus size={14} />Línea sin artículo</Button>}
          </div>
          {brand ? <ProductPicker brandId={brandId} onPick={add} placeholder="Escaneá o buscá por SKU o nombre…" autoFocus={!!brandId} />
            : <div className="rounded-md bg-sunk px-3 py-2 text-[13px] text-muted">Elegí primero la marca a cuyo nombre se factura.</div>}
          {items.length > 0 && (
            <div className="mt-3 overflow-x-auto rounded-lg border border-line">
              <table className="tbl">
                <thead><tr><th>Artículo</th><th className="w-20 text-right">Cant.</th><th className="w-28 text-right">Precio</th><th className="w-20 text-right">Desc. %</th><th className="text-right">Total</th><th /></tr></thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={i}>
                      <td>
                        {it.free ? <Input className="h-8 py-1" value={it.description} onChange={(e) => upd(i, 'description', e.target.value)} placeholder="Descripción" /> : (
                          <>
                            <span className="font-medium">{it.description}</span>{it.variant && <span className="text-muted"> · {it.variant}</span>}
                            <span className="block text-[12px] text-muted">{it.sku}{Number(it.qty) > it.stock && <span className="text-bad"> · hay {it.stock} en stock</span>}</span>
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
          {isReturn && electronic && (
            <div className="mt-3 grid max-w-md gap-3 sm:grid-cols-2">
              <Field label="Venta original #" hint="La nota de crédito la referencia"><Input inputMode="numeric" value={head.ref_sale_id} onChange={setH('ref_sale_id')} placeholder="Ej. 124" /></Field>
            </div>
          )}
        </div>

        {/* 4. comprobante y cliente */}
        {brand && (
          <div className="rounded-lg border border-line p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="eyebrow">Comprobante</div>
              {electronic && !isReturn && (
                <div className="inline-flex rounded-md border border-line p-0.5">
                  {[['ticket', 'e-Ticket · consumidor final'], ['factura', 'e-Factura · con RUT']].map(([v, l]) => (
                    <button key={v} type="button" onClick={() => setHead({ ...head, cfe_kind: v, customer_doc_type: v === 'factura' ? 'RUT' : head.customer_doc_type === 'RUT' ? 'CI' : head.customer_doc_type })}
                      className={cx('rounded px-2.5 py-1 text-[12px] font-medium', head.cfe_kind === v ? 'bg-ink text-paper' : 'text-ink2')}>{l}</button>
                  ))}
                </div>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              {!electronic && <Field label="N° de factura" className="sm:col-span-4"><Input value={head.invoice_number} onChange={setH('invoice_number')} placeholder="Ej. A-1234" /></Field>}
              <Field label="Documento">
                <Select value={head.customer_doc_type} onChange={setH('customer_doc_type')} disabled={head.cfe_kind === 'factura'}>
                  <option value="CI">CI</option><option value="RUT">RUT</option><option value="PASAPORTE">Pasaporte</option><option value="DNI">DNI</option><option value="OTRO">Otro</option>
                </Select>
              </Field>
              <Field label="Número"><Input value={head.customer_doc} onChange={setH('customer_doc')} /></Field>
              <Field label={head.customer_doc_type === 'RUT' ? 'Razón social' : 'Nombre'} className="sm:col-span-2"><Input value={head.customer_name} onChange={setH('customer_name')} /></Field>
              {electronic && <Field label="Email (le llega el PDF)" className="sm:col-span-2"><Input type="email" value={head.customer_email} onChange={setH('customer_email')} /></Field>}
            </div>
            <p className="mt-2 text-[12px] text-muted">{head.cfe_kind === 'factura' ? 'La e-Factura lleva RUT y razón social del cliente.' : 'Datos del cliente opcionales. Para montos altos DGI exige identificarlo; si falta, Biller lo avisa.'}</p>
          </div>
        )}
        <ErrorNote>{error}</ErrorNote>
      </div>
    </Modal>
  );
}
