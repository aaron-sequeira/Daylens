import { describe, it, expect } from 'vitest';
import { decide, holdReason, type GateContext } from './gate';
import type { Candidate, Kind, NudgeRow } from './types';

const MIN = 60_000, now = 10_000 * MIN;
const cand = (o: Partial<Candidate> = {}): Candidate => ({ ruleId: 'goal_80', kind: 'health', key: 'goal_80:d', mini: 'm', stat: 's', title: 't', body: 'b', primary: { label: 'OK', action: 'ack' }, ...o });
const row = (o: Partial<NudgeRow>): NudgeRow => ({ id: 1, at: now - 60 * MIN, date: 'd', kind: 'health', ruleId: 'x', key: 'k', title: 't', body: 'b', status: 'shown', ...o });
const ALL_ON: Record<Kind, boolean> = { health: true, behaviour: true, tip: true, win: true, reminder: true };
const TIP_CANDIDATE = cand({ kind: 'tip', ruleId: 'stuck_tip', key: 'stuck_tip:x' });
const ctx = (o: Partial<GateContext> = {}): GateContext => ({ now, history: [], kinds: ALL_ON, snoozeUntil: 0, fewer: {}, weight: 1, hold: null, ...o });

describe('decide', () => {
  it('shows a fresh candidate', () => { expect(decide(cand(), ctx())).toEqual({ status: 'show', offerFewer: false }); });
  it('drops a key that already fired (shown or held) within the history window', () => {
    expect(decide(cand(), ctx({ history: [row({ key: 'goal_80:d', status: 'held' })] })).status).toBe('drop');
  });
  it('drops disabled kinds', () => { expect(decide(cand(), ctx({ kinds: { ...ALL_ON, health: false } })).status).toBe('drop'); });
  it('enforces the 20-minute global cooldown except for eye_break/stretch', () => {
    const h = [row({ at: now - 10 * MIN, ruleId: 'scattered', kind: 'behaviour' })];
    expect(decide(cand(), ctx({ history: h })).status).toBe('drop');
    expect(decide(cand({ ruleId: 'eye_break', key: 'e:1' }), ctx({ history: h })).status).toBe('show');
    expect(decide(cand(), ctx({ history: [row({ at: now - 10 * MIN, ruleId: 'eye_break' })] })).status).toBe('show');
  });
  it('enforces the per-rule cooldown scaled by weight and back-off', () => {
    const h = [row({ at: now - 3 * 60 * MIN, ruleId: 'goal_80', key: 'old' })];
    expect(decide(cand(), ctx({ history: h })).status).toBe('show');
    expect(decide(cand(), ctx({ history: h, weight: 2 })).status).toBe('drop');
    expect(decide(cand(), ctx({ history: h, fewer: { health: 2 } })).status).toBe('drop');
  });
  it('gives eye_break/stretch their own 45-min gap scaled by weight, back-off and "show fewer"', () => {
    const eye = cand({ ruleId: 'eye_break', key: 'eye_break:s:2' });
    const h = [row({ at: now - 60 * MIN, ruleId: 'eye_break', key: 'eye_break:s:1' })];
    expect(decide(eye, ctx({ history: h })).status).toBe('show');
    expect(decide(eye, ctx({ history: h, weight: 2 }))).toEqual({ status: 'drop', reason: 'rule cooldown' });
    expect(decide(eye, ctx({ history: h, fewer: { health: 2 } }))).toEqual({ status: 'drop', reason: 'rule cooldown' });
    const dismissed = [1, 2, 3].map((d) => row({ at: now - d * 24 * 60 * MIN, status: 'dismissed', ruleId: 'r' + d, key: 'x' + d }));
    expect(decide(eye, ctx({ history: [...h, ...dismissed] })).status).toBe('drop');
    // A user-chosen 30-min interval keeps its cadence at weight 1: gap = 0.9 × 30 min.
    const eye30 = cand({ ruleId: 'eye_break', key: 'eye_break:t:2', gapMs: 27 * MIN });
    const h30 = [row({ at: now - 31 * MIN, ruleId: 'eye_break', key: 'eye_break:t:1' })];
    expect(decide(eye30, ctx({ history: h30 })).status).toBe('show');
    expect(decide(eye30, ctx({ history: h30, weight: 2 })).status).toBe('drop');
    expect(decide(cand({ ruleId: 'stretch', key: 'stretch:s:2' }), ctx({ history: [row({ at: now - 60 * MIN, ruleId: 'stretch' })], weight: 2 })).status).toBe('drop');
  });
  it('backs off after 3 dismissals of a kind and offers "show fewer"', () => {
    const h = [1, 2, 3].map((d) => row({ at: now - d * 24 * 60 * MIN, status: 'dismissed', ruleId: 'r' + d, key: 'x' + d }));
    expect(decide(cand(), ctx({ history: h }))).toEqual({ status: 'show', offerFewer: true });
  });
  it('holds while snoozed or when a hold reason applies', () => {
    expect(decide(cand(), ctx({ snoozeUntil: now + MIN }))).toEqual({ status: 'held', reason: 'snoozed' });
    expect(decide(cand(), ctx({ hold: 'call' }))).toEqual({ status: 'held', reason: 'call' });
  });
  it('reminders ignore the global and rule cooldowns but still obey snooze, holds and the kind switch', () => {
    const rem: Candidate = { ruleId: 'reminder', kind: 'reminder', key: 'reminder:2:2026-09-30', mini: '🍱 Lunch', stat: '1:00 pm', title: 'Lunch time 🍱', body: 'b', primary: { label: 'Start break', action: 'break_reminder' } };
    const recentTip: NudgeRow = { id: 1, at: now - 60_000, date: 'd', kind: 'tip', ruleId: 'stuck_tip', key: 'x', title: '', body: '', status: 'shown' };
    const recentRem: NudgeRow = { ...recentTip, id: 2, kind: 'reminder', ruleId: 'reminder', key: 'reminder:1:123' };
    expect(decide(rem, ctx({ history: [recentTip, recentRem] })).status).toBe('show');
    expect(decide(rem, ctx({ snoozeUntil: now + 1 })).status).toBe('held');
    expect(decide(rem, ctx({ hold: 'call' })).status).toBe('held');
    expect(decide(rem, ctx({ kinds: { ...ALL_ON, reminder: false } })).status).toBe('drop');
  });
  it('a shown reminder does not start the global cooldown for other pop-ups', () => {
    const recentRem: NudgeRow = { id: 2, at: now - 60_000, date: 'd', kind: 'reminder', ruleId: 'reminder', key: 'reminder:1:123', title: '', body: '', status: 'shown' };
    expect(decide(TIP_CANDIDATE, ctx({ history: [recentRem] })).status).toBe('show');
  });
  it('never offers "show fewer" for a reminder, even after 3+ dismissals of its kind', () => {
    const rem = cand({ kind: 'reminder', ruleId: 'reminder', key: 'reminder:9:x' });
    const h = [1, 2, 3].map((d) => row({ at: now - d * 24 * 60 * MIN, status: 'dismissed', kind: 'reminder', ruleId: 'reminder', key: 'y' + d }));
    expect(decide(rem, ctx({ history: h }))).toEqual({ status: 'show', offerFewer: false });
  });
});

