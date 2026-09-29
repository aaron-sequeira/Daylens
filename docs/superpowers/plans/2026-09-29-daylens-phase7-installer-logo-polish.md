# Daylens Phase 7 — Installer, Sunrise logo, polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an installable Windows build of Daylens with its own hand-drawn Sunrise logo (drawing itself in on open), and clear the polish backlog.

**Architecture:** A seeded logo generator (`scripts/logo/sunrise.mjs`) is the single source for the SVG marks, the renderer's path data and — via an Electron offscreen render script — the `.ico`/tray PNGs. A `Logo` React component animates the mark with CSS stroke-dash. electron-builder + NSIS (one-click, per-user, custom uninstall prompt) packages the app with an explicit exclusion list, and `scripts/check-build.mjs` verifies the unpacked build. Polish items are small, independent edits in main and renderer.

**Tech Stack:** Electron 33.4.11, electron-vite, React 19, TypeScript, vitest, electron-builder (NSIS), PowerShell (OCR helper).

**Spec:** `docs/superpowers/specs/2026-09-29-daylens-phase7-packaging-logo-polish-design.md`

## Global Constraints

- Windows x64 only; unsigned; no auto-update; version `1.0.0`; `appId: ai.worksight.daylens`; `productName: Daylens`.
- No new npm dependencies (dev or prod). Use Node/Electron built-ins and what's installed.
- Writer runtime ships CPU + Vulkan only: exclude `@node-llama-cpp/win-x64-cuda`, `win-x64-cuda-ext`, `win-arm64`, any `linux-*`/`mac-*`; exclude onnxruntime-node `darwin`, `linux`, `win32/arm64`; exclude active-win darwin bindings.
- Installer: `oneClick: true`, `perMachine: false`; uninstall prompt default **No**, skipped when `${isUpdated}`.
- Logo colours: tile `#171717`, sun `#F6B35E`, horizon `#FBF8F4`; tile `rx` 24 of a 100 viewBox; art scaled 0.86 about the centre inside the tile.
- Draw-in ≈ 2 s; plays on app open (first time the window is visible) and on the onboarding welcome; never under `prefers-reduced-motion: reduce`.
- Tests: run with `cd apps/consumer && ELECTRON_RUN_AS_NODE=1 ../../node_modules/electron/dist/electron.exe ../../node_modules/vitest/vitest.mjs run [path]` (the user's dev instance may lock better_sqlite3 — never `pnpm test`). Typecheck: `cd apps/consumer && npx tsc --noEmit -p tsconfig.web.json && npx tsc --noEmit -p tsconfig.node.json`.
- Never launch the Daylens app, never load a model, never kill processes you did not start. (Running the offscreen logo render script with Electron is allowed: it is not the app.)
- Never stage `.codex/`. Stage by explicit path. Commit messages end with a blank line then `Co-Authored-By: <your model> <noreply@anthropic.com>`.
- Never print screen/OCR text, real-DB window titles or model output.

## Review Focus

1. **App auto-started with `--hidden` at login** — the draw-in must not play unseen in the hidden window; it plays the first time the user opens the window. (Task 2: `logoStartState` tests + the `visibilitychange` gate; human checklist step 4.)
2. **Dev instance still running while the installed app starts** — both share `%APPDATA%\Daylens` and the single-instance lock, so the installed app would silently quit. (Task 7 checklist step 0; Task 3 notes it in the build README section of the report.)
3. **User profile path with spaces/non-ASCII** (e.g. `C:\Users\José Smith`) — OCR helper spawn and the uninstall `RMDir` must quote paths. Spawn already uses an args array; Task 3's installer test asserts the NSIS script quotes `"$APPDATA\Daylens"`.
4. **Round line caps showing a dot on an undrawn stroke** at the start of the draw-in — pen strokes use `stroke-dasharray: 1 2` with offset `1.01` so nothing renders before the pen reaches it. (Task 2 CSS; Task 7 start-frame screenshot.)
5. **Build accidentally including CUDA/Mac binaries or missing a native module** — `check-build.mjs` fails in both directions. (Task 3 fixture tests.)

---

### Task 1: Sunrise logo generator and icon files

**Files:**
- Create: `apps/consumer/scripts/logo/sunrise.mjs`, `apps/consumer/scripts/logo/ico.mjs`, `apps/consumer/scripts/logo/render.cjs`
- Create (tests): `apps/consumer/scripts/logo/sunrise.test.ts`, `apps/consumer/scripts/logo/ico.test.ts`
- Create (generated, committed): `apps/consumer/resources/logo-full.svg`, `apps/consumer/resources/logo-small.svg`, `apps/consumer/src/renderer/components/logoPaths.ts`, `apps/consumer/resources/icon.ico`, `apps/consumer/resources/tray@2x.png`
- Replace (generated): `apps/consumer/resources/icon.png`, `apps/consumer/resources/tray.png`
- Modify: `apps/consumer/vitest.config.ts`, `apps/consumer/package.json` (script `logo`)

**Interfaces:**
- Produces: `src/renderer/components/logoPaths.ts` exporting
  `interface LogoMark { circle: string; rays: string; horizon: string; clipY: number; width: [number, number, number] }`,
  `const LOGO: { full: LogoMark; small: LogoMark }`, `const LOGO_COLORS: { tile: string; sun: string; horizon: string }`.
- Produces: `sunrise.mjs` exports `buildMarks(): { FULL, SMALL }`, `FULL`, `SMALL` (LogoMark objects), `markSvg(mark, { size, tile = true }): string`, `writeSources(): void`, `COLORS`.
- Produces: `ico.mjs` exports `buildIco(images: { size: number; data: Buffer }[]): Buffer`.

- [ ] **Step 1: Let vitest see script tests**

`apps/consumer/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'], environment: 'node' }
});
```

- [ ] **Step 2: Write the failing ICO test**

`apps/consumer/scripts/logo/ico.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildIco } from './ico.mjs';

const png = (n: number) => Buffer.from([0x89, 0x50, 0x4e, 0x47, ...Array(n).fill(n)]);

describe('buildIco', () => {
  it('writes the ICONDIR header, one 16-byte entry per image, then the PNG bytes in order', () => {
    const a = png(3), b = png(5);
    const ico = buildIco([{ size: 16, data: a }, { size: 256, data: b }]);
    expect(ico.readUInt16LE(0)).toBe(0); // reserved
    expect(ico.readUInt16LE(2)).toBe(1); // type: icon
    expect(ico.readUInt16LE(4)).toBe(2); // count
    // entry 0
    expect(ico.readUInt8(6)).toBe(16); expect(ico.readUInt8(7)).toBe(16);
    expect(ico.readUInt16LE(6 + 4)).toBe(1); expect(ico.readUInt16LE(6 + 6)).toBe(32);
    expect(ico.readUInt32LE(6 + 8)).toBe(a.length); expect(ico.readUInt32LE(6 + 12)).toBe(6 + 32);
    // entry 1: 256 is encoded as 0
    expect(ico.readUInt8(22)).toBe(0); expect(ico.readUInt8(23)).toBe(0);
    expect(ico.readUInt32LE(22 + 8)).toBe(b.length); expect(ico.readUInt32LE(22 + 12)).toBe(6 + 32 + a.length);
    expect(ico.subarray(38, 38 + a.length).equals(a)).toBe(true);
    expect(ico.subarray(38 + a.length).equals(b)).toBe(true);
  });
});
```

- [ ] **Step 3: Run it — expect FAIL (module not found)**

Run: `cd apps/consumer && ELECTRON_RUN_AS_NODE=1 ../../node_modules/electron/dist/electron.exe ../../node_modules/vitest/vitest.mjs run scripts/logo/ico.test.ts`

- [ ] **Step 4: Implement `ico.mjs`**

```js
// Packs PNG images into a Windows .ico (PNG-compressed entries, valid since Windows Vista).
/** @param {{ size: number, data: Buffer }[]} images */
export function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = 6 + 16 * images.length;
  images.forEach((img, i) => {
    const o = i * 16, dim = img.size >= 256 ? 0 : img.size; // 256 is stored as 0
    dir.writeUInt8(dim, o); dir.writeUInt8(dim, o + 1);
    dir.writeUInt8(0, o + 2); dir.writeUInt8(0, o + 3); // no palette, reserved
    dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6); // planes, bits per pixel
    dir.writeUInt32LE(img.data.length, o + 8); dir.writeUInt32LE(offset, o + 12);
    offset += img.data.length;
  });
  return Buffer.concat([header, dir, ...images.map((i) => i.data)]);
}
```
Run the test again — expect PASS.

- [ ] **Step 5: Write the failing generator test**

`apps/consumer/scripts/logo/sunrise.test.ts`:
```ts
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
```
Run — expect FAIL (module not found).

- [ ] **Step 6: Implement `sunrise.mjs`**

```js
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
```
Run the generator test — expect PASS. (Re-indent the `FULL`/`SMALL` object bodies inside `buildMarks` as you like; the values are what matter.)

- [ ] **Step 7: Implement `render.cjs` (Electron offscreen rasteriser)**

```js
// Rasterises the Sunrise marks into the icon files. Run with Electron (not Node): `pnpm --filter @worksight/consumer logo`.
// Offscreen windows only — this never starts Daylens itself.
const { app, BrowserWindow } = require('electron');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const { FULL, SMALL, markSvg, writeSources } = await import('./sunrise.mjs');
  const { buildIco } = await import('./ico.mjs');
  const res = join(__dirname, '..', '..', 'resources');
  writeSources();
  const SCALE = 4; // draw 4x, then downscale with the best filter: smooth edges at 16 px
  const win = new BrowserWindow({ show: false, transparent: true, frame: false, webPreferences: { offscreen: true } });
  win.setBackgroundColor('#00000000');
  const png = async (mark, size) => {
    const px = size * SCALE;
    win.setContentSize(px, px);
    const html = `<html><body style="margin:0;background:transparent;overflow:hidden">${markSvg(mark, { size: px })}</body></html>`;
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: px, height: px });
    return img.resize({ width: size, height: size, quality: 'best' }).toPNG();
  };
  const entries = [];
  for (const size of [16, 24, 32, 48]) entries.push({ size, data: await png(SMALL, size) });
  for (const size of [64, 128, 256]) entries.push({ size, data: await png(FULL, size) });
  writeFileSync(join(res, 'icon.ico'), buildIco(entries));
  writeFileSync(join(res, 'icon.png'), entries.find((e) => e.size === 256).data);
  writeFileSync(join(res, 'tray.png'), await png(SMALL, 16));
  writeFileSync(join(res, 'tray@2x.png'), await png(SMALL, 32));
  console.log('[logo] wrote icon.ico, icon.png, tray.png, tray@2x.png, logo-*.svg, logoPaths.ts');
  app.quit();
});
```
Add to `apps/consumer/package.json` scripts: `"logo": "electron scripts/logo/render.cjs"`.

- [ ] **Step 8: Generate and inspect**

Run: `cd apps/consumer && ../../node_modules/electron/dist/electron.exe scripts/logo/render.cjs`
Expected: the `[logo] wrote …` line; files exist. Check `file resources/icon.png resources/tray.png resources/tray@2x.png` reports 256×256, 16×16, 32×32 RGBA. Open the PNGs with your image-reading tool and confirm: transparent corners outside the tile, the sun and horizon visible at 16 px (tray.png). If the 16 px tray is muddy, adjust `SMALL` (fewer/thicker strokes) in `sunrise.mjs` and re-run; update the test only if the ray count changes (keep 5 unless unreadable — report any change). Report the final 16 px judgement in your report.

- [ ] **Step 9: Run the tests and typecheck, then commit**

Run the two script tests, then the full consumer suite and typecheck (logoPaths.ts must typecheck under tsconfig.web.json).
```bash
git add apps/consumer/vitest.config.ts apps/consumer/package.json apps/consumer/scripts/logo apps/consumer/resources/logo-full.svg apps/consumer/resources/logo-small.svg apps/consumer/resources/icon.ico apps/consumer/resources/icon.png apps/consumer/resources/tray.png apps/consumer/resources/tray@2x.png apps/consumer/src/renderer/components/logoPaths.ts
git commit -m "feat(consumer): Sunrise logo generator, icon.ico and tray icons"
```

---

### Task 2: `Logo` component and the draw-in

**Files:**
- Create: `apps/consumer/src/renderer/components/Logo.tsx`, `apps/consumer/src/renderer/lib/logo.ts`, `apps/consumer/src/renderer/lib/logo.test.ts`
- Modify: `apps/consumer/src/renderer/components/Rail.tsx:8`, `apps/consumer/src/renderer/components/TitleBar.tsx:6`, `apps/consumer/src/renderer/components/Onboarding.tsx:108-109` (welcome step), `apps/consumer/src/renderer/components/Icon.tsx` (remove `sun`), `apps/consumer/src/renderer/styles.css` (`.logo` rule line 29, `.logo svg` in line 33, new `.dl-*` rules)

**Interfaces:**
- Consumes: `LOGO`, `LOGO_COLORS`, `LogoMark` from `./logoPaths` (Task 1).
- Produces: `<Logo variant: 'full' | 'small'; size: number; animate?: LogoAnimate; decorative?: boolean />`; `lib/logo.ts`: `type LogoAnimate = 'none' | 'app-open' | 'mount'`, `logoStartState(animate): 'final' | 'pre'`, `markAppOpenPlayed(): void`, `resetLogoForTest(): void`.

- [ ] **Step 1: Failing test for the start-state rule**

`apps/consumer/src/renderer/lib/logo.test.ts`:
```ts
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
```
Run — expect FAIL (module not found).

- [ ] **Step 2: Implement `lib/logo.ts`**

```ts
export type LogoAnimate = 'none' | 'app-open' | 'mount';

// ponytail: module flag = once per window lifetime (a renderer reload resets it, which is a re-open anyway).
let appOpenPlayed = false;

/** 'final' = draw the finished logo now; 'pre' = hold the undrawn frame until the window is visible, then play. */
export function logoStartState(animate: LogoAnimate): 'final' | 'pre' {
  if (animate === 'none') return 'final';
  if (animate === 'app-open' && appOpenPlayed) return 'final';
  return 'pre';
}
export function markAppOpenPlayed(): void { appOpenPlayed = true; }
export function resetLogoForTest(): void { appOpenPlayed = false; }
```
Run — expect PASS.

- [ ] **Step 3: Implement `Logo.tsx`**

```tsx
import { useEffect, useId, useState } from 'react';
import { LOGO, LOGO_COLORS } from './logoPaths';
import { logoStartState, markAppOpenPlayed, type LogoAnimate } from '../lib/logo';

/** The Daylens Sunrise mark. `animate` draws it in (horizon → sun rises and traces itself → rays), starting the first
 * time the document is visible, so a window started hidden at login plays it when the user first opens it. */
export function Logo({ variant, size, animate = 'none', decorative = false }: { variant: 'full' | 'small'; size: number; animate?: LogoAnimate; decorative?: boolean }) {
  const m = LOGO[variant];
  const clipId = `dl-clip-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [state, setState] = useState<'final' | 'pre' | 'play'>(() => logoStartState(animate));
  useEffect(() => {
    if (state !== 'pre') return;
    const start = (): void => { if (animate === 'app-open') markAppOpenPlayed(); setState('play'); };
    if (document.visibilityState === 'visible') { start(); return; }
    const onVis = (): void => { if (document.visibilityState === 'visible') start(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [state, animate]);
  const stroke = (color: string, w: number) => ({ fill: 'none', stroke: color, strokeWidth: w, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, pathLength: 1 });
  return (
    <svg className={`dl-logo dl-${state}`} viewBox="0 0 100 100" width={size} height={size}
      role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : 'Daylens'} aria-hidden={decorative || undefined}>
      <rect x="2" y="2" width="96" height="96" rx="24" fill={LOGO_COLORS.tile} />
      <g transform="translate(50 50) scale(0.86) translate(-50 -50)">
        <clipPath id={clipId}><rect x="0" y="0" width="100" height={m.clipY} /></clipPath>
        <g clipPath={`url(#${clipId})`}>
          <g className="dl-sun"><path className="dl-c" d={m.circle} {...stroke(LOGO_COLORS.sun, m.width[0])} /></g>
          <path className="dl-r" d={m.rays} {...stroke(LOGO_COLORS.sun, m.width[1])} />
        </g>
        <path className="dl-h" d={m.horizon} {...stroke(LOGO_COLORS.horizon, m.width[2])} />
      </g>
    </svg>
  );
}
```

- [ ] **Step 4: CSS**

In `styles.css`, replace line 29's `.logo` rule with `.logo { display: grid; place-items: center; margin-bottom: 26px; }` (the mark carries its own black tile) and change line 33 to `.nav svg { width: 20px; height: 20px; }`. Append:
```css
/* ---------- Sunrise logo draw-in (Logo.tsx) ---------- */
/* pathLength=1 on every pen stroke. Dash 1 + gap 2 with offset 1.01 hides a stroke completely (no round-cap dot at
   its start) until the pen reaches it; offset 0 shows it whole. */
.dl-logo .dl-c, .dl-logo .dl-r, .dl-logo .dl-h { stroke-dasharray: 1 2; stroke-dashoffset: 0; }
.dl-pre .dl-c, .dl-pre .dl-r, .dl-pre .dl-h, .dl-play .dl-c, .dl-play .dl-r, .dl-play .dl-h { stroke-dashoffset: 1.01; }
.dl-pre .dl-sun, .dl-play .dl-sun { transform: translateY(10px); }
.dl-play .dl-h { animation: dl-pen .5s cubic-bezier(.65, 0, .35, 1) .2s forwards; }
.dl-play .dl-c { animation: dl-pen .7s cubic-bezier(.65, 0, .35, 1) .55s forwards; }
.dl-play .dl-r { animation: dl-pen .8s cubic-bezier(.65, 0, .35, 1) 1.1s forwards; }
.dl-play .dl-sun { animation: dl-rise .9s var(--ease) .5s forwards; }
@keyframes dl-pen { to { stroke-dashoffset: 0; } }
@keyframes dl-rise { to { transform: translateY(0); } }
@media (prefers-reduced-motion: reduce) {
  .dl-logo .dl-c, .dl-logo .dl-r, .dl-logo .dl-h { stroke-dasharray: none !important; stroke-dashoffset: 0 !important; animation: none !important; }
  .dl-logo .dl-sun { transform: none !important; animation: none !important; }
}
```

- [ ] **Step 5: Use it**

- `Rail.tsx`: `import { Logo } from './Logo';` and replace line 8 with `<div className="logo"><Logo variant="small" size={40} animate="app-open" /></div>`.
- `TitleBar.tsx`: replace line 6 with `<Logo variant="small" size={16} decorative />` and import it (drop the `Icon` import if unused).
- `Onboarding.tsx` welcome (case 0): insert `<Logo variant="full" size={96} animate="mount" />` as the first child, before the `ob-kicker` paragraph. If the welcome's spacing needs it, add `.ob-logo { margin-bottom: 14px; }` by wrapping it: `<div className="ob-logo"><Logo … /></div>`.
- `Icon.tsx`: remove `'sun'` from `IconName` and its entry (verify no other `name="sun"` usage with grep first).

- [ ] **Step 6: Typecheck, full suite, commit**

```bash
git add apps/consumer/src/renderer/components/Logo.tsx apps/consumer/src/renderer/lib/logo.ts apps/consumer/src/renderer/lib/logo.test.ts apps/consumer/src/renderer/components/Rail.tsx apps/consumer/src/renderer/components/TitleBar.tsx apps/consumer/src/renderer/components/Onboarding.tsx apps/consumer/src/renderer/components/Icon.tsx apps/consumer/src/renderer/styles.css
git commit -m "feat(consumer): Sunrise logo in title bar, rail and onboarding, with draw-in"
```

---

### Task 3: Installer and build check

**Files:**
- Create: `apps/consumer/electron-builder.yml`, `apps/consumer/resources/installer.nsh`, `apps/consumer/scripts/check-build.mjs`
- Create (tests): `apps/consumer/scripts/check-build.test.ts`, `apps/consumer/scripts/installer-config.test.ts`
- Modify: `apps/consumer/package.json` (version `1.0.0`, scripts `dist`, `check-build`), `apps/consumer/src/main/index.ts:65` (AppUserModelID)

**Interfaces:**
- Produces: `check-build.mjs` exports `checkBuild(root: string, opts?: { maxBytes?: number }): { ok: boolean; problems: string[]; bytes: number }` and runs as a CLI (`node scripts/check-build.mjs [dir]`, default `release/win-unpacked`, exit 1 on problems).

- [ ] **Step 1: Failing config test**

`apps/consumer/scripts/installer-config.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const app = join(__dirname, '..');
const yml = readFileSync(join(app, 'electron-builder.yml'), 'utf8');
const nsh = readFileSync(join(app, 'resources', 'installer.nsh'), 'utf8');

describe('electron-builder.yml', () => {
  it('identity and one-click per-user install', () => {
    expect(yml).toMatch(/^appId: ai\.worksight\.daylens$/m);
    expect(yml).toMatch(/^productName: Daylens$/m);
    expect(yml).toMatch(/oneClick: true/);
    expect(yml).toMatch(/perMachine: false/);
    expect(yml).toMatch(/include: resources\/installer\.nsh/);
    expect(yml).toMatch(/icon: resources\/icon\.ico/);
  });
  it('excludes CUDA, ARM, Mac and Linux binaries', () => {
    for (const p of ['@node-llama-cpp/win-x64-cuda', '@node-llama-cpp/win-x64-cuda-ext', '@node-llama-cpp/win-arm64',
      '@node-llama-cpp/{linux,mac}-*', 'onnxruntime-node/bin/napi-v3/{darwin,linux}', 'onnxruntime-node/bin/napi-v3/win32/arm64',
      'active-win/lib/binding/*darwin*']) expect(yml).toContain(`!**/node_modules/${p}`);
  });
  it('ships the OCR helper and both tray icons as extra resources', () => {
    for (const f of ['ocr-helper.ps1', 'tray.png', 'tray@2x.png']) expect(yml).toContain(`from: resources/${f}`);
  });
});

describe('installer.nsh', () => {
  it('asks before deleting data, default No, never during an update, with the path quoted', () => {
    expect(nsh).toContain('!macro customUnInstall');
    expect(nsh).toContain('${ifNot} ${isUpdated}');
    expect(nsh).toContain('MB_DEFBUTTON2');
    expect(nsh).toContain('RMDir /r "$APPDATA\\Daylens"');
  });
});
```
Run — expect FAIL (files missing).

- [ ] **Step 2: `electron-builder.yml`**

```yaml
appId: ai.worksight.daylens
productName: Daylens
# pnpm hoists `electron` to the root node_modules, so electron-builder can't auto-detect the version from
# apps/consumer. Pin it to the installed version (keep in sync with the lockfile when upgrading).
electronVersion: 33.4.11
directories:
  output: release
  buildResources: resources
artifactName: Daylens-Setup-${version}.${ext}
# Native deps live in the hoisted root node_modules; `dist` runs rebuild-native first and passes
# --config.npmRebuild=false, so the prebuilt Electron-ABI binaries are bundled as-is.
files:
  - out/**/*
  - package.json
  # Writer runtime: CPU + Vulkan only (spec §2.4 — CUDA adds ~520 MB for a modest NVIDIA-only speedup).
  - "!**/node_modules/@node-llama-cpp/win-x64-cuda{,/**}"
  - "!**/node_modules/@node-llama-cpp/win-x64-cuda-ext{,/**}"
  - "!**/node_modules/@node-llama-cpp/win-arm64{,/**}"
  - "!**/node_modules/@node-llama-cpp/{linux,mac}-*{,/**}"
  # Laya runtime: Windows x64 only.
  - "!**/node_modules/onnxruntime-node/bin/napi-v3/{darwin,linux}{,/**}"
  - "!**/node_modules/onnxruntime-node/bin/napi-v3/win32/arm64{,/**}"
  - "!**/node_modules/active-win/lib/binding/*darwin*{,/**}"
# asar is DISABLED on purpose (same reason as apps/agent): active-win's native .node is unpacked but its runtime
# JS dependency (@mapbox/node-pre-gyp) would stay inside app.asar and be unreachable -> nothing tracked. It also
# keeps node-llama-cpp's ESM + binaries and onnxruntime's .node on plain disk paths.
asar: false
# Runtime files loaded from process.resourcesPath when packaged (index.ts). buildResources is build-time only.
extraResources:
  - from: resources/ocr-helper.ps1
    to: ocr-helper.ps1
  - from: resources/tray.png
    to: tray.png
  - from: resources/tray@2x.png
    to: tray@2x.png
win:
  target: nsis
  icon: resources/icon.ico
nsis:
  oneClick: true
  perMachine: false
  runAfterFinish: true
  createDesktopShortcut: true
  createStartMenuShortcut: true
  shortcutName: Daylens
  include: resources/installer.nsh
```

- [ ] **Step 3: `resources/installer.nsh`**

```nsis
; Daylens uninstall: offer to delete the user's data (history, reports, downloaded models) — default No.
; Skipped when the uninstaller runs as part of an upgrade (${isUpdated}), so updating never touches data.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also delete your Daylens history, reports and downloaded AI models?$\r$\n$\r$\nChoose No to keep them for a future install." IDNO daylens_keep
      RMDir /r "$APPDATA\Daylens"
    daylens_keep:
  ${endIf}
!macroend
```
Run the config test — expect PASS.

- [ ] **Step 4: Failing `check-build` test**

`apps/consumer/scripts/check-build.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { checkBuild, REQUIRED } from './check-build.mjs';

let root: string;
const touch = (rel: string, bytes = 10) => { const p = join(root, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, Buffer.alloc(bytes)); };
const good = () => { for (const r of REQUIRED) touch(r.probe); };

describe('checkBuild', () => {
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'dl-build-')); });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('passes a complete, lean build', () => {
    good();
    expect(checkBuild(root)).toMatchObject({ ok: true, problems: [] });
  });
  it('fails when a required native part is missing', () => {
    good();
    rmSync(join(root, REQUIRED[0].probe));
    const r = checkBuild(root);
    expect(r.ok).toBe(false);
    expect(r.problems.join('\n')).toContain(REQUIRED[0].label);
  });
  it('fails when a CUDA or Mac package sneaks in', () => {
    good();
    touch('resources/app/node_modules/@node-llama-cpp/win-x64-cuda/bins/x.node');
    touch('resources/app/node_modules/onnxruntime-node/bin/napi-v3/darwin/arm64/x.node');
    const r = checkBuild(root);
    expect(r.ok).toBe(false);
    expect(r.problems.join('\n')).toMatch(/win-x64-cuda/);
    expect(r.problems.join('\n')).toMatch(/darwin/);
  });
  it('fails over the size limit and names the biggest directories', () => {
    good();
    touch('resources/app/node_modules/huge/blob.bin', 2000);
    const r = checkBuild(root, { maxBytes: 1000 });
    expect(r.ok).toBe(false);
    expect(r.problems.join('\n')).toMatch(/huge/);
  });
});
```
Run — expect FAIL.

- [ ] **Step 5: Implement `check-build.mjs`**

First list the real native file locations to use as probes: `ls ../../node_modules/better-sqlite3/build/Release/*.node`, `ls ../../node_modules/active-win/lib/binding/napi-6-win32-unknown-x64`, `ls ../../node_modules/onnxruntime-node/bin/napi-v3/win32/x64`, `ls ../../node_modules/@node-llama-cpp/win-x64/bins ../../node_modules/@node-llama-cpp/win-x64-vulkan/bins` — set each `probe` to one concrete file under `resources/app/node_modules/…` that exists in those listings (keep the paths below if they match).
```js
// Verifies an unpacked Windows build (release/win-unpacked): every native part present, no CUDA/ARM/Mac/Linux
// binaries, and the total size under a limit. Run after `dist`, or alone: node scripts/check-build.mjs [dir]
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const NM = 'resources/app/node_modules';
export const REQUIRED = [
  { label: 'Daylens.exe', probe: 'Daylens.exe' },
  { label: 'OCR helper', probe: 'resources/ocr-helper.ps1' },
  { label: 'tray icon', probe: 'resources/tray.png' },
  { label: 'tray icon @2x', probe: 'resources/tray@2x.png' },
  { label: 'main bundle', probe: 'resources/app/out/main/index.js' },
  { label: 'Laya worker', probe: 'resources/app/out/main/brain.js' },
  { label: 'writer worker', probe: 'resources/app/out/main/writer.js' },
  { label: 'SQLite (better-sqlite3)', probe: `${NM}/better-sqlite3/build/Release/better_sqlite3.node` },
  { label: 'window tracking (active-win)', probe: `${NM}/active-win/lib/binding/napi-6-win32-unknown-x64/node-active-win.node` },
  { label: 'Laya runtime (onnxruntime win32/x64)', probe: `${NM}/onnxruntime-node/bin/napi-v3/win32/x64/onnxruntime_binding.node` },
  { label: 'writer runtime CPU (@node-llama-cpp/win-x64)', probe: `${NM}/@node-llama-cpp/win-x64/package.json` },
  { label: 'writer runtime Vulkan (@node-llama-cpp/win-x64-vulkan)', probe: `${NM}/@node-llama-cpp/win-x64-vulkan/package.json` },
];
export const FORBIDDEN = [
  `${NM}/@node-llama-cpp/win-x64-cuda`, `${NM}/@node-llama-cpp/win-x64-cuda-ext`, `${NM}/@node-llama-cpp/win-arm64`,
  `${NM}/onnxruntime-node/bin/napi-v3/darwin`, `${NM}/onnxruntime-node/bin/napi-v3/linux`, `${NM}/onnxruntime-node/bin/napi-v3/win32/arm64`,
];
const FORBIDDEN_PREFIX = [`${NM}/@node-llama-cpp/linux-`, `${NM}/@node-llama-cpp/mac-`];
export const MAX_BYTES = 900 * 1024 * 1024;

function sizeOf(dir, perTop, top) {
  let total = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    const n = e.isDirectory() ? sizeOf(p, perTop, top ?? p) : statSync(p).size;
    total += n;
    if (!e.isDirectory() && top) perTop.set(top, (perTop.get(top) ?? 0) + n);
  }
  return total;
}

export function checkBuild(root, { maxBytes = MAX_BYTES } = {}) {
  const problems = [];
  for (const r of REQUIRED) if (!existsSync(join(root, r.probe))) problems.push(`missing: ${r.label} (${r.probe})`);
  for (const f of FORBIDDEN) if (existsSync(join(root, f))) problems.push(`should not ship: ${f}`);
  const scoped = join(root, NM, '@node-llama-cpp');
  if (existsSync(scoped)) for (const d of readdirSync(scoped)) {
    const rel = `${NM}/@node-llama-cpp/${d}`;
    if (FORBIDDEN_PREFIX.some((p) => rel.startsWith(p))) problems.push(`should not ship: ${rel}`);
  }
  const perTop = new Map();
  const nm = join(root, NM);
  const bytes = sizeOf(root, new Map(), null);
  if (bytes > maxBytes) {
    if (existsSync(nm)) sizeOf(nm, perTop, null);
    const biggest = [...perTop.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([d, n]) => `  ${(n / 1048576).toFixed(1)} MB  ${relative(root, d)}`).join('\n');
    problems.push(`too big: ${(bytes / 1048576).toFixed(0)} MB > ${(maxBytes / 1048576).toFixed(0)} MB. Largest:\n${biggest}`);
  }
  return { ok: problems.length === 0, problems, bytes };
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)).toLowerCase() === resolve(process.argv[1]).toLowerCase()) {
  const dir = process.argv[2] ?? join(fileURLToPath(new URL('..', import.meta.url)), 'release', 'win-unpacked');
  const r = checkBuild(dir);
  console.log(r.ok ? `[check-build] OK — ${(r.bytes / 1048576).toFixed(0)} MB` : `[check-build] FAILED\n${r.problems.join('\n')}`);
  process.exit(r.ok ? 0 : 1);
}
```
Run the test — expect PASS. (Note: in the size test, `perTop` keys are top-level entries under `node_modules`; `huge` must appear in the message.)

- [ ] **Step 6: Package scripts, version, AppUserModelID**

`apps/consumer/package.json`: set `"version": "1.0.0"`; add scripts
`"dist": "node ../../scripts/rebuild-native.cjs && electron-vite build && electron-builder --config.npmRebuild=false && node scripts/check-build.mjs"`,
`"check-build": "node scripts/check-build.mjs"`.
`src/main/index.ts` right after `app.setName('Daylens');` (line 65): `app.setAppUserModelId('ai.worksight.daylens'); // matches the installer's shortcut, so the taskbar groups them`.

- [ ] **Step 7: Full suite, typecheck, commit (do NOT run `dist` — Task 7 does)**

```bash
git add apps/consumer/electron-builder.yml apps/consumer/resources/installer.nsh apps/consumer/scripts/check-build.mjs apps/consumer/scripts/check-build.test.ts apps/consumer/scripts/installer-config.test.ts apps/consumer/package.json apps/consumer/src/main/index.ts
git commit -m "feat(consumer): one-click NSIS installer config, uninstall prompt, build check"
```

---

### Task 4: Visible polish (spec §4 items 1–6)

**Files:**
- Modify: `src/renderer/lib/insights.ts:27-36` + `insights.test.ts`; `src/renderer/components/InsightsScreen.tsx:132`; `src/renderer/components/ReportsScreen.tsx:71` and the `.rep-search` block (~243-282); `src/renderer/styles.css` (`.sr-only`); `src/renderer/lib/format.ts:3-6` + `format.test.ts:8`
- Create: `src/renderer/components/AboutSection.tsx`
- Modify (About IPC): `src/main/channels.ts`, `src/main/ipc.ts` (AboutView, IpcDeps, handler), `src/preload/index.ts`, `src/main/index.ts` (deps), `src/renderer/components/SettingsScreen.tsx`
(All paths under `apps/consumer/`.)

**Interfaces:**
- Produces: `AboutView { version: string; credits: string[] }` in `main/ipc.ts`; channel `CH.aboutGet = 'app:about'`; preload `api.about(): Promise<AboutView>`.

- [ ] **Step 1: Week label years — failing tests** (append to `insights.test.ts` `describe('weekLabel')`)

```ts
  it('adds years: both ends for a week spanning two years, once at the end for a week in another year', () => {
    expect(weekLabel('2025-12-29', '2026-03-10')).toBe('29 Dec 2025 – 4 Jan 2026');
    expect(weekLabel('2025-09-22', '2026-03-10')).toBe('22–28 Sep 2025');
    expect(weekLabel('2025-09-29', '2026-03-10')).toBe('29 Sep – 5 Oct 2025');
    expect(weekLabel('2026-06-01', '2026-09-30')).toBe('1–7 Jun'); // current year: unchanged
  });
```
Run — expect FAIL. Then replace the tail of `weekLabel` (lines 31-35):
```ts
  const start = parseYmd(weekStart);
  const end = parseYmd(addDays(weekStart, 6));
  const thisYear = parseYmd(today).getFullYear();
  const spansYears = start.getFullYear() !== end.getFullYear();
  const endYear = spansYears || end.getFullYear() !== thisYear ? ` ${end.getFullYear()}` : '';
  if (spansYears) return `${start.getDate()} ${MONTHS[start.getMonth()]} ${start.getFullYear()} – ${end.getDate()} ${MONTHS[end.getMonth()]}${endYear}`;
  return start.getMonth() === end.getMonth()
    ? `${start.getDate()}–${end.getDate()} ${MONTHS[end.getMonth()]}${endYear}`
    : `${start.getDate()} ${MONTHS[start.getMonth()]} – ${end.getDate()} ${MONTHS[end.getMonth()]}${endYear}`;
```
Run — expect PASS (existing weekLabel tests too).

- [ ] **Step 2: Past-week copy**

`InsightsScreen.tsx:132`: `return <div className="report-card"><p>{view.nextWeek === null ? 'Not enough tracked days yet this week' : 'Not enough tracked days that week'}</p></div>;` (`nextWeek` is null only for the current week.)

- [ ] **Step 3: Search clear + announced no-match**

`ReportsScreen.tsx:71`: in the empty-query branch add `++searchSeq.current;` first, so an in-flight reply for the old query is dropped:
```ts
    if (print || !searchQ.trim()) { ++searchSeq.current; setSearchHits([]); setSearchOpen(false); setHighlighted(-1); return; }
```
Inside `<div className="rep-search" …>`, right after the `<input … />`, add a polite live region (keep the visible "No reports match" row as is):
```tsx
              <span className="sr-only" role="status" aria-live="polite">
                {searchOpen && searchQ.trim() && searchHits.length === 0 ? 'No reports match' : ''}
              </span>
```
`styles.css` (append): `.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }`

- [ ] **Step 4: "3h", not "3h 0m" — failing test then fix**

`format.test.ts:8` → `expect(formatHm(3600)).toBe('1h');` and add `expect(formatHm(7260)).toBe('2h 1m'); expect(formatHm(0)).toBe('0m');`. Run — FAIL. `format.ts`:
```ts
export function formatHm(sec: number): string {
  const m = Math.floor(Math.max(0, sec) / 60);
  if (m < 60) return `${m}m`;
  return m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 60)}h`;
}
```
Run — PASS; then run the whole renderer test folder (other tests may assert a formatted string).

- [ ] **Step 5: Settings → About**

- `main/channels.ts`: add `aboutGet: 'app:about',`.
- `main/ipc.ts`: `export interface AboutView { version: string; credits: string[] }`; add `about(): AboutView;` to `IpcDeps`; in `registerIpc`: `ipcMain.handle(CH.aboutGet, () => d.about());`.
- `preload/index.ts`: import `AboutView`; add `about: (): Promise<AboutView> => ipcRenderer.invoke(CH.aboutGet),` to `api`.
- `main/index.ts` where `registerIpc({...})` is called: add `about: () => ({ version: app.getVersion(), credits: [WRITER_ATTRIBUTION] }),`.
- `AboutSection.tsx`:
```tsx
import { useEffect, useState } from 'react';
import type { AboutView } from '../../main/ipc';
import { api } from '../lib/api';

export function AboutSection() {
  const [about, setAbout] = useState<AboutView | null>(null);
  useEffect(() => { api.about().then(setAbout).catch((e) => console.error('[renderer] about failed:', e)); }, []);
  if (!about) return null;
  return (
    <div className="grp">
      <h4>About</h4>
      <div className="srow"><p>Daylens {about.version}<small>{about.credits.join(' ')}</small></p></div>
    </div>
  );
}
```
- `SettingsScreen.tsx`: render `<AboutSection />` as the last child of `<main className="settings">`.
If `main/ipc.test.ts` builds a full `IpcDeps`, add `about: () => ({ version: '1.0.0', credits: [] })` there.

- [ ] **Step 6: Full suite, typecheck, commit**

```bash
git add apps/consumer/src/renderer/lib/insights.ts apps/consumer/src/renderer/lib/insights.test.ts apps/consumer/src/renderer/components/InsightsScreen.tsx apps/consumer/src/renderer/components/ReportsScreen.tsx apps/consumer/src/renderer/styles.css apps/consumer/src/renderer/lib/format.ts apps/consumer/src/renderer/lib/format.test.ts apps/consumer/src/renderer/components/AboutSection.tsx apps/consumer/src/renderer/components/SettingsScreen.tsx apps/consumer/src/main/channels.ts apps/consumer/src/main/ipc.ts apps/consumer/src/preload/index.ts apps/consumer/src/main/index.ts
git commit -m "fix(consumer): week years, past-week copy, search clear/announce, 3h durations, About"
```
(Add `apps/consumer/src/main/ipc.test.ts` if you changed it.)

---

### Task 5: Safety and robustness (spec §4 items 7–12)

**Files (under `apps/consumer/`):**
- Modify: `src/main/report/share.ts` + `share.test.ts` (items 7, 8); `src/main/index.ts` (~512-537 auto-save, ~809-819 shareGet, ~1000-1012 delete, 419-445 detailFor/pastDay); `src/main/ipc.ts:65` (`shareGet(): Promise<ShareGetView>`); `src/main/report/schema.ts:83-84, 103-107` + `schema.test.ts` (item 9); `resources/ocr-helper.ps1` (item 10) + new `src/main/ocr/helperScript.test.ts`; `src/renderer/components/PrivacySection.tsx:15-25,109` + new `src/renderer/lib/privacy.ts`, `privacy.test.ts` (item 11b)

**Interfaces:**
- Produces: `AutoSaveDeps` gains optional `stillValid?(): boolean` and `remove?(p: string): Promise<void>`; `autoSavePdf` may return `'skipped'`. `checkFolder(dir, stat, timeoutMs = 1500): Promise<'ok' | 'missing' | 'unknown'>` in share.ts. `restoreDefaults(current: string[]): { list: string[]; full: boolean }` in `renderer/lib/privacy.ts`.

- [ ] **Step 1: Item 7 — failing test** (share.test.ts)

```ts
  it('skips (and removes the temp file) when the report was deleted while rendering', async () => {
    const calls: string[] = [];
    const r = await autoSavePdf('2026-09-28', 'C:\\out', {
      render: async () => Buffer.from('pdf'), write: async (p) => { calls.push(`write ${p}`); },
      exists: async () => true, rename: async () => { calls.push('rename'); },
      stillValid: () => false, remove: async (p) => { calls.push(`remove ${p}`); }
    });
    expect(r).toBe('skipped');
    expect(calls).not.toContain('rename');
    expect(calls.some((c) => c.startsWith('remove') && c.endsWith('.tmp'))).toBe(true);
  });
```
Run — FAIL. In `share.ts`: add to `AutoSaveDeps`
```ts
  /** False once "Delete my activity" ran after this save was scheduled: the rendered PDF shows wiped data. */
  stillValid?(): boolean;
  remove?(p: string): Promise<void>;
