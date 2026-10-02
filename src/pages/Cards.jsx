import { useMemo, useState } from 'react';
import { CreditCard, Upload, RefreshCw, Wrench, Unlink, EyeOff, Eye, Info } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi, useSession } from '../lib/session.jsx';
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Loading, PageHeader, Select, Stat, Tabs, useToast, cx } from '../components/ui.jsx';
import { fmtDate, fmtDateTime, fmtInt, fmtMoney } from '../lib/format.js';

const STATUS = {
  ok: ['ok', 'Conciliada'],
  pos_equivocado: ['bad', 'POS equivocado'],
  otra_marca: ['bad', 'POS de otra marca'],
  medio_equivocado: ['warn', 'Medio de pago equivocado'],
  tipo_equivocado: ['warn', 'Débito / crédito cruzado'],
  sin_venta: ['warn', 'Sin venta en el sistema'],
  sin_asignar: ['neutral', 'POS sin asignar'],
  venta_anulada: ['warn', 'La venta está anulada'],
  devolucion: ['neutral', 'Devolución'],
  ignorada: ['neutral', 'Descartada'],
};
const REVIEW = ['pos_equivocado', 'otra_marca', 'medio_equivocado', 'tipo_equivocado', 'sin_venta', 'sin_asignar', 'venta_anulada'];
const posLabel = (pos, brand) => (pos === 'maja' ? 'POS de MAJA' : pos === 'marca' ? `POS de ${brand || 'la marca'}` : 'sin POS');

function explain(t) {
  const s = t.sale;
  switch (t.status) {
    case 'pos_equivocado': return `Se anotó en el ${posLabel(s.pos, s.brand_name)}, pero se cobró en el ${t.owner_label}.`;
    case 'otra_marca': return `Es una venta de ${s.brand_name}, pero se cobró en el ${t.owner_label}: la plata le entró a otra marca.`;
    case 'medio_equivocado': return `Se anotó como ${s.payment_method}, pero se pagó con tarjeta.`;
    case 'tipo_equivocado': return `Se anotó como ${s.payment_method} y Handy dice ${t.movement}.`;
    case 'sin_venta': return t.candidates?.length ? 'No se unió sola: hay más de una venta posible. Elegí cuál es.' : 'Ninguna venta del sistema coincide en importe y fecha. ¿Se olvidaron de registrarla?';
    case 'sin_asignar': return 'Todavía no indicaste de quién es esta terminal (arriba, en POS).';
    case 'venta_anulada': return 'Está unida a una venta que después se anuló.';
    default: return null;
  }
}

async function readExcel(file) {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  return wb.SheetNames.map((name) => ({ name, rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null }) }));
}

