import { useState } from 'react';
import { ChevronLeft, ChevronRight, CreditCard, Download, Landmark, Lock, LockOpen, Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi, useSession } from '../lib/session.jsx';
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Loading, Modal, PageHeader, Select, Stat, useToast, SETTLEMENT_BADGE } from '../components/ui.jsx';
import { currentPeriod, downloadCSV, fmtDate, fmtInt, fmtMoney, fmtPct, fmtPeriod, fmtPeriodShort, shiftPeriod, todayISO } from '../lib/format.js';

const PAY_METHODS = ['Transferencia', 'Efectivo', 'Descuento de ventas', 'Otro'];

export default function Settlements() {
  const { isAdmin, brandId } = useSession();
  const [period, setPeriod] = useState(currentPeriod());
  const { data, error, loading, reload } = useApi('/settlements', brandId ? { brand_id: brandId } : { period });
  const [detail, setDetail] = useState(null);

  const rows = data?.rows || [];
  const owed = rows.reduce((a, r) => a + Math.max(0, r.balance), 0);
  const brandMode = data?.mode === 'brand';

  const exportCSV = () => downloadCSV(brandMode ? `liquidaciones-${data.brand.name}.csv` : `liquidaciones-${period}.csv`, [
    ['Mes', 'Marca', 'Vendido', 'Unidades', 'Comisión %', 'Comisión', 'Cuota', 'IVA', 'Total', 'Pagado', 'Saldo', 'Estado', 'Cerrada'],
    ...rows.map((r) => [r.period, r.brand_name, r.sales_total, r.units, r.commission_pct, r.commission, r.fee, r.iva, r.total, r.paid, r.balance, SETTLEMENT_BADGE[r.status][1], r.closed ? 'Sí' : 'No']),
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
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {brandMode ? <>
              <Stat label="Comisión de MAJA" value={fmtPct(data.brand.commission_pct)} sub="sobre lo vendido en el mes" />
              <Stat label="Cuota mensual" value={fmtMoney(data.brand.monthly_fee)} sub={data.brand.plus_iva ? 'más IVA' : 'monto fijo'} delay={50} />
              <Stat label="Este mes (hasta hoy)" value={fmtMoney(rows[0]?.total ?? 0)} sub={rows[0] ? `Comisión ${fmtMoney(rows[0].commission)} · cuota ${fmtMoney(rows[0].fee)}` : null} delay={100} />
              <Stat label="Saldo pendiente" value={fmtMoney(owed)} tone={owed > 0 ? 'accent' : undefined} sub={owed > 0 ? `${rows.filter((r) => r.balance > 0.009).length} meses con saldo` : 'Al día'} delay={150} />
            </> : <>
              <Stat label="Vendido en el mes" value={fmtMoney(rows.reduce((a, r) => a + r.sales_total, 0))} />
              <Stat label="Comisiones" value={fmtMoney(rows.reduce((a, r) => a + r.commission, 0))} delay={50} />
              <Stat label="Cuotas" value={fmtMoney(rows.reduce((a, r) => a + r.fee, 0))} delay={100} />
              <Stat label="Saldo a cobrar del mes" value={fmtMoney(owed)} tone={owed > 0 ? 'accent' : undefined} sub={`${rows.filter((r) => r.closed).length} de ${rows.length} cerradas`} delay={150} />
            </>}
          </div>

          <Card className="rise overflow-hidden">
            {!rows.length ? (
              <Empty icon={Landmark} title="Sin liquidaciones">{isAdmin ? 'Aparecen cuando hay marcas activas en el mes.' : 'Todavía no hay meses para liquidar.'}</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="tbl">
                  <thead><tr><th>{brandMode ? 'Mes' : 'Marca'}</th><th className="text-right">Vendido</th><th className="text-right">Comisión</th><th className="text-right">Cuota</th><th className="text-right">IVA</th><th className="text-right">Total</th><th className="text-right">Pagado</th><th className="text-right">Saldo</th><th>Estado</th></tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={`${r.brand_id}-${r.period}`} className="cursor-pointer" onClick={() => setDetail({ brand_id: r.brand_id, period: r.period })}>
                        <td className="whitespace-nowrap font-medium">
                          <span className={brandMode ? 'capitalize' : ''}>{brandMode ? fmtPeriod(r.period) : r.brand_name}</span>
                          {r.closed ? <Lock size={12} className="ml-1.5 inline text-muted" /> : r.period === currentPeriod() && <span className="ml-2 text-[11px] font-normal text-muted">en curso</span>}
                        </td>
                        <td className="num text-right">{fmtMoney(r.sales_total)}<span className="block text-[11px] text-muted">{fmtInt(r.units)} u.</span></td>
                        <td className="num text-right">{fmtMoney(r.commission)}<span className="block text-[11px] text-muted">{fmtPct(r.commission_pct)}</span></td>
                        <td className="num text-right">{fmtMoney(r.fee)}</td>
                        <td className="num text-right text-muted">{r.iva ? fmtMoney(r.iva) : '—'}</td>
                        <td className="num text-right font-semibold">{fmtMoney(r.total)}</td>
                        <td className="num text-right text-ink2">{fmtMoney(r.paid)}</td>
                        <td className={`num text-right font-semibold ${r.balance > 0.009 ? 'text-accent' : 'text-muted'}`}>{fmtMoney(r.balance)}</td>
                        <td><Badge tone={SETTLEMENT_BADGE[r.status][0]}>{SETTLEMENT_BADGE[r.status][1]}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <p className="mt-4 max-w-3xl text-[13px] text-muted">
            Total del mes = comisión sobre lo vendido + cuota mensual{rows.some((r) => r.iva) ? ' + IVA cuando corresponde' : ''}. Mientras el mes está abierto se recalcula con cada venta; al cerrarlo, MAJA congela los montos.
          </p>
        </>
      )}

      {detail && <DetailModal {...detail} isAdmin={isAdmin} onClose={() => setDetail(null)} onChanged={reload} />}
    </>
  );
}

function DetailModal({ brand_id, period, isAdmin, onClose, onChanged }) {
  const toast = useToast();
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
  const reopen = () => window.confirm('Al reabrir, los montos se vuelven a calcular con los datos actuales de la marca. ¿Seguimos?') &&
    act('reopen', () => api('/settlements/reopen', { method: 'POST', body: { brand_id, period } }), 'Mes reabierto');
  const savePay = () => act('pay', async () => { await api('/payments', { method: 'POST', body: { ...pay, brand_id, period } }); setPay(null); }, 'Pago registrado');
  const delPay = (id) => window.confirm('¿Borrar este pago?') && act(`del${id}`, () => api(`/payments/${id}`, { method: 'DELETE' }), 'Pago borrado');

  return (
    <Modal open wide title={s ? `${s.brand_name} · ${fmtPeriod(period)}` : 'Liquidación'} onClose={onClose}
      footer={isAdmin && s && (
        <div className="flex w-full flex-wrap justify-between gap-2">
          {s.closed
            ? <Button variant="outline" onClick={reopen} loading={busy === 'reopen'}><LockOpen size={15} />Reabrir mes</Button>
            : <Button variant="outline" onClick={close} loading={busy === 'close'} disabled={period === currentPeriod()} title={period === currentPeriod() ? 'Se cierra cuando termina el mes' : ''}><Lock size={15} />Cerrar mes</Button>}
          {s.balance > 0.009 && !pay && <Button variant="accent" onClick={() => setPay({ amount: String(s.balance), method: 'Transferencia', paid_at: todayISO(), note: '' })}><Plus size={15} />Registrar pago</Button>}
        </div>
      )}>
      {loading || !s ? <Loading /> : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={SETTLEMENT_BADGE[s.status][0]}>{SETTLEMENT_BADGE[s.status][1]}</Badge>
            {s.closed ? <Badge><Lock size={11} />Cerrada</Badge> : <Badge tone="warn">Abierta · se recalcula con cada venta</Badge>}
          </div>

          <div className="grid gap-6 md:grid-cols-[1fr_1fr]">
            <div className="rounded-lg border border-line">
              {[
                ['Vendido en el mes', fmtMoney(s.sales_total, true), `${fmtInt(s.units)} unidades`],
                [`Comisión MAJA (${fmtPct(s.commission_pct)})`, fmtMoney(s.commission, true)],
                ['Cuota mensual', fmtMoney(s.fee, true)],
                ...(s.iva ? [['IVA 22 %', fmtMoney(s.iva, true)]] : []),
              ].map(([l, v, sub]) => (
                <div key={l} className="flex items-baseline justify-between border-b border-line px-4 py-2.5 text-[13px]">
                  <span className="text-ink2">{l}{sub && <span className="block text-[11px] text-muted">{sub}</span>}</span><span className="num">{v}</span>
                </div>
              ))}
              <div className="flex items-baseline justify-between border-b border-line bg-sunk/60 px-4 py-3">
                <span className="font-semibold">Total a pagar a MAJA</span><span className="num font-display text-[26px] leading-none">{fmtMoney(s.total, true)}</span>
              </div>
              <div className="flex items-baseline justify-between border-b border-line px-4 py-2.5 text-[13px]"><span className="text-ink2">Pagado</span><span className="num">− {fmtMoney(s.paid, true)}</span></div>
              <div className="flex items-baseline justify-between px-4 py-3">
                <span className="font-semibold">Saldo</span><span className={`num font-display text-[26px] leading-none ${s.balance > 0.009 ? 'text-accent' : ''}`}>{fmtMoney(s.balance, true)}</span>
              </div>
            </div>

            <div>
              <div className="eyebrow mb-2">Pagos</div>
              {!data.payments.length ? <div className="rounded-lg bg-sunk px-4 py-3 text-[13px] text-muted">Sin pagos registrados.</div> : (
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {data.payments.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
                      <span>{fmtDate(p.paid_at)}{p.method && ` · ${p.method}`}{p.note && <span className="block text-[12px] text-muted">{p.note}</span>}</span>
                      <span className="flex items-center gap-2"><b className="num">{fmtMoney(p.amount, true)}</b>
                        {isAdmin && <button onClick={() => delPay(p.id)} className="rounded-md p-1 text-muted hover:bg-bad-soft hover:text-bad" aria-label="Borrar"><Trash2 size={13} /></button>}</span>
                    </li>
                  ))}
                </ul>
              )}
              {pay && (
                <div className="rise mt-3 space-y-3 rounded-lg border border-line p-4">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Monto ($)"><Input inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} autoFocus /></Field>
                    <Field label="Fecha"><Input type="date" value={pay.paid_at} onChange={(e) => setPay({ ...pay, paid_at: e.target.value })} /></Field>
                    <Field label="Forma"><Select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>{PAY_METHODS.map((m) => <option key={m}>{m}</option>)}</Select></Field>
                    <Field label="Nota"><Input value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} placeholder="N° de factura…" /></Field>
                  </div>
                  <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => setPay(null)}>Cancelar</Button><Button size="sm" onClick={savePay} loading={busy === 'pay'}>Guardar pago</Button></div>
                </div>
              )}
            </div>
          </div>

          {data.card_maja?.count > 0 && (
            <div className="flex items-start gap-3 rounded-lg border border-line bg-sunk/60 px-4 py-3 text-[13px]">
              <CreditCard size={16} className="mt-0.5 shrink-0 text-muted" />
              <span>
                <b className="num">{fmtMoney(data.card_maja.total, true)}</b> de ventas de {s.brand_name} se cobraron con tarjeta en el <b>POS de MAJA</b> ({data.card_maja.count} {data.card_maja.count === 1 ? 'cobro' : 'cobros'}, según los reportes de Handy). Esa plata entró a MAJA, no a la marca.
              </span>
            </div>
          )}
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
