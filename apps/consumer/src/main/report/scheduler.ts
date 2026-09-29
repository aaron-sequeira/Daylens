import { localDate } from '@worksight/core/date';
import { EARLY_MORNING_MIN, shiftDate } from '../day/time';
import type { GenerateOutcome } from './generate';
import { weekDates, weekStart } from './week';

export interface ReportSchedulerDeps {
  now(): number; windDown(date: string): string; row(date: string): { status: string } | null; hasActivity(date: string): boolean;
  canWrite(): boolean; gateOk(): boolean; otherJobRunning(): boolean; lowBattery(): Promise<boolean>;
  /** The lighter gate for a click (Generate / Regenerate): enough free memory now, no wait for idle. */
  manualGateOk(): boolean;
  /** An automatic weekly summary that is due (`'W:<weekStart>'`, see weekDueKey), checked after the daily reports. */
  weekDue(): string | null;
  /** Receives a date (`YYYY-MM-DD`) or a week key (`W:<weekStart>`): the scheduler keeps keys opaque. */
  generate(key: string): Promise<GenerateOutcome>; onChange?(): void;
}
export interface ReportScheduler { tick(): Promise<void>; request(date: string): void; cancel(date: string): void; queued(date: string): boolean;
  /** In the manual queue (a Generate / Regenerate click): the only kind of wait Cancel applies to. */
  requested(date: string): boolean;
  running(): string | null; waiting(): string | null; autoPaused(): boolean; resume(): void; }

const CRASH_WINDOW_MS = 10 * 60_000;
/** An automatic report needs at least this much screen time on the day; a near-empty day makes the writer
 * invent a narrative. `hasActivity` (wired in index.ts to a day's screen time) enforces it; manual Generate does not. */
export const MIN_AUTO_SCREEN_SEC = 1800;
/** An automatic weekly summary needs at least this many days with MIN_AUTO_SCREEN_SEC of screen time. */
export const WEEK_MIN_ACTIVE_DAYS = 3;

/** Which week's summary is due, as `'W:<weekStart>'`, or null. Last week is due once it has enough active days and
 * no row at all (a failed week is retried only by hand). The current week is due only on its Sunday, once that
 * Sunday's daily report is ready. Pure: index.ts wires the lookups. */
export function weekDueKey(i: { today: string; hasWeekly(ws: string): boolean; activeDays(ws: string): number; sundayReady(ws: string): boolean }): string | null {
  const current = weekStart(i.today), last = shiftDate(current, -7);
  if (!i.hasWeekly(last) && i.activeDays(last) >= WEEK_MIN_ACTIVE_DAYS) return `W:${last}`;
  if (weekDates(current)[6] === i.today && i.sundayReady(current) && !i.hasWeekly(current) && i.activeDays(current) >= WEEK_MIN_ACTIVE_DAYS) return `W:${current}`;
  return null;
}

const minutesOf = (hhmm: string): number => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

export function createReportScheduler(d: ReportSchedulerDeps): ReportScheduler {
  let running: string | null = null, waiting: string | null = null, paused = false, checking = false;
  let crashes: number[] = [];
  const manual: string[] = [];
  const change = (): void => d.onChange?.();

  const autoDue = (): string | null => {
    const now = d.now();
    const today = localDate(now), yesterday = shiftDate(today, -1);
    if (!d.row(yesterday) && d.hasActivity(yesterday)) return yesterday; // cheap row check first: hasActivity builds a day view
    const wd = minutesOf(d.windDown(today));
    const nowMin = new Date(now).getHours() * 60 + new Date(now).getMinutes();
    if (wd >= EARLY_MORNING_MIN && nowMin >= wd && !d.row(today) && d.hasActivity(today)) return today;
    return d.weekDue(); // daily reports first
  };

  return {
    async tick() {
      if (running || checking) return;
      checking = true;
      try {
        const isManual = manual.length > 0;
        const date = isManual ? manual[0] : paused ? null : autoDue();
        const wait = (w: string | null): void => { if (w !== waiting) { waiting = w; change(); } };
        if (!date) { wait(null); return; }
        // No usable writer: drop a manual request (so it can't block the queue), and don't call anything "waiting".
        if (!d.canWrite()) { if (isManual) manual.shift(); wait(null); return; }
        // Cheap checks first: the battery query spawns a process, so only ask once the gate is open.
        if (!(isManual ? d.manualGateOk() : d.gateOk()) || d.otherJobRunning()) { wait(date); return; }
        if (!isManual && await d.lowBattery()) { wait(null); return; }
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
          } catch (e) {
            console.error('Generate failed:', date, String(e).slice(0, 100));
          } finally { running = null; change(); }
        })();
      } finally { checking = false; }
    },
    request(date) { if (!manual.includes(date)) manual.push(date); change(); },
    cancel(date) {
      const i = manual.indexOf(date);
      if (i >= 0) manual.splice(i, 1);
      if (waiting === date) waiting = null;
      change();
    },
    queued: (date) => manual.includes(date) || waiting === date,
    requested: (date) => manual.includes(date),
    running: () => running,
    waiting: () => waiting,
    autoPaused: () => paused,
    resume() { paused = false; crashes = []; change(); }
  };
}
