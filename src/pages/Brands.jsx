import { useState } from 'react';
import { Plus, Store, Pencil, FileText, Receipt } from 'lucide-react';
import { api } from '../lib/api.js';
import { useSession } from '../lib/session.jsx';
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Textarea, useToast } from '../components/ui.jsx';
import { useApi } from '../lib/session.jsx';
import { fmtInt, fmtMoney, fmtPct, fmtPeriod } from '../lib/format.js';

const EMPTY = {
  name: '', contact_name: '', email: '', phone: '', rut: '', commission_pct: '', monthly_fee: '', plus_iva: false, start_period: '', notes: '', active: true,
  razon_social: '', billing_mode: 'manual', iva_mode: 'basica', biller_token: '', biller_sucursal: '', biller_env: 'produccion',
};
export const BILLING_LABEL = {
  manual: 'Factura a mano',
  cuenta_ajena: 'Biller de MAJA · cuenta ajena',
  biller_marca: 'Biller propio',
};

export default function Brands() {
  const { brands, refreshBrands } = useSession();
  const [editing, setEditing] = useState(null);
  const [billing, setBilling] = useState(false);

  return (
    <>
      <PageHeader eyebrow="Administración" title="Marcas">
        <Button variant="outline" onClick={() => setBilling(true)}><Receipt size={15} />Facturación de MAJA</Button>
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
              <div className="mt-3 flex items-center gap-1.5 text-[12px] text-ink2"><FileText size={13} className="text-muted" />{BILLING_LABEL[b.billing_mode] || BILLING_LABEL.manual}</div>
              {b.start_period && <div className="mt-1 text-[12px] text-muted">Liquida desde {fmtPeriod(b.start_period)}</div>}
            </Card>
          ))}
        </div>
      )}

      {billing && <MajaBillingModal onClose={() => setBilling(false)} />}
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
        <Field label="RUT"><Input value={form.rut || ''} onChange={set('rut')} /></Field>
        <Field label="Razón social" className="col-span-2" hint="Como figura en DGI; sale en las facturas emitidas a nombre de la marca"><Input value={form.razon_social || ''} onChange={set('razon_social')} /></Field>

        <div className="col-span-2 mt-2 border-t border-line pt-4">
          <div className="eyebrow mb-3">Facturación de sus ventas</div>
          <div className="grid gap-2">
            {[
              ['cuenta_ajena', 'MAJA factura por cuenta de la marca', 'e-Ticket / e-Factura de venta por cuenta ajena con el Biller de MAJA; la marca figura como mandante.'],
              ['biller_marca', 'Con el Biller de la marca', 'Se emite automáticamente con el token de Biller de la marca.'],
              ['manual', 'A mano', 'La marca factura en su sistema y MAJA anota el número de la factura.'],
            ].map(([v, t, d]) => (
              <label key={v} className={`flex cursor-pointer gap-3 rounded-lg border px-3 py-2.5 transition ${form.billing_mode === v ? 'border-ink bg-sunk/60' : 'border-line hover:border-ink/30'}`}>
                <input type="radio" name="billing_mode" value={v} checked={form.billing_mode === v} onChange={set('billing_mode')} className="mt-1 accent-[#1d1b18]" />
                <span><span className="block text-[13px] font-semibold">{t}</span><span className="block text-[12px] text-muted">{d}</span></span>
              </label>
            ))}
          </div>
        </div>
        {form.billing_mode !== 'manual' && (
          <Field label="IVA de sus artículos" className="col-span-2">
            <Select value={form.iva_mode} onChange={set('iva_mode')}>
              <option value="basica">Régimen general · tasa básica 22 % (incluido en el precio)</option>
              <option value="minimo">Literal E / IVA mínimo</option>
              <option value="exento">Exento</option>
            </Select>
          </Field>
        )}
        {form.billing_mode === 'biller_marca' && <>
          <Field label="Token de Biller de la marca" hint={form.has_biller_token ? 'Ya hay un token guardado; dejalo vacío para no cambiarlo' : 'Se genera en biller.uy/api/tokens'} className="col-span-2">
            <Input type="password" value={form.biller_token || ''} onChange={set('biller_token')} autoComplete="off" placeholder={form.has_biller_token ? '••••••••' : ''} />
          </Field>
          <Field label="ID de sucursal en Biller" hint="Ajustes → Sucursales"><Input value={form.biller_sucursal || ''} onChange={set('biller_sucursal')} /></Field>
          <Field label="Ambiente">
            <Select value={form.biller_env} onChange={set('biller_env')}><option value="produccion">Producción</option><option value="test">Pruebas</option></Select>
          </Field>
        </>}
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

function MajaBillingModal({ onClose }) {
  const toast = useToast();
  const { data, loading } = useApi('/settings/billing');
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const f = form ?? (data ? { token: '', sucursal: data.sucursal, env: data.env } : null);
  const set = (k) => (e) => setForm({ ...f, [k]: e.target.value });

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await api('/settings/billing', { method: 'PUT', body: f });
      toast('Facturación de MAJA guardada');
      onClose();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal open title="Facturación de MAJA" onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={save} loading={busy} disabled={!f}>Guardar</Button></>}>
      {loading || !f ? null : (
        <div className="space-y-4">
          <p className="text-[13px] text-ink2">
            Es la cuenta de Biller de MAJA. Se usa para las marcas que facturan <b>por cuenta ajena</b>: MAJA emite el comprobante y la marca figura como mandante.
          </p>
          <Field label="Token de Biller" hint={data.has_token ? 'Ya hay un token guardado; dejalo vacío para no cambiarlo' : 'Se genera en biller.uy/api/tokens'}>
            <Input type="password" value={f.token} onChange={set('token')} autoComplete="off" placeholder={data.has_token ? '••••••••' : ''} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="ID de sucursal" hint="Ajustes → Sucursales"><Input value={f.sucursal} onChange={set('sucursal')} /></Field>
            <Field label="Ambiente"><Select value={f.env} onChange={set('env')}><option value="produccion">Producción</option><option value="test">Pruebas</option></Select></Field>
          </div>
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
    </Modal>
  );
}
