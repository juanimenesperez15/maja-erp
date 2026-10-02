import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronLeft, ChevronRight, CreditCard, Download, FileText, Landmark, Lock, LockOpen, MessageCircle, Plus, Printer, Trash2 } from 'lucide-react';
import { api, getToken } from '../lib/api.js';
import { useApi, useSession } from '../lib/session.jsx';
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Loading, Modal, PageHeader, Select, Stat, useToast, cx, SETTLEMENT_BADGE } from '../components/ui.jsx';
import { currentPeriod, downloadCSV, fmtDate, fmtDateTime, fmtInt, fmtMoney, fmtPct, fmtPeriod, fmtPeriodShort, parseNum, shiftPeriod, todayISO } from '../lib/format.js';

const PAY_METHODS = ['Transferencia', 'Efectivo', 'Descuento de ventas', 'Otro'];

/** Saldo con signo legible: positivo lo debe la marca, negativo lo debe MAJA. */
function Balance({ value, big }) {
  const cls = big ? 'num font-display text-[26px] leading-none' : 'num font-semibold';
  if (value > 0.009) return <span className={cx(cls, 'text-accent')}>{fmtMoney(value, big)}</span>;
  if (value < -0.009) return <span className={cx(cls, 'text-ok')}>{fmtMoney(-value, big)}<span className="ml-1 font-sans text-[11px] font-semibold">a favor</span></span>;
  return <span className={cx(cls, 'text-muted')}>{fmtMoney(0, big)}</span>;
}

