# Daylens Phase 5 — Coach, Pop-ups, Break Screen, Memory-Friendly Labelling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real-time coaching through the approved animated top-right pop-ups and a full-screen break screen, gated by manners rules, plus Laya labelling that waits for idle time / free memory so the user's other apps keep their RAM.

**Architecture:** Pure, unit-tested modules under `src/main/coach/` (types, store, activity helpers, 12 rules, profile weights, MannersGate, engine) and `src/main/brain/resources.ts`; two thin window managers (`src/main/windows/pill.ts`, `breakOverlay.ts`) with their own vanilla-TS renderer pages (`pill.html`, `break.html`) and preloads; `main/index.ts` builds a snapshot every 30 s and wires IPC, tray and a global shortcut; renderer adds Settings → Pop-ups and a Today "While you were busy" card.

**Tech Stack:** Electron 33 (BrowserWindow, screen, globalShortcut, powerMonitor), electron-vite 2 (multi-page renderer + multi-entry preload), React 19 (settings/Today only), TypeScript 5.7, zod 3, better-sqlite3, Vitest 2, onnxruntime (Python quantization + onnxruntime-node 1.21).

**Spec:** `docs/superpowers/specs/2026-09-25-daylens-phase5-coach-popups-design.md` (extends the main spec §9 and the Phase 4 spec).

**Deliberate deltas from the spec (plan rulings):** `nudges` gets an extra `key TEXT NOT NULL DEFAULT ''` column (dedupe key such as `goal_80:2026-09-25`, needed for once-per-day/once-per-streak rules). Disabled kinds are **dropped** (not held), so they never appear in "While you were busy". The stretch pop-up's primary button is "Stretch with me" (opens the 2-min stretch break screen from spec §5) instead of a bare "Done". A held nudge dismissed from the Today card becomes `expired` (not `dismissed`) so it never counts toward back-off.

## Global Constraints

- Branch `feat/daylens-phase5`. Commit messages end with a blank line then a `Co-Authored-By:` trailer naming the authoring model. Never stage `.codex/` or `apps/consumer/.models/`.
- Windows + Git Bash; commands from the repo root. Tests: `pnpm --filter @worksight/consumer test`; if its pretest fails with EPERM a Daylens instance is running — never kill it; use `cd apps/consumer && ELECTRON_RUN_AS_NODE=1 ../../node_modules/electron/dist/electron.exe ../../node_modules/vitest/vitest.mjs run [path]`. Typecheck `pnpm --filter @worksight/consumer typecheck`; build `pnpm --filter @worksight/consumer exec electron-vite build`.
- Never print screen/OCR text. Never kill processes you did not start. Real-model runs only with free RAM ≥ 2.5 GB.
- Batch start rule: `free ≥ need` AND (`idle ≥ 180 s` OR locked OR `free ≥ need + 2 GB`); `need = LAYA_PEAK_BYTES + 1 GB` (fp32 peak 3.2 GB). Not allowed → state `deferred`, retry next 60 s tick, never a failure. `BACKLOG_LIMIT = 500`; backlog guard only when `paused` or model not ready. ORT `enableCpuMemArena: false`, `enableMemPattern: false`.
- Weight-only 8-bit model passes only if all-final ≥ **0.88**, hold-out within 10 points of tuning, ms/read ≤ 1.5 × 545.
- Coach tick every **30 s**, only when consent granted and tracking not paused. Global cooldown **20 min** (eye_break/stretch exempt), per-rule **2 h** × profile weight × back-off; back-off = ×2 after **3 dismissals of a kind in 7 days** (+ offer "Show fewer like this?" which multiplies ×2 again).
- Hold (status `held`) for: snooze active; fullscreen foreground (bounds equal a display's bounds ±2 px); call apps/titles (Zoom app, Teams meeting/call, `Meet -`, `Zoom Meeting`, Discord `Voice Connected`); Windows notification state 2 (busy), 3 (D3D fullscreen), 4 (presentation), 6 (quiet time) — queried only when about to show, 2 s timeout, failure = not held.
- Rules: labels older than 30 min never trigger "right now" rules; categories count only at conf ≥ 0.5; stuck/distraction used as-is.
- Profile weights: goals → rules {less: goal_80, goal_100, below_avg; focus: scattered, deep_work; sleep: wind_down; breaks: eye_break, stretch; distract: doomscroll, stuck_escape, app_cap, stuck_tip}; if goals picked (and not `better`), unmapped rules ×2 (repeat_search never ×2); non-`profileDays` days: behaviour ×2.
- PillWindow 400×260, frameless, transparent, focusable false, skipTaskbar, alwaysOnTop `screen-saver`, `showInactive`, top-right of the display nearest the cursor (16 px margin), mouse passthrough except over a pill, created on demand and destroyed when empty; stack ≤ 3; auto-hide 8 s (paused on hover); **Ctrl+Alt+D** dismisses all; reduced motion → fade only. Animation per `docs/superpowers/specs/assets/daylens-mockups/pill-v2.html`.
- Break screen: one window per display; acrylic on Windows 11 build ≥ 22621 else `#FBF8F4E6`; eye 20 s / stretch 120 s; Skip, +1 min, Esc; completed breaks recorded and counted in the health score. Visuals per `popups.html` §2.
- Settings: `nudgeKinds` (JSON, all true), `snoozeUntil` (0), `appLimits` (JSON `[{app,minutes}]`, ≤ 20, app 1–60 chars, minutes 15–240), `nudgeFewer` (JSON per-kind multiplier). Not editable through `settings:set` (dedicated `coach:*` channels).

## Review Focus

1. **User typing when a pop-up appears** — the pill must never take focus or swallow keystrokes/clicks outside the pill. → PillManager uses `focusable:false` + `showInactive` + passthrough; checked in Task 11 manual run; unit-tested wiring of hover→passthrough in Task 7.
2. **The same pop-up firing again and again** (goal crossed, long streak, held during a call) — once per key. → gate dedupe test in Task 6, engine test in Task 9.
3. **Screen reading off / no labels yet** — label-based rules stay silent, health/switch/search/limit rules still work. → rule tests with empty reads in Tasks 4–5.
4. **Clock past midnight during wind-down** — one wind-down per night, not two. → `wind_down` night-key test in Task 4.
5. **Labelling deferred all day on a busy PC** — screen reading keeps capturing (backlog 500), Settings says "Waiting for a quiet moment". → scheduler + reader-guard tests in Task 1.

---

### Task 1: Memory-friendly batch scheduling

**Files:**
- Create: `apps/consumer/src/main/brain/resources.ts`, `apps/consumer/src/main/brain/resources.test.ts`
- Modify: `apps/consumer/src/main/brain/scheduler.ts`, `apps/consumer/src/main/brain/scheduler.test.ts`, `apps/consumer/src/main/brain/laya.ts`, `apps/consumer/src/main/brain/laya.test.ts`, `apps/consumer/src/main/models/manifest.ts`, `apps/consumer/src/renderer/lib/models.ts`, `apps/consumer/src/renderer/lib/models.test.ts`, `apps/consumer/src/main/index.ts`

**Interfaces:**
- Produces: `GB`, `LAYA_NEED_BYTES`, `batchAllowed({ freeBytes, idleSec, locked, needBytes }): boolean` (resources.ts); `LAYA_PEAK_BYTES` (manifest.ts); scheduler dep `canStart?: () => boolean`; `LabellingState` gains `'deferred'`; `BACKLOG_LIMIT = 500`.

- [ ] **Step 1: Failing tests**

`apps/consumer/src/main/brain/resources.test.ts`:

```ts
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
```

Append to `apps/consumer/src/main/brain/scheduler.test.ts` (inside its main `describe`, reusing its `add`, `brains`, `store`, `ready`, `now` helpers; add a `make` variant that passes `canStart`):

```ts
  it('defers (no fork, no failure) while canStart is false, then runs when allowed', () => {
    let allowed = false;
    add(25);
    const s = createLabelScheduler({ store, fork: () => { const b = new FakeBrain(); brains.push(b); return b; }, modelReady: () => ready, modelDir: 'M', now: () => now, canStart: () => allowed });
    s.tick(); s.tick();
    expect(brains).toHaveLength(0);
    expect(s.status().state).toBe('deferred');
    allowed = true; s.tick();
    expect(brains).toHaveLength(1);
  });
  it('does not block the reader while merely deferred, even with a big backlog', () => {
    add(600);
    const s = createLabelScheduler({ store, fork: () => new FakeBrain(), modelReady: () => true, modelDir: 'M', now: () => now, canStart: () => false });
    s.tick();
    expect(s.backlogBlocked()).toBe(false);
  });
  it('blocks the reader only past 500 reads when the model is missing', () => {
    ready = false; add(500);
    const s = createLabelScheduler({ store, fork: () => new FakeBrain(), modelReady: () => ready, modelDir: 'M', now: () => now });
    expect(s.backlogBlocked()).toBe(false);
    add(1, now + 1);
    expect(s.backlogBlocked()).toBe(true);
  });
```

(Delete/adjust any existing scheduler test that asserts the old 20-read backlog limit — replace its numbers with 500/501.)

In `apps/consumer/src/main/brain/laya.test.ts` update the `sessionOptions` expectation to include `enableCpuMemArena: false, enableMemPattern: false`.

Append to `apps/consumer/src/renderer/lib/models.test.ts` (inside `describe('model texts')`):

```ts
  it('describes deferred labelling', () => {
    expect(labellingText({ state: 'deferred', lastLabelledAt: null, pending: 12 })).toBe('Waiting for a quiet moment (12 reads queued)');
  });
```

- [ ] **Step 2: Run to confirm failure**

Run the consumer suite (fallback runner if EPERM). Expected: FAIL (missing `./resources`, `'deferred'` state, 500 limit, session options).

- [ ] **Step 3: Implement**

`apps/consumer/src/main/models/manifest.ts` — add below `LAYA_MANIFEST`:

```ts
// Measured peak working set of one Brain batch with this model (tools/laya/SPIKE-RESULTS.md, Phase 4).
export const LAYA_PEAK_BYTES = 3.2 * 1024 ** 3;
```

`apps/consumer/src/main/brain/resources.ts`:

```ts
import { LAYA_PEAK_BYTES } from '../models/manifest';

export const GB = 1024 ** 3;
/** Free memory a batch needs before it may start: the model's peak plus a 1 GB safety margin. */
export const LAYA_NEED_BYTES = LAYA_PEAK_BYTES + GB;
const IDLE_SEC = 180;
const SPARE_BYTES = 2 * GB;

/** Label only when it can't hurt: enough memory, and the user is away or there is plenty to spare. */
export function batchAllowed(i: { freeBytes: number; idleSec: number; locked: boolean; needBytes: number }): boolean {
  if (i.freeBytes < i.needBytes) return false;
  return i.idleSec >= IDLE_SEC || i.locked || i.freeBytes >= i.needBytes + SPARE_BYTES;
}
```

`apps/consumer/src/main/brain/scheduler.ts`:
- `export type LabellingState = 'waiting' | 'idle' | 'running' | 'paused' | 'deferred';`
- `export const BACKLOG_LIMIT = 500;`
- deps type: add `canStart?(): boolean;`
- add `let deferred = false;` next to `let running = false, paused = false, retryAt = 0;`
- in `tick()`, replace the final `runBatch();` with:

```ts
      const allowed = deps.canStart?.() ?? true;
      if (allowed !== !deferred) { deferred = !allowed; change(); }
      if (!allowed) return; // waiting for a quiet moment is never a failure
      runBatch();
```

- `status.state`: `paused ? 'paused' : running ? 'running' : !deps.modelReady() ? 'waiting' : deferred ? 'deferred' : 'idle'`.

`apps/consumer/src/main/brain/laya.ts` `sessionOptions` returns
`{ intraOpNumThreads: Math.max(1, Math.floor(cpuCount / 2)), interOpNumThreads: 1, enableCpuMemArena: false, enableMemPattern: false }` (update its return type accordingly).

`apps/consumer/src/renderer/lib/models.ts` `labellingText`: add as the first line
`if (l.state === 'deferred') return \`Waiting for a quiet moment (${l.pending} reads queued)\`;`

`apps/consumer/src/main/index.ts`: import `freemem` from `node:os` and `batchAllowed, LAYA_NEED_BYTES` from `./brain/resources`; add to `createLabelScheduler({...})`:

```ts
      canStart: () => batchAllowed({
        freeBytes: freemem(), idleSec: powerMonitor.getSystemIdleTime(),
        locked: powerMonitor.getSystemIdleState(60) === 'locked', needBytes: LAYA_NEED_BYTES
      }),
```

- [ ] **Step 4: Verify and commit**

Run the suite, typecheck, build.

```bash
git add apps/consumer/src/main/brain apps/consumer/src/main/models/manifest.ts apps/consumer/src/renderer/lib/models.ts apps/consumer/src/renderer/lib/models.test.ts apps/consumer/src/main/index.ts
git commit -m "feat(consumer): label only when idle or memory is plentiful; backlog 500; ORT arena off"
```

### Task 2: Weight-only 8-bit model experiment (manual, RAM-gated)

**Files:**
- Create: `tools/laya/quantize_q8w.py`
- Modify: `apps/consumer/src/main/brain/laya.eval.test.ts` (model file via env), `tools/laya/SPIKE-RESULTS.md`
- Modify (only on pass): `apps/consumer/src/main/models/manifest.ts`, `apps/consumer/src/main/models/manifest.test.ts`, `apps/consumer/src/main/brain/worker.ts`

**Interfaces:**
- Produces (on pass): `LAYA_ONNX_FILE` exported from manifest.ts (`'laya.q8w.onnx'`), manifest entry for it, updated `LAYA_PEAK_BYTES`, `LAYA_REVISION`; worker loads `loadLaya(req.modelDir, LAYA_ONNX_FILE)`. On fail: `LAYA_ONNX_FILE = 'laya.onnx'` (still exported) and nothing else changes.

- [ ] **Step 1: Eval harness takes a model file**

In `laya.eval.test.ts`: add `const ONNX = process.env.LAYA_ONNX ?? 'laya.onnx';`, use `existsSync(join(MODEL_DIR, ONNX))` in `have`, `loadLaya(MODEL_DIR, ONNX)`, include `${ONNX}` in the log lines, and log `ms/read` (time the loop). Commit with the quantize script below.

- [ ] **Step 2: Quantize**

`tools/laya/quantize_q8w.py`:

```python
"""Weight-only 8-bit quantization of the Laya ONNX export (activations stay fp32).
Usage: python tools/laya/quantize_q8w.py apps/consumer/.models/laya/laya.onnx apps/consumer/.models/laya/laya.q8w.onnx
"""
import sys
import onnx
from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer, DefaultWeightOnlyQuantConfig

src, dst = sys.argv[1], sys.argv[2]
model = onnx.load(src)
cfg = DefaultWeightOnlyQuantConfig(block_size=128, is_symmetric=True, bits=8)
q = MatMulNBitsQuantizer(model, algo_config=cfg)
q.process()
q.model.save_model_to_file(dst, use_external_data_format=False)
print("wrote", dst)
```

If the installed onnxruntime's `MatMulNBitsQuantizer`/`DefaultWeightOnlyQuantConfig` signature differs (check `python -c "import onnxruntime; print(onnxruntime.__version__)"`; 8-bit needs ≥ 1.20 — upgrade in the laya Python env if needed), adapt the call to that version's weight-only 8-bit API and say so in the report. Run it (needs ~6 GB free RAM; check first; if not available, report BLOCKED).

- [ ] **Step 3: Evaluate (free RAM ≥ 2.5 GB, one run at a time)**

```bash
cd apps/consumer && LAYA_EVAL=1 LAYA_ONNX=laya.q8w.onnx ELECTRON_RUN_AS_NODE=1 ../../node_modules/electron/dist/electron.exe ../../node_modules/vitest/vitest.mjs run src/main/brain/laya.eval.test.ts
```

Also measure peak working set of that single process (poll `Get-Process -Id <pid>` WorkingSet64 every 2 s from a background PowerShell loop you start and stop yourself). If onnxruntime-node rejects the model (unsupported op/bits), that is a FAIL.

- [ ] **Step 4: Record**

Append "Phase 5 — weight-only 8-bit" to `tools/laya/SPIKE-RESULTS.md`: file size, all-final / tuning / hold-out, ms/read, peak MB, PASS/FAIL against: all-final ≥ 0.88, hold-out within 10 points of tuning, ms/read ≤ 818. Export `LAYA_ONNX_FILE = 'laya.onnx'` from manifest.ts and use it in worker.ts (`loadLaya(req.modelDir, LAYA_ONNX_FILE)`) regardless of outcome. Commit.

- [ ] **Step 5 (only on PASS; the controller uploads)**

Report DONE with the file's size and SHA-256 (`sha256sum`). The controller uploads `laya.q8w.onnx` to `aaronalexS/daylens-laya-onnx`, verifies it at the new commit, and resumes you with the commit id. Then: in manifest.ts replace the `laya.onnx` entry with `{ name: 'laya.q8w.onnx', size, sha256 }`, set `LAYA_ONNX_FILE = 'laya.q8w.onnx'`, `LAYA_REVISION` = the commit, `LAYA_PEAK_BYTES` = measured peak (bytes, rounded up to 0.1 GB); update manifest.test.ts if it pins the file list; update the Phase 4 spec's §4 file table and Phase 5 spec §3.3 with the result. Tests + typecheck; commit.

### Task 3: Coach data layer (nudges, breaks, settings, Today apps, health breaks)

**Files:**
- Create: `apps/consumer/src/main/coach/types.ts`, `apps/consumer/src/main/coach/store.ts`, `apps/consumer/src/main/coach/store.test.ts`, `apps/consumer/src/main/coach/settings.ts`, `apps/consumer/src/main/coach/settings.test.ts`
- Modify: `apps/consumer/src/main/settings.ts`, `apps/consumer/src/main/screen/store.ts` (+ test), `apps/consumer/src/main/screen/labels.ts` (+ test), `apps/consumer/src/main/day/today.ts` (+ test), `apps/consumer/src/main/day/health.ts` (+ test)

**Interfaces:**
- Produces (types.ts):
  ```ts
  export type Kind = 'health' | 'behaviour' | 'tip' | 'win';
  export const KINDS: readonly Kind[];
  export type NudgeStatus = 'shown' | 'held' | 'dismissed' | 'acted' | 'snoozed' | 'expired';
  export type PrimaryAction = 'break_eye' | 'break_stretch' | 'ack';
  export interface Candidate { ruleId: string; kind: Kind; key: string; mini: string; stat: string; title: string; body: string; primary: { label: string; action: PrimaryAction } }
  export interface NudgeRow { id: number; at: number; date: string; kind: Kind; ruleId: string; key: string; title: string; body: string; status: NudgeStatus }
  export interface RecentRead { at: number; appName: string; windowTitle: string | null; category: string | null; conf: number | null; stuck: number | null; distraction: number | null }
  export interface AppLimit { app: string; minutes: number }
  export interface PillNudge { id: number; kind: Kind; mini: string; stat: string; title: string; body: string; primaryLabel: string; offerFewer: boolean }
  export type PillAction = 'primary' | 'dismiss' | 'snooze' | 'fewer' | 'expired';
  ```
- store.ts: `COACH_SCHEMA`; `createCoachStore(db): CoachStore` with `record(n: Omit<NudgeRow,'id'>): number`, `setStatus(id, status)`, `since(ms): NudgeRow[]`, `heldForDay(date): NudgeRow[]`, `recordBreak(b: { at; date; kind: 'eye' | 'stretch'; seconds; completed: boolean }): void`, `lastCompletedBreakAt(): number | null`, `completedBreaksForDay(date): number[]` (timestamps), `clear(): void`.
- settings.ts (coach): `parseKinds(json): Record<Kind, boolean>`, `parseLimits(json): AppLimit[]`, `parseFewer(json): Partial<Record<Kind, number>>`, zod `kindsInput`, `limitsInput`, `snoozeInput`.
- labels.ts: `readsSince(ms): RecentRead[]` (labelled rows only, ordered by `at`).
- today.ts: `TodayView.apps: AppTime[]` (all apps, sorted desc); `DayInput.breakScreens?: number[]`; `loadTodayView(repo, settings, date, now, labelsFor = () => [], breaksFor = () => [])`.
- health.ts: `HealthInput.breakScreens?: number[]` — completed break-screen breaks outside detected rest periods add to `breaks`.

- [ ] **Step 1: Failing tests**

`apps/consumer/src/main/coach/store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { COACH_SCHEMA, createCoachStore, type CoachStore } from './store';

let s: CoachStore;
beforeEach(() => { const db = new Database(':memory:'); db.exec(COACH_SCHEMA); s = createCoachStore(db); });
const n = (at: number, status: 'shown' | 'held' = 'shown', key = `k${at}`) =>
  ({ at, date: '2026-09-25', kind: 'health' as const, ruleId: 'eye_break', key, title: 't', body: 'b', status });

describe('coach store', () => {
  it('schema is idempotent and records nudges with keys', () => {
    const id = s.record(n(1000));
    expect(s.since(0)).toEqual([{ id, ...n(1000) }]);
  });
  it('updates status and filters by time', () => {
    const a = s.record(n(1000)); s.record(n(5000));
    s.setStatus(a, 'dismissed');
    expect(s.since(0)[0].status).toBe('dismissed');
    expect(s.since(2000)).toHaveLength(1);
  });
  it('lists held nudges for a day', () => {
    s.record(n(1000, 'held')); s.record(n(2000, 'shown'));
    expect(s.heldForDay('2026-09-25').map((r) => r.at)).toEqual([1000]);
  });
  it('records breaks and returns completed ones', () => {
    s.recordBreak({ at: 1000, date: '2026-09-25', kind: 'eye', seconds: 20, completed: true });
    s.recordBreak({ at: 3000, date: '2026-09-25', kind: 'eye', seconds: 5, completed: false });
    expect(s.completedBreaksForDay('2026-09-25')).toEqual([1000]);
    expect(s.lastCompletedBreakAt()).toBe(1000);
  });
  it('clear() empties nudges and breaks', () => {
    s.record(n(1)); s.recordBreak({ at: 1, date: '2026-09-25', kind: 'eye', seconds: 20, completed: true });
    s.clear();
    expect(s.since(0)).toEqual([]);
    expect(s.lastCompletedBreakAt()).toBeNull();
  });
});
```

`apps/consumer/src/main/coach/settings.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { kindsInput, limitsInput, parseFewer, parseKinds, parseLimits, snoozeInput } from './settings';

describe('coach settings', () => {
  it('parses stored JSON tolerantly', () => {
    expect(parseKinds('{"health":false}')).toEqual({ health: false, behaviour: true, tip: true, win: true });
    expect(parseKinds('bad')).toEqual({ health: true, behaviour: true, tip: true, win: true });
    expect(parseLimits('[{"app":"Discord","minutes":30},{"app":"","minutes":5}]')).toEqual([{ app: 'Discord', minutes: 30 }]);
    expect(parseLimits('nope')).toEqual([]);
    expect(parseFewer('{"tip":4,"win":"x"}')).toEqual({ tip: 4 });
  });
  it('validates IPC payloads', () => {
    expect(kindsInput.safeParse({ health: true, behaviour: false, tip: true, win: true }).success).toBe(true);
    expect(kindsInput.safeParse({ health: true }).success).toBe(false);
    expect(limitsInput.safeParse([{ app: 'Discord', minutes: 30 }]).success).toBe(true);
    expect(limitsInput.safeParse([{ app: 'Discord', minutes: 10 }]).success).toBe(false);
    expect(limitsInput.safeParse(Array.from({ length: 21 }, (_, i) => ({ app: `a${i}`, minutes: 30 }))).success).toBe(false);
    expect(snoozeInput.safeParse('1h').success).toBe(true);
    expect(snoozeInput.safeParse('forever').success).toBe(false);
  });
});
```

Append to `apps/consumer/src/main/screen/labels.test.ts`:

```ts
  it('lists labelled reads since a time with scores', () => {
    const a = add(1000, 'a', 'ha', 'Code'); add(2000, 'b', 'hb', 'Code');
    labels.applyLabels([{ id: a, category: 'work', categoryConf: 0.8, activity: 'coding', activityConf: 0.7, stuck: 1.6, distraction: 0.2 }], 3000);
    expect(labels.readsSince(500)).toEqual([{ at: 1000, appName: 'Code', windowTitle: 't', category: 'work', conf: 0.8, stuck: 1.6, distraction: 0.2 }]);
  });
```

Append to `apps/consumer/src/main/day/health.test.ts` (inside `describe('computeHealth')`; uses the file's `run`, `T`, `base` helpers):

```ts
  it('counts a completed break screen outside any detected rest as a break', () => {
    const samples = run(T(9), 120, 1); // 2 h of continuous activity, no 2-min rest
    const without = computeHealth({ ...base, samples, screenSec: 7200 });
    const withBreak = computeHealth({ ...base, samples, screenSec: 7200, breakScreens: [T(10)] });
    expect(withBreak.breaks).toBe(without.breaks + 1);
  });
```

Append to `apps/consumer/src/main/day/today.test.ts` (inside `describe('buildTodayView')`):

```ts
  it('lists every app with its time', () => {
    const v = view({ sessions: [session('Code', T(9), T(10)), session('Discord', T(10), T(10, 30)), session('Figma', T(10, 30), T(11)), session('Slack', T(11), T(11, 10))], samples: run(T(9), 130, 1) });
    expect(v.apps.map((a) => a.appName)).toEqual(['Code', 'Discord', 'Figma', 'Slack']);
  });
```

Append to `apps/consumer/src/main/screen/store.test.ts`: a test that `deleteActivity` and `exportAll` work both with and without the coach tables present (create a DB with `SCHEMA_SQL + SCREEN_SCHEMA + COACH_SCHEMA`, insert one nudge, assert `deleteActivity` empties `nudges` and `breaks`, and `exportAll(...)` contains `nudges` and `breaks` arrays; and that a DB without COACH_SCHEMA still works).

- [ ] **Step 2: Run to confirm failure**

- [ ] **Step 3: Implement**

`apps/consumer/src/main/coach/types.ts`:

```ts
export type Kind = 'health' | 'behaviour' | 'tip' | 'win';
export const KINDS: readonly Kind[] = ['health', 'behaviour', 'tip', 'win'];
export type NudgeStatus = 'shown' | 'held' | 'dismissed' | 'acted' | 'snoozed' | 'expired';
export type PrimaryAction = 'break_eye' | 'break_stretch' | 'ack';
export interface Candidate { ruleId: string; kind: Kind; key: string; mini: string; stat: string; title: string; body: string; primary: { label: string; action: PrimaryAction }; }
export interface NudgeRow { id: number; at: number; date: string; kind: Kind; ruleId: string; key: string; title: string; body: string; status: NudgeStatus; }
export interface RecentRead { at: number; appName: string; windowTitle: string | null; category: string | null; conf: number | null; stuck: number | null; distraction: number | null; }
export interface AppLimit { app: string; minutes: number; }
export interface PillNudge { id: number; kind: Kind; mini: string; stat: string; title: string; body: string; primaryLabel: string; offerFewer: boolean; }
export type PillAction = 'primary' | 'dismiss' | 'snooze' | 'fewer' | 'expired';
```

`apps/consumer/src/main/coach/store.ts`:

```ts
import type Database from 'better-sqlite3';
import type { NudgeRow, NudgeStatus } from './types';

export const COACH_SCHEMA = `
CREATE TABLE IF NOT EXISTS nudges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL, date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('health','behaviour','tip','win')),
  rule_id TEXT NOT NULL, key TEXT NOT NULL DEFAULT '', title TEXT NOT NULL, body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('shown','held','dismissed','acted','snoozed','expired'))
);
CREATE INDEX IF NOT EXISTS idx_nudges_date ON nudges(date, at);
CREATE INDEX IF NOT EXISTS idx_nudges_at ON nudges(at);
CREATE TABLE IF NOT EXISTS breaks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, date TEXT NOT NULL,
  kind TEXT NOT NULL, seconds INTEGER NOT NULL, completed INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_breaks_date ON breaks(date, at);