```
change the return type to `Promise<'ok' | 'off' | 'skipped' | string>`, and between `write` and `rename`:
```ts
    if (deps.stillValid && !deps.stillValid()) { await deps.remove?.(tmp).catch(() => {}); return 'skipped'; }
```
Run — PASS. In `index.ts` pdfQueue run: pass `stillValid: () => epoch === undefined || epoch === reportEpoch, remove: (p) => unlink(p)` (import `unlink` from `node:fs/promises` alongside `stat`/`rename`), and treat `'skipped'` as no error: `pdfFolderError = r === 'ok' || r === 'off' || r === 'skipped' ? null : r;`.

- [ ] **Step 2: Item 8 — failing tests for `checkFolder`** (share.test.ts)

```ts
describe('checkFolder', () => {
  const dir = { isDirectory: () => true }, file = { isDirectory: () => false };
  const err = (code: string) => Object.assign(new Error(code), { code });
  it('ok for a directory, missing for ENOENT/ENOTDIR or a file', async () => {
    expect(await checkFolder('x', async () => dir)).toBe('ok');
    expect(await checkFolder('x', async () => file)).toBe('missing');
    expect(await checkFolder('x', async () => { throw err('ENOENT'); })).toBe('missing');
    expect(await checkFolder('x', async () => { throw err('ENOTDIR'); })).toBe('missing');
  });
  it('unknown (no warning) for other errors or an unreachable share that never answers', async () => {
    expect(await checkFolder('x', async () => { throw err('EACCES'); })).toBe('unknown');
    expect(await checkFolder('\\\\gone\\share', () => new Promise(() => {}), 20)).toBe('unknown');
  });
});
```
Run — FAIL. Implement in `share.ts`:
```ts
/** Whether the auto-save folder still exists, without ever blocking: an unreachable network share (which can take
 * the SMB timeout to fail) or any non-"not found" error reads as 'unknown', which shows no warning. */
