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
});