`;

export interface CoachStore {
  record(n: Omit<NudgeRow, 'id'>): number;
  setStatus(id: number, status: NudgeStatus): void;
  since(ms: number): NudgeRow[];
  heldForDay(date: string): NudgeRow[];
  recordBreak(b: { at: number; date: string; kind: 'eye' | 'stretch'; seconds: number; completed: boolean }): void;
  lastCompletedBreakAt(): number | null;
  completedBreaksForDay(date: string): number[];
  clear(): void;
}

const COLS = 'id, at, date, kind, rule_id AS ruleId, key, title, body, status';

export function createCoachStore(db: Database.Database): CoachStore {
  const ins = db.prepare('INSERT INTO nudges (at, date, kind, rule_id, key, title, body, status) VALUES (@at, @date, @kind, @ruleId, @key, @title, @body, @status)');
  const upd = db.prepare('UPDATE nudges SET status = ? WHERE id = ?');
  const since = db.prepare(`SELECT ${COLS} FROM nudges WHERE at >= ? ORDER BY at, id`);
  const held = db.prepare(`SELECT ${COLS} FROM nudges WHERE date = ? AND status = 'held' ORDER BY at, id`);
  const brk = db.prepare('INSERT INTO breaks (at, date, kind, seconds, completed) VALUES (@at, @date, @kind, @seconds, @completed)');
  const lastBrk = db.prepare('SELECT max(at) AS t FROM breaks WHERE completed = 1');
  const dayBrk = db.prepare('SELECT at FROM breaks WHERE date = ? AND completed = 1 ORDER BY at');
  return {
    record: (n) => Number(ins.run(n).lastInsertRowid),
    setStatus: (id, status) => { upd.run(status, id); },
    since: (ms) => since.all(ms) as NudgeRow[],
    heldForDay: (date) => held.all(date) as NudgeRow[],
    recordBreak: (b) => { brk.run({ ...b, completed: b.completed ? 1 : 0 }); },
    lastCompletedBreakAt: () => (lastBrk.get() as { t: number | null }).t,
    completedBreaksForDay: (date) => (dayBrk.all(date) as { at: number }[]).map((r) => r.at),
    clear: () => { db.exec('DELETE FROM nudges; DELETE FROM breaks;'); }
  };
}
```

`apps/consumer/src/main/coach/settings.ts`:

```ts
import { z } from 'zod';
import { KINDS, type AppLimit, type Kind } from './types';

export const MAX_LIMITS = 20;
const CONTROL = /[\u0000-\u001f\u007f]/;
const safe = <T>(json: string, fallback: T): unknown => { try { return JSON.parse(json) as unknown; } catch { return fallback; } };

export function parseKinds(json: string): Record<Kind, boolean> {
  const v = safe(json, {}) as Record<string, unknown> | null;
  return Object.fromEntries(KINDS.map((k) => [k, v && typeof v === 'object' && typeof v[k] === 'boolean' ? (v[k] as boolean) : true])) as Record<Kind, boolean>;
}

const limit = z.object({ app: z.string().trim().min(1).max(60).refine((s) => !CONTROL.test(s)), minutes: z.number().int().min(15).max(240) }).strict();
export const limitsInput = z.array(limit).max(MAX_LIMITS);

export function parseLimits(json: string): AppLimit[] {
  const v = safe(json, []);
  if (!Array.isArray(v)) return [];
  return v.flatMap((x) => { const r = limit.safeParse(x); return r.success ? [r.data] : []; }).slice(0, MAX_LIMITS);
}

export function parseFewer(json: string): Partial<Record<Kind, number>> {
  const v = safe(json, {}) as Record<string, unknown> | null;
  const out: Partial<Record<Kind, number>> = {};
  for (const k of KINDS) { const m = v && typeof v === 'object' ? v[k] : undefined; if (typeof m === 'number' && m >= 1 && m <= 64) out[k] = m; }
  return out;
}

export const kindsInput = z.object({ health: z.boolean(), behaviour: z.boolean(), tip: z.boolean(), win: z.boolean() }).strict();
export const snoozeInput = z.enum(['1h', 'tomorrow', 'off']);
```

`apps/consumer/src/main/settings.ts` — add to `DEFAULT_SETTINGS` after `screenReadingAsked`:

```ts
  nudgeKinds: '{"health":true,"behaviour":true,"tip":true,"win":true}',
  snoozeUntil: 0,
  appLimits: '[]',
  nudgeFewer: '{}'
```

(Do not add them to `settingsPatch`.)

`apps/consumer/src/main/screen/labels.ts` — add to the `LabelStore` interface `readsSince(ms: number): RecentRead[];` (import `RecentRead` from `../coach/types`) and implement:

```ts
  const recent = db.prepare(`SELECT at, app_name AS appName, window_title AS windowTitle, category, category_conf AS conf, stuck, distraction
    FROM screen_reads WHERE at >= ? AND labeled_at IS NOT NULL AND category IS NOT NULL AND category <> 'uncertain' ORDER BY at`);
  // …
    readsSince: (ms) => recent.all(ms) as RecentRead[],
```

`apps/consumer/src/main/screen/store.ts` — make `deleteActivity` and `exportAll` include the coach tables when they exist:

```ts
const hasTable = (db: Database.Database, t: string): boolean =>
  !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
```

In `deleteActivity`'s transaction, after the existing exec: `if (hasTable(db, 'nudges')) db.exec('DELETE FROM nudges; DELETE FROM breaks;');`. In `ExportData` add `nudges: unknown[]; breaks: unknown[];` and in `exportAll` add `nudges: hasTable(db, 'nudges') ? all('nudges') : [], breaks: hasTable(db, 'breaks') ? all('breaks') : []`.

`apps/consumer/src/main/day/health.ts`:
- `HealthInput` gains `breakScreens?: number[];`
- after `const breaks = atLeast(restPeriods(sorted), BREAK_MS);` add:

```ts
  // A completed break screen counts as a break unless it already sits inside a detected rest period.
  const screenBreaks = (i.breakScreens ?? []).filter((t) => !breaks.some((b) => t >= b.start && t <= b.end)).length;
```

- use `breaks.length + screenBreaks` in the missed-break term and in the returned `breaks`.