export async function checkFolder(dir: string, stat: (d: string) => Promise<{ isDirectory(): boolean }>, timeoutMs = 1500): Promise<'ok' | 'missing' | 'unknown'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'unknown'>((res) => { timer = setTimeout(() => res('unknown'), timeoutMs); });
  const check = stat(dir).then(
    (s): 'ok' | 'missing' => (s.isDirectory() ? 'ok' : 'missing'),
    (e: NodeJS.ErrnoException): 'missing' | 'unknown' => (e?.code === 'ENOENT' || e?.code === 'ENOTDIR' ? 'missing' : 'unknown'));
  try { return await Promise.race([check, timeout]); } finally { clearTimeout(timer); }
}
```
Run — PASS. `ipc.ts:65` → `shareGet(): Promise<ShareGetView>;` (the handler at line 207 already returns whatever `d.reports.shareGet()` returns). `index.ts` shareGet becomes:
```ts
        shareGet: async () => {
          // A save-time failure (pdfFolderError) always wins: it's more specific than a plain "gone" check.
          const folder = settings.get().reportPdfFolder;
          if (!pdfFolderError && folder && (await checkFolder(folder, stat)) === 'missing') return { folder, lastError: "The auto-save folder can't be found." };
          return { folder, lastError: pdfFolderError };
        },
