const money = new Intl.NumberFormat('es-UY', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const money2 = new Intl.NumberFormat('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = new Intl.NumberFormat('es-UY', { maximumFractionDigits: 0 });

// enteros sin decimales; si hay centavos, siempre dos ("$ 2.635,20", no "$ 2.635,2")
export const fmtMoney = (n, decimals = false) => {
  const v = Number(n) || 0;
  return `$ ${(decimals || !Number.isInteger(Math.round(v * 100) / 100) ? money2 : money).format(v)}`;
};
/** Lee números escritos a la uruguaya: "1.234,50", "150.000", "2500". */
export function parseNum(v) {
  let s = String(v ?? '').replace(/[\s$]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return s === '' || !Number.isFinite(n) ? null : n;
}
export const fmtInt = (n) => int.format(Number(n) || 0);
export const fmtPct = (n) => `${money.format(Number(n) || 0)} %`;

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const fmtPeriod = (p) => { if (!p) return ''; const [y, m] = p.split('-'); return `${MONTHS[Number(m) - 1]} ${y}`; };
export const fmtPeriodShort = (p) => { const [y, m] = p.split('-'); return `${MONTHS_SHORT[Number(m) - 1]} ${y.slice(2)}`; };
export const fmtDate = (d) => { if (!d) return ''; const [y, m, day] = d.slice(0, 10).split('-'); return `${day}/${m}/${y}`; };
export const fmtDateShort = (d) => { const [, m, day] = d.slice(0, 10).split('-'); return `${Number(day)} ${MONTHS_SHORT[Number(m) - 1]}`; };
// datetime('now') de SQLite viene en UTC sin zona
export const fmtDateTime = (s) => {
  if (!s) return '';
  const d = new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
  return d.toLocaleString('es-UY', { timeZone: 'America/Montevideo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

export const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Montevideo' }).format(new Date());
export const currentPeriod = () => todayISO().slice(0, 7);
export const shiftPeriod = (p, delta) => { const [y, m] = p.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7); };

export function downloadCSV(filename, rows) {
  const esc = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = '﻿' + rows.map((r) => r.map(esc).join(';')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Lee una planilla pegada o subida (separador ; , o tab). Devuelve objetos con encabezados normalizados. */
export function parseTable(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const first = lines[0];
  const sep = first.includes('\t') ? '\t' : first.split(';').length > first.split(',').length ? ';' : ',';
  const split = (line) => {
    const out = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (c === sep && !q) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const norm = (h) => h.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const ALIAS = { sku: 'sku', codigo: 'sku', code: 'sku', nombre: 'name', name: 'name', producto: 'name', articulo: 'name', descripcion: 'name', variante: 'variant', variant: 'variant', talle: 'variant', precio: 'price', price: 'price', pvp: 'price', stock: 'stock', cantidad: 'stock' };
  const headers = split(first).map((h) => ALIAS[norm(h)] || norm(h));
  return lines.slice(1).map((l) => Object.fromEntries(split(l).map((v, i) => [headers[i], v])));
}
