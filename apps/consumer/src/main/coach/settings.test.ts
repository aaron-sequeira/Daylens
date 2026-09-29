import { describe, it, expect } from 'vitest';
import { kindsInput, limitsInput, parseFewer, parseKinds, parseLimits, resetFewerOnEnable, snoozeInput } from './settings';

describe('coach settings', () => {
  it('parses stored JSON tolerantly', () => {
    expect(parseKinds('{"health":false}')).toEqual({ health: false, behaviour: true, tip: true, win: true, reminder: true });
    expect(parseKinds('bad')).toEqual({ health: true, behaviour: true, tip: true, win: true, reminder: true });
    expect(parseLimits('[{"app":"Discord","minutes":30},{"app":"","minutes":5}]')).toEqual([{ app: 'Discord', minutes: 30 }]);
    expect(parseLimits('nope')).toEqual([]);
    expect(parseFewer('{"tip":4,"win":"x"}')).toEqual({ tip: 4 });
  });
  it('validates IPC payloads', () => {
    expect(kindsInput.safeParse({ health: true, behaviour: false, tip: true, win: true, reminder: true }).success).toBe(true);
    expect(kindsInput.safeParse({ health: true }).success).toBe(false);
    expect(limitsInput.safeParse([{ app: 'Discord', minutes: 30 }]).success).toBe(true);
    expect(limitsInput.safeParse([{ app: 'Discord', minutes: 10 }]).success).toBe(false);
    expect(limitsInput.safeParse(Array.from({ length: 21 }, (_, i) => ({ app: `a${i}`, minutes: 30 }))).success).toBe(false);
    expect(snoozeInput.safeParse('1h').success).toBe(true);
    expect(snoozeInput.safeParse('forever').success).toBe(false);
  });
  it('resets the "show fewer" multiplier of every kind switched from off to on', () => {
    const prev = { health: false, behaviour: true, tip: false, win: true, reminder: true };
    const next = { health: true, behaviour: true, tip: false, win: false, reminder: true };
    expect(resetFewerOnEnable(prev, next, { health: 4, behaviour: 2, tip: 8 })).toEqual({ behaviour: 2, tip: 8 });
    expect(resetFewerOnEnable(next, next, { health: 4 })).toEqual({ health: 4 });
  });
});
