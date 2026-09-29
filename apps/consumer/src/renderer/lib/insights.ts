import type { InsightsView } from '../../main/ipc';

// Local date helpers only: the renderer must not import main/day/time.ts (it pulls in node-only report types),
// so week math (Monday-of, add days) is kept small and self-contained here, mirroring reportDateLabel's own
// date parsing in ./report.
function parseYmd(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function fmtYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function addDays(date: string, n: number): string {
  const d = parseYmd(date);
  d.setDate(d.getDate() + n);
  return fmtYmd(d);
}
function mondayOf(date: string): string {
  const offset = (parseYmd(date).getDay() + 6) % 7; // getDay() is 0 for Sunday
  return addDays(date, -offset);
}

// Fixed 3-letter abbreviations: toLocaleDateString's 'short' month varies by ICU data ("Sep" vs "Sept").
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "This week" / "Last week", or the date range ("22–28 Sep", or "29 Sep – 5 Oct" across a month boundary). */
export function weekLabel(weekStart: string, today: string): string {
  const current = mondayOf(today);
  if (weekStart === current) return 'This week';
  if (weekStart === addDays(current, -7)) return 'Last week';
  const start = parseYmd(weekStart);
  const end = parseYmd(addDays(weekStart, 6));
  return start.getMonth() === end.getMonth()
    ? `${start.getDate()}–${end.getDate()} ${MONTHS[end.getMonth()]}`
    : `${start.getDate()} ${MONTHS[start.getMonth()]} – ${end.getDate()} ${MONTHS[end.getMonth()]}`;
}

/** "↑ 12% vs last week" / "↓ 5% vs last week" / "same as last week" / "" when there's nothing to compare. */
export function deltaText(now: number, prev: number | null): string {
  if (!prev) return '';
  const pct = Math.round(((now - prev) / prev) * 100);
  if (pct === 0) return 'same as last week';
  return `${pct > 0 ? '↑' : '↓'} ${Math.abs(pct)}% vs last week`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** A day's short label for the week's bars and the best-focus-day callout: "Today", else a weekday name. */
export function dayShortLabel(date: string, today: string): string {
  return date === today ? 'Today' : WEEKDAYS[parseYmd(date).getDay()];
}

/** Generate is only offered for a past week (always finished), or the current week from its Sunday onward. */
export function weekReady(weekStart: string, today: string): boolean {
  return today >= addDays(weekStart, 6);
}

export type SummaryCardKind = 'summary' | 'writing' | 'waiting' | 'failed' | 'download' | 'cloud_offer' | 'notEnough' | 'generate';

/** Which card the weekly summary shows, in strict precedence order (mirrors reportCardKind in ./report). */
export function summaryCardKind(v: InsightsView): SummaryCardKind {
  if (v.row?.status === 'ready') return 'summary';
  if (v.running || v.row?.status === 'pending') return 'writing';
  if (v.waiting || v.queued) return 'waiting';
  if (v.writer.state === 'unavailable' || v.writer.state === 'cloud_setup') return 'cloud_offer';
  if (v.row?.status === 'failed') return 'failed';
  if (v.writer.state === 'missing' || v.writer.state === 'downloading' || v.writer.state === 'verifying') return 'download';
  if (!v.row && v.numbers.totals.activeDays < 3) return 'notEnough';
  return 'generate';
}