`apps/consumer/src/main/day/today.ts`:
- `DayInput` gains `breakScreens?: number[];`; `TodayView` gains `apps: AppTime[];`
- in `buildTodayView` compute `apps` from today's pieces (sum ms per app, `sec()`, sort desc) and pass `breakScreens: today.breakScreens` into `computeHealth`.
- `loadTodayView(repo, settings, date, now, labelsFor = () => [], breaksFor: (date: ISODate) => number[] = () => [])` sets `breakScreens: breaksFor(d)` on each day.

- [ ] **Step 4: Verify and commit**

Suite, typecheck.

```bash
git add apps/consumer/src/main/coach apps/consumer/src/main/settings.ts apps/consumer/src/main/screen apps/consumer/src/main/day
git commit -m "feat(consumer): coach data layer (nudges, breaks, pop-up settings), all-apps list and break-screen health credit"
```

### Task 4: Snapshot type, activity helpers and health rules

**Files:**
- Create: `apps/consumer/src/main/coach/snapshot.ts` (type only), `apps/consumer/src/main/coach/activity.ts`, `apps/consumer/src/main/coach/activity.test.ts`, `apps/consumer/src/main/coach/rules/health.ts`, `apps/consumer/src/main/coach/rules/health.test.ts`, `apps/consumer/src/main/coach/fixtures.ts` (test helpers)

**Interfaces:**
- Consumes: types from Task 3; `ActivitySampleRow`, `FocusSessionRow` (`@worksight/core/types`); `TodayView` (day/today.ts); `DaylensSettings`; `Profile`; `restPeriods`, `atLeast` (day/time.ts); `BREAK_MS` (day/health.ts); `localDate` (`@worksight/core/date`).
- Produces:
  ```ts
  export interface Snapshot { now: number; date: string; settings: DaylensSettings; profile: Profile; samples: ActivitySampleRow[]; sessions: FocusSessionRow[]; readsToday: RecentRead[]; view: TodayView; searchTitles: { at: number; title: string }[]; limits: AppLimit[]; lastBreakAt: number | null }
  export type Rule = (s: Snapshot) => Candidate | null;
  // activity.ts
  export function currentStretch(samples, now, lastBreakAt): { start: number; ms: number } | null;
  export function hm(minutes: number): string;          // 45 → '45 min', 112 → '1h 52m'
  export function clock(hhmm: string): string;          // '23:00' → '11:00 pm'
  export function switchesBetween(sessions, from, to): number;
  export function normaliseSearch(title: string): string | null;
  // rules/health.ts
  export const eyeBreak: Rule; export const stretch: Rule; export const windDown: Rule; export const goal: Rule;
  ```

- [ ] **Step 1: Test fixtures and failing tests**

`apps/consumer/src/main/coach/fixtures.ts` (imported by rule tests only):

```ts
import type { ActivitySampleRow, FocusSessionRow } from '@worksight/core/types';
import { DEFAULT_SETTINGS } from '../settings';
import { DEFAULT_PROFILE } from '../../shared/profileOptions';
import type { TodayView } from '../day/today';
import type { Snapshot } from './snapshot';
import type { RecentRead } from './types';

export const MIN = 60_000;
export const T = (h: number, m = 0, day = 25): number => new Date(2026, 8, day, h, m).getTime();
export const active = (from: number, minutes: number, activeFlag: 0 | 1 = 1): ActivitySampleRow[] =>
  Array.from({ length: minutes }, (_, i) => ({ id: 0, bucketStart: from + i * MIN, bucketEnd: from + (i + 1) * MIN, mouseMoves: 1, mouseDistancePx: 1, clicks: 0, scrolls: 0, keyEvents: 1, active: activeFlag, appName: null, date: '2026-09-25' }));
let sid = 1;
export const sess = (appName: string, start: number, end: number | null = null, windowTitle: string | null = null): FocusSessionRow =>
  ({ id: sid++, appName, appPath: null, windowTitle, pid: 1, startedAt: start, endedAt: end, durationSec: end === null ? null : Math.round((end - start) / 1000), date: '2026-09-25' });
export const read = (at: number, appName: string, o: Partial<RecentRead> = {}): RecentRead =>
  ({ at, appName, windowTitle: null, category: null, conf: null, stuck: null, distraction: null, ...o });
export const emptyView = (o: Partial<TodayView> = {}): TodayView => ({
  date: '2026-09-25', now: T(12), screenSec: 0, activeSec: 0, goalSec: 420 * 60, firstSeenAt: null, cards: [], timeline: [], apps: [],
  health: { score: 100, breaks: 0, expectedBreaks: 0, longestStretchSec: 0, lateNight: false },
  week: Array.from({ length: 7 }, (_, i) => ({ date: `2026-09-${19 + i}`, seconds: 0, byCategory: { work: 0, learning: 0, social: 0, entertainment: 0, communication: 0, other: 0 } })),
  ...o
});
export const snap = (o: Partial<Snapshot> = {}): Snapshot => ({
  now: T(12), date: '2026-09-25', settings: { ...DEFAULT_SETTINGS, consentGranted: true }, profile: DEFAULT_PROFILE,
  samples: [], sessions: [], readsToday: [], view: emptyView(), searchTitles: [], limits: [], lastBreakAt: null, ...o
});
```

`apps/consumer/src/main/coach/activity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { active, MIN, sess, T } from './fixtures';
import { clock, currentStretch, hm, normaliseSearch, switchesBetween } from './activity';

describe('currentStretch', () => {
  it('measures time since the last 2-minute rest', () => {
    const samples = [...active(T(9), 30), ...active(T(9, 30), 3, 0), ...active(T(9, 33), 60)];
    expect(currentStretch(samples, T(10, 33), null)).toEqual({ start: T(9, 33), ms: 60 * MIN });
  });
  it('is null when the user is not currently active', () => {
    expect(currentStretch(active(T(9), 30), T(9, 45), null)).toBeNull();
    expect(currentStretch([], T(9), null)).toBeNull();
  });
  it('restarts after a completed break screen', () => {
    expect(currentStretch(active(T(9), 90), T(10, 30), T(10))).toEqual({ start: T(10), ms: 30 * MIN });
  });
});

describe('formatting', () => {
  it('formats durations and clocks', () => {
    expect(hm(45)).toBe('45 min'); expect(hm(112)).toBe('1h 52m'); expect(hm(120)).toBe('2h 0m');
    expect(clock('23:00')).toBe('11:00 pm'); expect(clock('00:30')).toBe('12:30 am');
  });
});

describe('switchesBetween', () => {
  it('counts sessions that started inside the window', () => {
    const s = [sess('A', T(9)), sess('B', T(9, 5)), sess('C', T(9, 10)), sess('D', T(9, 20))];
    expect(switchesBetween(s, T(9, 1), T(9, 15))).toBe(2);
  });
});

describe('normaliseSearch', () => {
  it('extracts queries from search-engine window titles', () => {
    expect(normaliseSearch('React  Hooks - Google Search - Google Chrome')).toBe('react hooks');
    expect(normaliseSearch('useEffect cleanup - Bing - Microsoft​ Edge')).toBe('useeffect cleanup');
    expect(normaliseSearch('typescript enum at DuckDuckGo — Mozilla Firefox')).toBe('typescript enum');
    expect(normaliseSearch('Inbox - Gmail - Google Chrome')).toBeNull();
    expect(normaliseSearch('Google Search - Google Chrome')).toBeNull();
  });
});
```

`apps/consumer/src/main/coach/rules/health.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { active, emptyView, snap, T } from '../fixtures';
import { eyeBreak, goal, stretch, windDown } from './health';

describe('eye_break', () => {
  it('fires after breakIntervalMin of activity, once per interval of the stretch', () => {
    const s = snap({ samples: active(T(9), 55), now: T(9, 55) });
    const c = eyeBreak(s)!;
    expect(c).toMatchObject({ ruleId: 'eye_break', kind: 'health', primary: { action: 'break_eye' } });
    expect(c.key).toBe(`eye_break:${T(9)}:1`);
    expect(eyeBreak(snap({ samples: active(T(9), 40), now: T(9, 40) }))).toBeNull();
  });
});

describe('stretch', () => {
  it('fires after 90 minutes without a 2-minute pause', () => {
    expect(stretch(snap({ samples: active(T(9), 95), now: T(10, 35) }))).toMatchObject({ ruleId: 'stretch', primary: { action: 'break_stretch' } });
    expect(stretch(snap({ samples: active(T(9), 80), now: T(10, 20) }))).toBeNull();
  });
});

describe('wind_down', () => {
  it('fires when active after the wind-down time, keyed by night', () => {
    const late = snap({ samples: active(T(23, 10), 10), now: T(23, 20) });
    expect(windDown(late)!.key).toBe('wind_down:2026-09-25');
    const afterMidnight = snap({ samples: active(T(0, 20, 26), 10), now: T(0, 30, 26), date: '2026-09-26' });
    expect(windDown(afterMidnight)!.key).toBe('wind_down:2026-09-25'); // same night, same key
    expect(windDown(snap({ samples: active(T(21), 10), now: T(21, 10) }))).toBeNull();
  });
});

describe('goal', () => {
  it('fires goal_80 then goal_100 with distinct keys', () => {
    const at80 = snap({ view: emptyView({ screenSec: 0.85 * 420 * 60 }) });
    expect(goal(at80)).toMatchObject({ ruleId: 'goal_80', key: 'goal_80:2026-09-25' });
    const at100 = snap({ view: emptyView({ screenSec: 420 * 60 }) });
    expect(goal(at100)).toMatchObject({ ruleId: 'goal_100', key: 'goal_100:2026-09-25' });
    expect(goal(snap({ view: emptyView({ screenSec: 60 }) }))).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

- [ ] **Step 3: Implement**

`apps/consumer/src/main/coach/snapshot.ts`:

```ts
import type { ActivitySampleRow, FocusSessionRow } from '@worksight/core/types';
import type { DaylensSettings } from '../settings';
import type { Profile } from '../../shared/profileOptions';
import type { TodayView } from '../day/today';
import type { AppLimit, Candidate, RecentRead } from './types';

export interface Snapshot {
  now: number; date: string; settings: DaylensSettings; profile: Profile;
  samples: ActivitySampleRow[]; sessions: FocusSessionRow[]; readsToday: RecentRead[];
  view: TodayView; searchTitles: { at: number; title: string }[]; limits: AppLimit[]; lastBreakAt: number | null;
}
export type Rule = (s: Snapshot) => Candidate | null;
```

`apps/consumer/src/main/coach/activity.ts`:

```ts
import type { ActivitySampleRow, FocusSessionRow } from '@worksight/core/types';
import { atLeast, restPeriods } from '../day/time';
import { BREAK_MS } from '../day/health';

const RECENT_MS = 2 * 60_000; // the user counts as "at it" if the latest bucket ended this recently

export function currentStretch(samples: ActivitySampleRow[], now: number, lastBreakAt: number | null): { start: number; ms: number } | null {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a.bucketStart - b.bucketStart);
  if (now - sorted[sorted.length - 1].bucketEnd > RECENT_MS) return null;
  const rests = atLeast(restPeriods(sorted), BREAK_MS);
  let start = rests.length ? rests[rests.length - 1].end : sorted[0].bucketStart;
  if (lastBreakAt !== null && lastBreakAt > start) start = lastBreakAt;
  return { start, ms: now - start };
}

export const hm = (minutes: number): string => (minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`);

export function clock(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

export const switchesBetween = (sessions: FocusSessionRow[], from: number, to: number): number =>
  sessions.filter((s) => s.startedAt > from && s.startedAt <= to).length;

const BROWSER_SUFFIX = /\s[-—–]\s(Google Chrome|Microsoft​? Edge|Mozilla Firefox|Brave|Opera|Vivaldi)$/i;
const ENGINES = [/^(.+?)\s-\sGoogle Search$/i, /^(.+?)\s-\sBing$/i, /^(.+?)\sat DuckDuckGo$/i];

/** 'react hooks - Google Search - Google Chrome' → 'react hooks'; null when the title isn't a search. */
export function normaliseSearch(title: string): string | null {
  const t = title.replace(BROWSER_SUFFIX, '').trim();
  for (const re of ENGINES) {
    const m = re.exec(t);
    if (m) { const q = m[1].toLowerCase().replace(/\s+/g, ' ').trim(); return q || null; }
  }
  return null;
}
```

`apps/consumer/src/main/coach/rules/health.ts`:

```ts
import { localDate } from '@worksight/core/date';
import type { Rule } from '../snapshot';
import { clock, currentStretch, hm } from '../activity';

const STRETCH_MS = 90 * 60_000;
const NIGHT_OFFSET_MS = 5 * 3_600_000; // a night runs until 05:00, so 00:30 belongs to yesterday's night
const EARLY_MIN = 5 * 60;

export const eyeBreak: Rule = (s) => {
  const st = currentStretch(s.samples, s.now, s.lastBreakAt);
  if (!st) return null;
  const n = Math.floor(st.ms / (s.settings.breakIntervalMin * 60_000));
  if (n < 1) return null;
  const d = hm(Math.round(st.ms / 60_000));
  return { ruleId: 'eye_break', kind: 'health', key: `eye_break:${st.start}:${n}`, mini: 'Eye break', stat: d,
    title: 'Give your eyes a break', body: `${d} non-stop. Look at something 6 m away for 20 seconds.`,
    primary: { label: 'Start break', action: 'break_eye' } };
};

export const stretch: Rule = (s) => {
  const st = currentStretch(s.samples, s.now, s.lastBreakAt);
  if (!st) return null;
  const n = Math.floor(st.ms / STRETCH_MS);
  if (n < 1) return null;
  const d = hm(Math.round(st.ms / 60_000));
  return { ruleId: 'stretch', kind: 'health', key: `stretch:${st.start}:${n}`, mini: 'Stretch', stat: d,
    title: 'Stand up & stretch', body: `${d} without a real pause. Stand up, roll your shoulders, grab some water.`,
    primary: { label: 'Stretch with me', action: 'break_stretch' } };
};

export const windDown: Rule = (s) => {
  if (!currentStretch(s.samples, s.now, null)) return null;
  const [wh, wm] = s.settings.windDownTime.split(':').map(Number);
  const windMin = wh * 60 + wm;
  const d = new Date(s.now);
  const minute = d.getHours() * 60 + d.getMinutes();
  const late = windMin < EARLY_MIN ? minute >= windMin && minute < EARLY_MIN : minute >= windMin || minute < EARLY_MIN;
  if (!late) return null;
  return { ruleId: 'wind_down', kind: 'health', key: `wind_down:${localDate(s.now - NIGHT_OFFSET_MS)}`, mini: 'Wind down', stat: clock(s.settings.windDownTime),
    title: 'Time to wind down', body: `It's past ${clock(s.settings.windDownTime)}. Start winding down so sleep comes easier.`,
    primary: { label: 'OK', action: 'ack' } };
};

export const goal: Rule = (s) => {
  const goalSec = s.settings.dailyGoalMin * 60;
  if (goalSec <= 0) return null;
  const ratio = s.view.screenSec / goalSec;
  const used = hm(Math.round(s.view.screenSec / 60)), target = hm(s.settings.dailyGoalMin);
  if (ratio >= 1) return { ruleId: 'goal_100', kind: 'health', key: `goal_100:${s.date}`, mini: 'Goal reached', stat: used,
    title: 'Daily goal reached', body: `You've hit your ${target} screen goal for today.`, primary: { label: 'OK', action: 'ack' } };
  if (ratio >= 0.8) return { ruleId: 'goal_80', kind: 'health', key: `goal_80:${s.date}`, mini: 'Nearly at goal', stat: used,
    title: 'Nearly at your goal', body: `${used} of your ${target} goal. Plan a screen-free evening?`, primary: { label: 'OK', action: 'ack' } };
  return null;
};
```

- [ ] **Step 4: Verify and commit**

```bash
git add apps/consumer/src/main/coach
git commit -m "feat(consumer): coach snapshot, activity helpers and health rules"
```

### Task 5: Behaviour, tip and win rules

**Files:**
- Create: `apps/consumer/src/main/coach/rules/behaviour.ts` (+ `.test.ts`), `apps/consumer/src/main/coach/rules/tips.ts` (+ `.test.ts`), `apps/consumer/src/main/coach/rules/wins.ts` (+ `.test.ts`), `apps/consumer/src/main/coach/rules/index.ts`

**Interfaces:**
- Consumes: Task 4 (`Rule`, `Snapshot`, helpers, fixtures); `displayAppName` (`../../../shared/categories`); `CONFIDENT` (`../../brain/questions`).
- Produces: `doomscroll`, `scattered`, `stuckEscape`, `appCap` (behaviour); `stuckTip`, `repeatSearch` (tips); `deepWork`, `belowAvg` (wins); `RULES: Rule[]` in priority order: eyeBreak, stretch, windDown, goal, doomscroll, scattered, stuckEscape, appCap, stuckTip, repeatSearch, deepWork, belowAvg.

- [ ] **Step 1: Failing tests**

`apps/consumer/src/main/coach/rules/behaviour.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { MIN, emptyView, read, sess, snap, T } from '../fixtures';
import { appCap, doomscroll, scattered, stuckEscape } from './behaviour';

