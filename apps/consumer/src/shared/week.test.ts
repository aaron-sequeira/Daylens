import { describe, it, expect } from 'vitest';
import { canGenerateWeek } from './week';

describe('canGenerateWeek', () => {
  it('past weeks always; the current week only from its Sunday; handles month/year ends', () => {
    expect(canGenerateWeek('2026-09-21', '2026-09-29')).toBe(true);
    expect(canGenerateWeek('2026-09-28', '2026-10-03')).toBe(false); // Saturday
    expect(canGenerateWeek('2026-09-28', '2026-10-04')).toBe(true);  // Sunday
    expect(canGenerateWeek('2025-12-29', '2026-01-04')).toBe(true);
  });
});
