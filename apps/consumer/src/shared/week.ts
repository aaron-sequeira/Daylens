/** Generate may run for a week only once it's finished: any past week, or the current week from its own Sunday on.
 * Shared by main (report/week.ts) and the renderer (lib/insights.ts weekReady). Dates are local YYYY-MM-DD. */
export function canGenerateWeek(ws: string, today: string): boolean {
  const [y, m, d] = ws.split('-').map(Number);
  const s = new Date(y, m - 1, d + 6);
  const sunday = `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, '0')}-${String(s.getDate()).padStart(2, '0')}`;
  return today >= sunday;
}