const scroll = (from: number, minutes: number, app = 'Google Chrome', title: string | null = 'Reddit') =>
  Array.from({ length: Math.floor(minutes / 2) + 1 }, (_, i) => read(from + i * 2 * MIN, app, { distraction: 1.8, windowTitle: title }));

describe('doomscroll', () => {
  it('fires after 20 min of high-distraction reads in one app', () => {
    const s = snap({ readsToday: scroll(T(11, 30), 22), now: T(11, 53) });
    expect(doomscroll(s)).toMatchObject({ ruleId: 'doomscroll', kind: 'behaviour', key: `doomscroll:Google Chrome:${T(11, 30)}` });
  });
  it('uses 15 min for a distraction-list app/site', () => {
    const s = snap({ readsToday: scroll(T(11, 30), 16, 'Google Chrome', 'YouTube - Google Chrome'), now: T(11, 47), profile: { ...snap().profile, distractions: ['YouTube'] } });
    expect(doomscroll(s)?.title).toMatch(/YouTube/);
  });
  it('stays silent without labels or with stale reads', () => {
    expect(doomscroll(snap({ readsToday: [] }))).toBeNull();
    expect(doomscroll(snap({ readsToday: scroll(T(10), 22), now: T(11, 53) }))).toBeNull();
  });
});

describe('scattered', () => {
  it('fires at 40 switches in 15 minutes', () => {
    const sessions = Array.from({ length: 41 }, (_, i) => sess(i % 2 ? 'A' : 'B', T(11, 45) + i * 20_000));
    expect(scattered(snap({ sessions, now: T(12) }))).toMatchObject({ ruleId: 'scattered' });
    expect(scattered(snap({ sessions: sessions.slice(0, 30), now: T(12) }))).toBeNull();
  });
});

describe('stuck_escape', () => {
  it('fires after 3 stuck → social/entertainment jumps today', () => {
    const reads = [0, 60, 120].flatMap((m) => [
      read(T(9) + m * MIN, 'Code', { stuck: 1.7, category: 'work', conf: 0.9 }),
      read(T(9) + m * MIN + MIN, 'Discord', { category: 'social', conf: 0.8 })
    ]);
    expect(stuckEscape(snap({ readsToday: reads }))).toMatchObject({ ruleId: 'stuck_escape', key: 'stuck_escape:2026-09-25' });
    expect(stuckEscape(snap({ readsToday: reads.slice(0, 4) }))).toBeNull();
  });
  it('ignores low-confidence categories', () => {
    const reads = [0, 60, 120].flatMap((m) => [read(T(9) + m * MIN, 'Code', { stuck: 1.7 }), read(T(9) + m * MIN + MIN, 'Discord', { category: 'social', conf: 0.3 })]);
    expect(stuckEscape(snap({ readsToday: reads }))).toBeNull();
  });
});

describe('app_cap', () => {
  it('fires when an app passes its daily limit, once per day per app', () => {
    const s = snap({ limits: [{ app: 'Discord', minutes: 30 }], view: emptyView({ apps: [{ appName: 'Discord.exe', seconds: 31 * 60 }] }) });
    expect(appCap(s)).toMatchObject({ ruleId: 'app_cap', key: 'app_cap:Discord:2026-09-25' });
    expect(appCap(snap({ limits: [{ app: 'Discord', minutes: 30 }], view: emptyView({ apps: [{ appName: 'Discord', seconds: 20 * 60 }] }) }))).toBeNull();
  });
});
```

`apps/consumer/src/main/coach/rules/tips.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { MIN, read, snap, T } from '../fixtures';
import { repeatSearch, stuckTip } from './tips';

describe('stuck_tip', () => {
  it('fires on 3 stuck reads within 10 min in one app', () => {
    const reads = [0, 3, 6].map((m) => read(T(11, 50) + m * MIN, 'Code', { stuck: 1.6 }));
    expect(stuckTip(snap({ readsToday: reads, now: T(11, 57) }))).toMatchObject({ ruleId: 'stuck_tip', kind: 'tip', title: 'Stuck in Code?' });
    expect(stuckTip(snap({ readsToday: reads.slice(0, 2), now: T(11, 57) }))).toBeNull();
  });
});

describe('repeat_search', () => {
  it('fires when the same query appears 3 times in 7 days', () => {
    const titles = [T(9, 0, 20), T(9, 0, 22), T(9, 0, 25)].map((at) => ({ at, title: 'React  hooks - Google Search - Google Chrome' }));
    expect(repeatSearch(snap({ searchTitles: titles }))).toMatchObject({ ruleId: 'repeat_search', key: 'repeat_search:react hooks' });
    expect(repeatSearch(snap({ searchTitles: titles.slice(0, 2) }))).toBeNull();
  });
});
```

`apps/consumer/src/main/coach/rules/wins.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { emptyView, read, sess, snap, T } from '../fixtures';
import { belowAvg, deepWork } from './wins';

describe('deep_work', () => {
  it('fires at 60 and 90 minutes of work+learning with few switches', () => {
    const view = emptyView({ timeline: [{ start: T(10), end: T(10, 40), category: 'work' }, { start: T(10, 40), end: T(11, 32), category: 'learning' }] });
    expect(deepWork(snap({ view, now: T(11, 33) }))).toMatchObject({ ruleId: 'deep_work', key: `deep_work:${T(10)}:90` });
    const v60 = emptyView({ timeline: [{ start: T(10), end: T(11, 5), category: 'work' }] });
    expect(deepWork(snap({ view: v60, now: T(11, 6) }))?.key).toBe(`deep_work:${T(10)}:60`);
  });
  it('is blocked by many switches or high distraction', () => {
    const view = emptyView({ timeline: [{ start: T(10), end: T(11, 5), category: 'work' }] });
    const sessions = Array.from({ length: 12 }, (_, i) => sess('Code', T(10, 1 + i)));
    expect(deepWork(snap({ view, sessions, now: T(11, 6) }))).toBeNull();
    expect(deepWork(snap({ view, readsToday: [read(T(10, 30), 'Code', { distraction: 1.2 })], now: T(11, 6) }))).toBeNull();
  });
});

describe('below_avg', () => {
  it('fires at 18:00 when today is ≥ 10 % below the 7-day average', () => {
    const week = emptyView().week.map((d, i) => ({ ...d, seconds: i < 6 ? 6 * 3600 : 0 }));
    const s = snap({ now: T(18, 5), view: emptyView({ week, screenSec: 4 * 3600 }) });
    expect(belowAvg(s)).toMatchObject({ ruleId: 'below_avg', title: 'Down 33% today' });
    expect(belowAvg(snap({ now: T(17), view: emptyView({ week, screenSec: 4 * 3600 }) }))).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

- [ ] **Step 3: Implement**

`apps/consumer/src/main/coach/rules/behaviour.ts`:

```ts
import type { Rule } from '../snapshot';
import type { RecentRead } from '../types';
import { displayAppName } from '../../../shared/categories';
import { CONFIDENT } from '../../brain/questions';
import { hm, switchesBetween } from '../activity';

const MIN = 60_000;
const FRESH_MS = 5 * MIN; // the latest scroll read must be this recent
const GAP_MS = 5 * MIN;   // reads further apart than this break a run
const DISTRACTED = 1.5, STUCK = 1.5;

function matchDistraction(r: RecentRead, list: string[]): string | null {
  const hay = `${r.appName} ${r.windowTitle ?? ''}`.toLowerCase();
  return list.find((d) => hay.includes(d.toLowerCase())) ?? null;
}

export const doomscroll: Rule = (s) => {
  const byApp = new Map<string, RecentRead[]>();
  for (const r of s.readsToday) byApp.set(r.appName, [...(byApp.get(r.appName) ?? []), r]);
  for (const [app, reads] of byApp) {
    const last = reads[reads.length - 1];
    if (s.now - last.at > FRESH_MS || (last.distraction ?? 0) < DISTRACTED) continue;
    let first = last;
    for (let i = reads.length - 2; i >= 0; i--) {
      const r = reads[i];
      if ((r.distraction ?? 0) < DISTRACTED || first.at - r.at > GAP_MS) break;
      first = r;
    }
    const named = matchDistraction(last, s.profile.distractions);
    const needMin = named ? 15 : 20;
    const mins = Math.round((last.at - first.at) / MIN);
    if (mins < needMin) continue;
    const label = named ?? displayAppName(app);
    return { ruleId: 'doomscroll', kind: 'behaviour', key: `doomscroll:${app}:${first.at}`, mini: 'Scrolling', stat: `${mins} min`,
      title: `You've been scrolling ${label} ${mins} min`, body: 'Take a short break? A minute away resets the pull.',
      primary: { label: 'Take a break', action: 'break_eye' } };
  }
  return null;
};

export const scattered: Rule = (s) => {
  const n = switchesBetween(s.sessions, s.now - 15 * MIN, s.now);
  if (n < 40) return null;
  return { ruleId: 'scattered', kind: 'behaviour', key: `scattered:${Math.floor(s.now / (15 * MIN))}`, mini: 'Scattered?', stat: `${n} switches`,
    title: 'Feeling scattered?', body: `${n} app switches in 15 min. Pick one task and close the rest for a while.`, primary: { label: 'OK', action: 'ack' } };
};

export const stuckEscape: Rule = (s) => {
  const escapes = new Map<string, number>();
  let count = 0;
  s.readsToday.forEach((r, i) => {
    if ((r.stuck ?? 0) < STUCK) return;
    const next = s.readsToday.slice(i + 1).find((x) => x.at - r.at <= 2 * MIN && (x.category === 'social' || x.category === 'entertainment') && (x.conf ?? 0) >= CONFIDENT);
    if (!next) return;
    count++;
    escapes.set(next.appName, (escapes.get(next.appName) ?? 0) + 1);
  });
  if (count < 3) return null;
  const app = displayAppName([...escapes.entries()].sort((a, b) => b[1] - a[1])[0][0]);
  return { ruleId: 'stuck_escape', kind: 'behaviour', key: `stuck_escape:${s.date}`, mini: 'Reflex', stat: `${count}× today`,
    title: `Stuck → ${app} is becoming a reflex`, body: `${count} times today you went to ${app} right after getting stuck. Try a 2-minute walk instead.`,
    primary: { label: 'OK', action: 'ack' } };
};

export const appCap: Rule = (s) => {
  for (const l of s.limits) {
    const used = s.view.apps.find((a) => displayAppName(a.appName).toLowerCase() === l.app.toLowerCase());
    if (!used || used.seconds < l.minutes * 60) continue;
    return { ruleId: 'app_cap', kind: 'behaviour', key: `app_cap:${l.app}:${s.date}`, mini: `${l.app} limit`, stat: hm(l.minutes),
      title: `${l.app}: ${hm(l.minutes)} limit reached`, body: `You've used ${l.app} for ${hm(Math.round(used.seconds / 60))} today. Time to close it?`,
      primary: { label: 'OK', action: 'ack' } };
  }
  return null;
};
```

`apps/consumer/src/main/coach/rules/tips.ts`:

```ts
import type { Rule } from '../snapshot';
import { displayAppName } from '../../../shared/categories';
import { normaliseSearch } from '../activity';

const MIN = 60_000;

// ponytail: template text; Phase 6's writer replaces title/body behind the same Candidate shape.
export const stuckTip: Rule = (s) => {
  const recent = s.readsToday.filter((r) => s.now - r.at <= 10 * MIN && (r.stuck ?? 0) >= 1.5);
  const byApp = new Map<string, number>();
  for (const r of recent) byApp.set(r.appName, (byApp.get(r.appName) ?? 0) + 1);
  const hit = [...byApp.entries()].find(([, n]) => n >= 3);
  if (!hit) return null;
  const app = displayAppName(hit[0]);
  return { ruleId: 'stuck_tip', kind: 'tip', key: `stuck_tip:${hit[0]}:${Math.floor(s.now / (2 * 60 * MIN))}`, mini: 'Stuck?', stat: '10 min',
    title: `Stuck in ${app}?`, body: 'Ten minutes on the same problem. Try explaining it out loud, or take a 5-min walk and come back.',
    primary: { label: 'Got it', action: 'ack' } };
};

export const repeatSearch: Rule = (s) => {
  const counts = new Map<string, number>();
  for (const t of s.searchTitles) { const q = normaliseSearch(t.title); if (q) counts.set(q, (counts.get(q) ?? 0) + 1); }
  const hit = [...counts.entries()].find(([, n]) => n >= 3);
  if (!hit) return null;
  const q = hit[0].length > 30 ? `${hit[0].slice(0, 29)}…` : hit[0];
  return { ruleId: 'repeat_search', kind: 'tip', key: `repeat_search:${hit[0]}`, mini: 'Same search', stat: `${hit[1]}×`,
    title: `Searched “${q}” ${hit[1]}× this week`, body: "Save the answer as a note or bookmark so you don't have to look it up again.",
    primary: { label: 'Got it', action: 'ack' } };
};
```

`apps/consumer/src/main/coach/rules/wins.ts`:

```ts
import type { Rule } from '../snapshot';
import { hm, switchesBetween } from '../activity';

const MIN = 60_000;

export const deepWork: Rule = (s) => {
  const segs = [...s.view.timeline].sort((a, b) => a.start - b.start);
  let run: { start: number; end: number } | null = null;
  for (const g of segs) {
    const focus = g.category === 'work' || g.category === 'learning';
    if (!focus) { run = null; continue; }
    run = run && g.start - run.end <= MIN ? { start: run.start, end: Math.max(run.end, g.end) } : { start: g.start, end: g.end };
  }
  if (!run || s.now - run.end > 2 * MIN) return null;
  const mins = Math.round((run.end - run.start) / MIN);
  const milestone = mins >= 90 ? 90 : mins >= 60 ? 60 : 0;
  if (!milestone) return null;
  if (switchesBetween(s.sessions, run.start, run.end) > 10) return null;
  const d = s.readsToday.filter((r) => r.at >= run!.start && r.at <= run!.end && r.distraction !== null).map((r) => r.distraction as number);
  if (d.length && d.reduce((a, b) => a + b, 0) / d.length >= 0.5) return null;
  return { ruleId: 'deep_work', kind: 'win', key: `deep_work:${run.start}:${milestone}`, mini: 'Deep work', stat: `${milestone} min 🎉`,
    title: `${milestone}-min deep-work streak 🎉`, body: 'Nice focus. Stand up, stretch, grab some water.', primary: { label: 'Keep going', action: 'ack' } };
};

export const belowAvg: Rule = (s) => {
  if (new Date(s.now).getHours() < 18) return null;
  const prior = s.view.week.slice(0, -1).filter((d) => d.seconds > 0);
  if (prior.length < 3) return null;
  const avg = prior.reduce((a, d) => a + d.seconds, 0) / prior.length;
  if (s.view.screenSec >= avg * 0.9) return null;
  const p = Math.round((1 - s.view.screenSec / avg) * 100);
  return { ruleId: 'below_avg', kind: 'win', key: `below_avg:${s.date}`, mini: 'Below average', stat: `-${p}%`,
    title: `Down ${p}% today`, body: `${hm(Math.round(s.view.screenSec / 60))} so far vs your ${hm(Math.round(avg / 60))} average. Keep it up.`,
    primary: { label: '🎉', action: 'ack' } };
};
```

`apps/consumer/src/main/coach/rules/index.ts`:

```ts
import type { Rule } from '../snapshot';
import { eyeBreak, goal, stretch, windDown } from './health';
import { appCap, doomscroll, scattered, stuckEscape } from './behaviour';
import { repeatSearch, stuckTip } from './tips';
import { belowAvg, deepWork } from './wins';

/** Priority order: health first, wins last. */
export const RULES: Rule[] = [eyeBreak, stretch, windDown, goal, doomscroll, scattered, stuckEscape, appCap, stuckTip, repeatSearch, deepWork, belowAvg];
```

- [ ] **Step 4: Verify and commit**

```bash
git add apps/consumer/src/main/coach/rules
git commit -m "feat(consumer): behaviour, template tip and win rules"
```

### Task 6: Profile weights, MannersGate and hold detection

**Files:**
- Create: `apps/consumer/src/main/coach/weights.ts` (+ test), `apps/consumer/src/main/coach/gate.ts` (+ test), `apps/consumer/src/main/coach/notifState.ts` (+ test)

**Interfaces:**
- Produces:
  ```ts
  export function ruleWeight(ruleId: string, kind: Kind, profile: Profile, now: number): number;
  export const GLOBAL_COOLDOWN_MS: number, RULE_COOLDOWN_MS: number;
  export interface GateContext { now: number; history: NudgeRow[]; kinds: Record<Kind, boolean>; snoozeUntil: number; fewer: Partial<Record<Kind, number>>; weight: number; hold: string | null }
  export type Decision = { status: 'show'; offerFewer: boolean } | { status: 'held'; reason: string } | { status: 'drop'; reason: string };
  export function decide(c: Candidate, ctx: GateContext): Decision;
  export interface Rect { x: number; y: number; width: number; height: number }
  export function holdReason(fg: { appName: string; title: string | null; bounds: Rect | null } | null, displays: Rect[], notifState: number | null): string | null;
  export function queryNotificationState(run?: (cmd: string, args: string[], timeoutMs: number) => Promise<string>): Promise<number | null>;
  ```

- [ ] **Step 1: Failing tests**

`apps/consumer/src/main/coach/weights.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_PROFILE } from '../../shared/profileOptions';
import { ruleWeight } from './weights';
import { T } from './fixtures';

