import { describe, it, expect } from 'vitest';
import { homeOffset, travelReminders, travelState } from './travel';

const H = 3_600_000, D = 24 * H;
const chg = (at: number, fromOffset: number, toOffset: number) => ({ at, fromName: 'A', toName: 'B', fromOffset, toOffset });

describe('homeOffset', () => {
  it('is the current offset when nothing changed in 14 days', () => { expect(homeOffset([], 60, 100 * D)).toBe(60); });
  it('is the offset lived in longest over the last 14 days', () => {
    const now = 100 * D;
    expect(homeOffset([chg(now - 2 * D, 60, 540)], 540, now)).toBe(60);               // 12 days home, 2 in Tokyo
    expect(homeOffset([chg(now - 10 * D, 60, 540)], 540, now)).toBe(540);             // 4 days home, 10 in Tokyo
  });
});

describe('travelState', () => {
  const now = 100 * D;
  it('is off for small shifts, no change, or after its window', () => {
    expect(travelState(null, 60, now, 0)).toBeNull();
    expect(travelState(chg(now - H, 60, 120), 60, now, 0)).toBeNull();               // 1 h: not travel
    expect(travelState(chg(now - 4 * D, 60, 540), 60, now, 0)).toBeNull();           // 8 h → 3 days, over
  });
  it('east trip: direction, hours from home, day count, length', () => {
    expect(travelState(chg(now - 30 * H, 60, 540), 60, now, 0)).toMatchObject({ direction: 'east', fromHomeMin: 480, back: false, day: 2, days: 3 });
  });
  it('west trip and the length clamp (2..5 days)', () => {
    expect(travelState(chg(now - H, 60, -120), 60, now, 0)).toMatchObject({ direction: 'west', days: 2 });   // 3 h → 1 → clamp 2
    expect(travelState(chg(now - H, -480, 600), -480, now, 0)).toMatchObject({ days: 5 });                     // 18 h → 6 → clamp 5
  });
  it('flying home starts its own "back" travel mode', () => {
    expect(travelState(chg(now - H, 540, 60), 60, now, 0)).toMatchObject({ back: true, direction: 'west' });
  });
  it('turned off for this trip', () => {
    const c = chg(now - H, 60, 540);
    expect(travelState(c, 60, now, c.at + 3 * D)).toBeNull();
  });
});

describe('travelReminders', () => {
  it('daylight + last coffee at the right local times, no break', () => {
    const east = travelReminders({ direction: 'east', fromHomeMin: 480, back: false, day: 1, days: 3, endsAt: 0, tips: [] });
    expect(east.map((r) => [r.id, r.builtin, r.schedule, r.breakSec])).toEqual([
      [-1, 'travel_daylight', { type: 'time', time: '09:00', days: [1, 2, 3, 4, 5, 6, 7] }, 0],
      [-2, 'travel_coffee', { type: 'time', time: '14:00', days: [1, 2, 3, 4, 5, 6, 7] }, 0]
    ]);
    const west = travelReminders({ direction: 'west', fromHomeMin: -300, back: false, day: 1, days: 2, endsAt: 0, tips: [] });
    expect(west.map((r) => (r.schedule.type === 'time' ? r.schedule.time : ''))).toEqual(['16:00', '15:00']);
  });
});
