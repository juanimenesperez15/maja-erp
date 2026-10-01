import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { api } from '../lib/api.js';
import { fmtMoney } from '../lib/format.js';
import { cx } from './ui.jsx';

/** Buscador de artículos por SKU o nombre. Enter con un único resultado lo elige directo (sirve con lector de código). */
export default function ProductPicker({ brandId, onPick, placeholder = 'Buscar por SKU o nombre…', autoFocus }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const box = useRef(null);

  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await api('/products', { query: { q, brand_id: brandId, limit: 20 } });
        setResults(r);
        setHi(0);
        setOpen(true);
      } catch { setResults([]); }
    }, 180);
    return () => clearTimeout(t);
  }, [q, brandId]);

  useEffect(() => {
    const h = (e) => box.current && !box.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const pick = (p) => { onPick(p); setQ(''); setResults([]); setOpen(false); };

  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const exact = results.find((r) => r.sku.toLowerCase() === q.trim().toLowerCase());
      if (exact) pick(exact);
      else if (results[hi]) pick(results[hi]);
    } else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div className="relative" ref={box}>
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
      <input className="field pl-9" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} onFocus={() => results.length && setOpen(true)} placeholder={placeholder} autoFocus={autoFocus} />
      {open && q.trim() && (
        <div className="fade absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-lg border border-line bg-card shadow-xl">
          {!results.length ? <div className="px-3 py-3 text-[13px] text-muted">Sin resultados</div> : results.map((p, i) => (
            <button key={p.id} type="button" onMouseEnter={() => setHi(i)} onClick={() => pick(p)}
              className={cx('flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[13px]', i === hi && 'bg-sunk')}>
              <span className="min-w-0">
                <span className="block truncate font-medium">{p.name}{p.variant ? <span className="font-normal text-muted"> · {p.variant}</span> : null}</span>
                <span className="block text-[12px] text-muted">{p.sku}{!brandId && ` · ${p.brand_name}`}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="num block">{fmtMoney(p.price)}</span>
                <span className={cx('num block text-[12px]', p.stock <= 0 ? 'text-bad' : 'text-muted')}>{p.stock} en stock</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
