import { useState } from 'react';
import { api } from '../lib/api.js';
import { useSession } from '../lib/session.jsx';
import { Button, ErrorNote, Field, Input } from '../components/ui.jsx';

export default function Login() {
  const { needsSetup, signIn } = useSession();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api(needsSetup ? '/auth/setup' : '/auth/login', { method: 'POST', body: form });
      signIn(r.token, r.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden bg-ink text-paper lg:block">
        <div className="absolute inset-0 opacity-[.07]" style={{ backgroundImage: 'repeating-linear-gradient(90deg, #f4f0e8 0 1px, transparent 1px 88px)' }} />
        <div className="relative flex h-full flex-col justify-between p-14">
          <div className="text-[11px] font-semibold uppercase tracking-[.32em] text-paper/50">Multibrand</div>
          <div>
            <div className="rise font-display text-[150px] leading-[.85] tracking-[-.03em]">MAJA<span className="text-[#d98c7c]">.</span></div>
            <p className="rise mt-6 max-w-sm font-display text-[26px] italic leading-snug text-paper/70" style={{ animationDelay: '120ms' }}>
              Cada marca, su stock, sus ventas y sus cuentas, en un solo lugar.
            </p>
          </div>
          <div className="text-[12px] text-paper/40">Sistema de gestión</div>
        </div>
      </div>

      <div className="flex items-center justify-center px-6 py-12">
        <form onSubmit={submit} className="rise w-full max-w-sm space-y-5">
          <div className="font-display text-[56px] leading-none lg:hidden">MAJA<span className="text-accent">.</span></div>
          <div>
            <div className="eyebrow">{needsSetup ? 'Primer uso' : 'Acceso'}</div>
            <h1 className="mt-1 font-display text-[38px] leading-tight">{needsSetup ? 'Creá el usuario administrador' : 'Entrá a tu cuenta'}</h1>
            {needsSetup && <p className="mt-2 text-[13px] text-muted">Es la cuenta de MAJA. Después, desde Marcas y Usuarios, le das acceso a cada marca.</p>}
          </div>
          {needsSetup && <Field label="Tu nombre"><Input value={form.name} onChange={set('name')} autoFocus required /></Field>}
          <Field label="Email"><Input type="email" value={form.email} onChange={set('email')} autoFocus={!needsSetup} required autoComplete="username" /></Field>
          <Field label="Contraseña" hint={needsSetup ? 'Mínimo 8 caracteres' : undefined}>
            <Input type="password" value={form.password} onChange={set('password')} required autoComplete={needsSetup ? 'new-password' : 'current-password'} />
          </Field>
          <ErrorNote>{error}</ErrorNote>
          <Button type="submit" size="lg" className="w-full" loading={busy}>{needsSetup ? 'Crear y entrar' : 'Entrar'}</Button>
        </form>
      </div>
    </div>
  );
}
