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
    kinds: () => ({ health: true, behaviour: true, tip: true, win: true, reminder: true }), snoozeUntil: () => 0, fewer: () => ({}),
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
  it('a held reminder is not recorded, so it shows once the hold ends', async () => {
    let hold: string | null = 'call';
    const rem = (): Candidate => ({ ruleId: 'reminder', kind: 'reminder', key: 'reminder:2:2026-09-30', mini: '🍱 Lunch', stat: '1:00 pm', title: 'Lunch time 🍱', body: 'b', primary: { label: 'Start break', action: 'break_reminder' } });
    const { d, rows, shown } = deps({ rules: [rem], holdReason: async () => hold });
    expect(await createCoach(d).tick()).toBe('held');
    expect(rows).toHaveLength(0);
    hold = null;
    expect(await createCoach(d).tick()).toBe('shown');
    expect(shown).toHaveLength(1);
  });
  it('drops behaviour, tip and reminder candidates during a focus block, but not health or focus_start', async () => {
    const now = T(12);
    const blocks = [{ start: now - 60_000, end: now + 60 * 60_000, label: '11:59', minutes: 60 }];
    const { d, shown } = deps({ snapshot: () => snap({ now, focusBlocks: blocks }),
      rules: [() => c({ kind: 'behaviour', ruleId: 'scattered', key: 'b' }), () => c({ kind: 'tip', ruleId: 'stuck_tip', key: 't' }),
        () => c({ kind: 'reminder', ruleId: 'reminder', key: 'reminder:1:123' }), () => c({ kind: 'health', ruleId: 'goal_80', key: 'h' })] });
    await createCoach(d).tick();
    expect(shown.map((n) => n.kind)).toEqual(['health']);
  });
  it('silences a reminder during a focus block without recording it, so it shows once the block ends', async () => {
    const now = T(12);
    const blocks = [{ start: now - 60_000, end: now + 60 * 60_000, label: '11:59', minutes: 60 }];
    const rem = (): Candidate => ({ ruleId: 'reminder', kind: 'reminder', key: 'reminder:1:123', mini: 'm', stat: 's', title: 't', body: 'b', primary: { label: 'Start break', action: 'break_reminder' } });
    const { d, rows, shown } = deps({ snapshot: () => snap({ now, focusBlocks: blocks }), rules: [rem] });
    expect(await createCoach(d).tick()).toBe('none');
    expect(rows).toHaveLength(0);
    expect(shown).toHaveLength(0);
    const { d: d2, shown: shown2 } = deps({ snapshot: () => snap({ now, focusBlocks: [] }), rules: [rem] });
    expect(await createCoach(d2).tick()).toBe('shown');
    expect(shown2).toHaveLength(1);
  });

  describe('AI tip rewrite', () => {
    const tip = (o: Partial<Candidate> = {}): Candidate => c({ kind: 'tip', ruleId: 'stuck_tip', key: 'stuck_tip:a', ...o });

    it('shows a stuck_tip candidate with the rewritten title/body when rewrite resolves', async () => {
      const { d, shown } = deps({
        rules: [() => tip()],
        rewrite: async (cand) => ({ ...cand, title: 'Rewritten title', body: 'Rewritten body' })
      });
      expect(await createCoach(d).tick()).toBe('shown');
      expect(shown[0]).toMatchObject({ title: 'Rewritten title', body: 'Rewritten body' });
    });

    it('never passes a goal_80 candidate to rewrite', async () => {
      let called = false;
      const { d, shown } = deps({ rewrite: async (cand) => { called = true; return cand; } }); // default rule is goal_80
      await createCoach(d).tick();
      expect(called).toBe(false);
      expect(shown[0].title).toBe('t');
    });

    it('leaves the template shown when rewrite rejects', async () => {
      const { d, shown } = deps({ rules: [() => tip()], rewrite: async () => { throw new Error('down'); } });
      await createCoach(d).tick();
      expect(shown[0]).toMatchObject({ title: 't', body: 'b' });
    });

    it('never rewrites a held candidate: rewrite runs only after the gate says show and there is no hold', async () => {
      let called = false;
      const { d, rows } = deps({
        holdReason: async () => 'call', rules: [() => tip()],
        rewrite: async (cand) => { called = true; return cand; }
      });
      expect(await createCoach(d).tick()).toBe('held');
      expect(called).toBe(false);
      expect(rows[0].status).toBe('held');
    });

    it('keeps the original ruleId/key on the recorded nudge even if rewrite tries to change them', async () => {
      const { d, rows } = deps({
        rules: [() => tip()],
        rewrite: async (cand) => ({ ...cand, ruleId: 'hacked', key: 'hacked-key', title: 'R', body: 'B' })
      });
      await createCoach(d).tick();
      expect(rows[0]).toMatchObject({ ruleId: 'stuck_tip', key: 'stuck_tip:a' });
    });

    it('re-checks the hold after a rewrite: holds instead of showing if a hold now applies', async () => {
      let calls = 0;
      const { d, shown, rows } = deps({
        holdReason: async () => { calls++; return calls === 1 ? null : 'call'; }, // clear when the gate ran, busy by the time rewrite finished
        rules: [() => tip()],
        rewrite: async (cand) => ({ ...cand, title: 'R', body: 'B' })
      });
      expect(await createCoach(d).tick()).toBe('held');
      expect(shown).toHaveLength(0);
      expect(rows[0].status).toBe('held');
    });

    it('re-checks the snooze after a rewrite: holds instead of showing if a snooze now applies', async () => {
      let calls = 0;
      const { d, shown, rows } = deps({
        snoozeUntil: () => (calls++ === 0 ? 0 : T(12) + 60_000), // not snoozed when the gate ran, snoozed by the time rewrite finished
        rules: [() => tip()],
        rewrite: async (cand) => ({ ...cand, title: 'R', body: 'B' })
      });
      expect(await createCoach(d).tick()).toBe('held');
      expect(shown).toHaveLength(0);
      expect(rows[0].status).toBe('held');
    });

    it('a hold found after a rewrite also holds later candidates in the same tick', async () => {
      let calls = 0;
      const later = (): Candidate => ({ ...tip(), ruleId: 'deep_work', key: 'deep_work:a' });
      const { d, shown, rows } = deps({
        holdReason: async () => { calls++; return calls === 1 ? null : 'call'; },
        rules: [() => tip(), later],
        rewrite: async (cand) => ({ ...cand, title: 'R', body: 'B' })
      });
      expect(await createCoach(d).tick()).toBe('held');
      expect(shown).toHaveLength(0);
      expect(rows.map((r) => r.status)).toEqual(['held', 'held']);
    });

    it('re-checks the hold when rewrite fell back to the template slowly (>= 2 s)', async () => {
      let t = T(12), calls = 0;
      const { d, shown, rows } = deps({
        now: () => t,
        holdReason: async () => { calls++; return calls === 1 ? null : 'call'; },
        rules: [() => tip()],
        rewrite: async (cand) => { t += 2500; return cand; } // timed out -> original, but 2.5 s later
      });
      expect(await createCoach(d).tick()).toBe('held');
      expect(shown).toHaveLength(0);
      expect(rows[0].status).toBe('held');
    });

    it('skips the post-rewrite hold check when rewrite returned the original (no second PowerShell spawn)', async () => {
      let asked = 0;
      const { d, shown } = deps({ holdReason: async () => { asked++; return null; }, rules: [() => tip()], rewrite: async (cand) => cand });
      expect(await createCoach(d).tick()).toBe('shown');
      expect(asked).toBe(1);
      expect(shown[0].title).toBe('t');
    });
  });
});
