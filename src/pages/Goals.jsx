import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, Target } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi } from '../lib/session.jsx';
import { Button, Card, Empty, ErrorNote, Loading, PageHeader, useToast } from '../components/ui.jsx';
import { currentPeriod, fmtMoney, fmtPeriod, fmtPeriodShort, parseNum, shiftPeriod } from '../lib/format.js';

const parse = parseNum;

export default function Goals() {
  const toast = useToast();
  const [period, setPeriod] = useState(currentPeriod());
  const { data, error, loading, reload } = useApi('/goals', { period });
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (data) setDraft(Object.fromEntries(data.rows.map((r) => [r.brand_id, r.goal === null ? '' : String(r.goal)])));
  }, [data]);

  const rows = data?.rows || [];
  const dirty = rows.some((r) => (r.goal === null ? '' : String(r.goal)) !== (draft[r.brand_id] ?? ''));
  const total = rows.reduce((a, r) => a + (parse(draft[r.brand_id]) ?? 0), 0);
  const prevTotal = rows.reduce((a, r) => a + r.prev_sales, 0);

  const copyPrev = () => setDraft(Object.fromEntries(rows.map((r) => [r.brand_id, r.prev_goal !== null ? String(r.prev_goal) : draft[r.brand_id] ?? ''])));
  const fromSales = (pct) => setDraft(Object.fromEntries(rows.map((r) => [r.brand_id, r.prev_sales ? String(Math.round((r.prev_sales * (1 + pct / 100)) / 100) * 100) : draft[r.brand_id] ?? ''])));

  const save = async () => {
    setBusy(true);
    setErr('');
    try {
      await api('/goals', { method: 'PUT', body: { period, goals: rows.map((r) => ({ brand_id: r.brand_id, amount: parse(draft[r.brand_id]) ?? '' })) } });
      toast(`Objetivos de ${fmtPeriod(period)} guardados`);
      reload();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader eyebrow="Metas de venta por marca" title="Objetivos">
        <div className="flex items-center rounded-lg border border-line bg-card">
          <button className="p-2 text-ink2 hover:text-ink" onClick={() => setPeriod(shiftPeriod(period, -1))} aria-label="Mes anterior"><ChevronLeft size={16} /></button>
          <span className="min-w-[90px] text-center text-[13px] font-medium capitalize">{fmtPeriodShort(period)}</span>
          <button className="p-2 text-ink2 hover:text-ink" onClick={() => setPeriod(shiftPeriod(period, 1))} aria-label="Mes siguiente"><ChevronRight size={16} /></button>
        </div>
      </PageHeader>

      <ErrorNote>{error}</ErrorNote>
      {loading && !data ? <Loading /> : !rows.length ? (
        <Card><Empty icon={Target} title="Sin marcas activas">Primero cargá las marcas.</Empty></Card>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={copyPrev} disabled={!rows.some((r) => r.prev_goal !== null)}><Copy size={14} />Copiar objetivos de {fmtPeriodShort(shiftPeriod(period, -1))}</Button>
            <span className="text-[12px] text-muted">o tomar lo vendido en {fmtPeriodShort(shiftPeriod(period, -1))}:</span>
            {[0, 10, 20].map((p) => <Button key={p} variant="ghost" size="sm" onClick={() => fromSales(p)} disabled={!prevTotal}>{p ? `+${p} %` : 'igual'}</Button>)}
          </div>

          <Card className="rise overflow-hidden">
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Marca</th>
                    <th className="text-right">Vendido {fmtPeriodShort(shiftPeriod(period, -12))}</th>
                    <th className="text-right">Vendido {fmtPeriodShort(shiftPeriod(period, -1))}</th>
                    <th className="w-48 text-right">Objetivo {fmtPeriodShort(period)}</th>
                    <th className="text-right">vs. mes anterior</th>
                    <th className="text-right">Vendido hasta hoy</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const g = parse(draft[r.brand_id]);
                    const vs = g !== null && r.prev_sales ? (g - r.prev_sales) / r.prev_sales : null;
                    return (
                      <tr key={r.brand_id}>
                        <td className="font-medium">{r.brand_name}</td>
                        <td className="num text-right text-muted">{r.last_year_sales ? fmtMoney(r.last_year_sales) : '—'}</td>
                        <td className="num text-right text-ink2">{fmtMoney(r.prev_sales)}</td>
                        <td className="text-right">
                          <div className="relative ml-auto w-40">
                            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">$</span>
                            <input className="field num h-9 py-1 pl-7 text-right" inputMode="decimal" value={draft[r.brand_id] ?? ''} placeholder="Sin objetivo"
                              onChange={(e) => setDraft({ ...draft, [r.brand_id]: e.target.value })} />
                          </div>
                        </td>
                        <td className={`num text-right text-[13px] ${vs === null ? 'text-muted' : vs >= 0 ? 'text-ok' : 'text-bad'}`}>{vs === null ? '—' : `${vs >= 0 ? '+' : ''}${Math.round(vs * 100)} %`}</td>
                        <td className="num text-right">{fmtMoney(r.sales)}{g ? <span className="block text-[11px] text-muted">{Math.round((r.sales / g) * 100)} % del objetivo</span> : null}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-line bg-sunk/50">
                    <td className="px-3 py-3 font-semibold">Tienda</td>
                    <td />
                    <td className="num px-3 py-3 text-right font-semibold">{fmtMoney(prevTotal)}</td>
                    <td className="num px-3 py-3 text-right font-display text-[22px]">{fmtMoney(total)}</td>
                    <td className={`num px-3 py-3 text-right text-[13px] ${prevTotal && total ? (total >= prevTotal ? 'text-ok' : 'text-bad') : 'text-muted'}`}>{prevTotal && total ? `${total >= prevTotal ? '+' : ''}${Math.round(((total - prevTotal) / prevTotal) * 100)} %` : '—'}</td>
                    <td className="num px-3 py-3 text-right font-semibold">{fmtMoney(rows.reduce((a, r) => a + r.sales, 0))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
          <div className="mt-4 flex items-center justify-between gap-4">
            <p className="max-w-xl text-[13px] text-muted">El objetivo es el importe a vender en el mes, igual que lo que suma la caja. Las marcas no ven sus objetivos; las vendedoras ven el avance en su tablero.</p>
            <Button onClick={save} loading={busy} disabled={!dirty}>Guardar objetivos</Button>
          </div>
          <div className="mt-2"><ErrorNote>{err}</ErrorNote></div>
        </>
      )}
    </>
  );
}
