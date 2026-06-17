import Link from 'next/link';
import type { MemberPeriodStats } from '@/lib/types';
import { TrendArrow } from './TrendArrow';
export function RosterTable({ rows }: { rows: MemberPeriodStats[] }) {
  return (
    <table className="w-full rounded-xl border bg-white text-sm">
      <thead><tr className="border-b text-left text-xs uppercase text-gray-500">
        <th className="p-2">Member</th><th className="p-2">Avg active hrs</th><th className="p-2">Active %</th>
        <th className="p-2">Score</th><th className="p-2">Trend</th><th className="p-2">Days</th>
      </tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.userId} className="border-b last:border-0 hover:bg-gray-50">
            <td className="p-2"><Link href={`/members/${r.userId}`} className="text-gray-900 underline-offset-2 hover:underline">{r.fullName}</Link></td>
            <td className="p-2">{r.avgActiveHours.toFixed(1)}</td>
            <td className="p-2">{Math.round(r.avgActivePct)}%</td>
            <td className="p-2 font-medium">{r.activityScore}</td>
            <td className="p-2"><TrendArrow trend={r.trend} /></td>
            <td className="p-2">{r.daysWithData}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
