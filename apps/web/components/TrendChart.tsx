'use client';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
export function TrendChart({ data }: { data: { date: string; activeHours: number; score?: number }[] }) {
  return (
    <div className="h-64 w-full rounded-2xl border border-subtle bg-surface p-4">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
          <defs>
            <linearGradient id="accentGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--accent)" stopOpacity={0.35} />
              <stop offset="1" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--subtle)" />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} />
          <Tooltip />
          <Area type="monotone" dataKey="activeHours" stroke="var(--accent)" strokeWidth={2.5} fill="url(#accentGrad)" dot={false} name="Active hrs" />
          {data.some((d) => d.score !== undefined) && <Area type="monotone" dataKey="score" stroke="var(--accent-2)" strokeWidth={2} fill="transparent" dot={false} name="Score" />}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
