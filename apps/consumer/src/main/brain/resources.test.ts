import { describe, it, expect } from 'vitest';
import { GB, batchAllowed } from './resources';

const need = 4.2 * GB;
describe('batchAllowed', () => {
  it('never starts below the memory need', () => {
    expect(batchAllowed({ freeBytes: 4 * GB, idleSec: 3600, locked: true, needBytes: need })).toBe(false);
  });
  it('starts when idle 3 min or locked', () => {
    expect(batchAllowed({ freeBytes: 5 * GB, idleSec: 180, locked: false, needBytes: need })).toBe(true);
    expect(batchAllowed({ freeBytes: 5 * GB, idleSec: 10, locked: true, needBytes: need })).toBe(true);
    expect(batchAllowed({ freeBytes: 5 * GB, idleSec: 179, locked: false, needBytes: need })).toBe(false);
  });
  it('starts while the user works only with 2 GB to spare', () => {
    expect(batchAllowed({ freeBytes: need + 2 * GB, idleSec: 0, locked: false, needBytes: need })).toBe(true);
    expect(batchAllowed({ freeBytes: need + 2 * GB - 1, idleSec: 0, locked: false, needBytes: need })).toBe(false);
  });
});
