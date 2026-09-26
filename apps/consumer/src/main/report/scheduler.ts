import { localDate } from '@worksight/core/date';
import { EARLY_MORNING_MIN, shiftDate } from '../day/time';
import type { GenerateOutcome } from './generate';

export interface ReportSchedulerDeps {
  now(): number; windDown(date: string): string; row(date: string): { status: string } | null; hasActivity(date: string): boolean;
  canWrite(): boolean; gateOk(): boolean; otherJobRunning(): boolean; lowBattery(): Promise<boolean>;
  generate(date: string): Promise<GenerateOutcome>; onChange?(): void;
}
export interface ReportScheduler { tick(): Promise<void>; request(date: string): void; running(): string | null; waiting(): string | null; autoPaused(): boolean; resume(): void; }

const CRASH_WINDOW_MS = 10 * 60_000;
const minutesOf = (hhmm: string): number => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

export function createReportScheduler(d: ReportSchedulerDeps): ReportScheduler {
  let running: string | null = null, waiting: string | null = null, paused = false;
  let crashes: number[] = [];
  const manual: string[] = [];
  const change = (): void => d.onChange?.();

  const autoDue = (): string | null => {
    const now = d.now();
    const today = localDate(now), yesterday = shiftDate(today, -1);
    if (d.hasActivity(yesterday) && !d.row(yesterday)) return yesterday;
    const wd = minutesOf(d.windDown(today));
    const nowMin = new Date(now).getHours() * 60 + new Date(now).getMinutes();
    if (wd >= EARLY_MORNING_MIN && nowMin >= wd && d.hasActivity(today) && !d.row(today)) return today;
    return null;
  };

  return {
    async tick() {
      if (running) return;
      const isManual = manual.length > 0;
      const date = isManual ? manual[0] : paused ? null : autoDue();
      const wait = (w: string | null): void => { if (w !== waiting) { waiting = w; change(); } };
      if (!date || !d.canWrite()) { wait(date && isManual ? date : null); return; }
      if (!isManual && await d.lowBattery()) { wait(null); return; }
      if (!d.gateOk() || d.otherJobRunning()) { wait(date); return; }
      if (isManual) manual.shift();
      running = date; wait(null); change();
      void (async () => {
        try {
          const outcome = await d.generate(date);
          if (outcome === 'crash') {
            const now = d.now();
            crashes = [...crashes.filter((t) => now - t < CRASH_WINDOW_MS), now];
            if (crashes.length >= 3) paused = true;
          }
        } finally { running = null; change(); }
      })();
    },
    request(date) { if (!manual.includes(date)) manual.push(date); change(); },
    running: () => running,
    waiting: () => waiting,
    autoPaused: () => paused,
    resume() { paused = false; crashes = []; change(); }
  };
}
