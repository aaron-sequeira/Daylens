import { describe, it, expect } from 'vitest';
import { formatDuration, formatClock, formatPct } from './format';

describe('format', () => {
  it('formats durations', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(125)).toBe('2m 5s');
    expect(formatDuration(3725)).toBe('1h 2m');
  });
  it('formats percent and clock', () => {
    expect(formatPct(50)).toBe('50%');
    expect(typeof formatClock(Date.now())).toBe('string');
    expect(formatClock(null)).toBe('—');
  });
});
