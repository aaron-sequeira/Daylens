import { describe, it, expect } from 'vitest';
import { scoreRun, type EvalRow } from './evalScore';

describe('scoreRun', () => {
  it('computes Laya-only and final accuracy plus a confusion table', () => {
    const rows: EvalRow[] = [
      { id: 1, expected: 'work', choice: 'work', confidence: 0.9, app: 'Visual Studio Code' },
      { id: 2, expected: 'communication', choice: 'entertainment', confidence: 0.1, app: 'Microsoft Teams' },
      { id: 3, expected: 'social', choice: 'entertainment', confidence: 0.7, app: 'Google Chrome' },
      { id: 4, expected: 'learning', choice: 'learning', confidence: 0.3, app: 'Google Chrome' }
    ];
    const s = scoreRun(rows);
    expect(s.n).toBe(4);
    expect(s.layaAcc).toBeCloseTo(0.5);
    // row 2 fixed by the known-app rule (Teams -> communication); row 4 keeps Laya's own
    // (correct) guess since Chrome is not a known app, so the app rule doesn't override it.
    expect(s.finalAcc).toBeCloseTo(0.75);
    expect(s.confusion.social.entertainment).toBe(1);
    expect(s.confusion.work.work).toBe(1);
  });
  it('handles an empty run', () => {
    expect(scoreRun([])).toEqual({ n: 0, layaAcc: 0, finalAcc: 0, confusion: {} });
  });
});
