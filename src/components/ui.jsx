import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { X, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';

const cx = (...c) => c.filter(Boolean).join(' ');
export { cx };

export function Button({ variant = 'primary', size = 'md', className, loading, children, ...props }) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-md font-medium transition disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30';
  const sizes = { sm: 'h-8 px-3 text-[13px]', md: 'h-9 px-4 text-[14px]', lg: 'h-11 px-5 text-[15px]' };
  const variants = {
    primary: 'bg-ink text-paper hover:bg-[#33302b]',
    accent: 'bg-accent text-paper hover:bg-[#6a251c]',
    ghost: 'text-ink2 hover:bg-sunk',
    outline: 'border border-line bg-card text-ink hover:border-ink/40',
    danger: 'border border-bad/30 bg-card text-bad hover:bg-bad-soft',
  };
  return (
    <button className={cx(base, sizes[size], variants[variant], className)} disabled={loading || props.disabled} {...props}>
      {loading && <Loader2 size={15} className="animate-spin" />}
      {children}
    </button>
  );
}

export function Field({ label, hint, children, className }) {
  return (
    <label className={cx('block', className)}>
      {label && <span className="mb-1.5 block text-[12px] font-semibold text-ink2">{label}</span>}
      {children}
      {hint && <span className="mt-1 block text-[12px] text-muted">{hint}</span>}
    </label>
  );
}
export const Input = ({ className, ...p }) => <input className={cx('field', className)} {...p} />;
export const Select = ({ className, children, ...p }) => <select className={cx('field', className)} {...p}>{children}</select>;
export const Textarea = ({ className, ...p }) => <textarea className={cx('field min-h-[80px]', className)} {...p} />;

export function Card({ className, children, ...p }) {
  return <div className={cx('rounded-xl border border-line bg-card', className)} {...p}>{children}</div>;
}

export function PageHeader({ eyebrow, title, children }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4 rise">
      <div>
        {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
        <h1 className="font-display text-[44px] leading-[1] tracking-tight">{title}</h1>
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function Badge({ tone = 'neutral', children }) {
  const tones = {
    neutral: 'bg-sunk text-ink2', ok: 'bg-ok-soft text-ok', warn: 'bg-warn-soft text-warn', bad: 'bg-bad-soft text-bad', accent: 'bg-accent-soft text-accent', ink: 'bg-ink text-paper',
  };
  return <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold', tones[tone])}>{children}</span>;
}

export function Empty({ icon: Icon, title, children, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      {Icon && <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-line text-muted"><Icon size={20} strokeWidth={1.6} /></div>}
      <div className="font-display text-[24px] leading-tight">{title}</div>
      {children && <p className="mt-2 max-w-md text-[13px] text-muted">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Loading() {
  return <div className="flex items-center justify-center py-20 text-muted"><Loader2 className="animate-spin" size={20} /></div>;
}

export function ErrorNote({ children }) {
  if (!children) return null;
  return <div className="flex items-start gap-2 rounded-md bg-bad-soft px-3 py-2 text-[13px] text-bad"><AlertCircle size={15} className="mt-0.5 shrink-0" />{children}</div>;
}

export function Modal({ open, onClose, title, children, footer, wide }) {
  useEffect(() => {
    if (!open) return;
    const h = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fade fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4 pt-[6vh] backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={cx('rise w-full rounded-xl border border-line bg-card shadow-[0_30px_80px_-20px_rgba(29,27,24,.45)]', wide ? 'max-w-4xl' : 'max-w-lg')}>
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 className="font-display text-[26px] leading-none">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1.5 text-muted hover:bg-sunk hover:text-ink" aria-label="Cerrar"><X size={18} /></button>
        </div>
        <div className="px-6 py-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line bg-paper/50 px-6 py-3.5">{footer}</div>}
      </div>
    </div>
  );
}

export function Stat({ label, value, sub, tone, className, delay = 0 }) {
  return (
    <div className={cx('rise min-w-0 rounded-xl border border-line bg-card px-5 py-4', className)} style={{ animationDelay: `${delay}ms` }}>
      <div className="eyebrow">{label}</div>
      <div className={cx('num mt-2 truncate font-display text-[clamp(26px,2.6vw,36px)] leading-none', tone === 'accent' && 'text-accent', tone === 'bad' && 'text-bad')}>{value}</div>
      {sub && <div className="mt-2 text-[12px] text-muted">{sub}</div>}
    </div>
  );
}

export function Tabs({ value, onChange, options }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-card p-0.5">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={cx('rounded-md px-3 py-1.5 text-[13px] font-medium transition', value === o.value ? 'bg-ink text-paper' : 'text-ink2 hover:text-ink')}>
          {o.label}{o.count ? <span className="ml-1.5 opacity-60">{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

// ---------- avisos ----------
const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((msg, tone = 'ok') => {
    const id = Math.random();
    setItems((x) => [...x, { id, msg, tone }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 3800);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex flex-col gap-2">
        {items.map((t) => (
          <div key={t.id} className={cx('rise pointer-events-auto flex items-center gap-2 rounded-lg px-4 py-3 text-[13px] font-medium shadow-lg', t.tone === 'bad' ? 'bg-bad text-paper' : 'bg-ink text-paper')}>
            {t.tone === 'bad' ? <AlertCircle size={15} /> : <CheckCircle2 size={15} />}{t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

export const STATUS_LABEL = {
  ingreso: { pendiente: 'Enviado', listo: 'Controlado', completado: 'Recibido', cancelado: 'Cancelado' },
  pickup: { pendiente: 'Por armar', listo: 'Listo para retirar', completado: 'Retirado', cancelado: 'Cancelado' },
  retiro: { pendiente: 'Solicitado', listo: 'Preparado', completado: 'Retirado', cancelado: 'Cancelado' },
};
export const STATUS_TONE = { pendiente: 'warn', listo: 'accent', completado: 'ok', cancelado: 'neutral' };
export const TYPE_LABEL = { ingreso: 'Ingreso de mercadería', pickup: 'Pick up', retiro: 'Retiro de mercadería' };

export const SETTLEMENT_BADGE = {
  pagada: ['ok', 'Pagada'], parcial: ['warn', 'Pago parcial'], pendiente: ['bad', 'Pendiente'], sin_cargo: ['neutral', 'Sin cargo'],
};
