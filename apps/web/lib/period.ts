export type Period = 7 | 14 | 30;

// Use the LOCAL calendar date — the agent (shared/date.ts `localDate`) and the seed
// both write `daily_activity.date` as the machine's local date, so the dashboard's
// window must be computed in local time too, or "today" is missed in non-UTC zones.
function isoDaysBack(today: Date, back: number): string {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  d.setDate(d.getDate() - back);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function dateRange(period: number, today = new Date()): string[] {
  return Array.from({ length: period }, (_, i) => isoDaysBack(today, period - 1 - i));
}

export function priorRange(period: number, today = new Date()): string[] {
  return Array.from({ length: period }, (_, i) => isoDaysBack(today, period + (period - 1 - i)));
}
