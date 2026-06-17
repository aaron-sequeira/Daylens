import type { AppUsage } from '@/lib/types';
export function AppTable({ apps }: { apps: AppUsage[] }) {
  return (
    <table className="w-full rounded-xl border bg-white text-sm">
      <thead><tr className="border-b text-left text-xs uppercase text-gray-500">
        <th className="p-2">App</th><th className="p-2">Time</th><th className="p-2">Sessions</th><th className="p-2">Active %</th>
      </tr></thead>
      <tbody>
        {apps.map((a) => (
          <tr key={a.appName} className="border-b last:border-0">
            <td className="p-2">{a.appName}</td>
            <td className="p-2">{Math.round(a.totalSec / 60)} min</td>
            <td className="p-2">{a.sessions}</td>
            <td className="p-2">{a.activePct}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
