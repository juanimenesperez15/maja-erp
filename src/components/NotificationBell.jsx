import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { api } from '../lib/api.js';
import { fmtDateTime } from '../lib/format.js';
import { cx } from './ui.jsx';

/** Campana con los avisos del usuario (pick ups nuevos, mercadería recibida, caja con diferencia…). */
export default function NotificationBell() {
  const [data, setData] = useState({ rows: [], unread: 0 });
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const navigate = useNavigate();

  const load = useCallback(() => api('/notifications').then(setData).catch(() => {}), []);
  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    const h = (e) => box.current && !box.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const go = async (n) => {
    setOpen(false);
    if (!n.read) await api('/notifications/read', { method: 'POST', body: { ids: [n.id] } }).catch(() => {});
    load();
    if (n.link) navigate(n.link);
  };
  const readAll = async () => { await api('/notifications/read', { method: 'POST', body: {} }).catch(() => {}); load(); };

  return (
    <div className="relative" ref={box}>
      <button onClick={() => setOpen(!open)} className="relative rounded-md p-2 text-ink2 hover:bg-sunk hover:text-ink" aria-label={`Avisos${data.unread ? ` (${data.unread} sin leer)` : ''}`}>
        <Bell size={18} />
        {data.unread > 0 && <span className="num absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-paper">{data.unread > 9 ? '9+' : data.unread}</span>}
      </button>
      {open && (
        <div className="fade absolute right-0 top-full z-40 mt-2 w-[340px] max-w-[calc(100vw-24px)] overflow-hidden rounded-xl border border-line bg-card shadow-2xl">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="text-[13px] font-semibold">Avisos</span>
            {data.unread > 0 && <button onClick={readAll} className="text-[12px] text-ink2 hover:text-ink hover:underline">Marcar todo como leído</button>}
          </div>
          <ul className="max-h-[60vh] overflow-y-auto">
            {!data.rows.length && <li className="px-4 py-6 text-center text-[13px] text-muted">No hay avisos.</li>}
            {data.rows.map((n) => (
              <li key={n.id}>
                <button onClick={() => go(n)} className={cx('flex w-full gap-3 border-b border-line px-4 py-3 text-left last:border-0 hover:bg-sunk/60', !n.read && 'bg-accent-soft/40')}>
                  <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read ? 'bg-transparent' : 'bg-accent')} />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium leading-snug">{n.title}</span>
                    {n.body && <span className="mt-0.5 block text-[12px] text-ink2">{n.body}</span>}
                    <span className="mt-0.5 block text-[11px] text-muted">{fmtDateTime(n.created_at)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
