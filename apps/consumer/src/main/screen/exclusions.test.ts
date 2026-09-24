import { describe, it, expect } from 'vitest';
import { DEFAULT_EXCLUSIONS, MAX_EXCLUSIONS, addExclusion } from '../../shared/exclusions';
import { exclusionsInput, isExcluded, parseExclusions } from './exclusions';

describe('isExcluded', () => {
  it('matches whole words in app name or title, case-insensitively', () => {
    expect(isExcluded(DEFAULT_EXCLUSIONS, '1Password', 'Vault')).toBe(true);
    expect(isExcluded(DEFAULT_EXCLUSIONS, 'Google Chrome', 'Bank of Baroda - Google Chrome')).toBe(true);
    expect(isExcluded(DEFAULT_EXCLUSIONS, 'Microsoft Edge', 'New tab - [InPrivate] - Microsoft Edge')).toBe(true);
    expect(isExcluded(DEFAULT_EXCLUSIONS, 'Google Chrome', 'Change your password - Google Chrome')).toBe(true);
  });
  it('does not match inside other words', () => {
    expect(isExcluded(DEFAULT_EXCLUSIONS, 'Google Chrome', 'Bankai - Bleach Wiki')).toBe(false);
    expect(isExcluded(DEFAULT_EXCLUSIONS, 'Visual Studio Code', 'passwordless.ts')).toBe(false);
    expect(isExcluded(DEFAULT_EXCLUSIONS, 'Visual Studio Code', null)).toBe(false);
  });
  it('escapes regex characters in patterns', () => {
    expect(isExcluded(['C++ (secret)'], 'Editor', 'notes C++ (secret) draft')).toBe(true);
    expect(isExcluded(['a.b'], 'axb', null)).toBe(false);
  });
});

describe('addExclusion', () => {
  it('adds a cleaned, unique pattern', () => {
    expect(addExclusion(['bank'], '  My   Journal ')).toEqual(['bank', 'My Journal']);
    expect(addExclusion(['bank'], 'BANK')).toEqual(['bank']);
    expect(addExclusion(['bank'], '   ')).toEqual(['bank']);
    expect(addExclusion(['bank'], 'x'.repeat(61))).toEqual(['bank']);
    expect(addExclusion(['bank'], 'a\u0007b')).toEqual(['bank']);
  });
  it('stops at 40 patterns', () => {
    const full = Array.from({ length: MAX_EXCLUSIONS }, (_, i) => `p${i}`);
    expect(addExclusion(full, 'new')).toBe(full);
  });
});

describe('parseExclusions / exclusionsInput', () => {
  it('falls back to defaults on corrupt data, keeps an explicitly empty list', () => {
    expect(parseExclusions('{bad')).toEqual(DEFAULT_EXCLUSIONS);
    expect(parseExclusions('"x"')).toEqual(DEFAULT_EXCLUSIONS);
    expect(parseExclusions('[]')).toEqual([]);
    expect(parseExclusions('["ok", 5, "", "ok2"]')).toEqual(['ok', 'ok2']);
  });
  it('validates the IPC payload', () => {
    expect(exclusionsInput.parse(['  a  b ', 'c'])).toEqual(['a b', 'c']);
    expect(exclusionsInput.safeParse(['a', 'A']).success).toBe(false);
    expect(exclusionsInput.safeParse(['']).success).toBe(false);
    expect(exclusionsInput.safeParse(['x'.repeat(61)]).success).toBe(false);
    expect(exclusionsInput.safeParse(Array.from({ length: 41 }, (_, i) => `p${i}`)).success).toBe(false);
    expect(exclusionsInput.safeParse(['a\nb']).success).toBe(false);
  });
});
