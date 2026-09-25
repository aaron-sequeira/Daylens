import { describe, it, expect } from 'vitest';
import { finalCategory } from './finalCategory';

describe('finalCategory', () => {
  it('keeps a confident Laya choice as-is', () => {
    expect(finalCategory('social', 0.8, 'Google Chrome')).toBe('social');
  });
  it('overrides an unsure choice with the app rule for a known app', () => {
    expect(finalCategory('entertainment', 0.2, 'Microsoft Teams')).toBe('communication');
  });
  it('keeps Laya\'s own guess for an unsure choice on an unknown app (no app-rule override)', () => {
    expect(finalCategory('entertainment', 0.2, 'Google Chrome')).toBe('entertainment');
  });
});
