import { describe, it, expect } from 'vitest';
import { isActiveBucket } from './idle';

const zero = { mouseMoves: 0, mouseDistancePx: 0, clicks: 0, scrolls: 0, keyEvents: 0 };

describe('isActiveBucket', () => {
  it('is active when any input occurred', () => {
    expect(isActiveBucket({ ...zero, clicks: 1 }, 999, 60)).toBe(true);
  });
  it('is active when system idle is below threshold even with no counted input', () => {
    expect(isActiveBucket(zero, 10, 60)).toBe(true);
  });
  it('is idle when no input and system idle exceeds threshold', () => {
    expect(isActiveBucket(zero, 120, 60)).toBe(false);
  });
});
