import { useMemo, useState } from 'react';
import { Search, Trash2, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { api } from '../lib/api.js';
import { useSession } from '../lib/session.jsx';
import { Button, ErrorNote, Field, Input, Modal, Select, useToast } from './ui.jsx';
import ProductPicker from './ProductPicker.jsx';
import PaymentFields, { paymentReady } from './PaymentFields.jsx';
import { fmtDate, fmtMoney, parseNum } from '../lib/format.js';

const lineTotal = (it) => Math.abs(Number(it.qty) || 0) * (parseNum(it.unit_price) || 0) * (1 - (Number(it.discount_pct) || 0) / 100);

/**
 * Cambio de prenda en un paso: elegís la venta original y qué devuelve, cargás lo que se lleva,
 * y se cobra o devuelve solo la diferencia. Por detrás quedan dos comprobantes (devolución y venta nueva).
 */
// fuera del componente: si se define adentro, los campos pierden el foco en cada tecla
function Lines({ list, setList, sign }) {
  return (
    <div className="mt-2 overflow-x-auto rounded-lg border border-line">
      <table className="tbl">
        <tbody>
          {list.map((it, i) => (
            <tr key={i}>
              <td><span className="font-medium">{it.description}</span>{it.variant && <span className="text-muted"> · {it.variant}</span>}</td>
              <td className="w-20"><Input className="h-8 py-1 text-right" inputMode="numeric" value={it.qty} onChange={(e) => setList((l) => l.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} /></td>
              <td className="w-28"><Input className="h-8 py-1 text-right" inputMode="decimal" value={it.unit_price} onChange={(e) => setList((l) => l.map((x, j) => (j === i ? { ...x, unit_price: e.target.value } : x)))} /></td>
              <td className="num w-28 whitespace-nowrap text-right font-semibold">{sign}{fmtMoney(lineTotal(it), true)}</td>
              <td className="w-10"><button onClick={() => setList((l) => l.filter((_, j) => j !== i))} className="rounded-md p-1.5 text-muted hover:bg-bad-soft hover:text-bad" aria-label="Quitar"><Trash2 size={14} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function ExchangeModal({ initialBrand, onClose, onSaved }) {
  const { brands } = useSession();
  const toast = useToast();
  const active = brands.filter((b) => b.active);
  const [brandId, setBrandId] = useState(initialBrand || '');
  const brand = active.find((b) => String(b.id) === String(brandId));
  const [saleNo, setSaleNo] = useState('');
  const [orig, setOrig] = useState(null);
  const [returns, setReturns] = useState([]);
  const [takes, setTakes] = useState([]);
  const [pay, setPay] = useState({ payment_method: '', pos: '', installments: '1', authorization: '' });
  const [inv, setInv] = useState({ invoice_number: '', return_invoice_number: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const electronic = brand && brand.billing_mode !== 'manual';
  const retTotal = returns.reduce((a, it) => a + lineTotal(it), 0);
  const newTotal = takes.reduce((a, it) => a + lineTotal(it), 0);
  const diff = Math.round((newTotal - retTotal) * 100) / 100;

  const findSale = async () => {
    setError('');
    try {
      const s = await api(`/sales/${Number(saleNo)}`);
      if (s.voided) throw new Error('Esa venta está anulada');
      setBrandId(String(s.brand_id));
      setOrig(s);
      setReturns([]);
    } catch (e) { setError(e.message); setOrig(null); }
  };
  const toggleReturn = (it) => setReturns((l) => (l.some((x) => x.from === it.id) ? l.filter((x) => x.from !== it.id)
    : [...l, { from: it.id, product_id: it.product_id, description: it.description, variant: it.variant, qty: '1', max: it.qty - it.returned, unit_price: String(it.unit_price), discount_pct: String(it.discount_pct || '') }]));
  const addTake = (p) => setTakes((l) => {
    const i = l.findIndex((x) => x.product_id === p.id);
    if (i >= 0) return l.map((x, j) => (j === i ? { ...x, qty: String(Number(x.qty) + 1) } : x));
    return [...l, { product_id: p.id, description: p.name, variant: p.variant, stock: p.stock, qty: '1', unit_price: String(p.price), discount_pct: '' }];
  });
  const addReturnFree = (p) => setReturns((l) => [...l, { product_id: p.id, description: p.name, variant: p.variant, qty: '1', unit_price: String(p.price), discount_pct: '' }]);

  const ready = brand && returns.length && takes.length && (electronic ? !!orig : true) && (Math.abs(diff) < 0.01 || paymentReady(pay)) && (electronic || inv.invoice_number.trim());

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api('/sales/exchange', {
        method: 'POST',
        body: { brand_id: brandId, ref_sale_id: orig?.id ?? null, returns, items: takes, ...pay, ...inv },
      });
      const bad = [r.return_sale, r.new_sale].find((s) => s.invoice_status === 'error');
      toast(bad ? `Cambio guardado, pero Biller no emitió: ${bad.invoice_error}` : `Cambio registrado${r.difference ? ` · ${r.difference > 0 ? 'cobrar' : 'devolver'} ${fmtMoney(Math.abs(r.difference))}` : ''}`, bad ? 'bad' : 'ok');
      onSaved();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal open wide title="Cambio de prenda" onClose={onClose}
      footer={<div className="flex w-full flex-wrap items-center justify-between gap-3">
        <div className="text-[13px]">
          {Math.abs(diff) < 0.01 ? <span className="font-semibold">Sin diferencia</span>
            : <><span className="eyebrow mr-2">{diff > 0 ? 'Cobrar' : 'Devolver'}</span><span className="num font-display text-[28px] leading-none">{fmtMoney(Math.abs(diff), true)}</span></>}
        </div>
        <div className="flex gap-2"><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={save} loading={busy} disabled={!ready}>Registrar cambio</Button></div>
      </div>}>
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-[1fr_1.2fr]">
          <Field label="Venta original #" hint={electronic ? 'Obligatoria: la nota de crédito la referencia' : 'Opcional, pero ayuda a no devolver de más'}>
            <div className="flex gap-2">
              <Input inputMode="numeric" value={saleNo} onChange={(e) => setSaleNo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && findSale()} placeholder="Ej. 124" />
              <Button variant="outline" onClick={findSale} disabled={!saleNo}><Search size={14} />Buscar</Button>
            </div>
          </Field>
          <Field label="Marca">
            <Select value={brandId} onChange={(e) => { setBrandId(e.target.value); setOrig(null); setReturns([]); setTakes([]); }} disabled={!!orig}>
              <option value="">Elegí…</option>
              {active.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </Field>
        </div>

        {/* lo que devuelve */}
        <div>
          <div className="eyebrow flex items-center gap-1.5"><ArrowDownLeft size={13} />Devuelve</div>
          {orig ? (
            <div className="mt-2 rounded-lg border border-line">
              <div className="border-b border-line px-3 py-2 text-[12px] text-muted">Venta #{orig.id} · {fmtDate(orig.date)} · {orig.payment_method} · {orig.invoice_number || 'sin comprobante'} — tocá lo que devuelve</div>
              {orig.items.filter((i) => i.qty > 0).map((it) => {
                const sel = returns.some((x) => x.from === it.id);
                const left = it.qty - it.returned;
                return (
                  <label key={it.id} className={`flex cursor-pointer items-center justify-between gap-3 border-b border-line px-3 py-2 text-[13px] last:border-0 ${left <= 0 ? 'opacity-50' : ''}`}>
                    <span className="flex items-center gap-2"><input type="checkbox" checked={sel} disabled={left <= 0} onChange={() => toggleReturn(it)} className="h-4 w-4 accent-[#1d1b18]" />{it.qty}× {it.description}{left < it.qty && <span className="text-muted"> (ya devolvió {it.returned})</span>}</span>
                    <span className="num">{fmtMoney(it.total)}</span>
                  </label>
                );
              })}
            </div>
          ) : brand && !electronic ? (
            <div className="mt-2"><ProductPicker brandId={brandId} onPick={addReturnFree} placeholder="Escaneá o buscá la prenda que devuelve…" /></div>
          ) : <div className="mt-2 rounded-md bg-sunk px-3 py-2 text-[13px] text-muted">Buscá la venta original para elegir qué devuelve.</div>}
          {returns.length > 0 && <Lines list={returns} setList={setReturns} sign="−" />}
        </div>

        {/* lo que se lleva */}
        <div>
          <div className="eyebrow flex items-center gap-1.5"><ArrowUpRight size={13} />Se lleva</div>
          {brand ? <div className="mt-2"><ProductPicker brandId={brandId} onPick={addTake} placeholder="Escaneá o buscá la prenda nueva…" /></div>
            : <div className="mt-2 rounded-md bg-sunk px-3 py-2 text-[13px] text-muted">Elegí la marca o buscá la venta original.</div>}
          {takes.length > 0 && <Lines list={takes} setList={setTakes} sign="" />}
        </div>

        {Math.abs(diff) >= 0.01 && <PaymentFields value={pay} onChange={setPay} brandName={brand?.name} label={diff > 0 ? 'Cómo paga la diferencia' : 'Cómo se le devuelve la diferencia'} />}

        {brand && !electronic && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="N° de factura de la venta nueva"><Input value={inv.invoice_number} onChange={(e) => setInv({ ...inv, invoice_number: e.target.value })} /></Field>
            <Field label="N° de nota de crédito" hint="Si la marca la hace"><Input value={inv.return_invoice_number} onChange={(e) => setInv({ ...inv, return_invoice_number: e.target.value })} /></Field>
          </div>
        )}
        {brand && electronic && <p className="text-[12px] text-muted">Se emiten dos comprobantes con el Biller: una nota de crédito por lo que devuelve y un e-Ticket por lo que se lleva.</p>}
        <ErrorNote>{error}</ErrorNote>
      </div>
    </Modal>
  );
}
