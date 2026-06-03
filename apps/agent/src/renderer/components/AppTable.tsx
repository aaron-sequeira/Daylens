import type { AppUsage } from '../../shared/types';
import { formatDuration, formatClock, formatPct } from '../lib/format';

export function AppTable({ apps }: { apps: AppUsage[] }) {
  if (apps.length === 0) return <div className="rounded-xl border bg-white p-6 text-sm text-gray-500">No activity recorded for this day yet.</div>;
  return (
    <div className="overflow-hidden rounded-xl border bg-white">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr><th className="p-3">Application</th><th className="p-3">Time</th><th className="p-3">Sessions</th><th className="p-3">First open</th><th className="p-3">Last close</th><th className="p-3">Active</th></tr>
        </thead>
        <tbody>
          {apps.map((a) => (
            <tr key={a.appName} className="border-t">
              <td className="p-3 font-medium">{a.appName}</td>
              <td className="p-3">{formatDuration(a.totalSec)}</td>
              <td className="p-3">{a.sessions}</td>
              <td className="p-3">{formatClock(a.firstOpenAt)}</td>
              <td className="p-3">{formatClock(a.lastCloseAt)}</td>
              <td className="p-3">{formatPct(a.activePct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
