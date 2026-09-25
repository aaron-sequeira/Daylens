import type { Rule, Snapshot } from './snapshot';
import type { Candidate, Kind, NudgeRow, NudgeStatus, PillNudge } from './types';
import { decide } from './gate';
import { RULES } from './rules';

export interface CoachDeps {
  now(): number; snapshot(now: number): Snapshot; history(now: number): NudgeRow[];
  kinds(): Record<Kind, boolean>; snoozeUntil(): number; fewer(): Partial<Record<Kind, number>>;
  weight(c: Candidate, now: number): number; holdReason(): Promise<string | null>;
  record(c: Candidate, status: NudgeStatus, now: number): number; setStatus(id: number, s: NudgeStatus): void;
  show(n: PillNudge): boolean; rules?: Rule[];
}

export function createCoach(d: CoachDeps) {
  const rules = d.rules ?? RULES;
  return {
    async tick(): Promise<'shown' | 'held' | 'none'> {
      const now = d.now();
      const snap = d.snapshot(now);
      const history = [...d.history(now)];
      let outcome: 'held' | 'none' = 'none';
      for (const rule of rules) {
        let c: Candidate | null = null;
        try { c = rule(snap); } catch (e) { console.error('[coach] rule failed:', e); continue; }
        if (!c) continue;
        const base = { now, history, kinds: d.kinds(), snoozeUntil: d.snoozeUntil(), fewer: d.fewer(), weight: d.weight(c, now) };
        let dec = decide(c, { ...base, hold: null });
        if (dec.status === 'show') {
          const hold = await d.holdReason();
          if (hold) dec = { status: 'held', reason: hold };
        }
        if (dec.status === 'drop') continue;
        if (dec.status === 'held') {
          const id = d.record(c, 'held', now);
          history.push({ id, at: now, date: snap.date, kind: c.kind, ruleId: c.ruleId, key: c.key, title: c.title, body: c.body, status: 'held' });
          outcome = 'held';
          continue;
        }
        const id = d.record(c, 'shown', now);
        const ok = d.show({ id, kind: c.kind, mini: c.mini, stat: c.stat, title: c.title, body: c.body, primaryLabel: c.primary.label, offerFewer: dec.offerFewer });
        if (!ok) { d.setStatus(id, 'held'); return 'held'; }
        return 'shown';
      }
      return outcome;
    }
  };
}