```
Remove the now-unused `existsSync`/`statSync` imports if nothing else uses them.

- [ ] **Step 3: Item 9 — failing tests** (schema.test.ts, in the grounding describe)

```ts
  it('does not read "3M views" or "100 m²" as minutes, but still checks "40m"', () => {
    expect(groundText('The video had 3M views.', [30])).toBe('The video had 3M views.');
    expect(groundText('A 100 m² room.', [30])).toBe('A 100 m² room.');
    expect(groundText('You spent 40m here.', [30])).toBeNull();
    expect(groundText('You spent 30m here.', [30])).toBe('You spent 30m here.');
  });
```
(Adjust the `groundText` call shape to the existing helper's signature in schema.ts if it differs — keep the four cases.) Run — FAIL on the first two. In `schema.ts` replace the `DURATION_RE` definition (line 84) with two regexes:
```ts
// Named units, any case: "60 minutes", "45 min", "3 hours", "60-minute", "2h".
const DURATION_RE = /\b(\d+(?:\.\d+)?)\s*-?\s*(minutes|minute|mins|min|hours|hour|hrs|hr|h)\b/gi;
// The bare minute unit is lowercase only ("40m"), so "3M views" isn't a duration, and not followed by ²/³ ("100 m²").
// ponytail: a standalone "100 m" (metres) still reads as minutes — rare in screen-time prose.
const BARE_MIN_RE = /\b(\d+(?:\.\d+)?)\s*m(?![a-zA-Z²³])/g;
```
and in `hasUngroundedDuration`, after the existing `DURATION_RE` loop over `remaining`, add:
```ts
  BARE_MIN_RE.lastIndex = 0;
  while ((m = BARE_MIN_RE.exec(remaining))) {
    if (!isGrounded(parseFloat(m[1]))) return true;
  }
