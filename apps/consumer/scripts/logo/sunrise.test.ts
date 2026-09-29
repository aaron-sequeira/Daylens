import { describe, it, expect } from 'vitest';
import { FULL, SMALL, buildMarks, markSvg } from './sunrise.mjs';

const subpaths = (d: string) => (d.match(/M/g) ?? []).length;

describe('sunrise logo', () => {
  it('is deterministic (seeded): building the marks twice gives identical paths', () => {
    expect(buildMarks()).toEqual(buildMarks());
    expect(buildMarks().FULL).toEqual(FULL);
  });
  it('full mark keeps the brainstorm drawing: 12 rays (half clipped below the horizon), clip at 63', () => {
    expect(subpaths(FULL.rays)).toBe(12);
    expect(FULL.clipY).toBe(63);
  });
  it('small mark is the bolder tray version: 5 rays, all strokes 11', () => {
    expect(subpaths(SMALL.rays)).toBe(5);
    expect(SMALL.width).toEqual([11, 11, 11]);
  });
  it('markSvg draws the black tile unless tile:false, with only path data from the mark', () => {
    const svg = markSvg(FULL, { size: 64 });
    expect(svg).toContain('width="64"');
    expect(svg).toContain('fill="#171717"');
    expect(svg).toContain(FULL.horizon);
    expect(markSvg(FULL, { size: 64, tile: false })).not.toContain('fill="#171717"');
  });
});
