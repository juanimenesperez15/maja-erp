import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken, setUnauthorizedHandler } from './api.js';

const SessionCtx = createContext(null);
const BRAND_KEY = 'maja_brand_filter';

export function SessionProvider({ children }) {
  const [state, setState] = useState({ loading: true, needsSetup: false, user: null });
  const [brands, setBrands] = useState(null);
  const [brandFilter, setBrandFilterState] = useState(() => { try { return localStorage.getItem(BRAND_KEY) || ''; } catch { return ''; } });

  const logout = useCallback(() => {
    setToken(null);
    setBrands(null);
    setState({ loading: false, needsSetup: false, user: null });
  }, []);

  const refreshBrands = useCallback(async () => {
    const list = await api('/brands');
    setBrands(list);
    return list;
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    (async () => {
      try {
        const { needsSetup } = await api('/auth/status');
        if (needsSetup) return setState({ loading: false, needsSetup: true, user: null });
        if (!getToken()) return setState({ loading: false, needsSetup: false, user: null });
        const { user } = await api('/auth/me');
        setState({ loading: false, needsSetup: false, user });
      } catch {
        setState({ loading: false, needsSetup: false, user: null });
      }
    })();
  }, [logout]);

  useEffect(() => { if (state.user) refreshBrands().catch(() => {}); }, [state.user, refreshBrands]);

  const signIn = (token, user) => {
    setToken(token);
    setState({ loading: false, needsSetup: false, user });
  };

  const setBrandFilter = (v) => {
    setBrandFilterState(v);
    try { localStorage.setItem(BRAND_KEY, v); } catch { /* sin storage */ }
  };

  // isAdmin = personal de MAJA (dueña o vendedora): opera la tienda y ve todas las marcas.
  // isOwner = la dueña: además ve plata (comisiones, cuotas, saldos), objetivos y configura.
  const isOwner = state.user?.role === 'admin';
  const isSeller = state.user?.role === 'vendedora';
  const isAdmin = isOwner || isSeller;
  // la marca siempre opera sobre la suya; el admin elige en la barra superior
  const brandId = isAdmin ? ((brands || []).some((b) => String(b.id) === String(brandFilter)) ? brandFilter : '') : String(state.user?.brand_id ?? '');

  return (
    <SessionCtx.Provider value={{ ...state, isAdmin, isOwner, isSeller, brands: brands || [], brandsLoaded: brands !== null, refreshBrands, brandId, setBrandFilter, signIn, logout }}>
      {children}
    </SessionCtx.Provider>
  );
}

export const useSession = () => useContext(SessionCtx);

/** Carga datos de la API y los recarga cuando cambian las dependencias. */
export function useApi(path, query, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const key = JSON.stringify([path, query]);
  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await api(path, { query }));
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ...deps]);
  useEffect(() => { load(); }, [load]);
  return { data, error, loading, reload: load, setData };
}
