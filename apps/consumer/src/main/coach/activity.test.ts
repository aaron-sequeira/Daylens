import { describe, it, expect } from 'vitest';
import { active, MIN, sess, T } from './fixtures';
import { clock, currentStretch, hm, normaliseSearch, switchesBetween } from './activity';

describe('currentStretch', () => {
  it('measures time since the last 2-minute rest', () => {
    const samples = [...active(T(9), 30), ...active(T(9, 30), 3, 0), ...active(T(9, 33), 60)];
    expect(currentStretch(samples, T(10, 33), null)).toEqual({ start: T(9, 33), ms: 60 * MIN });
  });
  it('is null when the user is not currently active', () => {
    expect(currentStretch(active(T(9), 30), T(9, 45), null)).toBeNull();
    expect(currentStretch([], T(9), null)).toBeNull();
  });
  it('restarts after a completed break screen', () => {
    expect(currentStretch(active(T(9), 90), T(10, 30), T(10))).toEqual({ start: T(10), ms: 30 * MIN });
  });
});

describe('formatting', () => {
  it('formats durations and clocks', () => {
    expect(hm(45)).toBe('45 min'); expect(hm(112)).toBe('1h 52m'); expect(hm(120)).toBe('2h 0m');
    expect(clock('23:00')).toBe('11:00 pm'); expect(clock('00:30')).toBe('12:30 am');
  });
});

describe('switchesBetween', () => {
  it('counts sessions that started inside the window', () => {
    const s = [sess('A', T(9)), sess('B', T(9, 5)), sess('C', T(9, 10)), sess('D', T(9, 20))];
    expect(switchesBetween(s, T(9, 1), T(9, 15))).toBe(2);
  });
  it('does not count title-only changes inside one app as switches', () => {
    const s = [sess('Code', T(9), null, 'a.ts'), sess('Code', T(9, 2), null, 'b.ts'), sess('Code', T(9, 4), null, 'c.ts'), sess('Chrome', T(9, 6)), sess('Chrome', T(9, 7), null, 'x')];
    expect(switchesBetween(s, T(9, 1), T(9, 15))).toBe(1);
  });
});

describe('normaliseSearch', () => {
  it('extracts queries from search-engine window titles', () => {
    expect(normaliseSearch('React  Hooks - Google Search - Google Chrome')).toBe('react hooks');
    expect(normaliseSearch('useEffect cleanup - Bing - Microsoft​ Edge')).toBe('useeffect cleanup');
    expect(normaliseSearch('typescript enum at DuckDuckGo — Mozilla Firefox')).toBe('typescript enum');
    expect(normaliseSearch('Inbox - Gmail - Google Chrome')).toBeNull();
    expect(normaliseSearch('Google Search - Google Chrome')).toBeNull();
  });
});
