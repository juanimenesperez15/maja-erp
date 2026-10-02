import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmtDateShort, fmtInt, fmtMoney, fmtPeriod } from '../lib/format.js';

export const INK = '#1d1b18';
export const ACCENT = '#7c2d23';
const GRID = '#e0d8ca';
const AXIS = { fontSize: 11, fill: '#857d71' };
const MONTH_LETTER = ['E', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const kfmt = (v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1000 ? `${Math.round(v / 1000)}k` : v);

function ChartTip({ active, payload, label, labelFmt }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-card px-3 py-2 text-[12px] shadow-lg">
      <div className="text-muted">{labelFmt ? labelFmt(label) : label}</div>
      <div className="num mt-0.5 text-[14px] font-semibold text-ink">{fmtMoney(payload[0].value)}</div>
      {payload[0].payload.units !== undefined && <div className="text-muted">{fmtInt(payload[0].payload.units)} unidades</div>}
    </div>
  );
}

/** Días del mes hasta hoy, con 0 en los días sin ventas. */
export function fillDays(period, rows) {
  const [y, m] = period.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Montevideo' }).format(new Date());
  const map = Object.fromEntries(rows.map((r) => [r.date, r]));
  const out = [];
  for (let d = 1; d <= last; d++) {
    const date = `${period}-${String(d).padStart(2, '0')}`;
    if (date > today) break;
    out.push(map[date] ?? { date, total: 0, units: 0 });
  }
  return out;
}

// sin animación: con "reducir movimiento" de Windows los gráficos quedaban en blanco hasta terminar
export function DailyChart({ data, height = 240 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
        <defs>
          <linearGradient id="gDaily" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={ACCENT} stopOpacity={0.22} /><stop offset="1" stopColor={ACCENT} stopOpacity={0} /></linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="date" tickFormatter={(d) => Number(d.slice(8))} tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={14} />
        <YAxis tickFormatter={kfmt} tick={AXIS} axisLine={false} tickLine={false} width={40} />
        <Tooltip content={<ChartTip labelFmt={fmtDateShort} />} cursor={{ stroke: INK, strokeDasharray: '3 3' }} />
        <Area type="monotone" dataKey="total" stroke={ACCENT} strokeWidth={2} fill="url(#gDaily)" dot={data.length < 3} activeDot={{ r: 4, stroke: '#fbf9f5', strokeWidth: 2 }} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function MonthsChart({ data, height = 240 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ left: 0, right: 0, top: 8 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="period" tickFormatter={(p) => MONTH_LETTER[Number(p.slice(5)) - 1]} tick={AXIS} axisLine={false} tickLine={false} interval={0} />
        <YAxis tickFormatter={kfmt} tick={AXIS} axisLine={false} tickLine={false} width={40} />
        <Tooltip content={<ChartTip labelFmt={fmtPeriod} />} cursor={{ fill: 'rgba(236,230,219,.6)' }} />
        <Bar dataKey="total" fill={INK} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
