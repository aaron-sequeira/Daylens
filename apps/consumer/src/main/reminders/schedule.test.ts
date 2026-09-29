import { describe, it, expect } from 'vitest';
import type { ActivitySampleRow } from '@worksight/core/types';
import { createLockLog, planReminders } from './schedule';
import { builtinDefaults, type Reminder, type ReminderState } from '../../shared/reminders';

const at = (h: number, m = 0, d = 30) => new Date(2026, 8, d, h, m).getTime(); // Wed 30 Sep 2026
const [water, lunch, tea] = builtinDefaults([1, 2, 3, 4, 5]).map((r, i) => ({ ...r, id: i + 1 })) as Reminder[];
/** One active 60-s bucket per minute over [from, to). */
const buckets = (from: number, to: number, on: 0 | 1): ActivitySampleRow[] =>
  Array.from({ length: Math.round((to - from) / 60_000) }, (_, i) => ({ id: i, bucketStart: from + i * 60_000, bucketEnd: from + (i + 1) * 60_000, active: on, date: '2026-09-30' } as unknown as ActivitySampleRow));
const active = (from: number, to: number): ActivitySampleRow[] => buckets(from, to, 1);
/** Inactive buckets: the PC is on and unlocked, just no keyboard/mouse (a passive call, a video). */
const idle = (from: number, to: number): ActivitySampleRow[] => buckets(from, to, 0);
const st = (o: Partial<ReminderState> = {}): ReminderState => ({ lastFiredDate: null, lastFiredAt: null, lastDoneAt: null, ...o });
const plan = (reminders: Reminder[], now: number, samples: ActivitySampleRow[], states = new Map<number, ReminderState>(), waterIntervalMin?: number,
  awayIntervals?: { start: number; end: number | null }[]) =>
  planReminders({ reminders, states, now, samples, waterIntervalMin, awayIntervals });

describe('clock-time reminders', () => {
  it('are due from their time for 60 minutes, on their days, once per local day', () => {
    const s = active(at(12, 30), at(13, 5));
    expect(plan([lunch], at(12, 59), s).due).toBeNull();
    expect(plan([lunch], at(13, 1), s).due).toEqual({ reminder: lunch, slot: '2026-09-30' });
    expect(plan([lunch], at(14, 1), active(at(12, 30), at(14, 1))).due).toBeNull();                       // window over
    expect(plan([lunch], at(13, 1), s, new Map([[lunch.id, st({ lastFiredDate: '2026-09-30' })]])).due).toBeNull(); // already fired today
    expect(plan([lunch], at(13, 1, 26), active(at(12, 30, 26), at(13, 1, 26))).due).toBeNull();          // Saturday: not a workday
  });
  it('are skipped (marked fired) when the PC was asleep or tracking was off around their time (no buckets)', () => {
    const r = plan([lunch], at(13, 30), active(at(13, 25), at(13, 30))); // woke at 13:25
    expect(r.due).toBeNull();
    expect(r.skipped).toEqual([{ id: lunch.id, date: '2026-09-30' }]);
    const gap = [...active(at(12, 0), at(12, 50)), ...active(at(13, 10), at(13, 30))]; // asleep 12:50–13:10, across 13:00
    expect(plan([lunch], at(13, 30), gap).skipped).toEqual([{ id: lunch.id, date: '2026-09-30' }]);
  });
  it('are due, not skipped, when the user was idle but unlocked across their time (passive call or video)', () => {
    const s = [...active(at(12, 0), at(12, 40)), ...idle(at(12, 40), at(13, 30))];
    const r = plan([lunch], at(13, 30), s);
    expect(r.skipped).toEqual([]);
    expect(r.due?.reminder.id).toBe(lunch.id);
  });
  it('are skipped when the screen was locked across their time', () => {
    const s = [...active(at(12, 0), at(12, 40)), ...idle(at(12, 40), at(13, 30))]; // the tracker keeps writing idle buckets while locked
    const r = plan([lunch], at(13, 30), s, undefined, undefined, [{ start: at(12, 45), end: at(13, 20) }]);
    expect(r.due).toBeNull();
    expect(r.skipped).toEqual([{ id: lunch.id, date: '2026-09-30' }]);
    expect(plan([lunch], at(13, 30), s, undefined, undefined, [{ start: at(12, 45), end: null }]).skipped) // still locked
      .toEqual([{ id: lunch.id, date: '2026-09-30' }]);
    expect(plan([lunch], at(13, 30), s, undefined, undefined, [{ start: at(10), end: at(11) }]).due?.reminder.id).toBe(lunch.id); // an earlier lock doesn't matter
  });
  it('a lock at their time still waits for the settle minute before skipping', () => {
    const s = active(at(12, 0), at(13, 0));
    expect(plan([lunch], at(13, 0) + 30_000, s, undefined, undefined, [{ start: at(12, 59), end: null }])).toEqual({ due: null, skipped: [] });
  });
  it('never decides "away" before the minute after the time has been recorded', () => {
    const offSince1250 = active(at(12, 30), at(12, 50));
    const early = plan([lunch], at(13, 0) + 20_000, offSince1250); // 13:00:20 — grace minute not written yet
    expect(early).toEqual({ due: null, skipped: [] });
    const later = plan([lunch], at(13, 1) + 20_000, [...offSince1250, ...active(at(13, 0), at(13, 1))]); // they came back at 13:00
    expect(later.due?.reminder.id).toBe(lunch.id);
    expect(plan([lunch], at(13, 2), offSince1250).skipped).toEqual([{ id: lunch.id, date: '2026-09-30' }]); // really away
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
  it('use the travel override for water, reporting the minutes actually used', () => {
    const r = plan([water], at(9, 45), active(at(9), at(9, 45)), undefined, 45).due;
    expect(r?.reminder.id).toBe(water.id);
    expect(r?.effectiveMinutes).toBe(45);
    expect(plan([water], at(10), active(at(9), at(10))).due?.effectiveMinutes).toBe(60);
  });
  it('the travel override never lengthens a shorter water interval the user chose', () => {
    const w30 = { ...water, schedule: { type: 'interval' as const, minutes: 30 } };
    const r = plan([w30], at(9, 30), active(at(9), at(9, 30)), undefined, 45).due;
    expect(r?.reminder.id).toBe(water.id);
    expect(r?.effectiveMinutes).toBe(30);
  });
});

describe('createLockLog', () => {
  it('records lock → unlock stretches, keeps an open one open, and prunes ones older than 24 h', () => {
    const log = createLockLog();
    log.lock(at(9)); log.unlock(at(9, 30));
    log.lock(at(12)); log.lock(at(12, 5)); // a repeated lock event doesn't open a second stretch
    expect(log.intervals(at(12, 10))).toEqual([{ start: at(9), end: at(9, 30) }, { start: at(12), end: null }]);
    log.unlock(at(13)); log.unlock(at(13, 1)); // a stray unlock is ignored
    expect(log.intervals(at(13, 5))).toEqual([{ start: at(9), end: at(9, 30) }, { start: at(12), end: at(13) }]);
    expect(log.intervals(at(9, 31) + 24 * 3_600_000)).toEqual([{ start: at(12), end: at(13) }]);
  });
});

describe('choosing one', () => {
  it('prefers a clock-time reminder over an interval one, and the earliest clock time', () => {
    const s = active(at(12), at(16, 1));
    const r = plan([water, tea, lunch], at(16, 1), s, new Map([[lunch.id, st({ lastFiredDate: null })]]));
    expect(r.due?.reminder.id).toBe(tea.id); // lunch's window (13:00–14:00) is over; tea is due; water too, but clock wins
  });
});