```
Update the comment above `DURATION_RE` that listed `"40m"`. Run the whole `src/main/report` folder — PASS (combined "5h 40m" tests must still pass: the combined pass blanks those spans first).

- [ ] **Step 4: Item 10 — failing script test, then the helper**

`src/main/ocr/helperScript.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ps1 = readFileSync(join(__dirname, '../../../resources/ocr-helper.ps1'), 'utf8');

describe('ocr-helper.ps1', () => {
  it('skips a hung (not responding) window before PrintWindow, as a normal no-capture result', () => {
    expect(ps1).toContain('public static extern bool IsHungAppWindow(IntPtr h);');
    const fn = ps1.slice(ps1.indexOf('function Capture-Foreground'));
    const hung = fn.indexOf('IsHungAppWindow($h)'), print = fn.indexOf('::PrintWindow(');
    expect(hung).toBeGreaterThan(-1);
    expect(hung).toBeLessThan(print);
    expect(fn.slice(hung, hung + 80)).toContain('return $null');
  });
});
```
Run — FAIL. In `ocr-helper.ps1`: add to the `DaylensFg` class `  [DllImport("user32.dll")] public static extern bool IsHungAppWindow(IntPtr h);` and in `Capture-Foreground`, right after the `IsIconic` line:
```powershell
  # A hung (not responding) window would block PrintWindow until our timeout and flip OCR status to failed: skip it.
  if ([DaylensFg]::IsHungAppWindow($h)) { return $null }
