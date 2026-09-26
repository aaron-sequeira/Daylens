import { describe, it, expect } from 'vitest';
import { addLimit, limitSuggestions, snoozeText } from './coach';

describe('coach UI helpers', () => {
  it('describes the snooze state', () => {
    const now = new Date(2026, 8, 25, 14, 0).getTime();
    expect(snoozeText(0, now)).toBe('Pop-ups are on');
    expect(snoozeText(now + 3_600_000, now)).toMatch(/^Snoozed until /);
  });
  it('suggests distraction apps not already limited', () => {
    expect(limitSuggestions(['YouTube', 'Discord'], [{ app: 'discord' }])).toEqual(['YouTube']);
    expect(limitSuggestions(['Games', 'News', 'X / Twitter'], [])).toEqual(['X / Twitter']);
  });
  it('adds limits case-insensitively unique, max 20', () => {
    expect(addLimit([{ app: 'Discord', minutes: 30 }], ' discord ', 60)).toEqual([{ app: 'Discord', minutes: 30 }]);
    expect(addLimit([], 'Steam', 45)).toEqual([{ app: 'Steam', minutes: 45 }]);
    expect(addLimit([], 'Ste\u0007am', 45)).toEqual([{ app: 'Steam', minutes: 45 }]);
    expect(addLimit(Array.from({ length: 20 }, (_, i) => ({ app: `a${i}`, minutes: 30 })), 'x', 30)).toHaveLength(20);
  });
});
