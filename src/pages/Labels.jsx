import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Printer, Tags } from 'lucide-react';
import JsBarcode from 'jsbarcode';
import { api } from '../lib/api.js';
import { useApi, useSession } from '../lib/session.jsx';
import { Button, Card, Empty, Field, Input, Loading, PageHeader, Select, Tabs, cx } from '../components/ui.jsx';
import { fmtMoney } from '../lib/format.js';

const FORMATS = {
  rollo: { label: 'Rollo 50 × 30 mm (impresora de etiquetas)', page: '@page { size: 50mm 30mm; margin: 0 }', cell: 'width:50mm;height:30mm;page-break-after:always' },
  a4: { label: 'Hoja A4 · 3 × 8 (etiquetas autoadhesivas)', page: '@page { size: A4; margin: 10mm 7mm }', cell: 'width:64mm;height:33.9mm;float:left;margin:0 1mm 0 0', perPage: 24 },
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function barcodeSvg(code) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  JsBarcode(svg, String(code), { format: 'CODE128', displayValue: false, margin: 0, height: 34, width: 1.4 });
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('style', 'width:100%;height:9mm;display:block');
  return svg.outerHTML;
}

/** Arma la página de impresión en otra ventana: así el resto de la app no sale en la etiqueta. */
export function printLabels(list, format, showPrice) {
  const f = FORMATS[format];
  const cells = list.flatMap((p) => Array.from({ length: p.copies }, () => `
    <div class="l" style="${f.cell}">
      <div class="b">${esc(p.brand_name)}</div>
      <div class="n">${esc(p.name)}${p.variant ? ` · ${esc(p.variant)}` : ''}</div>
      ${barcodeSvg(p.barcode || p.sku)}
      <div class="r"><span class="c">${esc(p.barcode || p.sku)}</span>${showPrice ? `<span class="p">${esc(fmtMoney(p.price))}</span>` : ''}</div>
    </div>`)).join('');
  const w = window.open('', '_blank');
  if (!w) return alert('El navegador bloqueó la ventana de impresión: permití las ventanas emergentes para esta página.');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Etiquetas MAJA</title><style>
    ${f.page}
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; }
    .l { padding: 2mm 3mm; overflow: hidden; display: flex; flex-direction: column; justify-content: space-between; }
    .b { font-size: 6.5pt; letter-spacing: .12em; text-transform: uppercase; }
    .n { font-size: 8pt; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .r { display: flex; justify-content: space-between; align-items: baseline; }
    .c { font-family: monospace; font-size: 7pt; }
    .p { font-size: 11pt; font-weight: bold; }
  </style></head><body>${cells}<script>window.onload=()=>{window.print();}<\/script></body></html>`);
  w.document.close();
}

export default function Labels() {
  const { brands, brandId } = useSession();
  const [params] = useSearchParams();
  const orderId = params.get('pedido');
  const [brand, setBrand] = useState(brandId || '');
  const [q, setQ] = useState('');
  const [view, setView] = useState('sin');
  const [format, setFormat] = useState('rollo');
  const [showPrice, setShowPrice] = useState(true);
  const [copies, setCopies] = useState({});
  const { data: products, loading } = useApi(brand ? '/products' : null, { brand_id: brand });

  // desde un ingreso recibido: una etiqueta por cada prenda que llegó
  useEffect(() => {
    if (!orderId) return;
    api(`/orders/${orderId}`).then((o) => {
      setBrand(String(o.brand_id));
      setView('todos');
      setCopies(Object.fromEntries(o.items.filter((i) => i.product_id).map((i) => [i.product_id, String(i.picked_qty || i.qty)])));
    }).catch(() => {});
  }, [orderId]);

  const list = useMemo(() => {
    let r = products || [];
    if (view === 'sin') r = r.filter((p) => !p.barcode);
    if (view === 'elegidos') r = r.filter((p) => Number(copies[p.id]) > 0);
    const t = q.trim().toLowerCase();
    if (t) r = r.filter((p) => `${p.sku} ${p.name} ${p.variant || ''} ${p.barcode || ''}`.toLowerCase().includes(t));
    return r;
  }, [products, view, q, copies]);
  const chosen = (products || []).filter((p) => Number(copies[p.id]) > 0).map((p) => ({ ...p, copies: Math.min(500, Number(copies[p.id])) }));
  const total = chosen.reduce((a, p) => a + p.copies, 0);
  const setAll = (fn) => setCopies((c) => ({ ...c, ...Object.fromEntries(list.map((p) => [p.id, fn(p)])) }));

  return (
    <>
      <PageHeader eyebrow={<Link to="/stock" className="hover:underline">Stock</Link>} title="Etiquetas con código de barras">
        <Button onClick={() => printLabels(chosen, format, showPrice)} disabled={!total}><Printer size={15} />Imprimir {total ? `${total} etiquetas` : ''}</Button>
      </PageHeader>
      <p className="mb-5 max-w-2xl text-[13px] text-muted">Para las prendas que no traen código de barras: la etiqueta lleva el SKU como código, así el escáner las reconoce en la caja, en los pedidos y en el conteo. Si el artículo ya tiene su código (EAN), se usa ese.</p>
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="Marca">
          <Select value={brand} onChange={(e) => { setBrand(e.target.value); setCopies({}); }}>
            <option value="">Elegí…</option>
            {brands.filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </Field>
        <Field label="Formato"><Select value={format} onChange={(e) => setFormat(e.target.value)}>{Object.entries(FORMATS).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}</Select></Field>
        <Field label="Buscar"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="SKU o nombre" /></Field>
        <label className="flex items-end gap-2 pb-2 text-[13px]"><input type="checkbox" checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)} className="h-4 w-4 accent-[#1d1b18]" />Con precio</label>
      </div>
      {!brand ? <Card><Empty icon={Tags} title="Elegí una marca" /></Card> : loading && !products ? <Loading /> : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <Tabs value={view} onChange={setView} options={[{ value: 'sin', label: 'Sin código de barras' }, { value: 'todos', label: 'Todos' }, { value: 'elegidos', label: 'Elegidos', count: chosen.length }]} />
            <Button size="sm" variant="ghost" onClick={() => setAll((p) => String(Math.max(0, p.stock)))}>Una por unidad en stock</Button>
            <Button size="sm" variant="ghost" onClick={() => setAll(() => '1')}>Una de cada</Button>
            <Button size="sm" variant="ghost" onClick={() => setAll(() => '')}>Ninguna</Button>
          </div>
          <Card className="rise overflow-hidden">
            {!list.length ? <Empty title={view === 'sin' ? 'Todos los artículos de esta marca tienen código de barras' : 'Nada para mostrar'} /> : (
              <div className="overflow-x-auto">
                <table className="tbl">
                  <thead><tr><th>Artículo</th><th>Código que va en la etiqueta</th><th className="text-right">Precio</th><th className="text-right">Stock</th><th className="w-28 text-right">Etiquetas</th></tr></thead>
                  <tbody>
                    {list.map((p) => (
                      <tr key={p.id} className={cx(Number(copies[p.id]) > 0 && 'bg-ok-soft/30')}>
                        <td><span className="font-medium">{p.name}</span>{p.variant && <span className="text-muted"> · {p.variant}</span>}</td>
                        <td className="font-mono text-[12px]">{p.barcode || p.sku}{!p.barcode && <span className="ml-1 font-sans text-[11px] text-muted">(SKU)</span>}</td>
                        <td className="num text-right">{fmtMoney(p.price)}</td>
                        <td className="num text-right text-muted">{p.stock}</td>
                        <td><Input className="ml-auto h-8 w-20 py-1 text-right" inputMode="numeric" value={copies[p.id] ?? ''} placeholder="0" onChange={(e) => setCopies({ ...copies, [p.id]: e.target.value.replace(/\D/g, '') })} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </>
  );
}
