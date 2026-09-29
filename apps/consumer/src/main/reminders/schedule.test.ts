import { describe, it, expect } from 'vitest';
import type { ActivitySampleRow } from '@worksight/core/types';
import { planReminders } from './schedule';
import { builtinDefaults, type Reminder, type ReminderState } from '../../shared/reminders';

const at = (h: number, m = 0, d = 30) => new Date(2026, 8, d, h, m).getTime(); // Wed 30 Sep 2026
const [water, lunch, tea] = builtinDefaults([1, 2, 3, 4, 5]).map((r, i) => ({ ...r, id: i + 1 })) as Reminder[];
/** One active 60-s bucket per minute over [from, to). */
const active = (from: number, to: number): ActivitySampleRow[] =>
  Array.from({ length: Math.round((to - from) / 60_000) }, (_, i) => ({ id: i, bucketStart: from + i * 60_000, bucketEnd: from + (i + 1) * 60_000, active: 1, date: '2026-09-30' } as unknown as ActivitySampleRow));
const st = (o: Partial<ReminderState> = {}): ReminderState => ({ lastFiredDate: null, lastFiredAt: null, lastDoneAt: null, ...o });
const plan = (reminders: Reminder[], now: number, samples: ActivitySampleRow[], states = new Map<number, ReminderState>(), waterIntervalMin?: number) =>
  planReminders({ reminders, states, now, samples, waterIntervalMin });

describe('clock-time reminders', () => {
  it('are due from their time for 60 minutes, on their days, once per local day', () => {
    const s = active(at(12, 30), at(13, 5));
    expect(plan([lunch], at(12, 59), s).due).toBeNull();
    expect(plan([lunch], at(13, 1), s).due).toEqual({ reminder: lunch, slot: '2026-09-30' });
    expect(plan([lunch], at(14, 1), active(at(12, 30), at(14, 1))).due).toBeNull();                       // window over
    expect(plan([lunch], at(13, 1), s, new Map([[lunch.id, st({ lastFiredDate: '2026-09-30' })]])).due).toBeNull(); // already fired today
    expect(plan([lunch], at(13, 1, 26), active(at(12, 30, 26), at(13, 1, 26))).due).toBeNull();          // Saturday: not a workday
  });
  it('are skipped (marked fired) when there was no input around their time — away, asleep', () => {
    const r = plan([lunch], at(13, 30), active(at(13, 25), at(13, 30))); // woke at 13:25
    expect(r.due).toBeNull();
    expect(r.skipped).toEqual([{ id: lunch.id, date: '2026-09-30' }]);
  });
  it('a disabled reminder is never due', () => {
    expect(plan([{ ...lunch, enabled: false }], at(13, 1), active(at(12, 30), at(13, 1))).due).toBeNull();
  });
  it('fired-date uses the current local date (a repeated local date after a zone change is a new day only if the date differs)', () => {
    const states = new Map([[lunch.id, st({ lastFiredDate: '2026-09-29' })]]);
    expect(plan([lunch], at(13, 1), active(at(12, 30), at(13, 1)), states).due?.slot).toBe('2026-09-30');
  });
});

describe('interval reminders', () => {
  it('are due after N minutes of active screen time since the day started', () => {
    expect(plan([water], at(9, 59), active(at(9), at(9, 59))).due).toBeNull();
    expect(plan([water], at(10, 0), active(at(9), at(10))).due?.reminder.id).toBe(water.id);
  });
  it('count from the last "I had some"/done or the last time it was shown', () => {
    const s = active(at(9), at(10, 30));
    expect(plan([water], at(10, 30), s, new Map([[water.id, st({ lastDoneAt: at(10) })]])).due).toBeNull();
    expect(plan([water], at(10, 30), s, new Map([[water.id, st({ lastFiredAt: at(9, 45) })]])).due).toBeNull();
    expect(plan([water], at(11, 0), active(at(9), at(11)), new Map([[water.id, st({ lastDoneAt: at(10) })]])).due?.slot).toBe(String(at(10)));
  });
  it('restart after 10+ minutes away (idle or asleep)', () => {
    const s = [...active(at(9), at(9, 50)), ...active(at(10, 5), at(10, 40))]; // 15-min gap
    expect(plan([water], at(10, 40), s).due).toBeNull();                         // only 35 min since the gap
  });
  it('use the travel override for water', () => {
    expect(plan([water], at(9, 45), active(at(9), at(9, 45)), undefined, 45).due?.reminder.id).toBe(water.id);
  });
});

describe('choosing one', () => {
  it('prefers a clock-time reminder over an interval one, and the earliest clock time', () => {
    const s = active(at(12), at(16, 1));
    const r = plan([water, tea, lunch], at(16, 1), s, new Map([[lunch.id, st({ lastFiredDate: null })]]));
    expect(r.due?.reminder.id).toBe(tea.id); // lunch's window (13:00–14:00) is over; tea is due; water too, but clock wins
  });
});
