import { describe, it, expect } from 'vitest';
import { CATEGORIES } from '../../shared/categories';
import { CONFIDENT, QUESTIONS } from './questions';

describe('QUESTIONS', () => {
  it('asks the four spec questions', () => {
    expect(Object.keys(QUESTIONS).sort()).toEqual(['activity', 'category', 'distraction', 'stuck']);
    expect(CONFIDENT).toBe(0.5);
  });
  it('category options are exactly the app categories, each with criteria text', () => {
    const q = QUESTIONS.category;
    expect(q.type).toBe('choice');
    const crit = q.criteria as Record<string, string>;
    expect(Object.keys(crit).sort()).toEqual([...CATEGORIES].sort());
    for (const c of CATEGORIES) expect(crit[c].length).toBeGreaterThan(10);
  });
  it('scores have three levels', () => {
    expect(QUESTIONS.stuck.criteria).toHaveLength(3);
    expect(QUESTIONS.distraction.criteria).toHaveLength(3);
  });
});
