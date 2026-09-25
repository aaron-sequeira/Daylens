import { describe, it, expect, vi } from 'vitest';
import { createCoach, type CoachDeps } from './engine';
import { snap, T } from './fixtures';
import type { Candidate, NudgeRow, NudgeStatus, PillNudge } from './types';

const c = (o: Partial<Candidate> = {}): Candidate => ({ ruleId: 'goal_80', kind: 'health', key: 'goal_80:d', mini: 'm', stat: 's', title: 't', body: 'b', primary: { label: 'OK', action: 'ack' }, ...o });
function deps(o: Partial<CoachDeps> = {}) {
  const rows: (NudgeRow & { status: NudgeStatus })[] = [];
  const shown: PillNudge[] = [];
  const d: CoachDeps = {
    now: () => T(12), snapshot: () => snap(), history: () => rows,
    kinds: () => ({ health: true, behaviour: true, tip: true, win: true }), snoozeUntil: () => 0, fewer: () => ({}),
    weight: () => 1, holdReason: async () => null,
    record: (cand, status, now) => { rows.push({ id: rows.length + 1, at: now, date: 'd', kind: cand.kind, ruleId: cand.ruleId, key: cand.key, title: cand.title, body: cand.body, status }); return rows.length; },
    setStatus: (id, s) => { rows[id - 1].status = s; },
    show: (n) => { shown.push(n); return true; },
    rules: [() => c()], ...o
  };
  return { d, rows, shown };
}

describe('coach engine', () => {
  it('shows a candidate and records it as shown', async () => {
    const { d, rows, shown } = deps();
    expect(await createCoach(d).tick()).toBe('shown');
    expect(rows.map((r) => r.status)).toEqual(['shown']);
    expect(shown[0]).toMatchObject({ id: 1, kind: 'health', title: 't', primaryLabel: 'OK', offerFewer: false });
  });
  it('never shows the same key twice', async () => {
    const { d, shown } = deps();
    const coach = createCoach(d);
    await coach.tick(); await coach.tick();
    expect(shown).toHaveLength(1);
  });
  it('holds (and records) when a hold reason applies, without showing', async () => {
    const { d, rows, shown } = deps({ holdReason: async () => 'call' });
    expect(await createCoach(d).tick()).toBe('held');
    expect(rows[0].status).toBe('held');
    expect(shown).toHaveLength(0);
  });
  it('only queries the hold reason when something is about to show', async () => {
    let asked = 0;
    const { d } = deps({ rules: [() => null], holdReason: async () => { asked++; return null; } });
    await createCoach(d).tick();
    expect(asked).toBe(0);
  });
  it('survives a throwing rule and shows at most one pop-up per tick', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { d, shown } = deps({ rules: [() => { throw new Error('bug'); }, () => c({ key: 'a' }), () => c({ key: 'b', ruleId: 'eye_break' })] });
    await createCoach(d).tick();
    expect(shown).toHaveLength(1);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
  it('marks a nudge held when the window cannot be shown', async () => {
    const { d, rows } = deps({ show: () => false });
    await createCoach(d).tick();
    expect(rows[0].status).toBe('held');
  });
  it('queries the hold reason at most once per tick, even with multiple show-eligible candidates', async () => {
    let asked = 0;
    const { d } = deps({
      holdReason: async () => { asked++; return 'call'; },
      rules: [() => c({ key: 'a' }), () => c({ key: 'b', ruleId: 'eye_break' })]
    });
    await createCoach(d).tick();
    expect(asked).toBe(1);
  });
  it('does not record a held key again on the next tick', async () => {
    const { d, rows } = deps({ holdReason: async () => 'call' });
    const coach = createCoach(d);
    await coach.tick();
    await coach.tick();
    expect(rows).toHaveLength(1);
  });
});
