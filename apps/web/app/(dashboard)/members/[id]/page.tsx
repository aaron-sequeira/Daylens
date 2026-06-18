import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getMember, getActivityForUsers } from '@/lib/queries';
import { dateRange, priorRange } from '@/lib/period';
import { activityScore, activeHours, memberPeriodStats } from '@/lib/aggregate';
import { StatCard } from '@/components/ui/StatCard';
import { Segmented } from '@/components/ui/Segmented';
import { Card } from '@/components/ui/Card';
import { TrendChart } from '@/components/TrendChart';
import { TrendArrow } from '@/components/TrendArrow';
import { ActiveIdleDonut } from '@/components/ActiveIdleDonut';
import { TimePerAppChart } from '@/components/TimePerAppChart';
import { AppTable } from '@/components/AppTable';

export default async function MemberDetail(
  { params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ period?: string; day?: string }> }
) {
  const { id } = await params;
  const sp = await searchParams;
  const period = [7, 14, 30].includes(Number(sp.period)) ? Number(sp.period) : 14;

  const member = await getMember(id);
  if (!member) notFound(); // RLS hid the row, or it doesn't exist

  const dates = dateRange(period);
  const cur = await getActivityForUsers([id], dates);
  const prev = await getActivityForUsers([id], priorRange(period));
  const stats = memberPeriodStats(id, member.full_name, cur, prev);

  const series = cur
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({ date: d.date, activeHours: activeHours(d), score: activityScore(d) }));

  const daysWithData = series.map((s) => s.date);
  const selectedDay = sp.day && daysWithData.includes(sp.day) ? sp.day : daysWithData[daysWithData.length - 1];
  const dayRow = cur.find((d) => d.date === selectedDay);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/" className="text-sm text-muted hover:text-fg">← Team</Link>
          <h1 className="text-lg font-bold text-fg">{member.full_name}</h1>
        </div>
        <Segmented options={[{label:'7d',value:7},{label:'14d',value:14},{label:'30d',value:30}]} value={period} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatCard label="Activity score" value={String(stats.activityScore)} trend={<TrendArrow trend={stats.trend} />} />
        <StatCard label="Avg active hrs" value={stats.avgActiveHours.toFixed(1)} />
        <StatCard label="Days with data" value={String(stats.daysWithData)} />
      </div>

      <TrendChart data={series} />

      {dayRow ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-muted">Day:</span>
            {daysWithData.slice(-10).map((d) => (
              <Link key={d} href={`?period=${period}&day=${d}`}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${d === selectedDay ? 'bg-surface text-accent shadow-sm' : 'bg-surface-2 text-muted'}`}>{d}</Link>
            ))}
          </div>
          <Card>
            <div className="grid gap-4 md:grid-cols-2">
              <ActiveIdleDonut activeSec={dayRow.activeSec} idleSec={dayRow.idleSec} />
              <TimePerAppChart apps={dayRow.byApp} />
            </div>
          </Card>
          <AppTable apps={dayRow.byApp} />
        </div>
      ) : (
        <p className="text-sm text-muted">No activity in this period.</p>
      )}
    </div>
  );
}
