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
                    <td>{u.role === 'admin' ? <Badge tone="ink">Dueña · MAJA</Badge> : u.role === 'vendedora' ? <Badge tone="ok">Vendedora · MAJA</Badge> : <Badge tone="accent">{u.brand_name}</Badge>}{!u.active && <span className="ml-1.5"><Badge tone="bad">Inactivo</Badge></span>}</td>
                    <td className="text-[13px] text-muted">{u.last_login_at ? fmtDateTime(u.last_login_at) : 'Nunca'}</td>
                    <td className="text-right"><button onClick={() => setEditing({ ...EMPTY, ...u, brand_id: u.brand_id ?? '', password: '' })} className="rounded-md p-1.5 text-muted hover:bg-sunk hover:text-ink" aria-label="Editar"><Pencil size={15} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <PermissionTable />
      {editing && <UserModal user={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </>
  );
}

// Qué puede ver y hacer cada perfil. Refleja los controles del servidor (no es solo visual).
const PERMS = [
  ['Tablero', 'Toda la tienda: objetivos, cómo va cada marca, alertas, por medio de pago y por vendedora', 'Lo del día: sus ventas, pick ups por armar, mercadería por recibir, stock bajo', 'El suyo: ventas, unidades, stock, pendientes y saldo con MAJA'],
  ['Ventas', 'Todas, con totales y exportación; anula ventas', 'Registra ventas y devoluciones; ve los últimos 7 días, sin totales ni exportar; no anula', 'Solo las suyas, con factura y medio de pago'],
  ['Stock', 'Todo; alta, edición, importación, ajustes y exportación', 'Consulta stock y movimientos; no crea artículos ni cambia precios', 'Su mercadería; carga artículos y precios (el stock entra con un ingreso)'],
  ['Pedidos y pick ups', 'Todo, incluido cancelar', 'Crea, arma, recibe y entrega; no cancela', 'Pide ingresos, retiros y pick ups; cancela mientras no se empezó a armar'],
  ['Liquidaciones', 'Todas; cierra meses y registra pagos', '—', 'Sus comisiones, cuotas, lo cobrado en el POS de MAJA y su saldo'],
  ['Objetivos', 'Los define', '—', '—'],
  ['Conciliación de tarjetas', 'Sube reportes de Handy y corrige', '—', '—'],
  ['Marcas y usuarios', 'Los administra', 'Ve solo nombre y razón social de cada marca', 'Ve solo su ficha'],
];

function PermissionTable() {
  return (
    <Card className="rise mt-6 overflow-hidden">
      <div className="px-5 pb-2 pt-5">
        <div className="eyebrow">Qué ve y qué hace cada perfil</div>
        <div className="mt-1 text-[13px] text-muted">Los límites los controla el servidor: aunque alguien escriba la dirección a mano, no ve lo que no le corresponde.</div>
      </div>
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead><tr><th className="w-40" /><th>Dueña</th><th>Vendedora</th><th>Marca (ej. Kokoro)</th></tr></thead>
          <tbody>
            {PERMS.map(([area, owner, seller, brand]) => (
              <tr key={area}>
                <td className="align-top font-semibold">{area}</td>
                <td className="align-top text-[13px]">{owner}</td>
                <td className={`align-top text-[13px] ${seller === '—' ? 'text-muted' : ''}`}>{seller}</td>
                <td className={`align-top text-[13px] ${brand === '—' ? 'text-muted' : ''}`}>{brand}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
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
              <option value="vendedora">Vendedora de MAJA</option>
              <option value="admin">Dueña / administración de MAJA</option>
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