const thu = T(12); // 2026-09-25 is a Friday (day 5)
describe('ruleWeight', () => {
  it('is 1 for everything when no goals are picked', () => {
    expect(ruleWeight('scattered', 'behaviour', { ...DEFAULT_PROFILE, goals: [] }, thu)).toBe(1);
  });
  it('doubles rules outside the picked goals (repeat_search exempt)', () => {
    const p = { ...DEFAULT_PROFILE, goals: ['sleep' as const] };
    expect(ruleWeight('wind_down', 'health', p, thu)).toBe(1);
    expect(ruleWeight('deep_work', 'win', p, thu)).toBe(2);
    expect(ruleWeight('repeat_search', 'tip', p, thu)).toBe(1);
  });
  it("treats 'better' as all goals", () => {
    expect(ruleWeight('deep_work', 'win', { ...DEFAULT_PROFILE, goals: ['better'] }, thu)).toBe(1);
  });
  it('doubles behaviour rules on non-usual days', () => {
    expect(ruleWeight('scattered', 'behaviour', { ...DEFAULT_PROFILE, goals: [], days: [1, 2, 3, 4] }, thu)).toBe(2);
    expect(ruleWeight('goal_80', 'health', { ...DEFAULT_PROFILE, goals: [], days: [1, 2, 3, 4] }, thu)).toBe(1);
  });
});
```

`apps/consumer/src/main/coach/gate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { decide, holdReason, type GateContext } from './gate';
import type { Candidate, NudgeRow } from './types';

const MIN = 60_000, now = 10_000 * MIN;
const cand = (o: Partial<Candidate> = {}): Candidate => ({ ruleId: 'goal_80', kind: 'health', key: 'goal_80:d', mini: 'm', stat: 's', title: 't', body: 'b', primary: { label: 'OK', action: 'ack' }, ...o });
const row = (o: Partial<NudgeRow>): NudgeRow => ({ id: 1, at: now - 60 * MIN, date: 'd', kind: 'health', ruleId: 'x', key: 'k', title: 't', body: 'b', status: 'shown', ...o });
const ctx = (o: Partial<GateContext> = {}): GateContext => ({ now, history: [], kinds: { health: true, behaviour: true, tip: true, win: true }, snoozeUntil: 0, fewer: {}, weight: 1, hold: null, ...o });

describe('decide', () => {
  it('shows a fresh candidate', () => { expect(decide(cand(), ctx())).toEqual({ status: 'show', offerFewer: false }); });
  it('drops a key that already fired (shown or held) within the history window', () => {
    expect(decide(cand(), ctx({ history: [row({ key: 'goal_80:d', status: 'held' })] })).status).toBe('drop');
  });
  it('drops disabled kinds', () => { expect(decide(cand(), ctx({ kinds: { health: false, behaviour: true, tip: true, win: true } })).status).toBe('drop'); });
  it('enforces the 20-minute global cooldown except for eye_break/stretch', () => {
    const h = [row({ at: now - 10 * MIN, ruleId: 'scattered', kind: 'behaviour' })];
    expect(decide(cand(), ctx({ history: h })).status).toBe('drop');
    expect(decide(cand({ ruleId: 'eye_break', key: 'e:1' }), ctx({ history: h })).status).toBe('show');
    expect(decide(cand(), ctx({ history: [row({ at: now - 10 * MIN, ruleId: 'eye_break' })] })).status).toBe('show');
  });
  it('enforces the per-rule cooldown scaled by weight and back-off', () => {
    const h = [row({ at: now - 3 * 60 * MIN, ruleId: 'goal_80', key: 'old' })];
    expect(decide(cand(), ctx({ history: h })).status).toBe('show');
    expect(decide(cand(), ctx({ history: h, weight: 2 })).status).toBe('drop');
    expect(decide(cand(), ctx({ history: h, fewer: { health: 2 } })).status).toBe('drop');
  });
  it('backs off after 3 dismissals of a kind and offers "show fewer"', () => {
    const h = [1, 2, 3].map((d) => row({ at: now - d * 24 * 60 * MIN, status: 'dismissed', ruleId: 'r' + d, key: 'x' + d }));
    expect(decide(cand(), ctx({ history: h }))).toEqual({ status: 'show', offerFewer: true });
  });
  it('holds while snoozed or when a hold reason applies', () => {
    expect(decide(cand(), ctx({ snoozeUntil: now + MIN }))).toEqual({ status: 'held', reason: 'snoozed' });
    expect(decide(cand(), ctx({ hold: 'call' }))).toEqual({ status: 'held', reason: 'call' });
  });
});

describe('holdReason', () => {
  const display = { x: 0, y: 0, width: 1920, height: 1080 };
  it('detects Focus Assist / fullscreen / calls', () => {
    expect(holdReason(null, [display], 6)).toBe('focus-assist');
    expect(holdReason({ appName: 'Game', title: 'x', bounds: { x: 0, y: 0, width: 1920, height: 1080 } }, [display], 5)).toBe('fullscreen');
    expect(holdReason({ appName: 'Google Chrome', title: 'Meet - abc-defg', bounds: null }, [display], 5)).toBe('call');
    expect(holdReason({ appName: 'Zoom Workplace', title: 'Zoom', bounds: null }, [display], null)).toBe('call');
    expect(holdReason({ appName: 'Microsoft Teams', title: 'Meeting with Priya | Microsoft Teams', bounds: null }, [display], null)).toBe('call');
  });
  it('does not hold for a normal maximised window or the desktop', () => {
    expect(holdReason({ appName: 'Code', title: 'a.ts', bounds: { x: 0, y: 0, width: 1920, height: 1040 } }, [display], 5)).toBeNull();
    expect(holdReason({ appName: 'Windows Explorer', title: 'Program Manager', bounds: display }, [display], 5)).toBeNull();
  });
});
```

`apps/consumer/src/main/coach/notifState.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { queryNotificationState } from './notifState';

