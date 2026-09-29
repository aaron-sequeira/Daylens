import { describe, it, expect, afterEach } from 'vitest';
import { homeOffset, travelReminders, travelState, zoneShiftMs } from './travel';
import { dayBounds, setDayShift } from '../day/time';

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
    expect(travelState(c, 60, now, c.at)).toBeNull();
  });
  it('a second trip whose endsAt equals a turned-off trip\'s endsAt still shows', () => {
    const first = chg(now - 3 * D, 60, 960);   // diff 900 -> days 5, endsAt = now + 2D
    const second = chg(now, 60, 420);          // diff 360 -> days 2, endsAt = now + 2D (same as `first`'s)
    expect(travelState(second, 60, now, first.at)).not.toBeNull();
  });
});

describe('zoneShiftMs', () => {
  const dayStart = 100 * D;
  it('sums the offset changes recorded after the day started', () => {
    expect(zoneShiftMs([chg(dayStart + 2 * D, 0, 540)], dayStart)).toBe(9 * H);        // London → Tokyo since
    expect(zoneShiftMs([], dayStart)).toBe(0);                                          // no later changes
    expect(zoneShiftMs([chg(dayStart - D, 0, 540)], dayStart)).toBe(0);                 // before the day: already in the clock
    expect(zoneShiftMs([chg(dayStart + D, 0, 540), chg(dayStart + 3 * D, 540, 0)], dayStart)).toBe(0); // a round trip
  });
});

describe('a past London evening after flying to Tokyo (real zones)', () => {
  const host = Intl.DateTimeFormat().resolvedOptions().timeZone;
  afterEach(() => { setDayShift(null); process.env.TZ = host; });
  it('stays inside its day once dayBounds is shifted by the later change', () => {
    const evening = Date.UTC(2026, 8, 23, 19, 0);                                        // 20:00 BST on 23 Sep, stored as 2026-09-23
    const changes = [{ at: Date.UTC(2026, 8, 25, 12), fromName: 'GMT Standard Time', toName: 'Tokyo Standard Time', fromOffset: 60, toOffset: 540 }];
    process.env.TZ = 'Asia/Tokyo';
    const plain = dayBounds('2026-09-23');
    expect(evening >= plain.end).toBe(true);                                             // clipped without the shift
    setDayShift((start) => zoneShiftMs(changes.filter((c) => c.at >= start), start));
    const b = dayBounds('2026-09-23');
    expect(b).toEqual({ start: Date.UTC(2026, 8, 22, 23), end: Date.UTC(2026, 8, 23, 23) }); // London's 23 Sep (BST)
    expect(evening > b.start && evening < b.end).toBe(true);
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
