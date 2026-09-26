import { describe, it, expect } from 'vitest';
import { inFocus, planOverrides } from './plan';
import type { PlanItemRow } from '../report/store';

const row = (id: number, item: PlanItemRow['item'], enabled = true): PlanItemRow => ({ id, forDate: '2026-09-27', sourceDate: '2026-09-26', item, enabled });
describe('plan overrides', () => {
  it('turns enabled plan items into coach overrides for the day', () => {
    const o = planOverrides([
      row(1, { kind: 'focus_block', text: 'Focus 9:30', payload: { start: '09:30', minutes: 90 } }),
      row(2, { kind: 'app_cap', text: 'YouTube 30', payload: { app: 'YouTube', minutes: 30 } }),
      row(3, { kind: 'break_interval', text: 'Breaks 40', payload: { minutes: 40 } }),
      row(4, { kind: 'wind_down', text: 'Bed 22:30', payload: { time: '22:30' } }),
      row(5, { kind: 'break_interval', text: 'off', payload: { minutes: 20 } }, false)
    ], '2026-09-27');
    const start = new Date(2026, 8, 27, 9, 30).getTime();
    expect(o).toEqual({ breakIntervalMin: 40, windDownTime: '22:30', limits: [{ app: 'YouTube', minutes: 30 }],
      focus: [{ start, end: start + 90 * 60_000, label: '09:30', minutes: 90 }] });
    expect(inFocus(o.focus, start + 10 * 60_000)).toBe(true);
    expect(inFocus(o.focus, start + 91 * 60_000)).toBe(false);
  });
  it('is empty with no items', () => { expect(planOverrides([], '2026-09-27')).toEqual({ limits: [], focus: [] }); });
});
