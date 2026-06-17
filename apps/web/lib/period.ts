export type Period = 7 | 14 | 30;

function isoDaysBack(today: Date, back: number): string {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

export function dateRange(period: number, today = new Date()): string[] {
  return Array.from({ length: period }, (_, i) => isoDaysBack(today, period - 1 - i));
}

export function priorRange(period: number, today = new Date()): string[] {
  return Array.from({ length: period }, (_, i) => isoDaysBack(today, period + (period - 1 - i)));
}
