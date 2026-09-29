import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { buildInsights, buildWeekInput, canGenerateWeek, createWeeklyStore, parseWeek, weekAllowedMinutes, weekDates, weekForCloud, weekPrompt, WEEKLY_SQL, weekStart, type InsightsDay, type WeekInput } from './week';
import { groundText } from './schema';

// Builds a WeekInput with one real day value and the rest zero, for weekAllowedMinutes edge cases.
const weekOf = (screenMin: number): WeekInput => ({
  weekStart: '2026-09-28',
  days: weekDates('2026-09-28').map((date, i) => ({ date, screenMin: i === 0 ? screenMin : 0, deepWorkMin: 0, healthScore: null, topApps: [], topSites: [] })),
  totals: { screenMin, deepWorkMin: 0, activeDays: screenMin > 0 ? 1 : 0, prevScreenMin: null }
});

const day = (date: string, h: number, deep = 0, score: number | null = 80): InsightsDay => ({ date, screenSec: h * 3600, byCategory: { work: h * 3600 }, healthScore: score, deepWorkSec: deep * 60 });
describe('week helpers', () => {
  it('finds Monday and the 7 dates', () => {
    expect(weekStart('2026-09-28')).toBe('2026-09-28'); // a Monday
    expect(weekStart('2026-10-04')).toBe('2026-09-28'); // Sunday
    expect(weekStart('2026-09-30')).toBe('2026-09-28');
    expect(weekDates('2026-09-28')).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
  });
  it('builds insight numbers: totals, previous week, best focus day, top apps, nudges', () => {
    const days = [day('2026-09-28', 6, 90), day('2026-09-29', 4, 30), day('2026-09-30', 0, 0, null), day('2026-10-01', 5, 120), day('2026-10-02', 2), day('2026-10-03', 0, 0, null), day('2026-10-04', 1)];
    const n = buildInsights({ weekStart: '2026-09-28', days, prevDays: [day('2026-09-21', 10, 60)],
      apps: [[{ app: 'Code', min: 200 }, { app: 'Chrome', min: 60 }], [{ app: 'Chrome', min: 100 }]], nudges: [{ status: 'acted' }, { status: 'dismissed' }, { status: 'acted' }, { status: 'expired' }] });
    expect(n.totals).toEqual({ screenSec: 18 * 3600, deepWorkSec: 240 * 60, avgHealth: 80, activeDays: 5 });
    expect(n.prev).toEqual({ screenSec: 10 * 3600, deepWorkSec: 3600 });
    expect(n.bestFocusDay).toBe('2026-10-01');
    expect(n.topApps).toEqual([{ app: 'Code', min: 200 }, { app: 'Chrome', min: 160 }]);
    expect(n.nudges).toEqual({ acted: 2, dismissed: 1 });
    expect(buildInsights({ weekStart: '2026-09-28', days: days.map((d) => ({ ...d, deepWorkSec: 0 })), prevDays: null, apps: [], nudges: [] }).bestFocusDay).toBeNull();
  });
  it('merges app names that differ only by case, keeping the spelling with the most minutes', () => {
    const n = buildInsights({ weekStart: '2026-09-21', days: [day('2026-09-21', 0, 0, null)], prevDays: null, nudges: [],
      apps: [[{ app: 'Code', min: 50 }], [{ app: 'code', min: 20 }, { app: 'Chrome', min: 30 }]] });
    expect(n.topApps).toEqual([{ app: 'Code', min: 70 }, { app: 'Chrome', min: 30 }]);
  });
  it('parses the week JSON with cuts and rejects a missing headline', () => {
    expect(parseWeek({ headline: 'h'.repeat(120), summary: 's'.repeat(900), focusForNextWeek: 'f'.repeat(300) })).toEqual({ headline: 'h'.repeat(80), summary: 's'.repeat(600), focusForNextWeek: 'f'.repeat(200) });
    expect(parseWeek({ headline: '', summary: 's', focusForNextWeek: 'f' })).toBeNull();
    expect(parseWeek('x')).toBeNull();
  });
  it('builds the writer input in minutes, strips headlines for the cloud, and lists allowed minutes', () => {
    const n = buildInsights({ weekStart: '2026-09-28', days: [day('2026-09-28', 2, 30), ...weekDates('2026-09-28').slice(1).map((d) => day(d, 0, 0, null))], prevDays: null, apps: [], nudges: [] });
    const w = buildWeekInput(n, weekDates('2026-09-28').map(() => ({ topApps: ['Code'], topSites: ['GitHub'], headline: 'Local headline' })));
    expect(w.days[0]).toMatchObject({ screenMin: 120, deepWorkMin: 30, topApps: ['Code'], headline: 'Local headline' });
    expect(w.totals).toMatchObject({ screenMin: 120, deepWorkMin: 30, activeDays: 1, prevScreenMin: null });
    expect(weekForCloud(w).days.every((d) => d.headline === undefined)).toBe(true);
    expect(weekAllowedMinutes(w)).toEqual(expect.arrayContaining([120, 30]));
  });
  it('also allows an hour-rounded mention of a real minute value ("about 21 hours" for 1234 min)', () => {
    const n = buildInsights({ weekStart: '2026-09-28', days: [day('2026-09-28', 1234 / 60), ...weekDates('2026-09-28').slice(1).map((d) => day(d, 0, 0, null))], prevDays: null, apps: [], nudges: [] });
    const w = buildWeekInput(n, weekDates('2026-09-28').map(() => ({ topApps: [], topSites: [] })));
    expect(w.days[0].screenMin).toBe(1234);
    const allowed = weekAllowedMinutes(w);
    expect(allowed).toEqual(expect.arrayContaining([1200, 1260])); // floor/round/ceil of 1234/60, ×60, both within 10% of 1234
    expect(groundText('You spent about 21 hours on screen this week.', allowed)).toBe('You spent about 21 hours on screen this week.');
  });
  it('only adds an hour-rounded value for minutes ≥120, and only within 10% of the real value', () => {
    expect(weekAllowedMinutes(weekOf(5))).not.toContain(60); // below 120: no hour-rounded value at all
    expect(weekAllowedMinutes(weekOf(45))).not.toContain(60); // below 120: no hour-rounded value at all
    // 150 → 120 is 20% off and 180 is 20% off: neither is within the 10% tolerance
    expect(weekAllowedMinutes(weekOf(150))).not.toContain(120);
    expect(weekAllowedMinutes(weekOf(150))).not.toContain(180);
  });
  it('tells the writer to state times exactly, not rounded or converted', () => {
    expect(weekPrompt({ weekStart: '2026-09-28', days: [], totals: { screenMin: 0, deepWorkMin: 0, activeDays: 0, prevScreenMin: null } }).system)
      .toContain("State times exactly as given in the input (as minutes, or as Xh Ym); don't round or convert.");
  });
  it('generates a week only for a finished week, or the current week from its own Sunday onward', () => {
    expect(canGenerateWeek('2026-09-28', '2026-09-30')).toBe(false); // Wednesday of the current week
    expect(canGenerateWeek('2026-09-28', '2026-10-04')).toBe(true); // Sunday of the current week
    expect(canGenerateWeek('2026-09-14', '2026-09-20')).toBe(true); // a week that has already finished
    expect(canGenerateWeek('2026-09-14', '2026-10-20')).toBe(true);
  });
  it('stores weekly rows and fails pending rows on restart', () => {
    const db = new Database(':memory:'); db.exec(WEEKLY_SQL);
    const s = createWeeklyStore(db);
    s.setPending('2026-09-28', 1);
    expect(s.get('2026-09-28')).toMatchObject({ status: 'pending' });
    s.setReady('2026-09-28', { headline: 'H', summary: 'S', focusForNextWeek: 'F' }, 'Qwen3 1.7B', 2);
    expect(s.get('2026-09-28')).toMatchObject({ status: 'ready', report: { headline: 'H' }, model: 'Qwen3 1.7B' });
    s.noteError('2026-09-28', 'busy');
    expect(s.get('2026-09-28')).toMatchObject({ status: 'ready', error: 'busy' });
    s.setPending('2026-10-05', 3); s.clearPending(4);
    expect(s.get('2026-10-05')).toMatchObject({ status: 'failed', error: 'interrupted' });
    s.delete('2026-10-05'); expect(s.get('2026-10-05')).toBeNull();
  });
});