```
Run — PASS.

- [ ] **Step 5: Item 11a — delete stays "deleted" if the checkpoint fails**

`index.ts` delete handler: replace `checkpoint(db);` with
```ts
            try { checkpoint(db); } catch (e) { console.error('[privacy] checkpoint after delete failed:', e); } // the delete itself succeeded
```

- [ ] **Step 6: Item 11b — Restore defaults with a full list**

`src/renderer/lib/privacy.test.ts`:
```ts
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
```
Run — FAIL. Create `src/renderer/lib/privacy.ts` (move the function out of PrivacySection.tsx):
```ts
import { DEFAULT_EXCLUSIONS, MAX_EXCLUSIONS } from '../../shared/exclusions';

/** Union of the current list and the defaults (case-insensitive), capped at MAX_EXCLUSIONS. Keeps whatever the user
 * added, never dropping their patterns; `full` = some default couldn't be added because the list is at the cap. */
export function restoreDefaults(current: string[]): { list: string[]; full: boolean } {
  const seen = new Set(current.map((p) => p.toLowerCase()));
  const list = [...current];
  let full = false;
  for (const d of DEFAULT_EXCLUSIONS) {
    if (seen.has(d.toLowerCase())) continue;
    if (list.length >= MAX_EXCLUSIONS) { full = true; break; }
    seen.add(d.toLowerCase());
    list.push(d);
  }
  return { list, full };
}
```
Run — PASS. In `PrivacySection.tsx`: delete the local `restoreDefaults`, import it from `../lib/privacy`, and change the button (line 109):
```tsx
            <button className="btn s" onClick={() => {
              const r = restoreDefaults(view.exclusions);
              if (r.full) setNote('Your list is full — remove some patterns to restore the defaults.');
              if (r.list.length !== view.exclusions.length) void saveExclusions(r.list);
            }}>Restore defaults</button>
