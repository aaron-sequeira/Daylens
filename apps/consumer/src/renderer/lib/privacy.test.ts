import { describe, it, expect } from 'vitest';
import { DEFAULT_EXCLUSIONS, MAX_EXCLUSIONS } from '../../shared/exclusions';
import { restoreDefaults } from './privacy';

describe('restoreDefaults', () => {
  it('adds missing defaults after the user\'s own patterns', () => {
    const r = restoreDefaults(['mine']);
    expect(r.list[0]).toBe('mine');
    expect(r.list).toEqual(expect.arrayContaining(DEFAULT_EXCLUSIONS));
    expect(r.full).toBe(false);
  });
  it('with a full list, keeps every user pattern and reports full instead of silently doing nothing', () => {
    const own = Array.from({ length: MAX_EXCLUSIONS }, (_, i) => `p${i}`);
    expect(restoreDefaults(own)).toEqual({ list: own, full: true });
  });
  it('is not full when all defaults are already present', () => {
    expect(restoreDefaults([...DEFAULT_EXCLUSIONS]).full).toBe(false);
  });
});
