import { localDate } from '@worksight/core/date';
import { EARLY_MORNING_MIN, shiftDate } from '../day/time';
import type { GenerateOutcome } from './generate';

export interface ReportSchedulerDeps {
  now(): number; windDown(date: string): string; row(date: string): { status: string } | null; hasActivity(date: string): boolean;
  canWrite(): boolean; gateOk(): boolean; otherJobRunning(): boolean; lowBattery(): Promise<boolean>;
  /** The lighter gate for a click (Generate / Regenerate): enough free memory now, no wait for idle. */
  manualGateOk(): boolean;
  generate(date: string): Promise<GenerateOutcome>; onChange?(): void;
}
export interface ReportScheduler { tick(): Promise<void>; request(date: string): void; cancel(date: string): void; queued(date: string): boolean;
  running(): string | null; waiting(): string | null; autoPaused(): boolean; resume(): void; }

const CRASH_WINDOW_MS = 10 * 60_000;
/** An automatic report needs at least this much screen time on the day; a near-empty day makes the writer
 * invent a narrative. `hasActivity` (wired in index.ts to a day's screen time) enforces it; manual Generate does not. */
export const MIN_AUTO_SCREEN_SEC = 1800;
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
    return null;
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
    running: () => running,
    waiting: () => waiting,
    autoPaused: () => paused,
    resume() { paused = false; crashes = []; change(); }
  };
}
