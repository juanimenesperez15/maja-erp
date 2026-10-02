import { cx } from './ui.jsx';

export const PAYMENT_METHODS = ['Efectivo', 'Débito', 'Crédito', 'Transferencia', 'Mercado Pago', 'Otro'];
export const isCard = (m) => m === 'Débito' || m === 'Crédito';

/** Medio de pago + (si es tarjeta) POS, cuotas y n° de autorización del voucher. value = { payment_method, pos, installments, authorization } */
export default function PaymentFields({ value, onChange, brandName, label = 'Medio de pago' }) {
  const set = (k, v) => onChange({ ...value, [k]: v });
  return (
    <div>
      <div className="mb-1.5 text-[12px] font-semibold text-ink2">{label}</div>
      <div className="flex flex-wrap gap-2">
        {PAYMENT_METHODS.map((m) => (
          <button key={m} type="button" onClick={() => set('payment_method', m)}
            className={cx('h-9 rounded-md border px-3.5 text-[13px] font-medium transition', value.payment_method === m ? 'border-ink bg-ink text-paper' : 'border-line bg-card text-ink2 hover:border-ink/40')}>
            {m}
          </button>
        ))}
      </div>
      {isCard(value.payment_method) && (
        <div className="fade mt-3 flex flex-wrap items-end gap-4 rounded-lg bg-sunk/70 px-3 py-3">
          <div>
            <div className="mb-1.5 text-[12px] font-semibold text-ink2">¿En qué POS se pasó la tarjeta?</div>
            <div className="inline-flex rounded-md border border-line bg-card p-0.5">
              {[['maja', 'POS de MAJA'], ['marca', `POS de ${brandName || 'la marca'}`]].map(([v, l]) => (
                <button key={v} type="button" onClick={() => set('pos', v)}
                  className={cx('rounded px-3 py-1.5 text-[13px] font-medium', value.pos === v ? 'bg-ink text-paper' : 'text-ink2')}>{l}</button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-semibold text-ink2">N° de autorización</span>
            <input className="field num h-9 w-32 py-1 font-mono" inputMode="numeric" value={value.authorization || ''} onChange={(e) => set('authorization', e.target.value)} placeholder="del voucher" />
          </label>
          {value.payment_method === 'Crédito' && (
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-semibold text-ink2">Cuotas</span>
              <select className="field h-9 w-24 py-1" value={value.installments || '1'} onChange={(e) => set('installments', e.target.value)}>
                {[1, 2, 3, 4, 5, 6, 8, 10, 12].map((c) => <option key={c} value={c}>{c === 1 ? 'Contado' : c}</option>)}
              </select>
            </label>
          )}
          <p className="basis-full text-[12px] text-muted">Copiá la autorización del voucher que imprimió el POS: así se cruza exacto con el reporte de Handy, y mirando el voucher se ve en qué POS se pasó.</p>
        </div>
      )}
    </div>
  );
}

export const paymentReady = (v) => !!v.payment_method && (!isCard(v.payment_method) || (v.pos && String(v.authorization || '').trim()));
