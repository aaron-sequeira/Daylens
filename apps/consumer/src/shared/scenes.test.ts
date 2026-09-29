import { describe, it, expect } from 'vitest';
import { SCENES } from './scenes';
import { ANIMATIONS } from './reminders';

describe('break scenes', () => {
  it('has one well-formed SVG per animation, drawn on a 120 viewBox', () => {
    for (const a of ANIMATIONS) {
      expect(SCENES[a]).toMatch(/^<svg class="dl-scene-svg" viewBox="0 0 120 120"[^>]*>[\s\S]*<\/svg>$/);
      expect(SCENES[a]).not.toMatch(/<script|on\w+=/i); // static markup only (it is set via innerHTML)
    }
  });
  it('namespaces clip-path ids so scenes can share a page', () => {
    const ids = ANIMATIONS.flatMap((a) => [...SCENES[a].matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
    expect(ids.every((id) => id.startsWith('sc-'))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
