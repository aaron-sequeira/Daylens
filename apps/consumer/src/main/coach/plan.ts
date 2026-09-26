import type { PlanItemRow } from '../report/store';
import type { AppLimit } from './types';

export interface FocusBlock { start: number; end: number; label: string; minutes: number; }
export interface PlanOverrides { breakIntervalMin?: number; windDownTime?: string; limits: AppLimit[]; focus: FocusBlock[]; }

const atTime = (date: string, hhmm: string): number => {
  const [y, m, d] = date.split('-').map(Number); const [h, mi] = hhmm.split(':').map(Number);
  return new Date(y, m - 1, d, h, mi).getTime();
};

/** Enabled plan items for `date` → what the coach should do differently that day. Later items win. */
export function planOverrides(items: PlanItemRow[], date: string): PlanOverrides {
  const o: PlanOverrides = { limits: [], focus: [] };
  for (const { item, enabled } of items) {
    if (!enabled) continue;
    if (item.kind === 'break_interval') o.breakIntervalMin = item.payload.minutes;
    else if (item.kind === 'wind_down') o.windDownTime = item.payload.time;
    else if (item.kind === 'app_cap') o.limits.push({ app: item.payload.app, minutes: item.payload.minutes });
    else { const start = atTime(date, item.payload.start); o.focus.push({ start, end: start + item.payload.minutes * 60_000, label: item.payload.start, minutes: item.payload.minutes }); }
  }
  return o;
}
export const inFocus = (blocks: FocusBlock[], now: number): boolean => blocks.some((b) => now >= b.start && now < b.end);
