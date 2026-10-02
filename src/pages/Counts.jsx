import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ClipboardList, Plus, Check, X, ArrowLeft } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi, useSession } from '../lib/session.jsx';
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Loading, PageHeader, Select, Stat, Tabs, useToast, cx } from '../components/ui.jsx';
import ScanBox from '../components/ScanBox.jsx';
import { fmtDateTime, fmtInt } from '../lib/format.js';

const STATUS = { abierto: ['warn', 'En curso'], aplicado: ['ok', 'Aplicado'], descartado: ['neutral', 'Descartado'] };

/** Conteo de inventario con el escáner: se pasa todo lo que hay y el sistema muestra las diferencias. */
export default function Counts() {
  const [params, setParams] = useSearchParams();
  const id = params.get('id');
  return id ? <CountDetail id={id} onBack={() => setParams({})} /> : <CountList onOpen={(cid) => setParams({ id: cid })} />;
}

function CountList({ onOpen }) {
  const { brands, brandId } = useSession();
  const toast = useToast();
  const { data, loading } = useApi('/counts');
  const [brand, setBrand] = useState(brandId || '');
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    try { const r = await api('/counts', { method: 'POST', body: { brand_id: brand || null } }); onOpen(r.id); } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader eyebrow={<Link to="/stock" className="hover:underline">Stock</Link>} title="Conteo de inventario">
        <Select className="w-auto min-w-[180px]" value={brand} onChange={(e) => setBrand(e.target.value)}>
          <option value="">Toda la tienda</option>
          {brands.filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
        <Button onClick={start} loading={busy}><Plus size={16} />Empezar conteo</Button>
      </PageHeader>
      <p className="mb-5 max-w-2xl text-[13px] text-muted">Pasá con el escáner cada prenda que hay en la tienda (o en la sección de una marca). Al terminar, la dueña revisa las diferencias y aplica el ajuste: el stock queda igual a lo contado. Conviene contar sin ventas en el medio.</p>
      <Card className="rise overflow-hidden">
        {loading && !data ? <Loading /> : !data?.length ? <Empty icon={ClipboardList} title="Todavía no hay conteos" /> : (
          <table className="tbl">
            <thead><tr><th>#</th><th>Qué</th><th>Empezó</th><th className="text-right">Unidades contadas</th><th>Estado</th></tr></thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id} className="cursor-pointer" onClick={() => onOpen(c.id)}>
                  <td className="num text-muted">{c.id}</td>
                  <td className="font-medium">{c.brand_name || 'Toda la tienda'}</td>
                  <td className="text-[13px] text-ink2">{c.created_by_name} · {fmtDateTime(c.created_at)}</td>
                  <td className="num text-right">{fmtInt(c.units)}</td>
                  <td><Badge tone={STATUS[c.status][0]}>{STATUS[c.status][1]}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

function CountDetail({ id, onBack }) {
  const { isOwner } = useSession();
  const toast = useToast();
  const { data, loading, reload, setData } = useApi(`/counts/${id}`);
  const [view, setView] = useState('diff');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const c = data?.count;
  const lines = data?.lines || [];
  const open = c?.status === 'abierto';

  const stats = useMemo(() => {
    const touched = lines.filter((l) => l.touched);
    const withDiff = lines.filter((l) => l.counted !== l.stock);
    return {
      counted: touched.reduce((a, l) => a + l.counted, 0), items: touched.length, diff: withDiff.length,
      missing: withDiff.filter((l) => l.counted < l.stock).reduce((a, l) => a + (l.stock - l.counted), 0),
      extra: withDiff.filter((l) => l.counted > l.stock).reduce((a, l) => a + (l.counted - l.stock), 0),
    };
  }, [lines]);
  const shown = view === 'diff' ? lines.filter((l) => l.counted !== l.stock) : view === 'touched' ? lines.filter((l) => l.touched) : lines;

  const onScan = async (code) => {
    const r = await api(`/counts/${id}/scan`, { method: 'POST', body: { code } });
    if (r.ok) setData((d) => ({ ...d, lines: d.lines.map((l) => (l.id === r.product_id ? { ...l, counted: r.counted, touched: true, diff: r.counted - l.stock } : l)) }));
    return r;
  };
  const setCounted = async (l, v) => {
    const n = Math.max(0, Math.trunc(Number(v) || 0));
    setData((d) => ({ ...d, lines: d.lines.map((x) => (x.id === l.id ? { ...x, counted: n, touched: true } : x)) }));
    await api(`/counts/${id}/lines`, { method: 'PUT', body: { product_id: l.id, counted: n } }).catch((e) => setError(e.message));
  };
  const apply = async (onlyTouched) => {
    const msg = onlyTouched
      ? 'Se ajusta el stock solo de los artículos que se contaron. ¿Seguimos?'
      : 'Se ajusta TODO: lo que no se escaneó queda con stock 0. Usalo solo si contaste todo. ¿Seguimos?';
    if (!window.confirm(msg)) return;
    setBusy('apply');
    try { const r = await api(`/counts/${id}/apply`, { method: 'POST', body: { only_touched: onlyTouched } }); toast(`Stock ajustado en ${r.adjusted} artículos`); reload(); } catch (e) { setError(e.message); } finally { setBusy(''); }
  };
  const discard = async () => {
    if (!window.confirm('¿Descartar este conteo? No cambia el stock.')) return;
    await api(`/counts/${id}/discard`, { method: 'POST' }).catch((e) => setError(e.message));
    reload();
  };

  if (loading && !data) return <Loading />;
  if (!c) return null;
  return (
    <>
      <PageHeader eyebrow={<button onClick={onBack} className="inline-flex items-center gap-1 hover:underline"><ArrowLeft size={12} />Conteos</button>} title={`Conteo #${c.id} · ${c.brand_name || 'toda la tienda'}`}>
        <Badge tone={STATUS[c.status][0]}>{STATUS[c.status][1]}</Badge>
        {open && isOwner && <>
          <Button variant="ghost" onClick={discard}><X size={15} />Descartar</Button>
          <Button variant="outline" onClick={() => apply(false)} loading={busy === 'apply'}>Ajustar todo</Button>
          <Button variant="accent" onClick={() => apply(true)} loading={busy === 'apply'}><Check size={15} />Ajustar lo contado</Button>
        </>}
      </PageHeader>
      <ErrorNote>{error}</ErrorNote>
      {open && <div className="mb-6"><ScanBox onScan={onScan} hint="Cada lectura suma 1 al artículo. Si una prenda no tiene código, buscala abajo y escribí la cantidad." /></div>}
      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Stat label="Unidades contadas" value={fmtInt(stats.counted)} sub={`${stats.items} artículos`} />
        <Stat label="Artículos con diferencia" value={fmtInt(stats.diff)} tone={stats.diff ? 'accent' : undefined} delay={50} />
        <Stat label="Faltan" value={fmtInt(stats.missing)} sub="unidades menos que el sistema" tone={stats.missing ? 'bad' : undefined} delay={100} />
        <Stat label="Sobran" value={fmtInt(stats.extra)} sub="unidades más que el sistema" delay={150} />
      </div>
      <div className="mb-4"><Tabs value={view} onChange={setView} options={[{ value: 'diff', label: 'Con diferencia', count: stats.diff }, { value: 'touched', label: 'Contados', count: stats.items }, { value: 'all', label: 'Todos', count: lines.length }]} /></div>
      <Card className="rise overflow-hidden">
        {!shown.length ? <Empty title={view === 'diff' ? 'Sin diferencias' : 'Nada para mostrar'} /> : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr>{!c.brand_id && <th>Marca</th>}<th>Artículo</th><th className="text-right">Sistema</th><th className="w-28 text-right">Contado</th><th className="text-right">Diferencia</th></tr></thead>
              <tbody>
                {shown.map((l) => {
                  const d = l.counted - l.stock;
                  return (
                    <tr key={l.id}>
                      {!c.brand_id && <td className="text-ink2">{l.brand_name}</td>}
                      <td><span className="font-medium">{l.name}</span>{l.variant && <span className="text-muted"> · {l.variant}</span>}<span className="block font-mono text-[11px] text-muted">{l.sku}{l.barcode && ` · ${l.barcode}`}</span></td>
                      <td className="num text-right">{l.stock}</td>
                      <td className="text-right">{open ? <Input className="ml-auto h-8 w-20 py-1 text-right" inputMode="numeric" defaultValue={l.touched ? l.counted : ''} key={`${l.id}-${l.counted}`} placeholder="0" onBlur={(e) => e.target.value !== String(l.touched ? l.counted : '') && setCounted(l, e.target.value)} /> : <span className="num">{l.counted}</span>}</td>
                      <td className={cx('num text-right font-semibold', d < 0 ? 'text-bad' : d > 0 ? 'text-ok' : 'text-muted')}>{d > 0 ? `+${d}` : d}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {open && !isOwner && <p className="mt-4 text-[13px] text-muted">Cuando termines de contar, avisale a la dueña: ella revisa las diferencias y aplica el ajuste.</p>}
    </>
  );
}