export default function Settlements() {
  const { isAdmin, brandId } = useSession();
  const [period, setPeriod] = useState(currentPeriod());
  const { data, error, loading, reload } = useApi('/settlements', brandId ? { brand_id: brandId } : { period });
  const [detail, setDetail] = useState(null);

  const rows = data?.rows || [];
  const owed = rows.reduce((a, r) => a + Math.max(0, r.balance), 0);
  const inFavor = rows.reduce((a, r) => a + Math.max(0, -r.balance), 0);
  const credit = rows.reduce((a, r) => a + r.card_credit, 0);
  const brandMode = data?.mode === 'brand';

  const exportCSV = () => downloadCSV(brandMode ? `liquidaciones-${data.brand.name}.csv` : `liquidaciones-${period}.csv`, [
    ['Mes', 'Marca', 'Vendido', 'Unidades', 'Comisión %', 'Comisión', 'Cuota', 'IVA', 'Cobrado en POS de MAJA', 'Total', 'Pagado', 'Saldo', 'Estado', 'Cerrada'],
    ...rows.map((r) => [r.period, r.brand_name, r.sales_total, r.units, r.commission_pct, r.commission, r.fee, r.iva, r.card_credit, r.total, r.paid, r.balance, SETTLEMENT_BADGE[r.status][1], r.closed ? 'Sí' : 'No']),
  ]);

  return (
    <>
      <PageHeader eyebrow={brandMode ? data.brand.name : 'Todas las marcas'} title={isAdmin ? 'Liquidaciones' : 'Comisiones y cuotas'}>
        {!brandId && (
          <div className="flex items-center rounded-lg border border-line bg-card">
            <button className="p-2 text-ink2 hover:text-ink" onClick={() => setPeriod(shiftPeriod(period, -1))} aria-label="Mes anterior"><ChevronLeft size={16} /></button>
            <span className="min-w-[90px] text-center text-[13px] font-medium capitalize">{fmtPeriodShort(period)}</span>
            <button className="p-2 text-ink2 hover:text-ink disabled:opacity-30" disabled={period >= currentPeriod()} onClick={() => setPeriod(shiftPeriod(period, 1))} aria-label="Mes siguiente"><ChevronRight size={16} /></button>
          </div>
        )}
        <Button variant="outline" onClick={exportCSV} disabled={!rows.length}><Download size={15} />Exportar</Button>
      </PageHeader>

      <ErrorNote>{error}</ErrorNote>
      {loading && !data ? <Loading /> : data && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
            {brandMode ? <>
              <Stat label="Comisión de MAJA" value={fmtPct(data.brand.commission_pct)} sub="sobre lo vendido en el mes" />
              <Stat label="Cuota mensual" value={fmtMoney(data.brand.monthly_fee)} sub={data.brand.plus_iva ? 'más IVA' : 'monto fijo'} delay={50} />
              <Stat label="Saldo a pagar a MAJA" value={fmtMoney(owed)} tone={owed > 0 ? 'accent' : undefined} sub={owed > 0 ? `${rows.filter((r) => r.balance > 0.009).length} meses con saldo` : 'Al día'} delay={100} />
              <Stat label="A favor de la marca" value={fmtMoney(inFavor)} sub={inFavor > 0 ? 'MAJA cobró ventas tuyas en su POS' : 'Nada pendiente'} delay={150} />
            </> : <>
              <Stat label="Comisiones + cuotas" value={fmtMoney(rows.reduce((a, r) => a + r.charges, 0))} sub={`Vendido ${fmtMoney(rows.reduce((a, r) => a + r.sales_total, 0))}`} />
              <Stat label="Cobrado en el POS de MAJA" value={fmtMoney(credit)} sub="ventas de marcas, se descuenta" delay={50} />
              <Stat label="Saldo a cobrar" value={fmtMoney(owed)} tone={owed > 0 ? 'accent' : undefined} sub={`${rows.filter((r) => r.closed).length} de ${rows.length} cerradas`} delay={100} />
              <Stat label="MAJA debe a marcas" value={fmtMoney(inFavor)} sub={inFavor > 0 ? (() => { const n = rows.filter((r) => r.balance < -0.009).length; return n === 1 ? '1 marca con saldo a favor' : `${n} marcas con saldo a favor`; })() : 'Nada'} delay={150} />
            </>}
          </div>

          <Card className="rise overflow-hidden">
            {!rows.length ? (
              <Empty icon={Landmark} title="Sin liquidaciones">{isAdmin ? 'Aparecen cuando hay marcas activas en el mes.' : 'Todavía no hay meses para liquidar.'}</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="tbl">
                  <thead><tr><th>{brandMode ? 'Mes' : 'Marca'}</th><th className="text-right">Vendido</th><th className="text-right">Comisión + cuota</th><th className="text-right">Cobrado en POS MAJA</th><th className="text-right">Total</th><th className="text-right">Pagado</th><th className="text-right">Saldo</th><th>Estado</th></tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={`${r.brand_id}-${r.period}`} className="cursor-pointer" onClick={() => setDetail({ brand_id: r.brand_id, period: r.period })}>
                        <td className="whitespace-nowrap font-medium">
                          <span className={brandMode ? 'capitalize' : ''}>{brandMode ? fmtPeriod(r.period) : r.brand_name}</span>
                          {r.closed ? <Lock size={12} className="ml-1.5 inline text-muted" /> : r.period === currentPeriod() && <span className="ml-2 text-[11px] font-normal text-muted">en curso</span>}
                          {r.card_credit_changed && <AlertTriangle size={13} className="ml-1.5 inline text-warn" />}
                        </td>
                        <td className="num whitespace-nowrap text-right">{fmtMoney(r.sales_total)}<span className="block text-[11px] text-muted">{fmtInt(r.units)} u.</span></td>
                        <td className="num whitespace-nowrap text-right">{fmtMoney(r.charges)}<span className="block text-[11px] text-muted">{fmtPct(r.commission_pct)} + {fmtMoney(r.fee)}{r.iva ? ' + IVA' : ''}</span></td>
                        <td className={cx('num whitespace-nowrap text-right', r.card_credit > 0 ? 'text-ok' : 'text-muted')}>{r.card_credit > 0 ? `− ${fmtMoney(r.card_credit)}` : '—'}</td>
                        <td className="whitespace-nowrap text-right">{r.total < -0.009 ? <Balance value={r.total} /> : <span className="num font-semibold">{fmtMoney(r.total)}</span>}</td>
                        <td className="num whitespace-nowrap text-right text-ink2">{fmtMoney(r.paid)}</td>
                        <td className="whitespace-nowrap text-right"><Balance value={r.balance} /></td>
                        <td><Badge tone={SETTLEMENT_BADGE[r.status][0]}>{SETTLEMENT_BADGE[r.status][1]}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <p className="mt-4 max-w-3xl text-[13px] text-muted">
            Total del mes = comisión sobre lo vendido + cuota mensual{rows.some((r) => r.iva) ? ' + IVA' : ''} − lo que se cobró con tarjeta en el POS de MAJA por ventas de la marca (según los reportes de Handy conciliados).
            Si da negativo, MAJA le debe la diferencia a la marca. Mientras el mes está abierto se recalcula; al cerrarlo se congela.
          </p>
        </>
      )}

      {detail && <DetailModal {...detail} isAdmin={isAdmin} onClose={() => setDetail(null)} onChanged={reload} />}
    </>
  );
}

const escH = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Resumen mensual para la marca, listo para "Guardar como PDF" desde el diálogo de impresión. */
function printStatement(data, period) {
  const s = data.settlement;
  const m = (v) => escH(fmtMoney(v, true));
  const row = (l, v, strong) => `<tr${strong ? ' class="t"' : ''}><td>${escH(l)}</td><td class="n">${v}</td></tr>`;
  const w = window.open('', '_blank');
  if (!w) return alert('El navegador bloqueó la ventana: permití las ventanas emergentes para esta página.');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Resumen ${escH(s.brand_name)} ${escH(period)}</title><style>
    @page { size: A4; margin: 18mm 16mm }
    body { font-family: Arial, Helvetica, sans-serif; color: #1d1b18; font-size: 10.5pt; }
    h1 { font-family: Georgia, serif; font-weight: normal; font-size: 26pt; margin: 0; }
    .brand { font-family: Georgia, serif; font-size: 22pt; } .brand span { color: #7c2d23; }
    .muted { color: #6f685e; } h2 { font-size: 9pt; letter-spacing: .14em; text-transform: uppercase; color: #6f685e; margin: 22px 0 6px; }
    table { width: 100%; border-collapse: collapse; } td, th { padding: 6px 4px; border-bottom: 1px solid #e0d8ca; text-align: left; }
    th { font-size: 8pt; letter-spacing: .08em; text-transform: uppercase; color: #6f685e; } .n { text-align: right; white-space: nowrap; }
    tr.t td { font-weight: bold; border-top: 2px solid #1d1b18; font-size: 12pt; } header { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 24px; }
  </style></head><body>
    <header><div><div class="brand">MAJA<span>.</span></div><div class="muted">Multibrand</div></div>
      <div style="text-align:right"><h1>${escH(s.brand_name)}</h1><div class="muted">Liquidación de ${escH(fmtPeriod(period))}${s.closed ? '' : ' (en curso)'}</div></div></header>
    <h2>Resumen</h2>
    <table>
      ${row(`Vendido en el mes (${s.units} unidades)`, m(s.sales_total))}
      ${row(`Comisión MAJA (${s.commission_pct} %)`, m(s.commission))}
      ${row('Cuota mensual', m(s.fee))}
      ${s.iva ? row('IVA 22 %', m(s.iva)) : ''}
      ${row('Cobrado con tarjeta en el POS de MAJA (se descuenta)', `− ${m(s.card_credit)}`)}
      ${row(s.total >= 0 ? 'Total a pagar a MAJA' : 'MAJA le debe a la marca', m(Math.abs(s.total)), true)}
      ${row('Pagos registrados', m(Math.abs(s.paid)))}
      ${row(s.balance > 0.009 ? 'Saldo a pagar' : s.balance < -0.009 ? 'Saldo a favor de la marca' : 'Saldo', m(Math.abs(s.balance)), true)}
    </table>
    ${s.invoice_number ? `<p class="muted">Factura de MAJA: ${escH(s.invoice_number)}</p>` : ''}
    ${data.collections.length ? `<h2>Ventas de la marca cobradas en el POS de MAJA</h2><table><tr><th>Fecha</th><th>Tarjeta</th><th>Venta</th><th class="n">Importe</th><th class="n">Se descuenta</th></tr>
      ${data.collections.map((c) => `<tr><td>${escH(fmtDateTime(`${c.txn_at.replace(' ', 'T')}:00-03:00`))}</td><td>${escH(c.network)} ···${escH(String(c.card || '').slice(-4))}</td><td>#${c.sale_id}</td><td class="n">${m(c.amount)}</td><td class="n">${m(c.credit)}</td></tr>`).join('')}</table>` : ''}
    ${data.payments.length ? `<h2>Pagos</h2><table>${data.payments.map((p) => `<tr><td>${escH(fmtDate(p.paid_at))}</td><td>${p.amount < 0 ? 'MAJA pagó a la marca' : 'La marca pagó'}${p.method ? ` · ${escH(p.method)}` : ''}</td><td class="n">${m(Math.abs(p.amount))}</td></tr>`).join('')}</table>` : ''}
    <h2>Qué se vendió</h2>
    <table><tr><th>SKU</th><th>Artículo</th><th class="n">Unid.</th><th class="n">Importe</th></tr>
      ${data.products.map((p) => `<tr><td>${escH(p.sku)}</td><td>${escH(p.description)}</td><td class="n">${p.units}</td><td class="n">${m(p.total)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Sin ventas</td></tr>'}</table>
    <p class="muted" style="margin-top:28px;font-size:8.5pt">Emitido el ${escH(new Date().toLocaleDateString('es-UY'))}. Lo cobrado en el POS de MAJA se toma de los reportes de Handy (lo que efectivamente se acreditó).</p>
    <script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
}

/** Botones y estado de la factura de MAJA a la marca, el resumen y el aviso por WhatsApp. */
function InvoiceBar({ s, data, period, brandId, isOwner, onChanged }) {
  const { brands } = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const brand = brands.find((b) => b.id === brandId);
  const phone = String(brand?.phone || '').replace(/\D/g, '').replace(/^0/, '598');
  const waText = encodeURIComponent(`Hola! Te paso la liquidación de MAJA de ${fmtPeriod(period)}: ${s.total >= 0 ? `total a pagar ${fmtMoney(s.total, true)}` : `MAJA te debe ${fmtMoney(-s.total, true)}`}${Math.abs(s.balance) > 0.009 ? ` · saldo ${fmtMoney(Math.abs(s.balance), true)}${s.balance < 0 ? ' a tu favor' : ''}` : ''}. El detalle lo ves en la app, en Comisiones y cuotas.`);
  const pdf = async () => {
    const res = await fetch(`/api/settlements/invoice-pdf?brand_id=${brandId}&period=${period}`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!res.ok) return toast((await res.json().catch(() => ({}))).error || 'No se pudo bajar la factura', 'bad');
    window.open(URL.createObjectURL(await res.blob()), '_blank');
  };
  const run = async (key, fn, msg) => { setBusy(key); try { await fn(); toast(msg); onChanged(); } catch (e) { toast(e.message, 'bad'); } finally { setBusy(''); } };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2.5 text-[13px]">
      <FileText size={15} className="text-muted" />
      {s.invoice_number ? (
        <span>Factura de MAJA: <b>{s.invoice_number}</b>{s.has_invoice_pdf && <button onClick={pdf} className="ml-2 underline decoration-line underline-offset-2 hover:decoration-ink">PDF</button>}</span>
      ) : s.closed ? (
        isOwner ? <>
          <span className="text-ink2">{s.invoice_status === 'error' ? <span className="text-bad">Biller no la emitió: {s.invoice_error}</span> : 'Sin facturar'}</span>
          <Button size="sm" variant="outline" loading={busy === 'inv'} onClick={() => run('inv', () => api('/settlements/invoice', { method: 'POST', body: { brand_id: brandId, period } }), 'Factura emitida')}>Facturar con Biller</Button>
          <Button size="sm" variant="ghost" onClick={() => { const n = window.prompt('N° de la factura que le hiciste a la marca'); if (n) run('man', () => api('/settlements/invoice-manual', { method: 'POST', body: { brand_id: brandId, period, invoice_number: n } }), 'Factura anotada'); }}>Anotar n° a mano</Button>
        </> : <span className="text-muted">MAJA todavía no emitió la factura de este mes.</span>
      ) : <span className="text-muted">{isOwner ? 'Cerrá el mes para facturarle a la marca la comisión y la cuota.' : 'El mes está en curso.'}</span>}
      <span className="ml-auto flex gap-2">
        <Button size="sm" variant="outline" onClick={() => printStatement(data, period)}><Printer size={14} />Resumen PDF</Button>
        {isOwner && phone.length >= 8 && <a href={`https://wa.me/${phone}?text=${waText}`} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-card px-3 text-[13px] hover:border-ink/40"><MessageCircle size={14} />WhatsApp</a>}
      </span>
    </div>
  );
}

function DetailModal({ brand_id, period, isAdmin, onClose, onChanged }) {
  const toast = useToast();
  const { isOwner } = useSession();
  const { data, loading, reload } = useApi('/settlements/detail', { brand_id, period });
  const [pay, setPay] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const s = data?.settlement;

  const refresh = () => { reload(); onChanged(); };
  const act = async (key, fn, msg) => {
    setBusy(key);
    setError('');
    try { await fn(); toast(msg); refresh(); } catch (e) { setError(e.message); } finally { setBusy(''); }
  };

  const close = () => act('close', () => api('/settlements/close', { method: 'POST', body: { brand_id, period } }), 'Mes cerrado');
  const reopen = () => window.confirm('Al reabrir, los montos se vuelven a calcular con los datos actuales (ventas, comisión y cobros en el POS de MAJA). ¿Seguimos?') &&
    act('reopen', () => api('/settlements/reopen', { method: 'POST', body: { brand_id, period } }), 'Mes reabierto');
  // pay.toBrand: MAJA le paga a la marca → se guarda en negativo
  const savePay = () => act('pay', async () => {
    const amount = parseNum(pay.amount);
    await api('/payments', { method: 'POST', body: { ...pay, amount: pay.toBrand ? -Math.abs(amount ?? 0) : amount, brand_id, period } });
    setPay(null);
  }, 'Pago registrado');
  const delPay = (id) => window.confirm('¿Borrar este pago?') && act(`del${id}`, () => api(`/payments/${id}`, { method: 'DELETE' }), 'Pago borrado');

  const rows = s && [
    ['Vendido en el mes', fmtMoney(s.sales_total, true), `${fmtInt(s.units)} unidades`],
    [`Comisión MAJA (${fmtPct(s.commission_pct)})`, fmtMoney(s.commission, true)],
    ['Cuota mensual', fmtMoney(s.fee, true)],
    ...(s.iva ? [['IVA 22 %', fmtMoney(s.iva, true)]] : []),
  ];

  return (
    <Modal open wide title={s ? `${s.brand_name} · ${fmtPeriod(period)}` : 'Liquidación'} onClose={onClose}
      footer={isAdmin && s && (
        <div className="flex w-full flex-wrap justify-between gap-2">
          {s.closed
            ? <Button variant="outline" onClick={reopen} loading={busy === 'reopen'}><LockOpen size={15} />Reabrir mes</Button>
            : <Button variant="outline" onClick={close} loading={busy === 'close'} disabled={period === currentPeriod()} title={period === currentPeriod() ? 'Se cierra cuando termina el mes' : ''}><Lock size={15} />Cerrar mes</Button>}
          {!pay && s.balance > 0.009 && <Button variant="accent" onClick={() => setPay({ amount: String(s.balance), method: 'Transferencia', paid_at: todayISO(), note: '', toBrand: false })}><Plus size={15} />Registrar pago de la marca</Button>}
          {!pay && s.balance < -0.009 && <Button variant="accent" onClick={() => setPay({ amount: String(-s.balance), method: 'Transferencia', paid_at: todayISO(), note: '', toBrand: true })}><Plus size={15} />Registrar pago a la marca</Button>}
        </div>
      )}>
      {loading || !s ? <Loading /> : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={SETTLEMENT_BADGE[s.status][0]}>{SETTLEMENT_BADGE[s.status][1]}</Badge>
            {s.closed ? <Badge><Lock size={11} />Cerrada</Badge> : <Badge tone="warn">Abierta · se recalcula</Badge>}
          </div>
          <InvoiceBar s={s} data={data} period={period} brandId={brand_id} isOwner={isOwner} onChanged={() => { reload(); onChanged(); }} />
          {s.card_credit_changed && (
            <div className="flex items-start gap-2 rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              Después de cerrar el mes se conciliaron más cobros en el POS de MAJA: ahora suman {fmtMoney(s.card_credit_live, true)} y la liquidación cerrada tiene {fmtMoney(s.card_credit, true)}. Reabrí el mes para actualizarla.
            </div>
          )}

          <div className="grid gap-6 md:grid-cols-[1fr_1fr]">
            <div className="rounded-lg border border-line">
              {rows.map(([l, v, sub]) => (
                <div key={l} className="flex items-baseline justify-between border-b border-line px-4 py-2.5 text-[13px]">
                  <span className="text-ink2">{l}{sub && <span className="block text-[11px] text-muted">{sub}</span>}</span><span className="num">{v}</span>
                </div>
              ))}
              <div className="flex items-baseline justify-between border-b border-line px-4 py-2.5 text-[13px]">
                <span className="font-semibold">Comisión + cuota</span><span className="num font-semibold">{fmtMoney(s.charges, true)}</span>
              </div>
              <div className="flex items-baseline justify-between border-b border-line px-4 py-2.5 text-[13px]">
                <span className="text-ink2">Cobrado en el POS de MAJA<span className="block text-[11px] text-muted">ventas de la marca que entraron a MAJA</span></span>
                <span className={cx('num', s.card_credit > 0 && 'text-ok')}>− {fmtMoney(s.card_credit, true)}</span>
              </div>
              <div className="flex items-baseline justify-between border-b border-line bg-sunk/60 px-4 py-3">
                <span className="font-semibold">{s.total >= 0 ? 'Total a pagar a MAJA' : 'MAJA le debe a la marca'}</span>
                <span className="num font-display text-[26px] leading-none">{fmtMoney(Math.abs(s.total), true)}</span>
              </div>
              <div className="flex items-baseline justify-between border-b border-line px-4 py-2.5 text-[13px]"><span className="text-ink2">Pagos registrados</span><span className="num">{s.paid >= 0 ? '− ' : '+ '}{fmtMoney(Math.abs(s.paid), true)}</span></div>
              <div className="flex items-baseline justify-between px-4 py-3">
                <span className="font-semibold">Saldo</span><Balance value={s.balance} big />
              </div>
            </div>

            <div>
              <div className="eyebrow mb-2">Pagos</div>
              {!data.payments.length ? <div className="rounded-lg bg-sunk px-4 py-3 text-[13px] text-muted">Sin pagos registrados.</div> : (
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {data.payments.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
                      <span>{fmtDate(p.paid_at)} · {p.amount < 0 ? 'MAJA pagó a la marca' : 'La marca pagó'}{p.method && ` · ${p.method}`}{p.note && <span className="block text-[12px] text-muted">{p.note}</span>}</span>
                      <span className="flex items-center gap-2"><b className="num">{fmtMoney(Math.abs(p.amount), true)}</b>
                        {isAdmin && <button onClick={() => delPay(p.id)} className="rounded-md p-1 text-muted hover:bg-bad-soft hover:text-bad" aria-label="Borrar"><Trash2 size={13} /></button>}</span>
                    </li>
                  ))}
                </ul>
              )}
              {pay && (
                <div className="rise mt-3 space-y-3 rounded-lg border border-line p-4">
                  <div className="text-[13px] font-semibold">{pay.toBrand ? 'MAJA le paga a la marca' : 'La marca le paga a MAJA'}</div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Monto ($)"><Input inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} autoFocus /></Field>
                    <Field label="Fecha"><Input type="date" value={pay.paid_at} onChange={(e) => setPay({ ...pay, paid_at: e.target.value })} /></Field>
                    <Field label="Forma"><Select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>{PAY_METHODS.map((m) => <option key={m}>{m}</option>)}</Select></Field>
                    <Field label="Nota"><Input value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} placeholder="N° de transferencia…" /></Field>
                  </div>
                  <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => setPay(null)}>Cancelar</Button><Button size="sm" onClick={savePay} loading={busy === 'pay'}>Guardar pago</Button></div>
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <div className="eyebrow flex items-center gap-1.5"><CreditCard size={13} />Cobros de la marca en el POS de MAJA</div>
              {isOwner && <Link to="/tarjetas" className="text-[12px] text-ink2 underline decoration-line underline-offset-2 hover:text-ink">Ir a la conciliación</Link>}
            </div>
            {!data.collections.length ? (
              <div className="rounded-lg bg-sunk px-4 py-3 text-[13px] text-muted">Ninguno en este mes, según los reportes de Handy conciliados.</div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="tbl">
                  <thead><tr><th>Cobro</th><th>Tarjeta</th><th>Venta</th><th className="text-right">Importe</th><th className="text-right">Descuentos de Handy</th><th className="text-right">Se descuenta</th></tr></thead>
                  <tbody>
                    {data.collections.map((c) => (
                      <tr key={c.id}>
                        <td className="whitespace-nowrap text-[13px]">{fmtDateTime(`${c.txn_at.replace(' ', 'T')}:00-03:00`)}</td>
                        <td className="text-[13px]">{c.network} ···{String(c.card || '').slice(-4)}<span className="block text-[11px] text-muted">{c.movement}</span></td>
                        <td className="text-[13px]">#{c.sale_id}{c.registered_pos === 'marca' && <span className="block text-[11px] font-semibold text-warn">anotada en el POS de la marca</span>}</td>
                        <td className="num text-right">{fmtMoney(c.amount, true)}</td>
                        <td className="num text-right text-muted">{fmtMoney(c.amount - c.credit, true)}</td>
                        <td className="num text-right font-semibold">{fmtMoney(c.credit, true)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-2 text-[12px] text-muted">Se descuenta lo que Handy le acreditó a MAJA (el importe menos su comisión y la devolución de IVA), que es la plata que efectivamente entró.</p>
          </div>

          <div>
            <div className="eyebrow mb-2">Qué se vendió</div>
            {!data.products.length ? <div className="text-[13px] text-muted">Sin ventas en el mes.</div> : (
              <div className="max-h-64 overflow-y-auto rounded-lg border border-line">
                <table className="tbl">
                  <thead><tr><th>SKU</th><th>Artículo</th><th className="text-right">Unid.</th><th className="text-right">Importe</th></tr></thead>
                  <tbody>{data.products.map((p, i) => <tr key={i}><td className="font-mono text-[12px] text-ink2">{p.sku}</td><td>{p.description}</td><td className="num text-right">{p.units}</td><td className="num text-right">{fmtMoney(p.total)}</td></tr>)}</tbody>
                </table>
              </div>
            )}
          </div>
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
    </Modal>
  );
}