```
(Drop now-unused imports from PrivacySection.)

- [ ] **Step 7: Item 12 — past days read their reads once**

`index.ts`: give `detailFor` an optional reads parameter and reuse one read in `pastDay`:
```ts
    const detailFor = (date: string, now: number, reads = labelStore.readsForDay(date)): DayDetail => buildDayDetail({
      sessions: repo.getFocusSessions(date), now, exclusions: parseExclusions(settings.get().exclusions),
      reads: reads.map((r) => ({ at: r.at, appName: r.appName, activity: r.activity,
        category: r.category ? finalCategory(r.category, r.conf ?? 0, r.appName) : null }))
    });
```
and in `pastDay`:
```ts
      const reads = labelStore.readsForDay(d);
      const v: PastDay = {
        screenSec: view.screenSec, detail: detailFor(d, now, reads), deepWorkSec: deepWorkSec(buildEpisodes(reads, false)),
```

- [ ] **Step 8: Full suite, typecheck, commit**

```bash
git add apps/consumer/src/main/report/share.ts apps/consumer/src/main/report/share.test.ts apps/consumer/src/main/index.ts apps/consumer/src/main/ipc.ts apps/consumer/src/main/report/schema.ts apps/consumer/src/main/report/schema.test.ts apps/consumer/resources/ocr-helper.ps1 apps/consumer/src/main/ocr/helperScript.test.ts apps/consumer/src/renderer/components/PrivacySection.tsx apps/consumer/src/renderer/lib/privacy.ts apps/consumer/src/renderer/lib/privacy.test.ts
git commit -m "fix(consumer): delete vs in-flight PDF, non-blocking folder check, metres, hung windows, restore-defaults, single past-day read"
```

---

### Task 6: Internal tidy-ups (spec §4 items 13a–13h)

**Files (under `apps/consumer/src/`):** `main/report/schema.ts`, `main/report/week.ts` + `week.test.ts`, new `shared/week.ts` + `shared/week.test.ts`, `renderer/lib/insights.ts`, `main/index.ts`, `main/coach/tip.ts` + `tip.test.ts`, `main/coach/engine.ts` + `engine.test.ts`

- [ ] **Step 1: 13a — one `cut`/`str`**

`schema.ts`: `export const cut = …` (line 16) and `export const str = …` (line 144). `week.ts`: delete its local `cut` (line 4) and `str` (line 59); `import { cut, str } from './schema';` (merge into the existing schema import if there is one). Run `src/main/report` tests — PASS.

- [ ] **Step 2: 13b — shared `canGenerateWeek`**

`shared/week.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { canGenerateWeek } from './week';

describe('canGenerateWeek', () => {
  it('past weeks always; the current week only from its Sunday; handles month/year ends', () => {
    expect(canGenerateWeek('2026-09-21', '2026-09-29')).toBe(true);
    expect(canGenerateWeek('2026-09-28', '2026-10-03')).toBe(false); // Saturday
    expect(canGenerateWeek('2026-09-28', '2026-10-04')).toBe(true);  // Sunday
    expect(canGenerateWeek('2025-12-29', '2026-01-04')).toBe(true);
  });
});
```
`shared/week.ts`:
```ts
/** Generate may run for a week only once it's finished: any past week, or the current week from its own Sunday on.
 * Shared by main (report/week.ts) and the renderer (lib/insights.ts weekReady). Dates are local YYYY-MM-DD. */
export function canGenerateWeek(ws: string, today: string): boolean {
  const [y, m, d] = ws.split('-').map(Number);
  const s = new Date(y, m - 1, d + 6);
  const sunday = `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, '0')}-${String(s.getDate()).padStart(2, '0')}`;
  return today >= sunday;
}
```
`week.ts`: delete its `canGenerateWeek` (and its doc comment) and add `export { canGenerateWeek } from '../../shared/week';`. `renderer/lib/insights.ts`: replace the `weekReady` function with `export { canGenerateWeek as weekReady } from '../../shared/week';` (keep its doc comment above it). Run all tests — PASS.

- [ ] **Step 3: 13c — topApps merges case-insensitively** (week.test.ts)

```ts
  it('merges app names that differ only by case, keeping the spelling with the most minutes', () => {
    const n = buildInsights({ weekStart: '2026-09-21', days: [], prevDays: null, nudges: [],
      apps: [[{ app: 'Code', min: 50 }], [{ app: 'code', min: 20 }, { app: 'Chrome', min: 30 }]] });
    expect(n.topApps).toEqual([{ app: 'Code', min: 70 }, { app: 'Chrome', min: 30 }]);
  });
```
(Use the real `days` shape the other buildInsights tests use if `[]` isn't accepted.) In `buildInsights` replace lines 50-52:
```ts
  const appTotals = new Map<string, { min: number; spell: Map<string, number> }>();
  for (const day of i.apps) for (const a of day) {
    const k = a.app.toLowerCase(), e = appTotals.get(k) ?? { min: 0, spell: new Map<string, number>() };
    e.min += a.min; e.spell.set(a.app, (e.spell.get(a.app) ?? 0) + a.min);
    appTotals.set(k, e);
  }
  const topApps = [...appTotals.values()]
    .map((e) => ({ app: [...e.spell.entries()].sort((a, b) => b[1] - a[1])[0][0], min: e.min }))
    .sort((a, b) => b.min - a.min).slice(0, 8);
```

- [ ] **Step 4: 13d — no week summaries before tracking began**

`index.ts` `insights.generate`: compute the oldest tracked day like `insightsView` does and no-op for weeks that end before it:
```ts
          const days = repo.getAvailableDays(); // newest first
          const oldest = days.length ? days[days.length - 1] : null;
          if (oldest === null || shiftDate(ws, 6) < oldest) return insightsView(ws); // nothing tracked that week
```
(place before the existing future/Sunday/running guard).

- [ ] **Step 5: 13e — one writer-state builder**

`index.ts`: add near the other view helpers
```ts
    const currentWriterState = () => writerState({ mode: settings.get().writerMode, hasKey: secrets.has(settings.get().aiProvider), cloudModel: settings.get().aiModel, tier: writerTier(), model: writerDl.status(), unavailable: unavailable() });
```
and replace the three `writerState({ … })` literals (lines ~635, ~663, ~674) with `currentWriterState()`. Behaviour unchanged; typecheck.

- [ ] **Step 6: 13f — tip allowed minutes from the template body only** (tip.test.ts)

Change the existing test's expectation and add a search-text case:
```ts
    expect(tipAllowedMinutes(input)).toEqual([12, 5]); // title numbers (counts, search text) are not durations
  });
  it('never allows digits from the user\'s search query in the title', () => {
    const input: TipInput = { ruleId: 'repeat_search', app: 'Chrome', title: null,
      episode: { minutes: 4, category: null, activity: null, avgStuck: 0 },
      template: { title: 'Searched "iphone 15" 3× this week', body: "Save the answer as a note or bookmark so you don't have to look it up again." } };
    expect(tipAllowedMinutes(input)).toEqual([4]);
  });
