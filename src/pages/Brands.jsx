import { useState } from 'react';
import { Plus, Store, Pencil } from 'lucide-react';
import { api } from '../lib/api.js';
import { useSession } from '../lib/session.jsx';
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Textarea, useToast } from '../components/ui.jsx';
import { fmtInt, fmtMoney, fmtPct, fmtPeriod } from '../lib/format.js';

const EMPTY = { name: '', contact_name: '', email: '', phone: '', rut: '', commission_pct: '', monthly_fee: '', plus_iva: false, start_period: '', notes: '', active: true };

export default function Brands() {
  const { brands, refreshBrands } = useSession();
  const [editing, setEditing] = useState(null);

  return (
    <>
      <PageHeader eyebrow="Administración" title="Marcas">
        <Button onClick={() => setEditing({ ...EMPTY })}><Plus size={16} />Nueva marca</Button>
      </PageHeader>

      {!brands.length ? (
        <Card><Empty icon={Store} title="Sin marcas cargadas" action={<Button onClick={() => setEditing({ ...EMPTY })}><Plus size={16} />Nueva marca</Button>}>
          Cada marca tiene su comisión sobre lo vendido y su cuota mensual. Con eso el sistema arma la liquidación de cada mes.
        </Empty></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {brands.map((b, i) => (
            <Card key={b.id} className={`rise group p-5 ${b.active ? '' : 'opacity-60'}`} style={{ animationDelay: `${i * 40}ms` }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-display text-[30px] leading-none">{b.name}</div>
                  <div className="mt-1.5 truncate text-[13px] text-muted">{[b.contact_name, b.email, b.phone].filter(Boolean).join(' · ') || 'Sin datos de contacto'}</div>
                </div>
                <button onClick={() => setEditing({ ...EMPTY, ...b, commission_pct: String(b.commission_pct), monthly_fee: String(b.monthly_fee), start_period: b.start_period || '' })}
                  className="rounded-md p-1.5 text-muted transition hover:bg-sunk hover:text-ink" aria-label="Editar"><Pencil size={15} /></button>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-4">
                <div><div className="eyebrow">Comisión</div><div className="num mt-1 text-[18px] font-semibold">{fmtPct(b.commission_pct)}</div></div>
                <div><div className="eyebrow">Cuota mensual</div><div className="num mt-1 text-[18px] font-semibold">{fmtMoney(b.monthly_fee)}{b.plus_iva && <span className="text-[12px] font-normal text-muted"> + IVA</span>}</div></div>
              </div>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {!b.active && <Badge tone="bad">Inactiva</Badge>}
                <Badge>{fmtInt(b.product_count)} artículos</Badge>
                <Badge>{fmtInt(b.stock_units)} en stock</Badge>
                <Badge tone={b.user_count ? 'ok' : 'warn'}>{b.user_count ? `${b.user_count} ${b.user_count === 1 ? 'acceso' : 'accesos'}` : 'Sin acceso creado'}</Badge>
              </div>
              {b.start_period && <div className="mt-3 text-[12px] text-muted">Liquida desde {fmtPeriod(b.start_period)}</div>}
            </Card>
          ))}
        </div>
      )}

      {editing && <BrandModal brand={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await refreshBrands(); }} />}
    </>
  );
}

function BrandModal({ brand, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(brand);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      if (form.id) await api(`/brands/${form.id}`, { method: 'PUT', body: form });
      else await api('/brands', { method: 'POST', body: form });
      toast(form.id ? 'Marca actualizada' : 'Marca creada');
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open title={form.id ? form.name || 'Editar marca' : 'Nueva marca'} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={save} loading={busy}>Guardar</Button></>}>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Nombre de la marca" className="col-span-2"><Input value={form.name} onChange={set('name')} autoFocus /></Field>
        <Field label="Comisión de MAJA (%)" hint="Sobre lo vendido en el mes"><Input inputMode="decimal" value={form.commission_pct} onChange={set('commission_pct')} placeholder="0" /></Field>
        <Field label="Cuota mensual ($)" hint="Monto fijo por mes"><Input inputMode="decimal" value={form.monthly_fee} onChange={set('monthly_fee')} placeholder="0" /></Field>
        <label className="col-span-2 flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={form.plus_iva} onChange={set('plus_iva')} className="h-4 w-4 accent-[#1d1b18]" />
          Comisión y cuota se cobran más IVA (22 %)
        </label>
        <Field label="Liquida desde (mes)" hint="Si lo dejás vacío, desde el mes de alta" className="col-span-2"><Input type="month" value={form.start_period} onChange={set('start_period')} /></Field>
        <Field label="Contacto"><Input value={form.contact_name} onChange={set('contact_name')} /></Field>
        <Field label="Teléfono"><Input value={form.phone} onChange={set('phone')} /></Field>
        <Field label="Email"><Input type="email" value={form.email} onChange={set('email')} /></Field>
        <Field label="RUT"><Input value={form.rut} onChange={set('rut')} /></Field>
        <Field label="Notas" className="col-span-2"><Textarea value={form.notes || ''} onChange={set('notes')} /></Field>
        {form.id && (
          <label className="col-span-2 flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={form.active} onChange={set('active')} className="h-4 w-4 accent-[#1d1b18]" />
            Marca activa (si la desactivás, sus usuarios no pueden entrar)
          </label>
        )}
      </div>
      <div className="mt-4"><ErrorNote>{error}</ErrorNote></div>
    </Modal>
  );
}
