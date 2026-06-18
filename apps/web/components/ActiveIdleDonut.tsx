'use client';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
export function ActiveIdleDonut({ activeSec, idleSec }: { activeSec: number; idleSec: number }) {
  const data = [{ name: 'Active', value: activeSec }, { name: 'Idle', value: idleSec }];
  return (
    <div className="h-56 rounded-2xl border border-subtle bg-surface p-4">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={50} outerRadius={75}>
            <Cell fill="var(--accent)" /><Cell fill="var(--subtle)" />
          </Pie>
          <Tooltip formatter={(v: number) => `${Math.round(v / 60)} min`} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
