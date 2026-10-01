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
