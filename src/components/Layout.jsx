import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { LayoutDashboard, Boxes, Truck, ShoppingBag, Receipt, Landmark, Store, Users, LogOut, Menu, X, KeyRound } from 'lucide-react';
import { useSession } from '../lib/session.jsx';
import { cx } from './ui.jsx';

export default function Layout() {
  const { user, isAdmin, brands, brandId, setBrandFilter, logout } = useSession();
  const [open, setOpen] = useState(false);
  const loc = useLocation();

  const nav = [
    { to: '/', label: 'Tablero', icon: LayoutDashboard, end: true },
    { to: '/ventas', label: 'Ventas', icon: Receipt },
    { to: '/stock', label: 'Stock', icon: Boxes },
    { to: '/pedidos', label: 'Pedidos', icon: Truck },
    { to: '/pickups', label: 'Pick ups', icon: ShoppingBag },
    { to: '/liquidaciones', label: isAdmin ? 'Liquidaciones' : 'Comisiones y cuotas', icon: Landmark },
  ];
  const adminNav = [
    { to: '/marcas', label: 'Marcas', icon: Store },
    { to: '/usuarios', label: 'Usuarios', icon: Users },
  ];
  const activeBrands = brands.filter((b) => b.active);

  const link = ({ to, label, icon: Icon, end }) => (
    <NavLink key={to} to={to} end={end} onClick={() => setOpen(false)}
      className={({ isActive }) => cx('group flex items-center gap-3 rounded-md px-3 py-2 text-[14px] transition',
        isActive ? 'bg-paper/10 text-paper' : 'text-paper/55 hover:bg-paper/5 hover:text-paper')}>
      {({ isActive }) => (<>
        <Icon size={17} strokeWidth={1.7} />
        <span>{label}</span>
        {isActive && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#d98c7c]" />}
      </>)}
    </NavLink>
  );

  return (
    <div className="flex min-h-screen">
      <aside className={cx('fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col bg-ink text-paper transition-transform lg:translate-x-0', open ? 'translate-x-0' : '-translate-x-full')}>
        <div className="px-6 pb-6 pt-7">
          <div className="font-display text-[42px] leading-none tracking-tight">MAJA<span className="text-[#d98c7c]">.</span></div>
          <div className="mt-1 text-[10px] font-semibold uppercase tracking-[.32em] text-paper/45">Multibrand</div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
          {nav.map(link)}
          {isAdmin && (<>
            <div className="px-3 pb-1.5 pt-6 text-[10px] font-semibold uppercase tracking-[.2em] text-paper/35">Administración</div>
            {adminNav.map(link)}
          </>)}
        </nav>
        <div className="border-t border-paper/10 p-4">
          <div className="text-[13px] font-medium">{user.name}</div>
          <div className="truncate text-[12px] text-paper/45">{isAdmin ? 'Administración MAJA' : user.brand_name}</div>
          <div className="mt-3 flex gap-1">
            <NavLink to="/cuenta" onClick={() => setOpen(false)} className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-paper/55 hover:bg-paper/5 hover:text-paper"><KeyRound size={13} />Contraseña</NavLink>
            <button onClick={logout} className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-paper/55 hover:bg-paper/5 hover:text-paper"><LogOut size={13} />Salir</button>
          </div>
        </div>
      </aside>
      {open && <div className="fade fixed inset-0 z-30 bg-ink/40 lg:hidden" onClick={() => setOpen(false)} />}

      <div className="flex min-w-0 flex-1 flex-col lg:pl-[248px]">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-paper/85 px-4 backdrop-blur md:px-8">
          <button className="rounded-md p-1.5 hover:bg-sunk lg:hidden" onClick={() => setOpen(!open)} aria-label="Menú">{open ? <X size={20} /> : <Menu size={20} />}</button>
          <div className="font-display text-[22px] lg:hidden">MAJA</div>
          <div className="ml-auto flex items-center gap-2">
            {isAdmin ? (
              !['/marcas', '/usuarios', '/cuenta'].includes(loc.pathname) && (
                <label className="flex items-center gap-2">
                  <span className="hidden text-[12px] text-muted sm:inline">Viendo</span>
                  <select className="field h-9 w-auto min-w-[190px] py-1.5" value={brandId} onChange={(e) => setBrandFilter(e.target.value)}>
                    <option value="">Todas las marcas</option>
                    {activeBrands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </label>
              )
            ) : (
              <div className="rounded-full border border-line bg-card px-3 py-1 text-[13px] font-medium">{user.brand_name}</div>
            )}
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-8 md:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