export default function Cards() {
  const toast = useToast();
  const { brands } = useSession();
  const [range, setRange] = useState({ from: '', to: '' });
  const [tab, setTab] = useState('revisar');
  const { data, error, loading, reload } = useApi('/cards/txns', { from: range.from, to: range.to });
  const terms = useApi('/cards/terminals');
  const [busy, setBusy] = useState('');

  const txns = data?.txns || [];
  const counts = useMemo(() => ({
    revisar: txns.filter((t) => REVIEW.includes(t.status)).length,
    ok: txns.filter((t) => t.status === 'ok').length,
  }), [txns]);
  const shown = tab === 'revisar' ? txns.filter((t) => REVIEW.includes(t.status)) : tab === 'ok' ? txns.filter((t) => t.status === 'ok') : txns;
  const refresh = () => { reload(); terms.reload(); };

  const upload = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    for (const f of files) {
      setBusy('upload');
      try {
        const sheets = await readExcel(f);
        const r = await api('/cards/import', { method: 'POST', body: { filename: f.name, sheets } });
        toast(`${f.name}: ${r.added} cobros nuevos (${r.rows - r.added} ya estaban) · ${r.matched} unidos a ventas`);
      } catch (err) { toast(`${f.name}: ${err.message}`, 'bad'); }
    }
    setBusy('');
    refresh();
  };

  const act = async (key, fn, msg) => {
    setBusy(key);
    try { await fn(); if (msg) toast(msg); refresh(); } catch (e) { toast(e.message, 'bad'); } finally { setBusy(''); }
  };

  const unassigned = (terms.data || []).filter((t) => !t.owner).length;

  return (
    <>
      <PageHeader eyebrow="Reportes de Handy contra las ventas registradas" title="Conciliación de tarjetas">
        <Button variant="outline" onClick={() => act('re', () => api('/cards/reconcile', { method: 'POST' }), 'Conciliación actualizada')} loading={busy === 're'} disabled={!txns.length}><RefreshCw size={15} />Volver a cruzar</Button>
        <label className={cx('inline-flex h-9 cursor-pointer items-center gap-2 rounded-md bg-ink px-4 text-[14px] font-medium text-paper hover:bg-[#33302b]', busy === 'upload' && 'pointer-events-none opacity-60')}>
          <Upload size={15} />{busy === 'upload' ? 'Leyendo…' : 'Subir reporte de Handy'}
          <input type="file" accept=".xlsx,.xls" multiple className="hidden" onChange={upload} />
        </label>
      </PageHeader>

      {/* terminales */}
      <Card className="rise mb-6 overflow-hidden">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pb-2 pt-5">
          <div>
            <div className="eyebrow">POS</div>
            <div className="mt-1 text-[13px] text-muted">De quién es cada terminal que aparece en los reportes. Subí el reporte de cada POS (el de MAJA y el de cada marca).</div>
          </div>
          {unassigned > 0 && <Badge tone="warn">{unassigned} sin asignar</Badge>}
        </div>
        {!terms.data?.length ? <div className="px-5 pb-5 text-[13px] text-muted">Todavía no subiste ningún reporte.</div> : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Terminal</th><th>Sucursal en Handy</th><th className="text-right">Cobros</th><th>Último</th><th className="w-64">Es el POS de</th></tr></thead>
              <tbody>
                {terms.data.map((t) => (
                  <tr key={t.terminal}>
                    <td className="font-mono text-[12px]">{t.terminal}</td>
                    <td>{t.sucursal || '—'}</td>
                    <td className="num text-right">{fmtInt(t.txns)}</td>
                    <td className="text-[13px] text-muted">{t.last_date ? fmtDate(t.last_date) : '—'}</td>
                    <td>
                      <Select className={cx('h-9 py-1', !t.owner && 'border-warn')} value={t.owner === 'maja' ? 'maja' : t.owner === 'marca' ? String(t.brand_id) : ''}
                        onChange={(e) => { const v = e.target.value; act(`t${t.terminal}`, () => api(`/cards/terminals/${encodeURIComponent(t.terminal)}`, { method: 'PUT', body: v === 'maja' ? { owner: 'maja' } : v ? { owner: 'marca', brand_id: v } : { owner: null } }), 'POS actualizado'); }}>
                        <option value="">Sin asignar…</option>
                        <option value="maja">MAJA</option>
                        {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ErrorNote>{error}</ErrorNote>
      {loading && !data ? <Loading /> : !txns.length && !data?.unpaid?.length ? (
        <Card><Empty icon={CreditCard} title="Subí el primer reporte">
          En Handy: Actividad → elegí las fechas → Exportar a Excel. Se cruza cada cobro con las ventas registradas (importe, fecha, hora y n° de factura) y quedan marcadas las que se anotaron en el POS equivocado.
        </Empty></Card>
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-end gap-3">
            <Field label="Desde"><Input type="date" value={range.from || data?.from || ''} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>
            <Field label="Hasta"><Input type="date" value={range.to || data?.to || ''} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field>
          </div>

          <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
            <Stat label="Cobros con tarjeta" value={fmtInt(txns.length)} sub={fmtMoney(txns.reduce((a, t) => a + (t.currency === 'UYU' ? t.amount : 0), 0))} />
            <Stat label="Conciliados" value={fmtInt(counts.ok)} delay={50} />
            <Stat label="Para revisar" value={fmtInt(counts.revisar)} tone={counts.revisar ? 'accent' : undefined} delay={100} />
            <Stat label="Ventas con tarjeta sin cobro" value={fmtInt(data.unpaid.length)} sub="no aparecen en los reportes" delay={150} />
          </div>

          {data.by_brand.length > 0 && (
            <Card className="rise mb-6 overflow-hidden">
              <div className="px-5 pb-2 pt-5"><div className="eyebrow">Dónde entró la plata de cada marca</div></div>
              <div className="overflow-x-auto">
                <table className="tbl">
                  <thead><tr><th>Marca</th><th className="text-right">En su POS</th><th className="text-right">En el POS de MAJA</th><th className="text-right">En el POS de otra marca</th></tr></thead>
                  <tbody>
                    {data.by_brand.map((b) => (
                      <tr key={b.brand_id}>
                        <td className="font-medium">{b.brand_name}</td>
                        <td className="num text-right">{fmtMoney(b.own)}</td>
                        <td className={cx('num text-right', b.maja > 0 && 'font-semibold text-accent')}>{fmtMoney(b.maja)}</td>
                        <td className={cx('num text-right', b.other > 0 && 'font-semibold text-bad')}>{fmtMoney(b.other)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="px-5 pb-4 pt-2 text-[12px] text-muted">Solo cobros unidos a una venta. Lo cobrado en el POS de MAJA entró a la cuenta de MAJA y es plata de la marca.</p>
            </Card>
          )}

          <div className="mb-4">
            <Tabs value={tab} onChange={setTab} options={[{ value: 'revisar', label: 'Para revisar', count: counts.revisar }, { value: 'ok', label: 'Conciliados', count: counts.ok }, { value: 'sin_cobro', label: 'Ventas sin cobro', count: data.unpaid.length }, { value: 'todos', label: 'Todos' }]} />
          </div>

          {tab === 'sin_cobro' ? <Unpaid rows={data.unpaid} /> : (
            <Card className="rise overflow-hidden">
              {!shown.length ? <Empty title={tab === 'revisar' ? 'Nada para revisar' : 'Sin cobros'}>{tab === 'revisar' && 'Todos los cobros del período coinciden con lo registrado.'}</Empty> : (
                <div className="overflow-x-auto">
                  <table className="tbl">
                    <thead><tr><th>Cobro en Handy</th><th>Tarjeta</th><th className="text-right">Importe</th><th>Venta en el sistema</th><th>Estado</th><th /></tr></thead>
                    <tbody>
                      {shown.map((t) => <TxnRow key={t.id} t={t} busy={busy} act={act} />)}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          {data.imports.length > 0 && (
            <p className="mt-4 flex items-start gap-1.5 text-[12px] text-muted"><Info size={13} className="mt-0.5 shrink-0" />
              Último reporte: {data.imports[0].filename} ({fmtDate(data.imports[0].date_from)} al {fmtDate(data.imports[0].date_to)}), subido {fmtDateTime(data.imports[0].created_at)}. Subir el mismo período otra vez no duplica cobros.
            </p>
          )}
        </>
      )}
    </>
  );
}

function TxnRow({ t, busy, act }) {
  const [pick, setPick] = useState('');
  const [tone, label] = STATUS[t.status] ?? ['neutral', t.status];
  const s = t.sale;
  const why = explain(t);
  const canFix = ['pos_equivocado', 'medio_equivocado', 'tipo_equivocado'].includes(t.status);
  return (
    <tr className={cx(t.status === 'ignorada' && 'opacity-50')}>
      <td className="whitespace-nowrap align-top">
        <div className="font-medium">{fmtDateTime(t.txn_at.replace(' ', 'T') + ':00-03:00')}</div>
        <div className="text-[12px] text-muted">{t.owner_label}</div>
        <div className="font-mono text-[11px] text-muted">{t.terminal}{t.invoice_number && ` · fact. ${t.invoice_number}`}</div>
      </td>
      <td className="align-top text-[13px]">
        <div>{t.network} ···{String(t.card || '').slice(-4)}</div>
        <div className="text-[12px] text-muted">{t.movement}{t.bank && ` · ${t.bank}`}</div>
      </td>
      <td className="num whitespace-nowrap text-right align-top font-semibold">{t.currency !== 'UYU' && `${t.currency} `}{fmtMoney(t.amount)}</td>
      <td className="align-top text-[13px]">
        {s ? (
          <>
            <div><b>#{s.id}</b> · {s.brand_name} · {fmtDate(s.date)}</div>
            <div className="text-[12px] text-muted">Anotada: {s.payment_method}{s.payment_method === 'Crédito' && s.installments > 1 && ` ${s.installments} cuotas`}{['Débito', 'Crédito'].includes(s.payment_method) && ` · ${posLabel(s.pos, s.brand_name)}`}</div>
            {t.match_kind === 'manual' && <div className="text-[11px] text-muted">unida a mano</div>}
          </>
        ) : t.candidates?.length ? (
          <div className="flex items-center gap-2">
            <Select className="h-8 min-w-[220px] py-1 text-[13px]" value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Elegir venta…</option>
              {t.candidates.map((c) => <option key={c.id} value={c.id}>#{c.id} · {c.brand_name} · {fmtDate(c.date)} · {c.payment_method}{c.minutes < 600 ? ` · ${c.minutes} min` : ''}</option>)}
            </Select>
            <Button size="sm" disabled={!pick} loading={busy === `m${t.id}`} onClick={() => act(`m${t.id}`, () => api(`/cards/txns/${t.id}`, { method: 'PUT', body: { sale_id: pick } }), 'Cobro unido a la venta')}>Unir</Button>
          </div>
        ) : <span className="text-muted">—</span>}
      </td>
      <td className="align-top">
        <Badge tone={tone}>{label}</Badge>
        {why && <div className="mt-1 max-w-[280px] text-[12px] leading-snug text-ink2">{why}</div>}
      </td>
      <td className="whitespace-nowrap text-right align-top">
        {canFix && <Button size="sm" variant="accent" loading={busy === `f${t.id}`} onClick={() => act(`f${t.id}`, () => api(`/cards/txns/${t.id}/fix`, { method: 'POST' }), `Venta #${s.id} corregida según Handy`)}><Wrench size={13} />Corregir venta</Button>}
        {s && <button title="Desunir de la venta" onClick={() => act(`u${t.id}`, () => api(`/cards/txns/${t.id}`, { method: 'PUT', body: { sale_id: null } }), 'Cobro desunido')} className="ml-1 rounded-md p-1.5 text-muted hover:bg-sunk hover:text-ink"><Unlink size={14} /></button>}
        {!s && <button title={t.ignored ? 'Volver a tener en cuenta' : 'Descartar (no es una venta de la tienda)'} onClick={() => act(`i${t.id}`, () => api(`/cards/txns/${t.id}`, { method: 'PUT', body: { ignored: !t.ignored } }), t.ignored ? 'Cobro restaurado' : 'Cobro descartado')} className="ml-1 rounded-md p-1.5 text-muted hover:bg-sunk hover:text-ink">{t.ignored ? <Eye size={14} /> : <EyeOff size={14} />}</button>}
      </td>
    </tr>
  );
}

function Unpaid({ rows }) {
  return (
    <Card className="rise overflow-hidden">
      {!rows.length ? <Empty title="Todas las ventas con tarjeta tienen su cobro" /> : (
        <>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Venta</th><th>Marca</th><th>Fecha</th><th>Anotada como</th><th>Factura</th><th className="text-right">Importe</th></tr></thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td className="num text-muted">#{s.id}</td>
                    <td className="font-medium">{s.brand_name}</td>
                    <td>{fmtDate(s.date)}</td>
                    <td className="text-[13px]">{s.payment_method}{s.payment_method === 'Crédito' && s.installments > 1 && ` ${s.installments} cuotas`} · {posLabel(s.pos, s.brand_name)}</td>
                    <td className="text-[13px] text-ink2">{s.invoice_number || '—'}</td>
                    <td className="num text-right font-semibold">{fmtMoney(s.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-5 pb-4 pt-2 text-[12px] text-muted">Ventas anotadas con tarjeta que no aparecen en ningún reporte subido. Puede faltar subir el reporte de algún POS, o la venta no se cobró con tarjeta.</p>
        </>
      )}
    </Card>
  );
}
