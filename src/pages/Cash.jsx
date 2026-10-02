import { useState } from 'react';
import { Lock, LockOpen, Plus, Minus, Wallet, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi, useSession } from '../lib/session.jsx';
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Loading, PageHeader, Select, Stat, Textarea, useToast, cx } from '../components/ui.jsx';
import { fmtDate, fmtDateTime, fmtMoney, parseNum, todayISO } from '../lib/format.js';

export default function Cash() {
  const { isOwner } = useSession();
  const toast = useToast();
  const [date, setDate] = useState(todayISO());
  const { data, loading, reload } = useApi('/cash', { date });
  const [float, setFloat] = useState('');
  const [mov, setMov] = useState({ kind: 'retiro', amount: '', reason: '' });
  const [close, setClose] = useState({ counted_cash: '', notes: '' });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const isToday = date === todayISO();

  const act = async (key, fn, msg) => {
    setBusy(key);
    setError('');
    try { const r = await fn(); toast(typeof msg === 'function' ? msg(r) : msg); reload(); } catch (e) { setError(e.message); } finally { setBusy(''); }
  };

  if (loading && !data) return <Loading />;
  const s = data?.session;
  const counted = parseNum(close.counted_cash);
  const preview = s && counted !== null ? Math.round((counted - s.expected_now) * 100) / 100 : null;

  return (
    <>
      <PageHeader eyebrow={s ? (s.status === 'abierta' ? 'Caja abierta' : 'Caja cerrada') : 'Caja'} title={isToday ? 'Caja de hoy' : `Caja del ${fmtDate(date)}`}>
        <Input type="date" className="w-auto" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
      </PageHeader>
      <ErrorNote>{error}</ErrorNote>

      {!s ? (
        <Card className="rise">
          <Empty icon={Wallet} title={isToday ? 'La caja de hoy no está abierta' : 'Ese día no se abrió la caja'}
            action={isToday && (
              <div className="flex items-end justify-center gap-2">
                <Field label="Fondo con el que arranca ($)"><Input className="w-40" inputMode="decimal" value={float} onChange={(e) => setFloat(e.target.value)} placeholder="0" autoFocus /></Field>
                <Button onClick={() => act('open', () => api('/cash/open', { method: 'POST', body: { opening_float: parseNum(float) ?? 0 } }), 'Caja abierta')} loading={busy === 'open'}><LockOpen size={15} />Abrir caja</Button>
              </div>
            )}>
            {isToday && 'Al empezar el día, contá el efectivo que hay para dar cambio y abrí la caja. Al cerrar, el sistema compara lo que contás con lo que debería haber.'}
          </Empty>
          {data.day.by_method.length > 0 && <div className="px-6 pb-6"><ByMethod rows={data.day.by_method} /></div>}
        </Card>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
            <Stat label="Fondo inicial" value={fmtMoney(s.opening_float)} sub={`${s.opened_by_name ?? ''} · ${fmtDateTime(s.opened_at)}`} />
            <Stat label="Ventas en efectivo" value={fmtMoney(s.cash_sales)} sub="lo cobrado; en cambios, la diferencia" delay={50} />
            <Stat label="Entradas − salidas" value={fmtMoney(s.ins - s.outs)} sub={`+${fmtMoney(s.ins)} / −${fmtMoney(s.outs)}`} delay={100} />
            <Stat label={s.status === 'cerrada' ? 'Diferencia al cerrar' : 'Debería haber'} value={s.status === 'cerrada' ? fmtMoney(s.difference) : fmtMoney(s.expected_now)}
              tone={s.status === 'cerrada' && Math.abs(s.difference) > 0.009 ? 'bad' : undefined}
              sub={s.status === 'cerrada' ? `Contó ${fmtMoney(s.counted_cash)} · esperaba ${fmtMoney(s.expected_cash)}` : 'en la caja, en efectivo'} delay={150} />
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
            <div className="space-y-6">
              <Card className="rise overflow-hidden">
                <div className="flex items-center justify-between px-5 pb-2 pt-5"><div className="eyebrow">Entradas y salidas de efectivo</div></div>
                {!s.movements.length ? <div className="px-5 pb-5 text-[13px] text-muted">Ninguna. Anotá acá lo que sale de la caja que no sea una venta (flete, compras, retiro de la dueña) o lo que entra (cambio).</div> : (
                  <ul className="divide-y divide-line">
                    {s.movements.map((m) => (
                      <li key={m.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-[13px]">
                        <span>{m.reason}<span className="block text-[12px] text-muted">{m.user_name} · {fmtDateTime(m.created_at)}</span></span>
                        <span className={cx('num font-semibold', m.kind === 'ingreso' ? 'text-ok' : 'text-bad')}>{m.kind === 'ingreso' ? '+' : '−'}{fmtMoney(m.amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {s.status === 'abierta' && (
                  <div className="flex flex-wrap items-end gap-2 border-t border-line bg-paper/50 px-5 py-3">
                    <Select className="h-9 w-32 py-1" value={mov.kind} onChange={(e) => setMov({ ...mov, kind: e.target.value })}><option value="retiro">Sale</option><option value="ingreso">Entra</option></Select>
                    <Input className="h-9 w-28" inputMode="decimal" placeholder="$" value={mov.amount} onChange={(e) => setMov({ ...mov, amount: e.target.value })} />
                    <Input className="h-9 min-w-[180px] flex-1" placeholder="Motivo" value={mov.reason} onChange={(e) => setMov({ ...mov, reason: e.target.value })} />
                    <Button size="sm" loading={busy === 'mov'} disabled={!mov.amount || !mov.reason.trim()}
                      onClick={() => act('mov', async () => { await api('/cash/movements', { method: 'POST', body: { ...mov, amount: parseNum(mov.amount) } }); setMov({ kind: 'retiro', amount: '', reason: '' }); }, 'Anotado')}>
                      {mov.kind === 'retiro' ? <Minus size={14} /> : <Plus size={14} />}Anotar
                    </Button>
                  </div>
                )}
              </Card>
              <Card className="rise p-5"><ByMethod rows={s.by_method} /></Card>
            </div>

            <Card className="rise p-5">
              {s.status === 'abierta' ? (
                <div className="space-y-4">
                  <div className="eyebrow flex items-center gap-1.5"><Lock size={13} />Cerrar la caja</div>
                  <p className="text-[13px] text-ink2">Contá todo el efectivo de la caja (incluido el fondo) y anotá el total. No mires el número del sistema antes de contar.</p>
                  <Field label="Efectivo contado ($)"><Input className="num text-[18px]" inputMode="decimal" value={close.counted_cash} onChange={(e) => setClose({ ...close, counted_cash: e.target.value })} /></Field>
                  {preview !== null && (
                    <div className={cx('flex items-center gap-2 rounded-lg px-3 py-2 text-[13px]', Math.abs(preview) < 0.01 ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad')}>
                      {Math.abs(preview) < 0.01 ? <><CheckCircle2 size={15} />Coincide con el sistema</> : <><AlertTriangle size={15} />{preview > 0 ? 'Sobran' : 'Faltan'} {fmtMoney(Math.abs(preview))}</>}
                    </div>
                  )}
                  <Field label="Nota" hint={preview && Math.abs(preview) >= 0.01 ? 'Si hay diferencia, contá qué pasó: le llega a la dueña' : undefined}><Textarea value={close.notes} onChange={(e) => setClose({ ...close, notes: e.target.value })} /></Field>
                  <Button className="w-full" loading={busy === 'close'} disabled={counted === null}
                    onClick={() => act('close', () => api('/cash/close', { method: 'POST', body: { date, counted_cash: counted, notes: close.notes } }), (r) => (Math.abs(r.difference) < 0.01 ? 'Caja cerrada sin diferencias' : `Caja cerrada con diferencia de ${fmtMoney(r.difference)}`))}>
                    <Lock size={15} />Cerrar caja
                  </Button>
                </div>
              ) : (
                <div className="space-y-3 text-[13px]">
                  <div className="eyebrow">Cierre</div>
                  <div className="flex justify-between"><span className="text-muted">Cerró</span><span>{s.closed_by_name} · {fmtDateTime(s.closed_at)}</span></div>
                  <div className="flex justify-between"><span className="text-muted">Contó</span><span className="num font-semibold">{fmtMoney(s.counted_cash)}</span></div>
                  <div className="flex justify-between"><span className="text-muted">Esperado</span><span className="num">{fmtMoney(s.expected_cash)}</span></div>
                  <div className="flex justify-between"><span className="text-muted">Diferencia</span><Badge tone={Math.abs(s.difference) < 0.01 ? 'ok' : 'bad'}>{fmtMoney(s.difference)}</Badge></div>
                  {s.notes && <p className="rounded-md bg-sunk px-3 py-2 text-ink2">{s.notes}</p>}
                  {isOwner && <Button variant="outline" size="sm" loading={busy === 'reopen'} onClick={() => act('reopen', () => api('/cash/reopen', { method: 'POST', body: { date } }), 'Caja reabierta')}><LockOpen size={14} />Reabrir</Button>}
                </div>
              )}
            </Card>
          </div>
        </>
      )}

      {data.history.length > 0 && (
        <Card className="rise mt-6 overflow-hidden">
          <div className="px-5 pb-2 pt-5"><div className="eyebrow">Últimas cajas</div></div>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Día</th><th>Estado</th><th className="text-right">Esperado</th><th className="text-right">Contado</th><th className="text-right">Diferencia</th><th>Cerró</th></tr></thead>
              <tbody>
                {data.history.map((h) => (
                  <tr key={h.date} className="cursor-pointer" onClick={() => setDate(h.date)}>
                    <td>{fmtDate(h.date)}</td>
                    <td><Badge tone={h.status === 'abierta' ? 'warn' : 'neutral'}>{h.status === 'abierta' ? 'Abierta' : 'Cerrada'}</Badge></td>
                    <td className="num text-right">{h.expected_cash !== null ? fmtMoney(h.expected_cash) : '—'}</td>
                    <td className="num text-right">{h.counted_cash !== null ? fmtMoney(h.counted_cash) : '—'}</td>
                    <td className={cx('num text-right font-semibold', h.difference !== null && Math.abs(h.difference) >= 0.01 ? 'text-bad' : 'text-muted')}>{h.difference !== null ? fmtMoney(h.difference) : '—'}</td>
                    <td className="text-[13px] text-ink2">{h.closed_by_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

function ByMethod({ rows }) {
  return (
    <div>
      <div className="eyebrow mb-3">Lo cobrado en el día por medio</div>
      {!rows.length ? <div className="text-[13px] text-muted">Sin ventas.</div> : (
        <ul className="space-y-1.5 text-[13px]">
          {rows.map((r) => (
            <li key={r.method} className="flex justify-between gap-3"><span>{r.method} <span className="text-muted">· {r.count}</span></span><span className="num font-semibold">{fmtMoney(r.total)}</span></li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[12px] text-muted">Con tarjeta: compará con el cierre de cada POS. Lo anotado en el POS de MAJA tiene que coincidir con su cierre de Handy.</p>
    </div>
  );
}