describe('holdReason', () => {
  const display = { x: 0, y: 0, width: 1920, height: 1080 };
  const sys = (state: number | null, micInUse = false) => ({ state, micInUse });
  it('detects Focus Assist / fullscreen / calls', () => {
    expect(holdReason(null, [display], sys(6))).toBe('focus-assist');
    expect(holdReason({ appName: 'Game', title: 'x', bounds: { x: 0, y: 0, width: 1920, height: 1080 } }, [display], sys(5))).toBe('fullscreen');
    expect(holdReason({ appName: 'Google Chrome', title: 'Meet - abc-defg', bounds: null }, [display], sys(5))).toBe('call');
    expect(holdReason({ appName: 'Zoom Workplace', title: 'Zoom', bounds: null }, [display], sys(5))).toBe('call');
    expect(holdReason({ appName: 'Microsoft Teams', title: 'Meeting with Priya | Microsoft Teams', bounds: null }, [display], sys(null))).toBe('call');
  });
  it('holds as a call while any microphone is in use, even with the call app in the background', () => {
    expect(holdReason({ appName: 'Code', title: 'a.ts', bounds: null }, [display], sys(5, true))).toBe('call');
    expect(holdReason(null, [display], sys(null, true))).toBe('call');
  });
  it('does not hold for a normal maximised window or the desktop', () => {
    expect(holdReason({ appName: 'Code', title: 'a.ts', bounds: { x: 0, y: 0, width: 1920, height: 1040 } }, [display], sys(5))).toBeNull();
    expect(holdReason({ appName: 'Windows Explorer', title: 'Program Manager', bounds: display }, [display], sys(5))).toBeNull();
  });
});
