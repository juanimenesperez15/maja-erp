import { useState } from 'react';
import { api } from '../lib/api.js';
import { useSession } from '../lib/session.jsx';
import { Button, Card, ErrorNote, Field, Input, PageHeader, useToast } from '../components/ui.jsx';

export default function Account() {
  const { user } = useSession();
  const toast = useToast();
  const [form, setForm] = useState({ current: '', next: '', repeat: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    if (form.next !== form.repeat) return setError('Las contraseñas nuevas no coinciden');
    setBusy(true);
    setError('');
    try {
      await api('/auth/password', { method: 'POST', body: form });
      setForm({ current: '', next: '', repeat: '' });
      toast('Contraseña actualizada');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader eyebrow={user.email} title="Mi cuenta" />
      <Card className="rise max-w-md p-6">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Contraseña actual"><Input type="password" value={form.current} onChange={set('current')} required autoComplete="current-password" /></Field>
          <Field label="Nueva contraseña" hint="Mínimo 8 caracteres"><Input type="password" value={form.next} onChange={set('next')} required autoComplete="new-password" /></Field>
          <Field label="Repetir nueva contraseña"><Input type="password" value={form.repeat} onChange={set('repeat')} required autoComplete="new-password" /></Field>
          <ErrorNote>{error}</ErrorNote>
          <Button type="submit" loading={busy}>Cambiar contraseña</Button>
        </form>
      </Card>
    </>
  );
}

/** Pantalla obligatoria cuando la dueña le puso una contraseña provisoria. */
export function ForcePassword() {
  const { user, logout } = useSession();
  const [form, setForm] = useState({ current: '', next: '', repeat: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    if (form.next !== form.repeat) return setError('Las contraseñas nuevas no coinciden');
    if (form.next === form.current) return setError('Elegí una distinta a la provisoria');
    setBusy(true);
    setError('');
    try { await api('/auth/password', { method: 'POST', body: form }); window.location.assign('/'); } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-12">
      <form onSubmit={submit} className="rise w-full max-w-sm space-y-5">
        <div className="font-display text-[48px] leading-none">MAJA<span className="text-accent">.</span></div>
        <div>
          <div className="eyebrow">{user.email}</div>
          <h1 className="mt-1 font-display text-[34px] leading-tight">Elegí tu contraseña</h1>
          <p className="mt-2 text-[13px] text-muted">Entraste con una contraseña provisoria. Elegí una propia para seguir.</p>
        </div>
        <Field label="Contraseña provisoria"><Input type="password" value={form.current} onChange={set('current')} required autoComplete="current-password" autoFocus /></Field>
        <Field label="Tu contraseña nueva" hint="Mínimo 8 caracteres"><Input type="password" value={form.next} onChange={set('next')} required autoComplete="new-password" /></Field>
        <Field label="Repetila"><Input type="password" value={form.repeat} onChange={set('repeat')} required autoComplete="new-password" /></Field>
        <ErrorNote>{error}</ErrorNote>
        <Button type="submit" size="lg" className="w-full" loading={busy}>Guardar y entrar</Button>
        <button type="button" onClick={logout} className="block w-full text-center text-[13px] text-ink2 underline decoration-line underline-offset-2">Salir</button>
      </form>
    </div>
  );
}
