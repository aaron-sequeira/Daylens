'use client';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
export function TrendChart({ data }: { data: { date: string; activeHours: number; score?: number }[] }) {
  return (
    <div className="h-64 w-full rounded-xl border bg-white p-4">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Line type="monotone" dataKey="activeHours" stroke="#111827" dot={false} name="Active hrs" />
          {data.some((d) => d.score !== undefined) && <Line type="monotone" dataKey="score" stroke="#10b981" dot={false} name="Score" />}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
