import Link from 'next/link';
import type { MemberPeriodStats } from '@/lib/types';
import { Table, Th, Tr, Td } from '@/components/ui/Table';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';

export function RosterTable({ rows }: { rows: MemberPeriodStats[] }) {
  return (
    <Table>
      <thead><Tr><Th>Member</Th><Th>Avg active hrs</Th><Th>Active %</Th><Th>Score</Th><Th>Trend</Th></Tr></thead>
      <tbody>
        {rows.map((r) => (
          <Tr key={r.userId} className="hover:bg-surface-2">
            <Td><Link href={`/members/${r.userId}`} className="flex items-center gap-2 hover:underline"><Avatar name={r.fullName} size={26} />{r.fullName}</Link></Td>
            <Td>{r.avgActiveHours.toFixed(1)}</Td>
            <Td>{Math.round(r.avgActivePct)}%</Td>
            <Td className="font-bold">{r.activityScore}</Td>
            <Td><Badge tone={r.trend.direction === 'up' ? 'success' : r.trend.direction === 'down' ? 'danger' : 'neutral'}>{r.trend.direction === 'up' ? '▲' : r.trend.direction === 'down' ? '▼' : '—'} {r.trend.delta >= 0 ? '+' : ''}{r.trend.delta}</Badge></Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}
