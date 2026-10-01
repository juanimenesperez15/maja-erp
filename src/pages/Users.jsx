import { useState } from 'react';
import { Plus, Users as UsersIcon, Pencil } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi, useSession } from '../lib/session.jsx';
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Loading, Modal, PageHeader, Select, useToast } from '../components/ui.jsx';
import { fmtDateTime } from '../lib/format.js';

const EMPTY = { name: '', email: '', password: '', role: 'marca', brand_id: '', active: true };

export default function UsersPage() {
  const { data, loading, reload } = useApi('/users');
  const { user: me } = useSession();
  const [editing, setEditing] = useState(null);

  return (
    <>
      <PageHeader eyebrow="Administración" title="Usuarios">
        <Button onClick={() => setEditing({ ...EMPTY })}><Plus size={16} />Nuevo usuario</Button>
      </PageHeader>
      <Card className="rise overflow-hidden">
        {loading && !data ? <Loading /> : !data?.length ? (
          <Empty icon={UsersIcon} title="Sin usuarios" />
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Nombre</th><th>Email</th><th>Acceso</th><th>Último ingreso</th><th /></tr></thead>
              <tbody>
                {data.map((u) => (
                  <tr key={u.id} className={u.active ? '' : 'opacity-50'}>
                    <td className="font-medium">{u.name}{u.id === me.id && <span className="ml-1.5 text-[12px] text-muted">(vos)</span>}</td>
                    <td className="text-ink2">{u.email}</td>
                    <td>{u.role === 'admin' ? <Badge tone="ink">MAJA · admin</Badge> : <Badge tone="accent">{u.brand_name}</Badge>}{!u.active && <span className="ml-1.5"><Badge tone="bad">Inactivo</Badge></span>}</td>
                    <td className="text-[13px] text-muted">{u.last_login_at ? fmtDateTime(u.last_login_at) : 'Nunca'}</td>
                    <td className="text-right"><button onClick={() => setEditing({ ...EMPTY, ...u, brand_id: u.brand_id ?? '', password: '' })} className="rounded-md p-1.5 text-muted hover:bg-sunk hover:text-ink" aria-label="Editar"><Pencil size={15} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="mt-4 max-w-2xl text-[13px] text-muted">
        Un usuario de marca ve solo lo suyo: su tablero, su stock, sus pedidos y pick ups, sus ventas y sus comisiones y cuotas. Los administradores de MAJA ven todo.
      </p>
      {editing && <UserModal user={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </>
  );
}

function UserModal({ user, onClose, onSaved }) {
  const { brands } = useSession();
  const toast = useToast();
  const [form, setForm] = useState(user);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      if (form.id) await api(`/users/${form.id}`, { method: 'PUT', body: form });
      else await api('/users', { method: 'POST', body: form });
      toast(form.id ? 'Usuario actualizado' : 'Usuario creado. Pasale el email y la contraseña a la marca.');
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open title={form.id ? 'Editar usuario' : 'Nuevo usuario'} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={save} loading={busy}>Guardar</Button></>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Tipo de acceso">
            <Select value={form.role} onChange={set('role')}>
              <option value="marca">Marca</option>
              <option value="admin">Administrador MAJA</option>
            </Select>
          </Field>
          {form.role === 'marca' && (
            <Field label="Marca">
              <Select value={form.brand_id} onChange={set('brand_id')}>
                <option value="">Elegí…</option>
                {brands.filter((b) => b.active || b.id === form.brand_id).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </Field>
          )}
        </div>
        <Field label="Nombre"><Input value={form.name} onChange={set('name')} /></Field>
        <Field label="Email (es el usuario para entrar)"><Input type="email" value={form.email} onChange={set('email')} autoComplete="off" /></Field>
        <Field label={form.id ? 'Nueva contraseña' : 'Contraseña'} hint={form.id ? 'Dejala vacía para no cambiarla' : 'Mínimo 8 caracteres'}>
          <Input type="text" value={form.password} onChange={set('password')} autoComplete="new-password" />
        </Field>
        {form.id && (
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={form.active} onChange={set('active')} className="h-4 w-4 accent-[#1d1b18]" />Usuario activo
          </label>
        )}
        <ErrorNote>{error}</ErrorNote>
      </div>
    </Modal>
  );
}