```
`tip.ts`:
```ts
/** Real numbers the writer may safely repeat back when rewriting a tip: the episode minutes plus any number in the
 * template body (so "a 5-min walk" doesn't flag its own "5"). Not the title: it holds counts and the user's search text. */
export function tipAllowedMinutes(t: TipInput): number[] {
  return [t.episode.minutes, ...numbersIn(t.template.body)];
}
```

- [ ] **Step 7: 13g — a slow fallback re-checks hold/snooze** (engine.test.ts, inside the rewrite describe)

```ts
    it('re-checks the hold when rewrite fell back to the template slowly (>= 2 s)', async () => {
      let t = T(12), calls = 0;
      const { d, shown, rows } = deps({
        now: () => t,
        holdReason: async () => { calls++; return calls === 1 ? null : 'call'; },
        rules: [() => tip()],
        rewrite: async (cand) => { t += 2500; return cand; } // timed out -> original, but 2.5 s later
      });
      expect(await createCoach(d).tick()).toBe('held');
      expect(shown).toHaveLength(0);
      expect(rows[0].status).toBe('held');
    });
```
`engine.ts` rewrite block:
```ts
        if (d.rewrite && REWRITE_RULES.has(c.ruleId)) {
          const original = c;
          const started = d.now();
          const rewritten = await d.rewrite(original, snap).catch(() => original);
          if (rewritten !== original) c = { ...rewritten, ruleId: original.ruleId, key: original.key, kind: original.kind, primary: original.primary };
          // A real rewrite, or a fallback that took a while (timeout / refused after a wait), may have outlived the
          // hold/snooze picture: re-check both before showing. An instant fallback needs no second PowerShell spawn.
          if (rewritten !== original || d.now() - started >= SLOW_FALLBACK_MS) {
            const holdAfter = await d.holdReason();
            holdOnce = Promise.resolve(holdAfter); // later candidates this tick see the fresh answer
            if (holdAfter || now < d.snoozeUntil()) {
              recordHeld(c);
              continue;
            }
          }
        }
```
with `const SLOW_FALLBACK_MS = 2000;` at module top. Existing tests (instant no-op → one holdReason call) must still pass.

- [ ] **Step 8: 13h — episode run uses the normalised app key** (tip.test.ts)

```ts
  it('counts the episode run across raw spellings of the same app', () => {
    const now = T(12, 0);
    const reads = [
      read(now - 8 * 60_000, 'Code.exe'), read(now - 6 * 60_000, 'Code.exe'),
      read(now - 4 * 60_000, 'code'), read(now - 2 * 60_000, 'code')
    ];
    const input = tipInput(cand(), snap({ readsToday: reads, now }), []);
    expect(input.episode.minutes).toBe(2); // 4 reads * 30s — one app, two raw spellings
  });
```
(Uses the file's existing `read`, `cand`, `snap`, `T` helpers, as in the tests above it.) `tip.ts` run loop (line 60): `if (appKey(r.appName) !== appKey(appRaw) || snap.now - r.at > EPISODE_WINDOW_MS) break;`.

- [ ] **Step 9: Full suite, typecheck, commit**

```bash
git add apps/consumer/src/main/report/schema.ts apps/consumer/src/main/report/week.ts apps/consumer/src/main/report/week.test.ts apps/consumer/src/shared/week.ts apps/consumer/src/shared/week.test.ts apps/consumer/src/renderer/lib/insights.ts apps/consumer/src/main/index.ts apps/consumer/src/main/coach/tip.ts apps/consumer/src/main/coach/tip.test.ts apps/consumer/src/main/coach/engine.ts apps/consumer/src/main/coach/engine.test.ts
git commit -m "refactor(consumer): shared week gate, helper dedupe, case-folded top apps, tip grounding tidy-ups"
```

---

### Task 7: Build and verification (controller)

- [ ] **Step 1:** Full consumer suite, core suite, `pnpm -r typecheck`, `npx electron-vite build` — all green.
- [ ] **Step 2: Installer build.** Confirm the user's dev Daylens isn't holding `better_sqlite3.node` (rebuild-native rewrites it; EPERM means it's running — ask the user to close it; never kill it). Confirm the winCodeSign cache workaround exists (`%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0`; if missing, apply the documented one-time extract excluding `*.dylib`). Run `pnpm --filter @worksight/consumer dist`. Expected: `release/Daylens-Setup-1.0.0.exe` and `[check-build] OK — N MB`. Record the installer size.
- [ ] **Step 3: Headless screenshots** (stubbed `window.daylens` over the built `out/renderer`, deleted afterwards): title bar + rail with the logo at draw-in start / middle / end (pin Web Animations time), onboarding welcome, Settings → About, Insights with a Dec/Jan week, reduced-motion end state. Check the start frame shows no stray dots.
- [ ] **Step 4: Human checklist** (spec §5.3, including step 0: close the dev Daylens first), plus spec §2.3's single-instance check: launching Daylens again from the Start menu while it runs brings the existing window forward.