describe('queryNotificationState', () => {
  it('parses the state number', async () => { expect(await queryNotificationState(async () => '5\r\n')).toBe(5); });
  it('returns null on failure or garbage', async () => {
    expect(await queryNotificationState(async () => { throw new Error('timeout'); })).toBeNull();
    expect(await queryNotificationState(async () => 'nope')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

- [ ] **Step 3: Implement**

`apps/consumer/src/main/coach/weights.ts`:

```ts
import type { Goal, Profile } from '../../shared/profileOptions';
import type { Kind } from './types';

const GOAL_RULES: Record<Goal, string[]> = {
  less: ['goal_80', 'goal_100', 'below_avg'], focus: ['scattered', 'deep_work'], sleep: ['wind_down'],
  breaks: ['eye_break', 'stretch'], distract: ['doomscroll', 'stuck_escape', 'app_cap', 'stuck_tip'], better: []
};

/** Cooldown multiplier: rules for goals the user picked run at normal pace, others half as often. */
export function ruleWeight(ruleId: string, kind: Kind, profile: Profile, now: number): number {
  let w = 1;
  if (profile.goals.length && !profile.goals.includes('better') && ruleId !== 'repeat_search') {
    if (!profile.goals.flatMap((g) => GOAL_RULES[g]).includes(ruleId)) w *= 2;
  }
  const dow = ((new Date(now).getDay() + 6) % 7) + 1; // 1 = Monday
  if (kind === 'behaviour' && !profile.days.includes(dow)) w *= 2;
  return w;
}
```

`apps/consumer/src/main/coach/gate.ts`:

```ts
import type { Candidate, Kind, NudgeRow, NudgeStatus } from './types';

export const GLOBAL_COOLDOWN_MS = 20 * 60_000;
export const RULE_COOLDOWN_MS = 2 * 3_600_000;
const OWN_CADENCE = new Set(['eye_break', 'stretch']);
const DISPLAYED = new Set<NudgeStatus>(['shown', 'dismissed', 'acted', 'snoozed', 'expired']);

export interface GateContext { now: number; history: NudgeRow[]; kinds: Record<Kind, boolean>; snoozeUntil: number; fewer: Partial<Record<Kind, number>>; weight: number; hold: string | null; }
export type Decision = { status: 'show'; offerFewer: boolean } | { status: 'held'; reason: string } | { status: 'drop'; reason: string };

/** `history` = the last 7 days of nudges. Drops leave no record, so the rule can fire later. */
export function decide(c: Candidate, x: GateContext): Decision {
  if (x.history.some((n) => n.key === c.key)) return { status: 'drop', reason: 'already fired' };
  if (!x.kinds[c.kind]) return { status: 'drop', reason: 'kind off' };
  const shown = x.history.filter((n) => DISPLAYED.has(n.status));
  const dismissals = x.history.filter((n) => n.kind === c.kind && n.status === 'dismissed').length;
  const backoff = (dismissals >= 3 ? 2 : 1) * (x.fewer[c.kind] ?? 1);
  if (!OWN_CADENCE.has(c.ruleId)) {
    if (shown.some((n) => !OWN_CADENCE.has(n.ruleId) && x.now - n.at < GLOBAL_COOLDOWN_MS)) return { status: 'drop', reason: 'global cooldown' };
    if (shown.some((n) => n.ruleId === c.ruleId && x.now - n.at < RULE_COOLDOWN_MS * x.weight * backoff)) return { status: 'drop', reason: 'rule cooldown' };
  }
  if (x.now < x.snoozeUntil) return { status: 'held', reason: 'snoozed' };
  if (x.hold) return { status: 'held', reason: x.hold };
  return { status: 'show', offerFewer: dismissals >= 3 };
}

export interface Rect { x: number; y: number; width: number; height: number; }
const SILENT_STATES = new Set([2, 3, 4, 6]); // busy, D3D full screen, presentation mode, quiet time
const near = (a: Rect, b: Rect): boolean =>
  Math.abs(a.x - b.x) <= 2 && Math.abs(a.y - b.y) <= 2 && Math.abs(a.width - b.width) <= 2 && Math.abs(a.height - b.height) <= 2;

function isCall(appName: string, title: string): boolean {
  if (/^zoom/i.test(appName) || /zoom meeting/i.test(title)) return true;
  if (/teams/i.test(appName) && /(meeting|call)/i.test(title)) return true;
  if (/meet - /i.test(title)) return true;
  return /discord/i.test(appName) && /voice connected/i.test(title);
}

export function holdReason(fg: { appName: string; title: string | null; bounds: Rect | null } | null, displays: Rect[], notifState: number | null): string | null {
  if (notifState !== null && SILENT_STATES.has(notifState)) return 'focus-assist';
  if (!fg) return null;
  const desktop = /explorer/i.test(fg.appName) && (fg.title ?? '') === 'Program Manager';
  if (!desktop && fg.bounds && displays.some((d) => near(d, fg.bounds as Rect))) return 'fullscreen';
  return isCall(fg.appName, fg.title ?? '') ? 'call' : null;
}
```

`apps/consumer/src/main/coach/notifState.ts`:

```ts
import { execFile } from 'node:child_process';

const SCRIPT = "Add-Type -Namespace D -Name Q -MemberDefinition '[DllImport(\"shell32.dll\")] public static extern int SHQueryUserNotificationState(out int s);'; $s = 0; [void][D.Q]::SHQueryUserNotificationState([ref]$s); $s";

const defaultRun = (cmd: string, args: string[], timeoutMs: number): Promise<string> => new Promise((resolve, reject) => {
  execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
});

/** Windows notification state (1–7), or null if unknown — only called when a pop-up is about to show. */
export async function queryNotificationState(run = defaultRun): Promise<number | null> {
  try {
    const n = Number.parseInt((await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SCRIPT], 2000)).trim(), 10);
    return Number.isInteger(n) && n >= 1 && n <= 7 ? n : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Verify and commit**

```bash
git add apps/consumer/src/main/coach
git commit -m "feat(consumer): profile weights, MannersGate and hold detection"
```

### Task 7: Pill window (manager, preload, page)

**Files:**
- Create: `apps/consumer/pill.html`, `apps/consumer/src/pill/main.ts`, `apps/consumer/src/pill/pill.css`, `apps/consumer/src/preload/pill.ts`, `apps/consumer/src/shared/nudgeLook.ts`, `apps/consumer/src/main/windows/pill.ts`, `apps/consumer/src/main/windows/pill.test.ts`
- Modify: `apps/consumer/electron.vite.config.ts`, `apps/consumer/tsconfig.web.json` (include `src/pill`, `src/break` if not covered by a glob)

**Interfaces:**
- Consumes: `PillNudge`, `PillAction`, `Kind` (coach/types).
- Produces: `NUDGE_LOOK: Record<Kind, { color: string; emoji: string; label: string }>`; `createPillManager(deps: { makeWindow(): PillWindowLike; placement(): { x: number; y: number }; onAction(id: number, action: PillAction): void }): { show(n: PillNudge): boolean; dismissAll(): void; handle(msg: PillMessage): void }` where `PillWindowLike = { send(channel: string, payload?: unknown): void; setIgnoreMouseEvents(ignore: boolean): void; showInactive(): void; setPosition(x: number, y: number): void; destroy(): void; isDestroyed(): boolean; onReady(cb: () => void): void }` and `PillMessage = { type: 'hover'; hover: boolean } | { type: 'action'; id: number; action: PillAction } | { type: 'empty' }` (zod `pillMessage`); preload API `window.pill = { onShow(cb), onDismissAll(cb), hover(b), action(id, a), empty() }`; built renderer `out/renderer/pill.html`, preload `out/preload/pill.js`. The real Electron adapter (`electronPillWindow(preload: string, load: (w: BrowserWindow) => void): PillWindowLike`) lives in the same file.

- [ ] **Step 1: Failing test (manager logic with a fake window)**

`apps/consumer/src/main/windows/pill.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createPillManager, pillMessage, type PillWindowLike } from './pill';
import type { PillNudge } from '../coach/types';

class FakeWin implements PillWindowLike {
  sent: [string, unknown][] = []; ignore = true; shown = 0; destroyed = false; pos: [number, number] = [0, 0];
  private ready: (() => void) | null = null;
  send(c: string, p?: unknown) { this.sent.push([c, p]); }
  setIgnoreMouseEvents(i: boolean) { this.ignore = i; }
  showInactive() { this.shown++; }
  setPosition(x: number, y: number) { this.pos = [x, y]; }
  destroy() { this.destroyed = true; }
  isDestroyed() { return this.destroyed; }
  onReady(cb: () => void) { this.ready = cb; }
  fireReady() { this.ready?.(); }
}
const n = (id: number): PillNudge => ({ id, kind: 'health', mini: 'm', stat: 's', title: 't', body: 'b', primaryLabel: 'OK', offerFewer: false });

describe('pill manager', () => {
  it('creates the window on demand, queues until ready, shows inactive at the placement', () => {
    const wins: FakeWin[] = [];
    const m = createPillManager({ makeWindow: () => { const w = new FakeWin(); wins.push(w); return w; }, placement: () => ({ x: 1504, y: 16 }), onAction: () => {} });
    expect(m.show(n(1))).toBe(true);
    expect(wins).toHaveLength(1);
    expect(wins[0].sent).toEqual([]);
    wins[0].fireReady();
    expect(wins[0].sent).toEqual([['pill:show', n(1)]]);
    expect(wins[0].shown).toBe(1);
    expect(wins[0].pos).toEqual([1504, 16]);
    m.show(n(2));
    expect(wins).toHaveLength(1);
    expect(wins[0].sent.at(-1)).toEqual(['pill:show', n(2)]);
  });
  it('toggles mouse passthrough on hover, forwards actions, destroys when empty', () => {
    const acts: [number, string][] = [];
    const w = new FakeWin();
    const m = createPillManager({ makeWindow: () => w, placement: () => ({ x: 0, y: 0 }), onAction: (id, a) => acts.push([id, a]) });
    m.show(n(1)); w.fireReady();
    m.handle({ type: 'hover', hover: true }); expect(w.ignore).toBe(false);
    m.handle({ type: 'hover', hover: false }); expect(w.ignore).toBe(true);
    m.handle({ type: 'action', id: 1, action: 'dismiss' }); expect(acts).toEqual([[1, 'dismiss']]);
    m.handle({ type: 'empty' }); expect(w.destroyed).toBe(true);
  });
  it('returns false if the window cannot be created', () => {
    const m = createPillManager({ makeWindow: () => { throw new Error('no'); }, placement: () => ({ x: 0, y: 0 }), onAction: () => {} });
    expect(m.show(n(1))).toBe(false);
  });
  it('validates renderer messages', () => {
    expect(pillMessage.safeParse({ type: 'action', id: 3, action: 'primary' }).success).toBe(true);
    expect(pillMessage.safeParse({ type: 'action', id: 3, action: 'hack' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

- [ ] **Step 3: Implement**

`apps/consumer/src/shared/nudgeLook.ts`:

```ts
import type { Kind } from '../main/coach/types';

// Colours/emoji per pill-v2.html.
export const NUDGE_LOOK: Record<Kind, { color: string; emoji: string; label: string }> = {
  health: { color: '#BFEBD3', emoji: '👁', label: 'Health' },
  behaviour: { color: '#F4C6C8', emoji: '↻', label: 'Behaviour' },
  tip: { color: '#D8D2FC', emoji: '💡', label: 'Tip' },
  win: { color: '#F9DDB9', emoji: '★', label: 'Win' }
};
```

`apps/consumer/src/main/windows/pill.ts`:

```ts
import { BrowserWindow, ipcMain } from 'electron';
import { z } from 'zod';
import type { PillAction, PillNudge } from '../coach/types';

export interface PillWindowLike {
  send(channel: string, payload?: unknown): void;
  setIgnoreMouseEvents(ignore: boolean): void;
  showInactive(): void;
  setPosition(x: number, y: number): void;
  destroy(): void;
  isDestroyed(): boolean;
  onReady(cb: () => void): void;
}

export const pillMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hover'), hover: z.boolean() }).strict(),
  z.object({ type: z.literal('action'), id: z.number().int(), action: z.enum(['primary', 'dismiss', 'snooze', 'fewer', 'expired']) }).strict(),
  z.object({ type: z.literal('empty') }).strict()
]);
export type PillMessage = z.infer<typeof pillMessage>;

export function createPillManager(deps: { makeWindow(): PillWindowLike; placement(): { x: number; y: number }; onAction(id: number, action: PillAction): void }) {
  let win: PillWindowLike | null = null;
  let ready = false;
  let queue: PillNudge[] = [];
  const flush = (): void => {
    if (!win || !ready) return;
    for (const n of queue) win.send('pill:show', n);
    queue = [];
    const p = deps.placement();
    win.setPosition(p.x, p.y);
    win.showInactive();
  };
  return {
    show(n: PillNudge): boolean {
      try {
        if (!win || win.isDestroyed()) {
          ready = false;
          win = deps.makeWindow();
          win.setIgnoreMouseEvents(true);
          win.onReady(() => { ready = true; flush(); });
        }
        queue.push(n);
        flush();
        return true;
      } catch (e) {
        console.error('[pill] window failed:', e);
        win = null;
        return false;
      }
    },
    dismissAll(): void { if (win && !win.isDestroyed()) win.send('pill:dismissAll'); },
    handle(msg: PillMessage): void {
      if (msg.type === 'hover') win?.setIgnoreMouseEvents(!msg.hover);
      else if (msg.type === 'action') deps.onAction(msg.id, msg.action);
      else { win?.destroy(); win = null; ready = false; }
    }
  };
}

export const PILL_W = 400, PILL_H = 260, PILL_MARGIN = 16;

/** Real Electron window for the pill (never focusable: it must not steal typing). */
export function electronPillWindow(preload: string, load: (w: BrowserWindow) => void, onMessage: (raw: unknown) => void): PillWindowLike {
  const w = new BrowserWindow({
    width: PILL_W, height: PILL_H, frame: false, transparent: true, focusable: false, skipTaskbar: true, resizable: false,
    hasShadow: false, show: false, alwaysOnTop: true,
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false }
  });
  w.setAlwaysOnTop(true, 'screen-saver');
  const listener = (e: Electron.IpcMainEvent, raw: unknown): void => { if (e.sender === w.webContents) onMessage(raw); };
  ipcMain.on('pill:msg', listener);
  w.on('closed', () => ipcMain.off('pill:msg', listener));
  load(w);
  return {
    send: (c, p) => { if (!w.isDestroyed()) w.webContents.send(c, p); },
    setIgnoreMouseEvents: (ignore) => { if (!w.isDestroyed()) w.setIgnoreMouseEvents(ignore, { forward: true }); },
    showInactive: () => w.showInactive(),
    setPosition: (x, y) => w.setPosition(Math.round(x), Math.round(y)),
    destroy: () => { if (!w.isDestroyed()) w.destroy(); },
    isDestroyed: () => w.isDestroyed(),
    onReady: (cb) => { w.webContents.once('did-finish-load', cb); }
  };
}
```

`apps/consumer/src/preload/pill.ts`:

```ts
import { contextBridge, ipcRenderer } from 'electron';
import type { PillAction, PillNudge } from '../main/coach/types';

const api = {
  onShow: (cb: (n: PillNudge) => void): void => { ipcRenderer.on('pill:show', (_e, n: PillNudge) => cb(n)); },
  onDismissAll: (cb: () => void): void => { ipcRenderer.on('pill:dismissAll', () => cb()); },
  hover: (hover: boolean): void => ipcRenderer.send('pill:msg', { type: 'hover', hover }),
  action: (id: number, action: PillAction): void => ipcRenderer.send('pill:msg', { type: 'action', id, action }),
  empty: (): void => ipcRenderer.send('pill:msg', { type: 'empty' })
};
export type PillApi = typeof api;
contextBridge.exposeInMainWorld('pill', api);
```

`apps/consumer/pill.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:" />
    <title>Daylens pop-up</title>
  </head>
  <body><div id="stack"></div><script type="module" src="/src/pill/main.ts"></script></body>
</html>
```

`apps/consumer/src/pill/pill.css` — port the mockup's pop-up rules (`.pill`, `.pill.hide`, `.pill.open`, `.head`, `.ic`, `.labels`, `.mini`, `.kind`, `.full`, `.acts`, `.bar`, `@keyframes shrink`) verbatim from `docs/superpowers/specs/assets/daylens-mockups/pill-v2.html` with these changes: `html, body { margin: 0; background: transparent; overflow: hidden; font-family: 'DM Sans Variable', system-ui, sans-serif; }`; `#stack { position: fixed; top: 0; right: 0; width: 400px; height: 260px; }`; `.pill { position: absolute; top: 18px; right: 18px; … }` (as in the mockup); add
```css
.pill.behind { transform: translateY(10px) scale(.94); opacity: .55; pointer-events: none; }
.pill.behind.b2 { transform: translateY(18px) scale(.88); opacity: .3; }
#stack:hover .pill.behind { transform: translateY(58px) scale(.96); opacity: .9; }
#stack:hover .pill.behind.b2 { transform: translateY(104px) scale(.92); }
.pill.open.fewer { height: 226px; }
.fewer-link { margin-top: 8px; font-size: 11.5px; text-decoration: underline; cursor: pointer; opacity: .7; background: none; border: 0; font: inherit; padding: 0; }
.x { cursor: pointer; }
.pill.open .bar i { animation: shrink 8s linear forwards; }
#stack:hover .pill.open .bar i { animation-play-state: paused; }
@media (prefers-reduced-motion: reduce) { .pill, .pill * { transition: opacity .2s !important; animation: none !important; } }
```
and import the font: first line `@import '@fontsource-variable/dm-sans';`.

`apps/consumer/src/pill/main.ts`:

```ts
import './pill.css';
import type { PillApi } from '../preload/pill';
import type { PillNudge } from '../main/coach/types';
import { NUDGE_LOOK } from '../shared/nudgeLook';

declare global { interface Window { pill: PillApi } }

const MAX = 3, OPEN_AFTER = 700, AUTO_HIDE = 8000;
const stack = document.getElementById('stack')!;
let hovering = false;
stack.addEventListener('mouseenter', () => { hovering = true; window.pill.hover(true); });
stack.addEventListener('mouseleave', () => { hovering = false; window.pill.hover(false); });

interface Card { n: PillNudge; el: HTMLElement; done: boolean; timer?: ReturnType<typeof setTimeout>; }
let cards: Card[] = [];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function layout(): void {
  cards.forEach((c, i) => {
    const depth = cards.length - 1 - i;
    c.el.classList.toggle('behind', depth > 0);
    c.el.classList.toggle('b2', depth > 1);
  });
}

function finish(c: Card, action: 'primary' | 'dismiss' | 'snooze' | 'fewer' | 'expired'): void {
  if (c.done) return;
  c.done = true;
  clearTimeout(c.timer);
  window.pill.action(c.n.id, action);
  c.el.classList.remove('open');
  setTimeout(() => c.el.classList.add('hide'), 350);
  setTimeout(() => {
    c.el.remove();
    cards = cards.filter((x) => x !== c);
    layout();
    if (!cards.length) window.pill.empty();
  }, 900);
}

function autoHide(c: Card): void {
  c.timer = setTimeout(() => (hovering ? autoHide(c) : finish(c, 'expired')), AUTO_HIDE);
}

function show(n: PillNudge): void {
  const look = NUDGE_LOOK[n.kind];
  const root = el('div', 'pill hide');
  root.style.setProperty('--c', look.color);
  const head = el('div', 'head');
  const labels = el('span', 'labels');
  const mini = el('span', 'mini', n.mini); mini.append(el('em', undefined, `· ${n.stat}`));
  const kind = el('span', 'kind'); kind.append(el('span', undefined, look.label));
  const x = el('i', 'x', 'now · ✕'); kind.append(x);
  labels.append(mini, kind);
  head.append(el('span', 'ic', look.emoji), labels);
  const full = el('div', 'full');
  const acts = el('div', 'acts');
  const primary = el('span', undefined, n.primaryLabel);
  const snooze = el('span', undefined, 'Snooze 1 h');
  acts.append(primary, snooze);
  full.append(el('b', undefined, n.title), el('p', undefined, n.body), acts);
  if (n.offerFewer) { const f = el('button', 'fewer-link', 'Show fewer like this?'); full.append(f); root.classList.add('fewer'); f.onclick = () => finish(card, 'fewer'); }
  const bar = el('div', 'bar'); bar.append(el('i'));
  root.append(head, full, bar);
  const card: Card = { n, el: root, done: false };
  primary.onclick = () => finish(card, 'primary');
  snooze.onclick = () => finish(card, 'snooze');
  x.onclick = () => finish(card, 'dismiss');
  stack.append(root);
  cards.push(card);
  while (cards.length > MAX) finish(cards[0], 'expired');
  layout();
  requestAnimationFrame(() => root.classList.remove('hide'));
  setTimeout(() => { if (!card.done) root.classList.add('open'); }, OPEN_AFTER);
  autoHide(card);
}

window.pill.onShow(show);
window.pill.onDismissAll(() => [...cards].forEach((c) => finish(c, 'dismiss')));
```

`apps/consumer/electron.vite.config.ts`:
- `preload: { plugins: [externalizeDepsPlugin()], build: { rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts'), pill: resolve(__dirname, 'src/preload/pill.ts'), break: resolve(__dirname, 'src/preload/break.ts') } } } }` — **create an empty placeholder `src/preload/break.ts` with `export {};` now** (Task 8 fills it) so the build succeeds.
- renderer input: `{ index: resolve(__dirname, 'index.html'), pill: resolve(__dirname, 'pill.html') }` (Task 8 adds `break`).

In `tsconfig.web.json` change `include` to `["src/renderer/**/*", "src/shared/**/*", "src/pill/**/*", "src/break/**/*"]` (`tsconfig.node.json` already covers `src/preload/**/*`).

- [ ] **Step 4: Verify and commit**

Tests, typecheck, build (confirm `out/renderer/pill.html` and `out/preload/pill.js` exist).

```bash
git add apps/consumer/pill.html apps/consumer/src/pill apps/consumer/src/preload apps/consumer/src/shared/nudgeLook.ts apps/consumer/src/main/windows apps/consumer/electron.vite.config.ts apps/consumer/tsconfig.web.json apps/consumer/tsconfig.node.json
git commit -m "feat(consumer): pill pop-up window (manager, preload, animated stack page)"
```

### Task 8: Break screen

**Files:**
- Create: `apps/consumer/break.html`, `apps/consumer/src/break/main.ts`, `apps/consumer/src/break/break.css`, `apps/consumer/src/main/windows/breakOverlay.ts`, `apps/consumer/src/main/windows/breakOverlay.test.ts`
- Modify: `apps/consumer/src/preload/break.ts`, `apps/consumer/electron.vite.config.ts` (renderer input `break`)

**Interfaces:**
- Produces: `BREAK_SECONDS = { eye: 20, stretch: 120 }`; `breakDone` zod (`{ completed: boolean, seconds: number }`); `createBreakOverlay(deps: { displays(): { bounds: Rect; primary: boolean }[]; makeWindow(bounds: Rect, primary: boolean): BreakWindowLike; onDone(r: { kind: 'eye' | 'stretch'; seconds: number; completed: boolean }): void }): { start(kind: 'eye' | 'stretch'): boolean; active(): boolean; handle(msg: BreakMessage): void }` with `BreakWindowLike = { send(c, p?): void; close(): void; onReady(cb): void; focus(): void }`, `BreakMessage = { type: 'done'; completed: boolean; seconds: number } | { type: 'extend' }`; `electronBreakWindow(bounds, preload, load, onMessage)` adapter; preload `window.brk = { onStart(cb), onExtend(cb), extend(), done(r) }`.

- [ ] **Step 1: Failing test**

`apps/consumer/src/main/windows/breakOverlay.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createBreakOverlay, type BreakWindowLike } from './breakOverlay';

class FakeWin implements BreakWindowLike {
  sent: [string, unknown][] = []; closed = false; focused = false; private r: (() => void) | null = null;
  send(c: string, p?: unknown) { this.sent.push([c, p]); }
  close() { this.closed = true; }
  onReady(cb: () => void) { this.r = cb; }
  focus() { this.focused = true; }
  ready() { this.r?.(); }
}

describe('break overlay', () => {
  it('opens one window per display, starts them, focuses the primary', () => {
    const wins: FakeWin[] = [];
    const o = createBreakOverlay({
      displays: () => [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, primary: true }, { bounds: { x: 1920, y: 0, width: 1280, height: 1024 }, primary: false }],
      makeWindow: () => { const w = new FakeWin(); wins.push(w); return w; }, onDone: () => {}
    });
    expect(o.start('eye')).toBe(true);
    wins.forEach((w) => w.ready());
    expect(wins.map((w) => w.sent[0])).toEqual([['break:start', { kind: 'eye', seconds: 20 }], ['break:start', { kind: 'eye', seconds: 20 }]]);
    expect(wins[0].focused).toBe(true);
    expect(o.start('eye')).toBe(false); // already running
  });
  it('broadcasts +1 min and closes all on done, reporting once', () => {
    const wins: FakeWin[] = []; const done: unknown[] = [];
    const o = createBreakOverlay({ displays: () => [{ bounds: { x: 0, y: 0, width: 1, height: 1 }, primary: true }, { bounds: { x: 1, y: 0, width: 1, height: 1 }, primary: false }],
      makeWindow: () => { const w = new FakeWin(); wins.push(w); return w; }, onDone: (r) => done.push(r) });
    o.start('stretch');
    o.handle({ type: 'extend' });
    expect(wins.every((w) => w.sent.some(([c]) => c === 'break:extend'))).toBe(true);
    o.handle({ type: 'done', completed: true, seconds: 180 });
    o.handle({ type: 'done', completed: true, seconds: 180 });
    expect(wins.every((w) => w.closed)).toBe(true);
    expect(done).toEqual([{ kind: 'stretch', seconds: 180, completed: true }]);
    expect(o.active()).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

- [ ] **Step 3: Implement**

`apps/consumer/src/main/windows/breakOverlay.ts`:

```ts
import { BrowserWindow, ipcMain } from 'electron';
import { release } from 'node:os';
import { z } from 'zod';
import type { Rect } from '../coach/gate';

export const BREAK_SECONDS = { eye: 20, stretch: 120 } as const;
export type BreakKind = keyof typeof BREAK_SECONDS;
export interface BreakWindowLike { send(channel: string, payload?: unknown): void; close(): void; onReady(cb: () => void): void; focus(): void; }
export const breakMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('done'), completed: z.boolean(), seconds: z.number().int().min(0).max(3600) }).strict(),
  z.object({ type: z.literal('extend') }).strict()
]);
export type BreakMessage = z.infer<typeof breakMessage>;

export function createBreakOverlay(deps: {
  displays(): { bounds: Rect; primary: boolean }[];
  makeWindow(bounds: Rect, primary: boolean): BreakWindowLike;
  onDone(r: { kind: BreakKind; seconds: number; completed: boolean }): void;
}) {
  let wins: BreakWindowLike[] = [];
  let kind: BreakKind | null = null;
  return {
    start(k: BreakKind): boolean {
      if (kind) return false;
      kind = k;
      wins = deps.displays().map(({ bounds, primary }) => {
        const w = deps.makeWindow(bounds, primary);
        w.onReady(() => { w.send('break:start', { kind: k, seconds: BREAK_SECONDS[k] }); if (primary) w.focus(); });
        return w;
      });
      return true;
    },
    active: (): boolean => kind !== null,
    handle(msg: BreakMessage): void {
      if (!kind) return;
      if (msg.type === 'extend') { wins.forEach((w) => w.send('break:extend')); return; }
      const k = kind;
      kind = null;
      wins.forEach((w) => w.close());
      wins = [];
      deps.onDone({ kind: k, seconds: msg.seconds, completed: msg.completed });
    }
  };
}

const acrylic = (): boolean => process.platform === 'win32' && Number(release().split('.')[2] ?? 0) >= 22621;

export function electronBreakWindow(bounds: Rect, preload: string, load: (w: BrowserWindow) => void, onMessage: (raw: unknown) => void): BreakWindowLike {
  const glass = acrylic();
  const w = new BrowserWindow({
    ...bounds, frame: false, resizable: false, movable: false, skipTaskbar: true, alwaysOnTop: true, show: false,
    backgroundColor: glass ? '#00000000' : '#FBF8F4E6', ...(glass ? { backgroundMaterial: 'acrylic' as const } : { transparent: true }),
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false }
  });
  w.setAlwaysOnTop(true, 'screen-saver');
  const listener = (e: Electron.IpcMainEvent, raw: unknown): void => { if (e.sender === w.webContents) onMessage(raw); };
  ipcMain.on('break:msg', listener);
  w.on('closed', () => ipcMain.off('break:msg', listener));
  load(w);
  return {
    send: (c, p) => { if (!w.isDestroyed()) w.webContents.send(c, p); },
    close: () => { if (!w.isDestroyed()) w.close(); },
    onReady: (cb) => { w.webContents.once('did-finish-load', () => { w.showInactive(); cb(); }); },
    focus: () => { if (!w.isDestroyed()) { w.show(); w.focus(); } }
  };
}
```

`apps/consumer/src/preload/break.ts`:

```ts
import { contextBridge, ipcRenderer } from 'electron';

const api = {
  onStart: (cb: (p: { kind: 'eye' | 'stretch'; seconds: number }) => void): void => { ipcRenderer.on('break:start', (_e, p) => cb(p)); },
  onExtend: (cb: () => void): void => { ipcRenderer.on('break:extend', () => cb()); },
  extend: (): void => ipcRenderer.send('break:msg', { type: 'extend' }),
  done: (r: { completed: boolean; seconds: number }): void => ipcRenderer.send('break:msg', { type: 'done', ...r })
};
export type BreakApi = typeof api;
contextBridge.exposeInMainWorld('brk', api);
```

`apps/consumer/break.html` — same head as `pill.html` (title "Daylens break"), body:

```html
  <body>
    <main class="overlay">
      <div class="breath"><div class="blob"></div>
        <svg width="180" height="180"><circle cx="90" cy="90" r="86" stroke="rgba(0,0,0,.08)" stroke-width="4" fill="none"/><circle class="p" id="ring" cx="90" cy="90" r="86" stroke="#171717" stroke-width="4" fill="none" stroke-linecap="round"/></svg>
        <span class="num" id="num">20</span></div>
      <span class="hint" id="hint">Breathe in…</span>
      <h3 id="title">Look at something far away</h3>
      <p id="text">At least 6 metres, like a window, a wall across the room, or the sky.</p>
      <div class="btns"><button class="pbtn s" id="skip">Skip</button><button class="pbtn s" id="more">+1 min</button></div>
    </main>
    <script type="module" src="/src/break/main.ts"></script>
  </body>
```

`apps/consumer/src/break/break.css` — port `.breath`, `.blob`, `@keyframes breathe`, `.breath svg`, `.breath circle.p`, `.num`, `.overlay h3`, `.overlay p`, `.hint`, `.pbtn` from `popups.html` verbatim, plus:

```css
@import '@fontsource-variable/dm-sans';
html, body { margin: 0; height: 100%; background: transparent; font-family: 'DM Sans Variable', system-ui, sans-serif; color: #171717; }
.overlay { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; text-align: center; }
.btns { display: flex; gap: 8px; }
.pbtn.s { background: rgba(255, 255, 255, .8); color: #171717; }
@media (prefers-reduced-motion: reduce) { .blob { animation: none !important; } .breath circle.p { transition: none !important; } }
```
(`--mint`, `--ink`, `--spring` used by the ported rules: define them on `:root` with the mockup's values.)

`apps/consumer/src/break/main.ts`:

```ts
import './break.css';
import type { BreakApi } from '../preload/break';

declare global { interface Window { brk: BreakApi } }

const COPY = {
  eye: ['Look at something far away', 'At least 6 metres, like a window, a wall across the room, or the sky.'],
  stretch: ['Stand up and stretch', 'Roll your shoulders, reach up, and take a few slow breaths.']
} as const;
const $ = (id: string): HTMLElement => document.getElementById(id)!;
const ring = $('ring') as unknown as SVGCircleElement;
let total = 0, left = 0, elapsed = 0, timer: ReturnType<typeof setInterval> | undefined, ended = false;

const end = (completed: boolean): void => {
  if (ended) return;
  ended = true;
  clearInterval(timer);
  window.brk.done({ completed, seconds: elapsed });
};

function tick(): void {
  left--; elapsed++;
  $('num').textContent = String(left);
  ring.style.strokeDashoffset = String(540 * (1 - left / total));
  $('hint').textContent = Math.floor(elapsed / 4) % 2 ? 'Breathe out…' : 'Breathe in…';
  if (left <= 0) { clearInterval(timer); $('hint').textContent = 'Nice. Welcome back 🌿'; setTimeout(() => end(true), 1400); }
}

window.brk.onStart(({ kind, seconds }) => {
  total = left = seconds;
  $('title').textContent = COPY[kind][0];
  $('text').textContent = COPY[kind][1];
  $('num').textContent = String(left);
  timer = setInterval(tick, 1000);
});
window.brk.onExtend(() => { left += 60; total += 60; });
$('skip').onclick = () => end(false);
$('more').onclick = () => window.brk.extend();
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') end(false); });
```

Add `break: resolve(__dirname, 'break.html')` to the renderer inputs.

- [ ] **Step 4: Verify and commit**

Tests, typecheck, build (confirm `out/renderer/break.html`, `out/preload/break.js`).

```bash
git add apps/consumer/break.html apps/consumer/src/break apps/consumer/src/preload/break.ts apps/consumer/src/main/windows/breakOverlay.ts apps/consumer/src/main/windows/breakOverlay.test.ts apps/consumer/electron.vite.config.ts
git commit -m "feat(consumer): full-screen break screen on every display"
```

### Task 9: Coach engine and main wiring

**Files:**
- Create: `apps/consumer/src/main/coach/engine.ts`, `apps/consumer/src/main/coach/engine.test.ts`
- Modify: `apps/consumer/src/main/channels.ts`, `apps/consumer/src/main/ipc.ts`, `apps/consumer/src/preload/index.ts`, `apps/consumer/src/main/index.ts`

**Interfaces:**
- Consumes: Tasks 3–8.
- Produces:
  ```ts
  export interface CoachDeps {
    now(): number; snapshot(now: number): Snapshot; history(now: number): NudgeRow[];
    kinds(): Record<Kind, boolean>; snoozeUntil(): number; fewer(): Partial<Record<Kind, number>>;
    weight(c: Candidate, now: number): number; holdReason(): Promise<string | null>;
    record(c: Candidate, status: NudgeStatus, now: number): number; setStatus(id: number, s: NudgeStatus): void;
    show(n: PillNudge): boolean; rules?: Rule[];
  }
  export function createCoach(d: CoachDeps): { tick(): Promise<'shown' | 'held' | 'none'> };
  ```
  IPC: `CoachView = { kinds: Record<Kind, boolean>; snoozeUntil: number; limits: AppLimit[]; held: { id: number; at: number; kind: Kind; title: string; body: string }[] }`; channels `coach:get`, `coach:setKinds`, `coach:snooze`, `coach:setLimits`, `coach:dismissHeld`, `coach:test`; preload `api.coach = { get, setKinds, snooze, setLimits, dismissHeld, test }`.

- [ ] **Step 1: Failing test**

`apps/consumer/src/main/coach/engine.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createCoach, type CoachDeps } from './engine';
import { snap, T } from './fixtures';
import type { Candidate, NudgeRow, NudgeStatus, PillNudge } from './types';

const c = (o: Partial<Candidate> = {}): Candidate => ({ ruleId: 'goal_80', kind: 'health', key: 'goal_80:d', mini: 'm', stat: 's', title: 't', body: 'b', primary: { label: 'OK', action: 'ack' }, ...o });
function deps(o: Partial<CoachDeps> = {}) {
  const rows: (NudgeRow & { status: NudgeStatus })[] = [];
  const shown: PillNudge[] = [];
  const d: CoachDeps = {
    now: () => T(12), snapshot: () => snap(), history: () => rows,
    kinds: () => ({ health: true, behaviour: true, tip: true, win: true }), snoozeUntil: () => 0, fewer: () => ({}),
    weight: () => 1, holdReason: async () => null,
    record: (cand, status, now) => { rows.push({ id: rows.length + 1, at: now, date: 'd', kind: cand.kind, ruleId: cand.ruleId, key: cand.key, title: cand.title, body: cand.body, status }); return rows.length; },
    setStatus: (id, s) => { rows[id - 1].status = s; },
    show: (n) => { shown.push(n); return true; },
    rules: [() => c()], ...o
  };
  return { d, rows, shown };
}

describe('coach engine', () => {
  it('shows a candidate and records it as shown', async () => {
    const { d, rows, shown } = deps();
    expect(await createCoach(d).tick()).toBe('shown');
    expect(rows.map((r) => r.status)).toEqual(['shown']);
    expect(shown[0]).toMatchObject({ id: 1, kind: 'health', title: 't', primaryLabel: 'OK', offerFewer: false });
  });
  it('never shows the same key twice', async () => {
    const { d, shown } = deps();
    const coach = createCoach(d);
    await coach.tick(); await coach.tick();
    expect(shown).toHaveLength(1);
  });
  it('holds (and records) when a hold reason applies, without showing', async () => {
    const { d, rows, shown } = deps({ holdReason: async () => 'call' });
    expect(await createCoach(d).tick()).toBe('held');
    expect(rows[0].status).toBe('held');
    expect(shown).toHaveLength(0);
  });
  it('only queries the hold reason when something is about to show', async () => {
    let asked = 0;
    const { d } = deps({ rules: [() => null], holdReason: async () => { asked++; return null; } });
    await createCoach(d).tick();
    expect(asked).toBe(0);
  });
  it('survives a throwing rule and shows at most one pop-up per tick', async () => {
    const { d, shown } = deps({ rules: [() => { throw new Error('bug'); }, () => c({ key: 'a' }), () => c({ key: 'b', ruleId: 'eye_break' })] });
    await createCoach(d).tick();
    expect(shown).toHaveLength(1);
  });
  it('marks a nudge held when the window cannot be shown', async () => {
    const { d, rows } = deps({ show: () => false });
    await createCoach(d).tick();
    expect(rows[0].status).toBe('held');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

- [ ] **Step 3: Implement the engine**

`apps/consumer/src/main/coach/engine.ts`:

```ts
import type { Rule, Snapshot } from './snapshot';
import type { Candidate, Kind, NudgeRow, NudgeStatus, PillNudge } from './types';
import { decide } from './gate';
import { RULES } from './rules';

export interface CoachDeps {
  now(): number; snapshot(now: number): Snapshot; history(now: number): NudgeRow[];
  kinds(): Record<Kind, boolean>; snoozeUntil(): number; fewer(): Partial<Record<Kind, number>>;
  weight(c: Candidate, now: number): number; holdReason(): Promise<string | null>;
  record(c: Candidate, status: NudgeStatus, now: number): number; setStatus(id: number, s: NudgeStatus): void;
  show(n: PillNudge): boolean; rules?: Rule[];
}

export function createCoach(d: CoachDeps) {
  const rules = d.rules ?? RULES;
  return {
    async tick(): Promise<'shown' | 'held' | 'none'> {
      const now = d.now();
      const snap = d.snapshot(now);
      const history = [...d.history(now)];
      let outcome: 'held' | 'none' = 'none';
      for (const rule of rules) {
        let c: Candidate | null = null;
        try { c = rule(snap); } catch (e) { console.error('[coach] rule failed:', e); continue; }
        if (!c) continue;
        const base = { now, history, kinds: d.kinds(), snoozeUntil: d.snoozeUntil(), fewer: d.fewer(), weight: d.weight(c, now) };
        let dec = decide(c, { ...base, hold: null });
        if (dec.status === 'show') {
          const hold = await d.holdReason();
          if (hold) dec = { status: 'held', reason: hold };
        }
        if (dec.status === 'drop') continue;
        if (dec.status === 'held') {
          const id = d.record(c, 'held', now);
          history.push({ id, at: now, date: snap.date, kind: c.kind, ruleId: c.ruleId, key: c.key, title: c.title, body: c.body, status: 'held' });
          outcome = 'held';
          continue;
        }
        const id = d.record(c, 'shown', now);
        const ok = d.show({ id, kind: c.kind, mini: c.mini, stat: c.stat, title: c.title, body: c.body, primaryLabel: c.primary.label, offerFewer: dec.offerFewer });
        if (!ok) { d.setStatus(id, 'held'); return 'held'; }
        return 'shown';
      }
      return outcome;
    }
  };
}
```

- [ ] **Step 4: IPC, preload, main wiring**

`channels.ts` add:

```ts
  coachGet: 'coach:get',
  coachSetKinds: 'coach:setKinds',
  coachSnooze: 'coach:snooze',
  coachSetLimits: 'coach:setLimits',
  coachDismissHeld: 'coach:dismissHeld',
  coachTest: 'coach:test',
```

`ipc.ts`: import `kindsInput, limitsInput, snoozeInput, parseKinds, parseLimits` from `./coach/settings`, `type { AppLimit, Kind }` from `./coach/types`; add

```ts
export interface CoachView { kinds: Record<Kind, boolean>; snoozeUntil: number; limits: AppLimit[]; held: { id: number; at: number; kind: Kind; title: string; body: string }[]; }
export interface CoachIpcDeps { held(): CoachView['held']; dismissHeld(id: number): void; test(): void; onChanged(): void; }
```

add `coach: CoachIpcDeps;` to `IpcDeps` and handlers:

```ts
  const coachView = (): CoachView => {
    const s = d.settings.get();
    return { kinds: parseKinds(s.nudgeKinds), snoozeUntil: s.snoozeUntil, limits: parseLimits(s.appLimits), held: d.coach.held() };
  };
  ipcMain.handle(CH.coachGet, () => coachView());
  ipcMain.handle(CH.coachSetKinds, (_e, raw) => { d.settings.set({ nudgeKinds: JSON.stringify(kindsInput.parse(raw)) }); d.coach.onChanged(); return coachView(); });
  ipcMain.handle(CH.coachSetLimits, (_e, raw) => { d.settings.set({ appLimits: JSON.stringify(limitsInput.parse(raw)) }); return coachView(); });
  ipcMain.handle(CH.coachSnooze, (_e, raw) => {
    const v = snoozeInput.parse(raw);
    const now = d.now();
    const tomorrow = new Date(now); tomorrow.setHours(24, 0, 0, 0);
    d.settings.set({ snoozeUntil: v === 'off' ? 0 : v === '1h' ? now + 3_600_000 : tomorrow.getTime() });
    d.coach.onChanged();
    return coachView();
  });
  ipcMain.handle(CH.coachDismissHeld, (_e, raw) => { d.coach.dismissHeld(z.number().int().parse(raw)); return coachView(); });
  ipcMain.handle(CH.coachTest, () => { d.coach.test(); });
```

Also pass breaks to Today: change the `todayGet` handler to `loadTodayView(d.repo, d.settings.get(), date, d.now(), d.labelsFor, d.breaksFor)` and add `breaksFor(date: string): number[];` to `IpcDeps`.

`preload/index.ts`: add

```ts
  coach: {
    get: (): Promise<CoachView> => ipcRenderer.invoke(CH.coachGet),
    setKinds: (k: Record<'health' | 'behaviour' | 'tip' | 'win', boolean>): Promise<CoachView> => ipcRenderer.invoke(CH.coachSetKinds, k),
    snooze: (v: '1h' | 'tomorrow' | 'off'): Promise<CoachView> => ipcRenderer.invoke(CH.coachSnooze, v),
    setLimits: (l: { app: string; minutes: number }[]): Promise<CoachView> => ipcRenderer.invoke(CH.coachSetLimits, l),
    dismissHeld: (id: number): Promise<CoachView> => ipcRenderer.invoke(CH.coachDismissHeld, id),
    test: (): Promise<void> => ipcRenderer.invoke(CH.coachTest)
  },
```

(import `CoachView` type from `../main/ipc`).

`index.ts` — add (imports: `globalShortcut, screen` from electron; `COACH_SCHEMA, createCoachStore` from `./coach/store`; `createCoach` from `./coach/engine`; `ruleWeight` from `./coach/weights`; `holdReason, type Rect` from `./coach/gate`; `queryNotificationState` from `./coach/notifState`; `parseFewer, parseKinds, parseLimits` from `./coach/settings`; `createPillManager, electronPillWindow, pillMessage, PILL_W, PILL_MARGIN` from `./windows/pill`; `createBreakOverlay, electronBreakWindow, breakMessage` from `./windows/breakOverlay`; `readProfile` already imported; `loadTodayView` from `./day/today`; `shiftDate` from `./day/time`):

```ts
    db.exec(COACH_SCHEMA);
    const coachStore = createCoachStore(db);
    const loadPage = (w: BrowserWindow, page: 'pill' | 'break'): void => {
      const devUrl = process.env['ELECTRON_RENDERER_URL'];
      if (devUrl) void w.loadURL(`${devUrl}/${page}.html`);
      else void w.loadFile(join(__dirname, `../renderer/${page}.html`));
    };
    const overlay = createBreakOverlay({
      displays: () => screen.getAllDisplays().map((dsp) => ({ bounds: dsp.bounds, primary: dsp.id === screen.getPrimaryDisplay().id })),
      makeWindow: (bounds) => electronBreakWindow(bounds, join(__dirname, '../preload/break.js'), (w) => loadPage(w, 'break'), (raw) => {
        const m = breakMessage.safeParse(raw);
        if (m.success) overlay.handle(m.data);
      }),
      onDone: (r) => {
        const now = Date.now();
        coachStore.recordBreak({ at: now, date: localDate(now), kind: r.kind, seconds: r.seconds, completed: r.completed });
        win?.webContents.send(CH.eventsUpdate);
      }
    });
    const primaryActions = new Map<number, { kind: string; action: string }>();
    const pill = createPillManager({
      makeWindow: () => electronPillWindow(join(__dirname, '../preload/pill.js'), (w) => loadPage(w, 'pill'), (raw) => {
        const m = pillMessage.safeParse(raw);
        if (m.success) pill.handle(m.data);
      }),
      placement: () => {
        const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
        return { x: wa.x + wa.width - PILL_W - PILL_MARGIN, y: wa.y + PILL_MARGIN };
      },
      onAction: (id, action) => {
        if (id < 0) return; // "Test a pop-up"
        const meta = primaryActions.get(id);
        primaryActions.delete(id);
        const status = action === 'primary' ? 'acted' : action === 'dismiss' || action === 'fewer' ? 'dismissed' : action === 'snooze' ? 'snoozed' : 'expired';
        coachStore.setStatus(id, status);
        if (action === 'snooze') settings.set({ snoozeUntil: Date.now() + 3_600_000 });
        if (action === 'fewer' && meta) {
          const fewer = parseFewer(settings.get().nudgeFewer);
          const k = meta.kind as keyof typeof fewer;
          settings.set({ nudgeFewer: JSON.stringify({ ...fewer, [k]: Math.min(64, (fewer[k] ?? 1) * 2) }) });
        }
        if (action === 'primary' && meta?.action === 'break_eye') overlay.start('eye');
        if (action === 'primary' && meta?.action === 'break_stretch') overlay.start('stretch');
        refreshTray();
        win?.webContents.send(CH.eventsUpdate);
      }
    });
    const buildSnapshot = (now: number) => {
      const s = settings.get();
      const date = localDate(now);
      const view = loadTodayView(repo, s, date, now, (d) => labelStore.labelsForDay(d), (d) => coachStore.completedBreaksForDay(d));
      const searchTitles = Array.from({ length: 7 }, (_, i) => repo.getFocusSessions(shiftDate(date, -i))).flat()
        .filter((x) => x.windowTitle).map((x) => ({ at: x.startedAt, title: x.windowTitle as string }));
      const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
      return {
        now, date, settings: s, profile: readProfile(s), samples: repo.getActivitySamples(date), sessions: repo.getFocusSessions(date),
        readsToday: labelStore.readsSince(dayStart.getTime()), // rules apply their own freshness windows
        view, searchTitles, limits: parseLimits(s.appLimits), lastBreakAt: coachStore.lastCompletedBreakAt()
      };
    };
    const coach = createCoach({
      now: () => Date.now(),
      snapshot: buildSnapshot,
      history: (now) => coachStore.since(now - 7 * 86_400_000),
      kinds: () => parseKinds(settings.get().nudgeKinds),
      snoozeUntil: () => settings.get().snoozeUntil,
      fewer: () => parseFewer(settings.get().nudgeFewer),
      weight: (c, now) => ruleWeight(c.ruleId, c.kind, readProfile(settings.get()), now),
      holdReason: async () => {
        const fg = await new ActiveWinForegroundSource().get().catch(() => null);
        const displays: Rect[] = screen.getAllDisplays().map((dsp) => dsp.bounds);
        return holdReason(fg ? { appName: fg.appName, title: fg.title, bounds: fg.bounds ?? null } : null, displays, await queryNotificationState());
      },
      record: (c, status, now) => {
        const id = coachStore.record({ at: now, date: localDate(now), kind: c.kind, ruleId: c.ruleId, key: c.key, title: c.title, body: c.body, status });
        if (status === 'shown') primaryActions.set(id, { kind: c.kind, action: c.primary.action });
        return id;
      },
      setStatus: (id, st) => coachStore.setStatus(id, st),
      show: (n) => pill.show(n)
    });
    let coaching = false;
    setInterval(() => {
      const s = settings.get();
      if (coaching || !s.consentGranted || s.trackingPaused) return;
      coaching = true;
      coach.tick().catch((e) => console.error('[coach] tick failed:', e)).finally(() => { coaching = false; });
    }, 30_000);
```

- Tray: in `refreshTray()`'s template add before the separator:

```ts
        settings.get().snoozeUntil > Date.now()
          ? { label: 'Resume pop-ups', click: () => { settings.set({ snoozeUntil: 0 }); refreshTray(); } }
          : { label: 'Snooze pop-ups 1 h', click: () => { settings.set({ snoozeUntil: Date.now() + 3_600_000 }); refreshTray(); } },
```

- Global shortcut after the window is created: `if (!globalShortcut.register('Control+Alt+D', () => pill.dismissAll())) console.warn('[coach] Ctrl+Alt+D is taken by another app');` and `app.on('will-quit', () => globalShortcut.unregisterAll());`.
- `registerIpc({... breaksFor: (d) => coachStore.completedBreaksForDay(d), coach: { held: () => coachStore.heldForDay(localDate(Date.now())).map(({ id, at, kind, title, body }) => ({ id, at, kind, title, body })), dismissHeld: (id) => { coachStore.setStatus(id, 'expired'); win?.webContents.send(CH.eventsUpdate); }, test: () => { pill.show({ id: -1, kind: 'health', mini: 'Eye break', stat: 'test', title: 'Give your eyes a break', body: 'This is how Daylens pop-ups look. They never take your keyboard focus.', primaryLabel: 'Nice', offerFewer: false }); }, onChanged: () => refreshTray() } })`.
- In the "Delete my activity" handler's `try`, after `deleteActivity(db)`, nothing more is needed (Task 3 made `deleteActivity` clear coach tables).

- [ ] **Step 5: Verify and commit**

Tests, typecheck, build. If no Daylens instance is running, do a ~40 s dev launch and check the log is clean (kill only your own process tree); otherwise skip and say so.

```bash
git add apps/consumer/src/main apps/consumer/src/preload/index.ts
git commit -m "feat(consumer): coach engine, IPC, tray snooze and Ctrl+Alt+D wiring"
```

### Task 10: Settings → Pop-ups and the Today "While you were busy" card

**Files:**
- Create: `apps/consumer/src/renderer/components/PopupsSection.tsx`, `apps/consumer/src/renderer/components/HeldCard.tsx`, `apps/consumer/src/renderer/lib/coach.ts`, `apps/consumer/src/renderer/lib/coach.test.ts`
- Modify: `apps/consumer/src/renderer/components/SettingsScreen.tsx`, `apps/consumer/src/renderer/components/TodayScreen.tsx`, `apps/consumer/src/renderer/styles.css`

**Interfaces:**
- Consumes: `api.coach.*`, `CoachView` (Task 9); `NUDGE_LOOK` (Task 7); `profile.distractions` via `api.profile.get()`; `formatClock`.
- Produces: `snoozeText(snoozeUntil: number, now: number): string`; `limitSuggestions(distractions: string[], existing: { app: string }[]): string[]`; `addLimit(list, app, minutes)`.

- [ ] **Step 1: Failing tests**

`apps/consumer/src/renderer/lib/coach.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { addLimit, limitSuggestions, snoozeText } from './coach';

describe('coach UI helpers', () => {
  it('describes the snooze state', () => {
    const now = new Date(2026, 8, 25, 14, 0).getTime();
    expect(snoozeText(0, now)).toBe('Pop-ups are on');
    expect(snoozeText(now + 3_600_000, now)).toMatch(/^Snoozed until /);
  });
  it('suggests distraction apps not already limited', () => {
    expect(limitSuggestions(['YouTube', 'Discord'], [{ app: 'discord' }])).toEqual(['YouTube']);
  });
  it('adds limits case-insensitively unique, max 20', () => {
    expect(addLimit([{ app: 'Discord', minutes: 30 }], ' discord ', 60)).toEqual([{ app: 'Discord', minutes: 30 }]);
    expect(addLimit([], 'Steam', 45)).toEqual([{ app: 'Steam', minutes: 45 }]);
    expect(addLimit(Array.from({ length: 20 }, (_, i) => ({ app: `a${i}`, minutes: 30 })), 'x', 30)).toHaveLength(20);
  });
});
```

- [ ] **Step 2: Implement helpers**

`apps/consumer/src/renderer/lib/coach.ts`:

```ts
import { formatClock } from './format';

export const LIMIT_CHOICES = [15, 30, 45, 60, 90, 120, 180, 240];

export function snoozeText(snoozeUntil: number, now: number): string {
  return snoozeUntil > now ? `Snoozed until ${formatClock(snoozeUntil)}` : 'Pop-ups are on';
}

export function limitSuggestions(distractions: string[], existing: { app: string }[]): string[] {
  const have = new Set(existing.map((l) => l.app.toLowerCase()));
  return distractions.filter((d) => !have.has(d.toLowerCase()));
}

export function addLimit(list: { app: string; minutes: number }[], raw: string, minutes: number): { app: string; minutes: number }[] {
  const app = raw.trim().replace(/\s+/g, ' ');
  if (!app || app.length > 60 || list.length >= 20 || list.some((l) => l.app.toLowerCase() === app.toLowerCase())) return list;
  return [...list, { app, minutes }];
}
```

- [ ] **Step 3: Components**

`apps/consumer/src/renderer/components/PopupsSection.tsx`:

```tsx
import { useEffect, useState } from 'react';
import type { CoachView } from '../../main/ipc';
import { NUDGE_LOOK } from '../../shared/nudgeLook';
import { api } from '../lib/api';
import { LIMIT_CHOICES, addLimit, limitSuggestions, snoozeText } from '../lib/coach';
import { formatHm } from '../lib/format';

const KIND_TEXT = { health: 'Eye breaks, stretching, wind-down, daily goal', behaviour: 'Doom-scrolling, scattered, app limits', tip: 'Short tips when you seem stuck', win: 'Deep-work streaks and good days' } as const;

export function PopupsSection() {
  const [view, setView] = useState<CoachView | null>(null);
  const [distractions, setDistractions] = useState<string[]>([]);
  const [app, setApp] = useState('');
  const [minutes, setMinutes] = useState(60);
  const load = (): void => { api.coach.get().then(setView).catch((e) => console.error('[renderer] coach.get failed:', e)); };
  useEffect(() => {
    load();
    api.profile.get().then((p) => setDistractions(p.distractions)).catch(() => {});
    return api.onUpdate(load);
  }, []);
  if (!view) return null;
  const save = (p: Promise<CoachView>): void => { p.then(setView).catch((e) => { console.error(e); load(); }); };
  const add = (name: string): void => {
    const next = addLimit(view.limits, name, minutes);
    setApp('');
    if (next !== view.limits) save(api.coach.setLimits(next));
  };

  return (
    <div className="grp">
      <h4>Pop-ups</h4>
      {(Object.keys(NUDGE_LOOK) as (keyof typeof NUDGE_LOOK)[]).map((k) => (
        <div className="srow" key={k}>
          <p>{NUDGE_LOOK[k].emoji} {NUDGE_LOOK[k].label}<small>{KIND_TEXT[k]}</small></p>
          <button className={`sw${view.kinds[k] ? ' on' : ''}`} aria-label={`${NUDGE_LOOK[k].label} pop-ups`} aria-pressed={view.kinds[k]}
            onClick={() => save(api.coach.setKinds({ ...view.kinds, [k]: !view.kinds[k] }))} />
        </div>
      ))}
      <div className="srow">
        <p>Snooze<small role="status">{snoozeText(view.snoozeUntil, Date.now())}</small></p>
        <div className="srow-btns">
          <button className="btn s" onClick={() => save(api.coach.snooze('1h'))}>1 hour</button>
          <button className="btn s" onClick={() => save(api.coach.snooze('tomorrow'))}>Until tomorrow</button>
          {view.snoozeUntil > Date.now() && <button className="btn s" onClick={() => save(api.coach.snooze('off'))}>Turn back on</button>}
        </div>
      </div>
      <div className="srow stack">
        <p>Daily limits<small>A pop-up tells you when you pass a limit. Nothing is blocked.</small></p>
        <div className="xchips">
          {view.limits.map((l) => (
            <span key={l.app} className="xchip">{l.app} · {formatHm(l.minutes * 60)}
              <button aria-label={`Remove limit for ${l.app}`} onClick={() => save(api.coach.setLimits(view.limits.filter((x) => x !== l)))}>×</button>
            </span>
          ))}
        </div>
        <div className="xadd">
          <input type="text" aria-label="App to limit" placeholder="App name, e.g. Discord" maxLength={60} value={app}
            onChange={(e) => setApp(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) add(app); }} />
          <select aria-label="Daily limit" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
            {LIMIT_CHOICES.map((m) => <option key={m} value={m}>{formatHm(m * 60)}</option>)}
          </select>
          <button className="btn s" onClick={() => add(app)}>Add</button>
        </div>
        {limitSuggestions(distractions, view.limits).length > 0 && (
          <div className="xchips">
            {limitSuggestions(distractions, view.limits).map((d) => <button key={d} className="btn s" onClick={() => add(d)}>+ {d}</button>)}
          </div>
        )}
      </div>
      <div className="srow">
        <p>See what a pop-up looks like<small>Shows a sample in the top-right corner.</small></p>
        <button className="btn s" onClick={() => { void api.coach.test(); }}>Test a pop-up</button>
      </div>
    </div>
  );
}
```

`apps/consumer/src/renderer/components/HeldCard.tsx`:

```tsx
import { useEffect, useState } from 'react';
import type { CoachView } from '../../main/ipc';
import { NUDGE_LOOK } from '../../shared/nudgeLook';
import { api } from '../lib/api';
import { formatClock } from '../lib/format';

export function HeldCard() {
  const [held, setHeld] = useState<CoachView['held']>([]);
  useEffect(() => {
    const load = (): void => { api.coach.get().then((v) => setHeld(v.held)).catch(() => {}); };
    load();
    return api.onUpdate(load);
  }, []);
  if (!held.length) return null;
  return (
    <div className="held" role="region" aria-label="While you were busy">
      <p className="sec">While you were busy</p>
      {held.map((h) => (
        <div key={h.id} className="held-row" style={{ ['--c' as string]: NUDGE_LOOK[h.kind].color }}>
          <span className="held-ic" aria-hidden="true">{NUDGE_LOOK[h.kind].emoji}</span>
          <div><b>{h.title}</b><p>{h.body} <small>{formatClock(h.at)}</small></p></div>
          <button className="btn s" aria-label={`Dismiss ${h.title}`} onClick={() => { api.coach.dismissHeld(h.id).then((v) => setHeld(v.held)).catch(() => {}); }}>✕</button>
        </div>
      ))}
    </div>
  );
}
```

Mount: `SettingsScreen.tsx` renders `<PopupsSection />` right after `<ModelSection ... />`; `TodayScreen.tsx` renders `<HeldCard />` right after `<ScreenPrompt ... />`.

`styles.css` (before the reduced-motion block):

```css
.held { margin-bottom: 16px; }
.held-row { display: flex; align-items: center; gap: 12px; background: #fff; border-radius: 16px; padding: 10px 12px; margin-top: 8px; border-left: 6px solid var(--c); }
.held-row p { margin: 2px 0 0; font-size: 12.5px; color: var(--muted); }
.held-row small { opacity: .7; }
.held-ic { font-size: 18px; }
.held-row .btn { margin-left: auto; }
```

- [ ] **Step 4: Verify and commit**

Tests, typecheck, build.

```bash
git add apps/consumer/src/renderer
git commit -m "feat(consumer): Settings pop-ups section and Today 'While you were busy' card"
```

### Task 11: Verification

- [ ] **Step 1:** `pnpm test` (all packages; fallback runner if EPERM), `pnpm -r typecheck`, build.
- [ ] **Step 2 (controller):** preview-harness screenshots of the pill page (each kind; stack of 3; offerFewer) and the break page vs `pill-v2.html` / `popups.html` §2; delete the harness.
- [ ] **Step 3 (human + controller, real app):** Settings → Pop-ups → "Test a pop-up": pill appears top-right, typing in another app continues uninterrupted, clicks outside the pill reach the app below, hover pauses auto-hide, Ctrl+Alt+D dismisses. Start a break (lower `breakIntervalMin` or use the eye-break pop-up): overlay on every monitor, Esc/Skip/+1 min work, Today's health breaks count goes up. Open a fullscreen video → a due pop-up is held and appears under "While you were busy". Snooze from the tray. Labelling: Settings → AI model shows "Waiting for a quiet moment" while busy with low RAM, and labels arrive after locking the PC for a few minutes.
