import { describe, it, expect } from 'vitest';
import { dateRange, priorRange } from './period';

describe('period ranges', () => {
  it('dateRange returns `period` consecutive YYYY-MM-DD ending today', () => {
    const r = dateRange(7, new Date('2026-06-17T12:00:00Z'));
    expect(r).toHaveLength(7);
    expect(r[6]).toBe('2026-06-17');
    expect(r[0]).toBe('2026-06-11');
  });
  it('priorRange returns the immediately preceding equal-length window', () => {
    const r = priorRange(7, new Date('2026-06-17T12:00:00Z'));
    expect(r).toHaveLength(7);
    expect(r[6]).toBe('2026-06-10');
    expect(r[0]).toBe('2026-06-04');
  });

  it('dateRange(30) covers the last 30 days ending today', () => {
    const today = new Date('2026-06-17T12:00:00Z');
    const r = dateRange(30, today);
    expect(r).toHaveLength(30);
    expect(r[29]).toBe('2026-06-17');
    expect(r[0]).toBe('2026-05-19');
  });

  it('priorRange(14) covers the 14-day window immediately before today\'s 14-day window', () => {
    const today = new Date('2026-06-17T12:00:00Z');
    const r = priorRange(14, today);
    expect(r).toHaveLength(14);
    expect(r[13]).toBe('2026-06-03');
    expect(r[0]).toBe('2026-05-21');
  });
});
