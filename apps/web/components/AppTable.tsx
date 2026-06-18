import type { AppUsage } from '@/lib/types';
import { Table, Th, Tr, Td } from '@/components/ui/Table';
export function AppTable({ apps }: { apps: AppUsage[] }) {
  return (
    <Table>
      <thead><Tr><Th>App</Th><Th>Time</Th><Th>Sessions</Th><Th>Active %</Th></Tr></thead>
      <tbody>
        {apps.map((a) => (
          <Tr key={a.appName}>
            <Td>{a.appName}</Td>
            <Td>{Math.round(a.totalSec / 60)} min</Td>
            <Td>{a.sessions}</Td>
            <Td>{a.activePct}%</Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}
