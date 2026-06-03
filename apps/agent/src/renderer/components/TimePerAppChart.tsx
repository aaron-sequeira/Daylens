import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import type { AppUsage } from '../../shared/types';

export function TimePerAppChart({ apps }: { apps: AppUsage[] }) {
  const data = apps.slice(0, 8).map((a) => ({ name: a.appName, minutes: Math.round(a.totalSec / 60) }));
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="mb-2 text-sm font-medium">Time per app (minutes)</div>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} layout="vertical" margin={{ left: 24 }}>
          <XAxis type="number" /><YAxis type="category" dataKey="name" width={120} />
          <Tooltip /><Bar dataKey="minutes" fill="#111827" radius={4} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
