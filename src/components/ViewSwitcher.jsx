import { useEffect, useState } from 'react';
import { Eye, Undo2 } from 'lucide-react';
import { api, getOwnerToken } from '../lib/api.js';
import { useSession } from '../lib/session.jsx';
import { useToast } from './ui.jsx';

/** Selector "Ver como" de la dueña: su vista, la de una vendedora o la de cada marca. */
export function ViewSelect({ className = '' }) {
  const { user, isPreview, brands, startPreview, endPreview } = useSession();
  const toast = useToast();
  const [options, setOptions] = useState(isPreview ? [] : brands);
  const [busy, setBusy] = useState(false);

  // en vista previa de una marca, /brands devuelve solo esa: la lista completa se pide con la sesión de la dueña
  useEffect(() => {
    if (!isPreview) { setOptions(brands); return; }
    api('/brands', { token: getOwnerToken() }).then(setOptions).catch(() => {});
  }, [isPreview, brands]);

  const value = !isPreview ? 'owner' : user.role === 'vendedora' ? 'vendedora' : `marca:${user.brand_id}`;
  const change = async (v) => {
    if (v === value) return;
    setBusy(true);
    try {
      if (v === 'owner') endPreview();
      else if (v === 'vendedora') await startPreview('vendedora');
      else await startPreview('marca', Number(v.split(':')[1]));
    } catch (e) { toast(e.message, 'bad'); setBusy(false); }
  };

  return (
    <label className={`flex items-center gap-2 ${className}`}>
      <Eye size={15} className="shrink-0 opacity-70" />
      <span className="hidden text-[12px] sm:inline">Ver como</span>
      <select className="field h-9 w-auto min-w-[170px] py-1.5 text-ink" value={value} disabled={busy} onChange={(e) => change(e.target.value)}>
        <option value="owner">Dueña (mi vista)</option>
        <option value="vendedora">Vendedora</option>
        <optgroup label="Marcas">
          {options.filter((b) => b.active).map((b) => <option key={b.id} value={`marca:${b.id}`}>{b.name}</option>)}
        </optgroup>
      </select>
    </label>
  );
}

/** Franja arriba de todo mientras la dueña mira la app como otro perfil. */
export function PreviewBanner() {
  const { user, isPreview, endPreview } = useSession();
  if (!isPreview) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-accent px-4 py-2 text-[13px] text-paper md:px-8">
      <span className="font-semibold">Vista previa: así ve la app {user.role === 'vendedora' ? 'una vendedora' : user.brand_name}.</span>
      <span className="opacity-80">Solo lectura: no se puede guardar nada.</span>
      <div className="ml-auto flex items-center gap-2">
        <ViewSelect />
        <button onClick={endPreview} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-paper px-3 font-medium text-accent hover:bg-paper/90"><Undo2 size={14} />Volver a mi vista</button>
      </div>
    </div>
  );
}
