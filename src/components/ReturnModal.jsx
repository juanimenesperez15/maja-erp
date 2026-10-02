import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { api } from '../lib/api.js';
import { Button, ErrorNote, Field, Input, Loading, Modal, Textarea, useToast, cx } from './ui.jsx';
import PaymentFields, { paymentReady } from './PaymentFields.jsx';
import { fmtDate, fmtMoney, parseNum } from '../lib/format.js';

/**
 * Nota de crédito asociada a una venta (devolución total o parcial). La puede hacer la vendedora;
 * anular una venta entera sigue siendo solo de la dueña.
 */
export default function ReturnModal({ saleId: initialSale, onClose, onSaved }) {
  const toast = useToast();
  const [saleNo, setSaleNo] = useState(initialSale ? String(initialSale) : '');
  const [sale, setSale] = useState(null);
  const [loading, setLoading] = useState(false);
  const [qty, setQty] = useState({});
  const [pay, setPay] = useState({ payment_method: '', pos: '', installments: '1', authorization: '' });
  const [extra, setExtra] = useState({ invoice_number: '', notes: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async (id) => {
    setLoading(true);
    setError('');
    try {
      const s = await api(`/sales/${Number(id)}`);
      if (s.voided) throw new Error('Esa venta está anulada');
      if (!s.items.some((i) => i.qty > 0)) throw new Error('Esa venta ya es una devolución');
      setSale(s);
      setQty({});
      // por defecto se devuelve con el mismo medio con que se pagó
      if (['Efectivo', 'Débito', 'Crédito', 'Transferencia', 'Mercado Pago', 'Otro'].includes(s.payment_method)) setPay((p) => ({ ...p, payment_method: s.payment_method, pos: s.pos || '' }));
    } catch (e) { setError(e.message); setSale(null); } finally { setLoading(false); }
  };
  useEffect(() => { if (initialSale) load(initialSale); }, [initialSale]);

  const lines = (sale?.items || []).filter((i) => i.qty > 0);
  const chosen = lines.filter((i) => Number(qty[i.id]) > 0);
  const total = chosen.reduce((a, i) => a + Number(qty[i.id]) * i.unit_price * (1 - (i.discount_pct || 0) / 100), 0);
  const electronic = sale && sale.cfe_mode && sale.cfe_mode !== 'manual';
  const ready = chosen.length && paymentReady(pay) && extra.notes.trim();

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api('/sales', {
        method: 'POST',
        body: {
          brand_id: sale.brand_id, ref_sale_id: sale.id, ...pay, notes: `Devolución: ${extra.notes.trim()}`, invoice_number: extra.invoice_number,
          items: chosen.map((i) => (i.product_id ? { product_id: i.product_id, qty: -Number(qty[i.id]), unit_price: i.unit_price, discount_pct: i.discount_pct } : { description: i.description, qty: -Number(qty[i.id]), unit_price: i.unit_price, discount_pct: i.discount_pct })),
        },
      });
      if (r.invoice_status === 'error') toast(`Devolución guardada, pero Biller no emitió la nota de crédito: ${r.invoice_error}`, 'bad');
      else toast(r.invoice_status === 'emitida' ? `Nota de crédito emitida · ${r.invoice_number}` : 'Devolución registrada');
      onSaved();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal open wide title="Nota de crédito · devolución" onClose={onClose}
      footer={<div className="flex w-full flex-wrap items-center justify-between gap-3">
        <div>{total > 0 && <><span className="eyebrow mr-2">Se devuelve</span><span className="num font-display text-[28px] leading-none">{fmtMoney(total, true)}</span></>}</div>
        <div className="flex gap-2"><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={save} loading={busy} disabled={!ready}>{electronic ? 'Emitir nota de crédito' : 'Registrar devolución'}</Button></div>
      </div>}>
      <div className="space-y-5">
        {!initialSale && (
          <Field label="Venta #">
            <div className="flex max-w-sm gap-2">
              <Input inputMode="numeric" value={saleNo} onChange={(e) => setSaleNo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saleNo && load(saleNo)} placeholder="Número de la venta" autoFocus />
              <Button variant="outline" onClick={() => load(saleNo)} disabled={!saleNo}><Search size={14} />Buscar</Button>
            </div>
          </Field>
        )}
        {loading && <Loading />}
        {sale && (
          <>
            <div className="text-[13px] text-ink2">Venta <b>#{sale.id}</b> de <b>{sale.brand_name}</b> · {fmtDate(sale.date)} · {sale.payment_method}{sale.invoice_number && ` · ${sale.invoice_number}`}</div>
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="tbl">
                <thead><tr><th>Artículo</th><th className="text-right">Vendidas</th><th className="text-right">Precio</th><th className="w-28 text-right">Devuelve</th></tr></thead>
                <tbody>
                  {lines.map((i) => {
                    const left = i.qty - (i.returned || 0);
                    return (
                      <tr key={i.id} className={cx(left <= 0 && 'opacity-50')}>
                        <td><span className="font-medium">{i.description}</span>{i.returned > 0 && <span className="block text-[12px] text-muted">ya devolvió {i.returned}</span>}</td>
                        <td className="num text-right">{i.qty}</td>
                        <td className="num text-right">{fmtMoney(i.unit_price)}{i.discount_pct > 0 && <span className="block text-[11px] text-accent">−{i.discount_pct}%</span>}</td>
                        <td className="text-right">
                          {left > 0 ? (
                            <select className="field ml-auto h-8 w-20 py-1" value={qty[i.id] ?? '0'} onChange={(e) => setQty({ ...qty, [i.id]: e.target.value })}>
                              {Array.from({ length: left + 1 }, (_, n) => <option key={n} value={n}>{n}</option>)}
                            </select>
                          ) : <span className="text-[12px] text-muted">devuelta</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <PaymentFields value={pay} onChange={setPay} brandName={sale.brand_name} label="Cómo se le devuelve la plata" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Motivo"><Textarea className="min-h-[60px]" value={extra.notes} onChange={(e) => setExtra({ ...extra, notes: e.target.value })} placeholder="Talle, falla, no le gustó…" /></Field>
              {!electronic && <Field label="N° de nota de crédito" hint="Si la marca la hace a mano (opcional)"><Input value={extra.invoice_number} onChange={(e) => setExtra({ ...extra, invoice_number: e.target.value })} /></Field>}
            </div>
            <p className="text-[12px] text-muted">{electronic ? 'Se emite una nota de crédito electrónica que referencia la venta original.' : ''} Las prendas vuelven al stock y se descuentan de lo vendido por la marca. Si se lleva otra prenda, usá "Cambio".</p>
          </>
        )}
        <ErrorNote>{error}</ErrorNote>
      </div>
    </Modal>
  );
}
