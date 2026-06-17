import { redirect } from 'next/navigation';
import { getViewerProfile, getTeamMembers, getActivityForUsers } from '@/lib/queries';
import { dateRange, priorRange } from '@/lib/period';
import { memberPeriodStats, teamAggregate } from '@/lib/aggregate';
import { StatCard } from '@/components/StatCard';
import { PeriodSelector } from '@/components/PeriodSelector';
import { TrendChart } from '@/components/TrendChart';
import { RosterTable } from '@/components/RosterTable';

export default async function Overview({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const viewer = await getViewerProfile();
  if (!viewer) redirect('/login');
  const { period: rawPeriod } = await searchParams;
  const period = [7, 14, 30].includes(Number(rawPeriod)) ? Number(rawPeriod) : 14;

  const dates = dateRange(period);
  const prior = priorRange(period);
  const members = await getTeamMembers(viewer);
  const ids = members.map((m) => m.id);

  const cur = await getActivityForUsers(ids, dates);
  const prev = await getActivityForUsers(ids, prior);
  const team = teamAggregate(cur);

  const rows = members.map((m) =>
    memberPeriodStats(m.id, m.full_name, cur.filter((d) => d.userId === m.id), prev.filter((d) => d.userId === m.id))
  ).sort((a, b) => b.activityScore - a.activityScore);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Team overview</h1>
        <PeriodSelector period={period} />
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Team active hrs" value={team.totalActiveHours.toFixed(1)} sub={`last ${period} days`} />
        <StatCard label="Avg active %" value={`${Math.round(team.avgActivePct)}%`} />
        <StatCard label="Members tracked" value={String(team.membersTracked)} />
        <StatCard label="Top app" value={team.topApp ?? '—'} />
      </div>
      <TrendChart data={team.series} />
      <RosterTable rows={rows} />
    </div>
  );
}
