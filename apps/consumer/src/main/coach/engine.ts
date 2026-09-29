import type { Rule, Snapshot } from './snapshot';
import type { Candidate, Kind, NudgeRow, NudgeStatus, PillNudge } from './types';
import { decide } from './gate';
import { inFocus } from './plan';
import { RULES } from './rules';
import { REWRITE_RULES } from './tip';

export interface CoachDeps {
  now(): number; snapshot(now: number): Snapshot; history(now: number): NudgeRow[];
  kinds(): Record<Kind, boolean>; snoozeUntil(): number; fewer(): Partial<Record<Kind, number>>;
  weight(c: Candidate, now: number): number; holdReason(): Promise<string | null>;
  record(c: Candidate, status: NudgeStatus, now: number): number; setStatus(id: number, s: NudgeStatus): void;
  show(n: PillNudge): boolean; rules?: Rule[];
  /** Replaces a stuck_tip/repeat_search template with a personal writer-written suggestion, memory allowing.
   * Any failure (reject, timeout, unusable writer) must resolve to the original candidate, not reject. */
  rewrite?(c: Candidate, snap: Snapshot): Promise<Candidate>;
}

export function createCoach(d: CoachDeps) {
  const rules = d.rules ?? RULES;
  return {
    async tick(): Promise<'shown' | 'held' | 'none'> {
      const now = d.now();
      const snap = d.snapshot(now);
      const history = [...d.history(now)];
      let outcome: 'held' | 'none' = 'none';
      // At most one PowerShell spawn per tick: every show-eligible candidate this tick shares the same answer.
      let holdOnce: Promise<string | null> | null = null;
      const getHold = (): Promise<string | null> => (holdOnce ??= d.holdReason());
      for (const rule of rules) {
        let c: Candidate | null = null;
        try { c = rule(snap); } catch (e) { console.error('[coach] rule failed:', e); continue; }
        if (!c) continue;
        // A planned focus block silences behaviour and tip pop-ups (the block's own start reminder still shows).
        if (inFocus(snap.focusBlocks, now) && (c.kind === 'behaviour' || c.kind === 'tip') && c.ruleId !== 'focus_start') continue;
        const base = { now, history, kinds: d.kinds(), snoozeUntil: d.snoozeUntil(), fewer: d.fewer(), weight: d.weight(c, now) };
        let dec = decide(c, { ...base, hold: null });
        if (dec.status === 'show') {
          const hold = await getHold();
          if (hold) dec = { status: 'held', reason: hold };
        }
        if (dec.status === 'drop') continue;
        const recordHeld = (cand: Candidate): void => {
          const id = d.record(cand, 'held', now);
          history.push({ id, at: now, date: snap.date, kind: cand.kind, ruleId: cand.ruleId, key: cand.key, title: cand.title, body: cand.body, status: 'held' });
          outcome = 'held';
        };
        if (dec.status === 'held') {
          recordHeld(c);
          continue;
        }
        if (d.rewrite && REWRITE_RULES.has(c.ruleId)) {
          const original = c;
          const rewritten = await d.rewrite(original, snap).catch(() => original);
          // Every fallback returns the original object: that's an instant no-op, so no re-check (or PowerShell spawn) needed.
          if (rewritten !== original) {
            c = { ...rewritten, ruleId: original.ruleId, key: original.key, kind: original.kind, primary: original.primary };
            // A rewrite can take up to 20s: the hold/snooze picture may have changed while waiting, so re-check
            // both before showing rather than trusting the decision made before the wait.
            const holdAfter = await d.holdReason();
            if (holdAfter || now < d.snoozeUntil()) {
              recordHeld(c);
              continue;
            }
          }
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
