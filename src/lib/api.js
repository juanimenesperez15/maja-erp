const TOKEN_KEY = 'maja_token';

export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
export const setToken = (t) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* sin storage */ } };
// mientras la dueña mira la app como otro perfil, su sesión real queda guardada aparte
const OWNER_KEY = 'maja_owner_token';
export const getOwnerToken = () => { try { return localStorage.getItem(OWNER_KEY); } catch { return null; } };
export const setOwnerToken = (t) => { try { t ? localStorage.setItem(OWNER_KEY, t) : localStorage.removeItem(OWNER_KEY); } catch { /* sin storage */ } };

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export async function api(path, { method = 'GET', body, query, token: tokenOverride } = {}) {
  let url = `/api${path}`;
  if (query) {
    const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ''));
    if ([...qs].length) url += `?${qs}`;
  }
  const headers = { 'Content-Type': 'application/json' };
  const token = tokenOverride || getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token) onUnauthorized();
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}
