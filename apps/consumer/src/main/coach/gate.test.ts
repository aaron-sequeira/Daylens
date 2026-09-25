import { describe, it, expect } from 'vitest';
import { decide, holdReason, type GateContext } from './gate';
import type { Candidate, NudgeRow } from './types';

const MIN = 60_000, now = 10_000 * MIN;
const cand = (o: Partial<Candidate> = {}): Candidate => ({ ruleId: 'goal_80', kind: 'health', key: 'goal_80:d', mini: 'm', stat: 's', title: 't', body: 'b', primary: { label: 'OK', action: 'ack' }, ...o });
const row = (o: Partial<NudgeRow>): NudgeRow => ({ id: 1, at: now - 60 * MIN, date: 'd', kind: 'health', ruleId: 'x', key: 'k', title: 't', body: 'b', status: 'shown', ...o });
const ctx = (o: Partial<GateContext> = {}): GateContext => ({ now, history: [], kinds: { health: true, behaviour: true, tip: true, win: true }, snoozeUntil: 0, fewer: {}, weight: 1, hold: null, ...o });

describe('decide', () => {
  it('shows a fresh candidate', () => { expect(decide(cand(), ctx())).toEqual({ status: 'show', offerFewer: false }); });
  it('drops a key that already fired (shown or held) within the history window', () => {
    expect(decide(cand(), ctx({ history: [row({ key: 'goal_80:d', status: 'held' })] })).status).toBe('drop');
  });
  it('drops disabled kinds', () => { expect(decide(cand(), ctx({ kinds: { health: false, behaviour: true, tip: true, win: true } })).status).toBe('drop'); });
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
