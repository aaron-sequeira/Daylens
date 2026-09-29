// Daylens "Sunrise" logo: a hand-drawn sun rising over a wavy horizon. Seeded, so every run draws the same wobble.
// Single source for resources/logo-*.svg, src/renderer/components/logoPaths.ts and (via render.cjs) the icon files.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const COLORS = { tile: '#171717', sun: '#F6B35E', horizon: '#FBF8F4' };
const f = (n) => Math.round(n * 100) / 100;
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
// Smooth low-frequency wobble: a few sines with random phase.
function noise(r) { const p = [r() * 6.28, r() * 6.28, r() * 6.28]; return (t) => 0.55 * Math.sin(2 * t + p[0]) + 0.3 * Math.sin(3 * t + p[1]) + 0.15 * Math.sin(5 * t + p[2]); }
// Catmull-Rom through points -> cubic bezier path (open).
function smooth(pts) {
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    d += ` C${f(p1[0] + (p2[0] - p0[0]) / 6)},${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)},${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])},${f(p2[1])}`;
  }
  return d;
}
// A pen circle: once round plus `over` radians so the ends overlap like a real stroke.
function penCircle(cx, cy, r, seed, { a0 = -2.4, over = 0.55, wob = 0.07 } = {}) {
  const n = noise(rng(seed)), pts = [], N = 40, span = Math.PI * 2 + over;
  for (let i = 0; i <= N; i++) { const t = a0 + (span * i) / N, rr = r * (1 + wob * n(t) + (i / N) * 0.04); pts.push([cx + rr * Math.cos(t), cy + rr * Math.sin(t)]); }
  return smooth(pts);
}
function ray(r, cx, cy, a, r1, r2, { lenVar, bend }) {
  const inner = r1 + (r() - 0.5) * 2, outer = r2 * (1 - lenVar / 2 + r() * lenVar);
  const x1 = cx + inner * Math.cos(a), y1 = cy + inner * Math.sin(a), x2 = cx + outer * Math.cos(a), y2 = cy + outer * Math.sin(a);
  const mx = (x1 + x2) / 2 - Math.sin(a) * (r() - 0.5) * bend * 2, my = (y1 + y2) / 2 + Math.cos(a) * (r() - 0.5) * bend * 2;
  return `M${f(x1)},${f(y1)} Q${f(mx)},${f(my)} ${f(x2)},${f(y2)}`;
}
// Rays evenly round a full circle from `start` (the full mark: the lower half is clipped by the horizon).
function rays(cx, cy, count, r1, r2, seed, { jitter = 0.09, lenVar = 0.28, bend = 1.6, start = -Math.PI / 2 } = {}) {
  const r = rng(seed), out = [];
  for (let i = 0; i < count; i++) out.push(ray(r, cx, cy, start + (i * 2 * Math.PI) / count + (r() - 0.5) * jitter * 2, r1, r2, { lenVar, bend }));
  return out.join(' ');
}
// Rays spread evenly across [from, to] (the small mark: every ray fully above the horizon).
function fanRays(cx, cy, count, r1, r2, seed, { from, to, jitter = 0.04, lenVar = 0.12, bend = 0.6 }) {
  const r = rng(seed), out = [];
  for (let i = 0; i < count; i++) out.push(ray(r, cx, cy, from + ((to - from) * i) / (count - 1) + (r() - 0.5) * jitter * 2, r1, r2, { lenVar, bend }));
  return out.join(' ');
}

/** Both marks, built from their seeds (pure: same output every call). */
export function buildMarks() {
  return {
    /** The chosen brainstorm drawing (concept D), unchanged: app icon >= 64 px, installer, onboarding. */
    FULL: {
      circle: penCircle(50, 63, 18, 4, { over: 0.3 }),
      rays: rays(50, 63, 12, 27, 38, 17, { start: -Math.PI }),
      horizon: smooth([[16, 66], [30, 63], [44, 66.5], [58, 63], [72, 66], [84, 63.5]]),
      clipY: 63, width: [5.5, 5, 5],
    },
    /** Bolder mark for <= 48 px (tray, title bar, rail, small icon sizes): 5 chunky rays, thick horizon, bigger sun.
     * ponytail: tuned by eye at real 16 px on #202020 and #EEF0F3; nudge r1/r2/width here if it reads muddy. */
    SMALL: {
      circle: penCircle(50, 62, 21, 4, { over: 0.2, wob: 0.04 }),
      rays: fanRays(50, 62, 5, 33, 45, 17, { from: -Math.PI + 0.42, to: -0.42 }),
      horizon: smooth([[14, 67], [32, 64.5], [50, 67], [68, 64.5], [86, 66.5]]),
      clipY: 62, width: [11, 11, 11],
    },
  };
}
export const { FULL, SMALL } = buildMarks();

const pen = (d, color, w) => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
/** Standalone SVG for a mark (used for the committed .svg files and for rasterising). */
export function markSvg(mark, { size, tile = true }) {
  const clip = `sunrise-clip-${mark.clipY}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}">`
    + (tile ? `<rect x="2" y="2" width="96" height="96" rx="24" fill="${COLORS.tile}"/>` : '')
    + `<g transform="translate(50 50) scale(0.86) translate(-50 -50)">`
    + `<clipPath id="${clip}"><rect x="0" y="0" width="100" height="${mark.clipY}"/></clipPath>`
    + `<g clip-path="url(#${clip})">${pen(mark.circle, COLORS.sun, mark.width[0])}${pen(mark.rays, COLORS.sun, mark.width[1])}</g>`
    + pen(mark.horizon, COLORS.horizon, mark.width[2])
    + `</g></svg>`;
}

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, '..', '..');
/** Writes the committed sources: resources/logo-full.svg, resources/logo-small.svg, src/renderer/components/logoPaths.ts. */
export function writeSources() {
  writeFileSync(join(app, 'resources', 'logo-full.svg'), markSvg(FULL, { size: 256 }) + '\n');
  writeFileSync(join(app, 'resources', 'logo-small.svg'), markSvg(SMALL, { size: 48 }) + '\n');
  const m = (x) => `{ circle: '${x.circle}', rays: '${x.rays}', horizon: '${x.horizon}', clipY: ${x.clipY}, width: [${x.width.join(', ')}] }`;
  writeFileSync(join(app, 'src', 'renderer', 'components', 'logoPaths.ts'),
    `// Generated by scripts/logo/sunrise.mjs — do not edit by hand (pnpm --filter @worksight/consumer logo).\n`
    + `export interface LogoMark { circle: string; rays: string; horizon: string; clipY: number; width: [number, number, number] }\n`
    + `export const LOGO: { full: LogoMark; small: LogoMark } = {\n  full: ${m(FULL)},\n  small: ${m(SMALL)}\n};\n`
    + `export const LOGO_COLORS = { tile: '${COLORS.tile}', sun: '${COLORS.sun}', horizon: '${COLORS.horizon}' };\n`);
}
