import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getMember, getActivityForUsers } from '@/lib/queries';
import { dateRange, priorRange } from '@/lib/period';
import { activityScore, activeHours, memberPeriodStats } from '@/lib/aggregate';
import { StatCard } from '@/components/StatCard';
import { PeriodSelector } from '@/components/PeriodSelector';
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
          <Link href="/" className="text-sm text-gray-500 hover:text-gray-900">← Team</Link>
          <h1 className="text-lg font-semibold">{member.full_name}</h1>
        </div>
        <PeriodSelector period={period} />
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <StatCard label="Activity score" value={String(stats.activityScore)} sub={`${stats.trend.delta >= 0 ? '+' : ''}${stats.trend.delta} vs prior`} />
        <StatCard label="Avg active hrs" value={stats.avgActiveHours.toFixed(1)} />
        <StatCard label="Days with data" value={String(stats.daysWithData)} />
      </div>
      <div className="flex items-center gap-2 text-sm"><span>Trend:</span><TrendArrow trend={stats.trend} /></div>

      <TrendChart data={series} />

      {dayRow ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">Day:</span>
            {daysWithData.slice(-10).map((d) => (
              <Link key={d} href={`?period=${period}&day=${d}`}
                className={`rounded px-2 py-1 text-xs ${d === selectedDay ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>{d}</Link>
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <ActiveIdleDonut activeSec={dayRow.activeSec} idleSec={dayRow.idleSec} />
            <TimePerAppChart apps={dayRow.byApp} />
          </div>
          <AppTable apps={dayRow.byApp} />
        </div>
      ) : (
        <p className="text-sm text-gray-500">No activity in this period.</p>
      )}
    </div>
  );
}
