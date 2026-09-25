import { describe, it, expect } from 'vitest';
import { finalCategory, scoreRun, type EvalRow } from './evalScore';

describe('finalCategory', () => {
  it('keeps confident Laya choices and falls back to the app rule when unsure', () => {
    expect(finalCategory('social', 0.8, 'Google Chrome')).toBe('social');
    expect(finalCategory('entertainment', 0.2, 'Microsoft Teams')).toBe('communication');
    expect(finalCategory('entertainment', 0.2, 'Google Chrome')).toBe('other');
  });
});

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
    expect(s.finalAcc).toBeCloseTo(0.5); // row 2 fixed by the app rule, row 4 lost to it
    expect(s.confusion.social.entertainment).toBe(1);
    expect(s.confusion.work.work).toBe(1);
  });
  it('handles an empty run', () => {
    expect(scoreRun([])).toEqual({ n: 0, layaAcc: 0, finalAcc: 0, confusion: {} });
  });
});
