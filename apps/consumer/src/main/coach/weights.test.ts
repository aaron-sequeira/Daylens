import { describe, it, expect } from 'vitest';
import { DEFAULT_PROFILE } from '../../shared/profileOptions';
import { ruleWeight } from './weights';
import { T } from './fixtures';

const thu = T(12); // 2026-09-25 is a Friday (day 5)
describe('ruleWeight', () => {
  it('is 1 for everything when no goals are picked', () => {
    expect(ruleWeight('scattered', 'behaviour', { ...DEFAULT_PROFILE, goals: [] }, thu)).toBe(1);
  });
  it('doubles rules outside the picked goals (repeat_search exempt)', () => {
    const p = { ...DEFAULT_PROFILE, goals: ['sleep' as const] };
    expect(ruleWeight('wind_down', 'health', p, thu)).toBe(1);
    expect(ruleWeight('deep_work', 'win', p, thu)).toBe(2);
    expect(ruleWeight('repeat_search', 'tip', p, thu)).toBe(1);
  });
  it("treats 'better' as all goals", () => {
    expect(ruleWeight('deep_work', 'win', { ...DEFAULT_PROFILE, goals: ['better'] }, thu)).toBe(1);
  });
  it('doubles behaviour rules on non-usual days', () => {
    expect(ruleWeight('scattered', 'behaviour', { ...DEFAULT_PROFILE, goals: [], days: [1, 2, 3, 4] }, thu)).toBe(2);
    expect(ruleWeight('goal_80', 'health', { ...DEFAULT_PROFILE, goals: [], days: [1, 2, 3, 4] }, thu)).toBe(1);
  });
});
