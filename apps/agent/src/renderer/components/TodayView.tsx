import { useEffect, useState, useCallback } from 'react';
import type { DaySummary } from '../../shared/types';
import { api } from '../lib/ipc';
import { formatDuration } from '../lib/format';
import { localDate } from '../../shared/date';
import { StatCard } from './StatCard';
import { DayPicker } from './DayPicker';
import { AppTable } from './AppTable';
import { TimePerAppChart } from './TimePerAppChart';
import { ActiveIdleDonut } from './ActiveIdleDonut';
import { AiSummaryCard } from './AiSummaryCard';

const today = (): string => localDate(Date.now());

export function TodayView() {
  const [days, setDays] = useState<string[]>([]);
  const [date, setDate] = useState<string>(today());
  const [summary, setSummary] = useState<DaySummary | null>(null);

  const load = useCallback(async (d: string) => {
    setSummary(await api.summary.getDay(d));
    setDays(await api.summary.getAvailableDays());
  }, []);

  useEffect(() => { void load(date); }, [date, load]);
  useEffect(() => api.onUpdate(() => { void load(date); }), [date, load]);

  if (!summary) return <div className="text-gray-500">Loading…</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Today</h2>
        <DayPicker days={days} value={date} onChange={setDate} />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Total tracked" value={formatDuration(summary.totalTrackedSec)} />
        <StatCard label="Active" value={formatDuration(summary.activeSec)} />
        <StatCard label="Idle" value={formatDuration(summary.idleSec)} />
      </div>
      <AiSummaryCard date={date} />
      <div className="grid grid-cols-2 gap-4">
        <TimePerAppChart apps={summary.apps} />
        <ActiveIdleDonut activeSec={summary.activeSec} idleSec={summary.idleSec} />
      </div>
      <AppTable apps={summary.apps} />
    </div>
  );
}
