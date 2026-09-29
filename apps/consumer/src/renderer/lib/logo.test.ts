import { describe, it, expect, beforeEach } from 'vitest';
import { logoStartState, markAppOpenPlayed, resetLogoForTest } from './logo';

describe('logoStartState', () => {
  beforeEach(() => resetLogoForTest());
  it('a non-animated logo is drawn complete', () => {
    expect(logoStartState('none')).toBe('final');
  });
  it('app-open holds the undrawn frame until it plays, then only once per window lifetime', () => {
    expect(logoStartState('app-open')).toBe('pre');
    markAppOpenPlayed();
    expect(logoStartState('app-open')).toBe('final'); // e.g. the rail re-mounting after onboarding redo
  });
  it('mount (onboarding welcome) plays every time, regardless of app-open', () => {
    markAppOpenPlayed();
    expect(logoStartState('mount')).toBe('pre');
  });
});
