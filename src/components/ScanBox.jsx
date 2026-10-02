import { useEffect, useRef, useState } from 'react';
import { ScanBarcode, CheckCircle2, XCircle } from 'lucide-react';
import { cx } from './ui.jsx';

let audio;
/** Pitido corto: agudo si salió bien, grave si no (para no tener que mirar la pantalla en cada escaneo). */
export function beep(ok = true) {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = ok ? 'sine' : 'square';
    o.frequency.value = ok ? 1320 : 220;
    g.gain.setValueAtTime(0.12, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + (ok ? 0.09 : 0.28));
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + (ok ? 0.1 : 0.3));
  } catch { /* sin audio */ }
}

/** Busca por SKU o por código de barras, sin distinguir mayúsculas ni espacios. */
export function findByCode(products, code) {
  const c = String(code).trim().toLowerCase();
  return products.find((p) => (p.barcode && String(p.barcode).trim().toLowerCase() === c) || String(p.sku).trim().toLowerCase() === c) ?? null;
}

/**
 * Campo para el escáner de códigos de barras: el lector escribe el código y manda Enter.
 * onScan(code) devuelve { ok, text } para mostrar y sonar. El foco vuelve solo al campo.
 */
export default function ScanBox({ onScan, placeholder = 'Escaneá o escribí el código y Enter', hint }) {
  const ref = useRef(null);
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const [last, setLast] = useState(null);
  const [count, setCount] = useState(0);

  useEffect(() => { ref.current?.focus(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    const code = value.trim();
    setValue('');
    if (!code) return;
    // onScan puede responder al toque o consultar al servidor (devuelve una promesa)
    let r;
    try { r = (await onScan(code)) ?? { ok: false, text: 'Sin resultado' }; } catch (err) { r = { ok: false, text: err.message }; }
    beep(r.ok);
    if (r.ok) setCount((n) => n + 1);
    setLast({ ...r, code, at: Date.now() });
    ref.current?.focus();
  };

  return (
    <div className={cx('rounded-xl border-2 p-3 transition', focused ? 'border-ink bg-card' : 'border-dashed border-line bg-sunk/50')}>
      <form onSubmit={submit} className="flex items-center gap-3">
        <ScanBarcode size={22} className={focused ? 'text-ink' : 'text-muted'} />
        <input ref={ref} value={value} onChange={(e) => setValue(e.target.value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          placeholder={focused ? placeholder : 'Tocá acá para escanear'} autoComplete="off" spellCheck={false}
          className="min-w-0 flex-1 bg-transparent font-mono text-[15px] outline-none placeholder:font-sans placeholder:text-[14px] placeholder:text-muted" />
        {count > 0 && <span className="num shrink-0 rounded-full bg-ink px-2.5 py-0.5 text-[12px] font-semibold text-paper">{count} leídos</span>}
      </form>
      {last && (
        <div key={last.at} className={cx('fade mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-[13px]', last.ok ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad')}>
          {last.ok ? <CheckCircle2 size={16} className="shrink-0" /> : <XCircle size={16} className="shrink-0" />}
          <span className="min-w-0"><span className="font-mono text-[12px] opacity-70">{last.code}</span> · <b>{last.text}</b></span>
        </div>
      )}
      {hint && !last && <div className="mt-2 text-[12px] text-muted">{hint}</div>}
    </div>
  );
}
