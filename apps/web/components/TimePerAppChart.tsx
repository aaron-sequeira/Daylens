'use client';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';
import type { AppUsage } from '@/lib/types';
export function TimePerAppChart({ apps }: { apps: AppUsage[] }) {
  const data = apps.map((a) => ({ app: a.appName, minutes: Math.round(a.totalSec / 60) }));
  return (
    <div className="h-56 rounded-xl border bg-white p-4">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
          <XAxis dataKey="app" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} />
          <Tooltip /><Bar dataKey="minutes" fill="#111827" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
