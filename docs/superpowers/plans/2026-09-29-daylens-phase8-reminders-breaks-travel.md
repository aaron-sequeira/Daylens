# Daylens Phase 8 — Reminders, animated break screens, travel mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Water, meal, tea and custom reminders that lead to animated, hand-drawn break screens, and automatic time-zone following with a short jet-lag travel mode.

**Architecture:** Reminders live in SQLite (`reminders`, `reminder_state`), a pure planner decides which one is due, and a new coach kind `reminder` feeds the existing engine → gate → pill → break overlay (reminders are exempt from coach cooldowns and are never recorded as "held", so a call only delays them). The break overlay takes a per-start spec (animation, length, copy) and renders one of ten SVG scenes. A zone watcher re-detects the Windows time zone, records changes, and a pure travel module derives home zone, travel mode, tips and travel reminders.

**Tech Stack:** Electron 33.4.11, React 19, TypeScript, better-sqlite3, zod, vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-29-daylens-phase8-reminders-breaks-travel-design.md`

## Global Constraints

- No new npm dependencies. Scenes are inline SVG + CSS.
- Days use the profile convention **1 = Monday … 7 = Sunday** (`shared/profileOptions.ts`).
- All reminder times are local (`HH:MM`), evaluated against the current local time.
- Limits: name 1–40 chars; message 0–120; interval 15–240 min; break 0 (none) or 15–3600 s; ≤ 20 custom reminders; ≥ 1 day for time reminders.
- Built-ins: water every 60 min / 30 s / on; lunch 13:00 workdays / 30 min / on; tea 16:00 workdays / 15 min / on; dinner 19:30 every day / 30 min / off.
- Clock reminders are due from their time for **60 minutes**, once per local day; skipped (marked fired, no pop-up) if there was no active input from 5 min before to 1 min after the time.
- Travel mode: |offset change| ≥ 180 min; length `clamp(round(|min| / 180), 2, 5)` days; water interval 45 min while active.
- Pop-ups: reminders never trigger or obey the 20-min global cooldown / rule cooldowns; they obey snooze, focus blocks, the Reminders kind switch, and call/fullscreen holds (holds delay, never drop).
- Break screens: scene inside the countdown ring; breaks ≥ 300 s are "long" (only **I'm back**, completed if ≥ 50 % elapsed); reduced motion → still scene.
- Tests: `cd apps/consumer && ELECTRON_RUN_AS_NODE=1 ../../node_modules/electron/dist/electron.exe ../../node_modules/vitest/vitest.mjs run [path]`; typecheck `npx tsc --noEmit -p tsconfig.web.json && npx tsc --noEmit -p tsconfig.node.json`. Never `pnpm test`.
- Never launch the Daylens app, never load a model, never kill processes you did not start, never change system settings (time zone).
- Never stage `.codex/`. Stage by explicit path. Commit messages end with a blank line then `Co-Authored-By: <your model> <noreply@anthropic.com>`.
- Never print screen/OCR text, real-DB window titles or model output.

## Review Focus

1. **A lunch reminder that falls during a call or full-screen video** must appear once the hold ends (within its 60-min window), not vanish — Task 5 engine test.
2. **The PC asleep or the user away at reminder time** (wakes 13:30) → lunch is skipped, not shown late — Task 3 test.
3. **Editing a reminder to a time that has already passed today** → no instant pop-up; it starts next time — Task 2 test.
4. **A long break interrupted by sleep** (laptop closed during a 30-min lunch break) → the watchdog ends it and counts it completed if ≥ 50 % elapsed — Task 4 test.
5. **Crossing midnight via a time-zone change** (flying west can repeat a local date) → fired-date logic uses the *current* local date, so each local day gets its reminders once — Task 3 test.

---

### Task 1: Time-zone watcher (spike first)

**Files:**
- Create: `apps/consumer/src/main/time/zone.ts`, `apps/consumer/src/main/time/zone.test.ts`, `apps/consumer/src/main/time/tzStore.ts`, `apps/consumer/src/main/time/tzStore.test.ts`
- Modify: `apps/consumer/src/main/settings.ts` (`zoneName`, `zoneOffset`, `travelOffUntil` defaults)

**Interfaces:**
- Produces: `resetClockZone(): void`; `currentOffsetMin(): number` (minutes east of UTC); `readWindowsZone(exec?): Promise<string | null>`; `createZoneWatcher(deps): { check(): Promise<TzChange | null> }`; `interface TzChange { at: number; fromName: string; toName: string; fromOffset: number; toOffset: number }`; `TZ_SQL`, `createTzStore(db): { record(c: TzChange): void; since(ms: number): TzChange[]; latest(): TzChange | null; clear(): void }`.

- [ ] **Step 1: Spike — prove the zone reset works in Electron's Node (failing test first)**

`zone.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest';
import { createZoneWatcher, currentOffsetMin, readWindowsZone, resetClockZone } from './zone';

describe('resetClockZone (spike: V8 re-detects the zone when TZ changes)', () => {
  const saved = process.env.TZ;
  afterEach(() => { if (saved === undefined) delete process.env.TZ; else process.env.TZ = saved; });
  it('follows a TZ change and returns to the host zone after reset', () => {
    const host = currentOffsetMin();
    process.env.TZ = 'Asia/Tokyo';
    expect(currentOffsetMin()).toBe(540);
    resetClockZone();
    expect(currentOffsetMin()).toBe(host);
  });
});

describe('readWindowsZone', () => {
  it('parses the reg query output', async () => {
    const out = '\r\nHKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\TimeZoneInformation\r\n    TimeZoneKeyName    REG_SZ    India Standard Time\r\n\r\n';
    expect(await readWindowsZone(async () => out)).toBe('India Standard Time');
  });
  it('returns null when the command fails', async () => {
    expect(await readWindowsZone(async () => { throw new Error('x'); })).toBeNull();
  });
});

describe('createZoneWatcher', () => {
  const mk = (names: (string | null)[], offsets: number[], stored = { name: '', offset: 0 }) => {
    let i = 0, reset = 0;
    const saved: { name: string; offset: number }[] = [];
    const w = createZoneWatcher({
      read: async () => names[Math.min(i, names.length - 1)],
      offset: () => offsets[Math.min(i, offsets.length - 1)],
      reset: () => { reset++; },
      stored: () => stored, save: (z) => { stored = z; saved.push(z); },
      now: () => 1000
    });
    return { w, next: () => { i++; }, resets: () => reset, saved };
  };
  it('first run stores the zone without reporting a change', async () => {
    const t = mk(['GMT Standard Time'], [60]);
    expect(await t.w.check()).toBeNull();
    expect(t.saved).toEqual([{ name: 'GMT Standard Time', offset: 60 }]);
  });
  it('reports a change (after resetting the clock) and stores the new zone', async () => {
    const t = mk(['GMT Standard Time', 'Tokyo Standard Time'], [60, 540], { name: 'GMT Standard Time', offset: 60 });
    expect(await t.w.check()).toBeNull();
    t.next();
    expect(await t.w.check()).toEqual({ at: 1000, fromName: 'GMT Standard Time', toName: 'Tokyo Standard Time', fromOffset: 60, toOffset: 540 });
    expect(t.resets()).toBe(1);
  });
  it('detects a change that happened while the app was closed', async () => {
    const t = mk(['Tokyo Standard Time'], [540], { name: 'GMT Standard Time', offset: 60 });
    expect(await t.w.check()).toMatchObject({ fromName: 'GMT Standard Time', toName: 'Tokyo Standard Time' });
  });
  it('does nothing when the zone cannot be read', async () => {
    const t = mk([null], [60], { name: 'GMT Standard Time', offset: 60 });
    expect(await t.w.check()).toBeNull();
    expect(t.resets()).toBe(0);
  });
});
```
Run — expect FAIL (module not found).

- [ ] **Step 2: Implement `zone.ts`**

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export interface TzChange { at: number; fromName: string; toName: string; fromOffset: number; toOffset: number; }

/** Minutes east of UTC right now (e.g. India +330, New York −300/−240). */
export const currentOffsetMin = (): number => -new Date().getTimezoneOffset();

/** V8 caches the host zone. Node re-detects it whenever process.env.TZ is set or deleted, so set-then-delete forces
 * a fresh read of the Windows zone. Leaves a user-set TZ alone (then Daylens keeps that fixed zone, by choice). */
export function resetClockZone(): void {
  if (process.env.TZ !== undefined && process.env.TZ !== 'UTC') return;
  process.env.TZ = 'UTC';
  delete process.env.TZ;
}

const KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\TimeZoneInformation';
const run = async (): Promise<string> =>
  (await promisify(execFile)('reg', ['query', KEY, '/v', 'TimeZoneKeyName'], { windowsHide: true, timeout: 3000 })).stdout;

/** The Windows time-zone key name (e.g. "India Standard Time"), or null if it can't be read. */
export async function readWindowsZone(exec: () => Promise<string> = run): Promise<string | null> {
  try {
    const m = /TimeZoneKeyName\s+REG_SZ\s+(.+?)\s*$/m.exec(await exec());
    return m ? m[1].trim() : null;
  } catch { return null; }
}

export function createZoneWatcher(d: {
  read(): Promise<string | null>; offset(): number; reset(): void;
  stored(): { name: string; offset: number }; save(z: { name: string; offset: number }): void; now(): number;
}) {
  return {
    /** Reads the Windows zone; on a change resets the JS clock, stores and returns the change. */
    async check(): Promise<TzChange | null> {
      const name = await d.read();
      if (!name) return null;
      const prev = d.stored();
      if (prev.name === name) return null;
      if (prev.name !== '') d.reset();
      const offset = d.offset();
      d.save({ name, offset });
      return prev.name === '' ? null : { at: d.now(), fromName: prev.name, toName: name, fromOffset: prev.offset, toOffset: offset };
    }
  };
}
```
Run the tests — expect PASS. **If the spike test fails** (the offset does not follow `TZ`), stop and report `BLOCKED` with the output: the fallback (IANA mapping) is a controller decision.

- [ ] **Step 3: `tzStore.ts` with a failing test first**

`tzStore.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { TZ_SQL, createTzStore } from './tzStore';

describe('tz store', () => {
  it('records changes and returns them newest-last / latest', () => {
    const db = new Database(':memory:'); db.exec(TZ_SQL);
    const s = createTzStore(db);
    expect(s.latest()).toBeNull();
    s.record({ at: 10, fromName: 'A', toName: 'B', fromOffset: 0, toOffset: 540 });
    s.record({ at: 20, fromName: 'B', toName: 'A', fromOffset: 540, toOffset: 0 });
    expect(s.since(15)).toEqual([{ at: 20, fromName: 'B', toName: 'A', fromOffset: 540, toOffset: 0 }]);
    expect(s.latest()?.at).toBe(20);
    s.clear();
    expect(s.latest()).toBeNull();
  });
});
```
Implement:
```ts
import type Database from 'better-sqlite3';
import type { TzChange } from './zone';

export const TZ_SQL = `
CREATE TABLE IF NOT EXISTS tz_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL,
  from_name TEXT NOT NULL, to_name TEXT NOT NULL, from_offset INTEGER NOT NULL, to_offset INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tz_at ON tz_changes(at);
`;
const COLS = 'at, from_name AS fromName, to_name AS toName, from_offset AS fromOffset, to_offset AS toOffset';

export function createTzStore(db: Database.Database) {
  const ins = db.prepare('INSERT INTO tz_changes (at, from_name, to_name, from_offset, to_offset) VALUES (@at, @fromName, @toName, @fromOffset, @toOffset)');
  const since = db.prepare(`SELECT ${COLS} FROM tz_changes WHERE at >= ? ORDER BY at, id`);
  const latest = db.prepare(`SELECT ${COLS} FROM tz_changes ORDER BY at DESC, id DESC LIMIT 1`);
  return {
    record: (c: TzChange): void => { ins.run(c); },
    since: (ms: number): TzChange[] => since.all(ms) as TzChange[],
    latest: (): TzChange | null => (latest.get() as TzChange | undefined) ?? null,
    clear: (): void => { db.exec('DELETE FROM tz_changes'); }
  };
}
```

- [ ] **Step 4: Settings defaults**

`settings.ts` `DEFAULT_SETTINGS`: add `zoneName: ''`, `zoneOffset: 0`, `travelOffUntil: 0` (not in `settingsPatch`; main sets them). If `settings.test.ts` snapshots the defaults, update it.

- [ ] **Step 5: Full suite, typecheck, commit**

```bash
git add apps/consumer/src/main/time apps/consumer/src/main/settings.ts
git commit -m "feat(consumer): time-zone watcher (re-detects the Windows zone) and tz_changes store"
```
(Include `settings.test.ts` if changed.)

---

### Task 2: Reminder model and store

**Files:**
- Create: `apps/consumer/src/shared/reminders.ts`, `apps/consumer/src/shared/reminders.test.ts`, `apps/consumer/src/main/reminders/store.ts`, `apps/consumer/src/main/reminders/store.test.ts`
- Modify: `apps/consumer/src/main/screen/store.ts` (`deleteActivity` clears `reminder_state`, `tz_changes`)

**Interfaces:**
- Produces (shared): `ANIMATIONS`, `type Animation`, `ANIMATION_LOOK: Record<Animation, { emoji: string; label: string }>`, `type Builtin`, `type Schedule`, `interface Reminder`, `type ReminderInput`, `interface ReminderState`, `LIMITS`, `BREAK_OPTIONS: number[]`, `validateReminder(input): string | null`, `builtinDefaults(workdays: number[]): Omit<Reminder, 'id'>[]`, `reminderTitle(r: Reminder): string`, `reminderSummary(r: Reminder): string`, `localDayOf(ms: number): number` (1..7).
- Produces (main): `REMINDERS_SQL`, `createReminderStore(db): ReminderStore` (methods below).

- [ ] **Step 1: Failing shared tests**

`shared/reminders.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { builtinDefaults, reminderSummary, reminderTitle, validateReminder, type ReminderInput } from './reminders';

const base: ReminderInput = { name: 'Vitamins', message: '', animation: 'medicine', schedule: { type: 'time', time: '09:00', days: [1, 2, 3, 4, 5] }, breakSec: 0 };

describe('validateReminder', () => {
  it('accepts a valid reminder', () => { expect(validateReminder(base)).toBeNull(); });
  it('enforces the limits', () => {
    expect(validateReminder({ ...base, name: ' ' })).toBe('Give it a name.');
    expect(validateReminder({ ...base, name: 'x'.repeat(41) })).toBe('Name is too long (40 characters max).');
    expect(validateReminder({ ...base, message: 'x'.repeat(121) })).toBe('Message is too long (120 characters max).');
    expect(validateReminder({ ...base, schedule: { type: 'time', time: '25:00', days: [1] } })).toBe('Pick a time.');
    expect(validateReminder({ ...base, schedule: { type: 'time', time: '09:00', days: [] } })).toBe('Pick at least one day.');
    expect(validateReminder({ ...base, schedule: { type: 'interval', minutes: 10 } })).toBe('Choose every 15 to 240 minutes.');
    expect(validateReminder({ ...base, breakSec: 5 })).toBe('Break length must be 15 seconds to 60 minutes, or no break.');
    expect(validateReminder({ ...base, animation: 'rocket' as never })).toBe('Choose an animation.');
  });
});

describe('builtinDefaults', () => {
  it('seeds water/lunch/tea/dinner with the spec defaults and the profile workdays', () => {
    const d = builtinDefaults([1, 2, 3, 4]);
    expect(d.map((r) => [r.builtin, r.enabled, r.breakSec])).toEqual([['water', true, 30], ['lunch', true, 1800], ['tea', true, 900], ['dinner', false, 1800]]);
    expect(d[0].schedule).toEqual({ type: 'interval', minutes: 60 });
    expect(d[1].schedule).toEqual({ type: 'time', time: '13:00', days: [1, 2, 3, 4] });
    expect(d[3].schedule).toEqual({ type: 'time', time: '19:30', days: [1, 2, 3, 4, 5, 6, 7] });
  });
});

describe('titles and summaries', () => {
  const [water, lunch] = builtinDefaults([1, 2, 3, 4, 5]).map((r, i) => ({ ...r, id: i + 1 }));
  it('built-ins have friendly titles; custom ones use name + emoji', () => {
    expect(reminderTitle(water)).toBe('Time for some water 💧');
    expect(reminderTitle(lunch)).toBe('Lunch time 🍱');
    expect(reminderTitle({ ...base, id: 9, builtin: null, enabled: true })).toBe('Vitamins 💊');
  });
  it('summaries read naturally', () => {
    expect(reminderSummary(water)).toBe('Every 60 min of screen time');
    expect(reminderSummary(lunch)).toBe('1:00 pm · Mon–Fri');
    expect(reminderSummary({ ...lunch, schedule: { type: 'time', time: '19:30', days: [1, 2, 3, 4, 5, 6, 7] } })).toBe('7:30 pm · every day');
    expect(reminderSummary({ ...lunch, schedule: { type: 'time', time: '08:05', days: [1, 3, 5] } })).toBe('8:05 am · Mon, Wed, Fri');
  });
});
```
Run — FAIL.

- [ ] **Step 2: Implement `shared/reminders.ts`**

```ts
export const ANIMATIONS = ['water', 'meal', 'tea', 'dinner', 'stretch', 'walk', 'eyes', 'medicine', 'call', 'breathe'] as const;
export type Animation = typeof ANIMATIONS[number];
export const ANIMATION_LOOK: Record<Animation, { emoji: string; label: string }> = {
  water: { emoji: '💧', label: 'Water' }, meal: { emoji: '🍱', label: 'Meal' }, tea: { emoji: '☕', label: 'Tea' },
  dinner: { emoji: '🍽️', label: 'Dinner' }, stretch: { emoji: '🧘', label: 'Stretch' }, walk: { emoji: '🚶', label: 'Walk' },
  eyes: { emoji: '👀', label: 'Eyes' }, medicine: { emoji: '💊', label: 'Medicine' }, call: { emoji: '📞', label: 'Call' },
  breathe: { emoji: '🌿', label: 'Breathe' }
};
export type Builtin = 'water' | 'lunch' | 'tea' | 'dinner' | 'travel_daylight' | 'travel_coffee';
export type Schedule = { type: 'time'; time: string; days: number[] } | { type: 'interval'; minutes: number };
export interface Reminder { id: number; builtin: Builtin | null; name: string; message: string; animation: Animation; schedule: Schedule; breakSec: number; enabled: boolean; }
export type ReminderInput = Pick<Reminder, 'name' | 'message' | 'animation' | 'schedule' | 'breakSec'> & { id?: number };
export interface ReminderState { lastFiredDate: string | null; lastFiredAt: number | null; lastDoneAt: number | null; }
export const LIMITS = { name: 40, message: 120, custom: 20, intervalMin: 15, intervalMax: 240, breakMin: 15, breakMax: 3600 } as const;
/** Break-length choices for the editor, seconds (0 = no break). */
export const BREAK_OPTIONS = [0, 15, 30, 60, 120, 300, 600, 900, 1200, 1800, 2700, 3600];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

export function validateReminder(r: ReminderInput): string | null {
  const name = r.name.trim();
  if (!name) return 'Give it a name.';
  if (name.length > LIMITS.name) return 'Name is too long (40 characters max).';
  if (r.message.length > LIMITS.message) return 'Message is too long (120 characters max).';
  if (!(ANIMATIONS as readonly string[]).includes(r.animation)) return 'Choose an animation.';
  if (r.schedule.type === 'time') {
    if (!TIME.test(r.schedule.time)) return 'Pick a time.';
    if (!r.schedule.days.length || r.schedule.days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) return 'Pick at least one day.';
  } else if (!Number.isInteger(r.schedule.minutes) || r.schedule.minutes < LIMITS.intervalMin || r.schedule.minutes > LIMITS.intervalMax) {
    return 'Choose every 15 to 240 minutes.';
  }
  if (!Number.isInteger(r.breakSec) || (r.breakSec !== 0 && (r.breakSec < LIMITS.breakMin || r.breakSec > LIMITS.breakMax))) {
    return 'Break length must be 15 seconds to 60 minutes, or no break.';
  }
  return null;
}

export function builtinDefaults(workdays: number[]): Omit<Reminder, 'id'>[] {
  const days = workdays.length ? [...workdays].sort() : [1, 2, 3, 4, 5];
  return [
    { builtin: 'water', name: 'Water', message: 'A few big sips. Your focus will thank you.', animation: 'water', schedule: { type: 'interval', minutes: 60 }, breakSec: 30, enabled: true },
    { builtin: 'lunch', name: 'Lunch', message: 'Step away from the screen and enjoy it.', animation: 'meal', schedule: { type: 'time', time: '13:00', days }, breakSec: 1800, enabled: true },
    { builtin: 'tea', name: 'Tea break', message: 'Put the kettle on, stretch your legs, look out of a window.', animation: 'tea', schedule: { type: 'time', time: '16:00', days }, breakSec: 900, enabled: true },
    { builtin: 'dinner', name: 'Dinner', message: 'Time to eat. Screens can wait.', animation: 'dinner', schedule: { type: 'time', time: '19:30', days: ALL_DAYS }, breakSec: 1800, enabled: false }
  ];
}

const TITLES: Record<Builtin, string> = {
  water: 'Time for some water 💧', lunch: 'Lunch time 🍱', tea: 'Tea break ☕', dinner: 'Dinner time 🍽️',
  travel_daylight: 'Get some daylight ☀️', travel_coffee: 'Last coffee for today ☕'
};
export const reminderTitle = (r: Reminder): string => (r.builtin ? TITLES[r.builtin] : `${r.name.trim()} ${ANIMATION_LOOK[r.animation].emoji}`);

const DAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export function clock12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}
function daysText(days: number[]): string {
  const s = [...new Set(days)].sort();
  if (s.length === 7) return 'every day';
  if (s.join() === '1,2,3,4,5') return 'Mon–Fri';
  if (s.join() === '6,7') return 'weekends';
  return s.map((d) => DAY[d]).join(', ');
}
export function reminderSummary(r: Reminder): string {
  return r.schedule.type === 'interval'
    ? `Every ${r.schedule.minutes} min of screen time`
    : `${clock12(r.schedule.time)} · ${daysText(r.schedule.days)}`;
}
/** Local weekday of a timestamp, 1 = Monday … 7 = Sunday. */
export const localDayOf = (ms: number): number => ((new Date(ms).getDay() + 6) % 7) + 1;
```
Run the shared tests — PASS.

- [ ] **Step 3: Failing store tests**

`main/reminders/store.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { REMINDERS_SQL, createReminderStore } from './store';
import type { ReminderInput } from '../../shared/reminders';

let db: Database.Database;
const at = (h: number, m = 0) => new Date(2026, 8, 30, h, m).getTime(); // Wed 30 Sep 2026, local
const vit: ReminderInput = { name: 'Vitamins', message: '', animation: 'medicine', schedule: { type: 'time', time: '09:00', days: [1, 2, 3, 4, 5, 6, 7] }, breakSec: 0 };

describe('reminder store', () => {
  beforeEach(() => { db = new Database(':memory:'); db.exec(REMINDERS_SQL); });

  it('seeds the built-ins once (idempotent), using the given workdays', () => {
    const s = createReminderStore(db);
    s.seed([1, 2, 3]); s.seed([1, 2, 3, 4, 5]);
    const list = s.list();
    expect(list.map((r) => r.builtin)).toEqual(['water', 'lunch', 'tea', 'dinner']);
    expect(list[1].schedule).toEqual({ type: 'time', time: '13:00', days: [1, 2, 3] });
  });

  it('creates, updates, enables and deletes a custom reminder; built-ins cannot be deleted', () => {
    const s = createReminderStore(db); s.seed([1, 2, 3, 4, 5]);
    const r = s.save(vit, at(8));
    expect(s.list().at(-1)).toMatchObject({ id: r.id, builtin: null, name: 'Vitamins', enabled: true });
    s.save({ ...vit, id: r.id, name: 'Vitamin D' }, at(8));
    expect(s.get(r.id)?.name).toBe('Vitamin D');
    s.setEnabled(r.id, false);
    expect(s.get(r.id)?.enabled).toBe(false);
    expect(s.remove(r.id)).toBe(true);
    expect(s.remove(s.list()[0].id)).toBe(false);
  });

  it('rejects invalid input and more than 20 custom reminders', () => {
    const s = createReminderStore(db);
    expect(() => s.save({ ...vit, name: '' }, at(8))).toThrow('Give it a name.');
    for (let i = 0; i < 20; i++) s.save({ ...vit, name: `r${i}` }, at(8));
    expect(() => s.save(vit, at(8))).toThrow('You can have up to 20 reminders of your own.');
  });

  it('saving a time that already passed today starts it next time (no instant pop-up)', () => {
    const s = createReminderStore(db);
    const r = s.save(vit, at(10)); // 09:00 already passed at 10:00
    expect(s.states().get(r.id)?.lastFiredDate).toBe('2026-09-30');
    const r2 = s.save({ ...vit, name: 'later', schedule: { type: 'time', time: '11:00', days: [3] } }, at(10));
    expect(s.states().get(r2.id)?.lastFiredDate ?? null).toBeNull();
  });

  it('reset restores a built-in to its defaults; state marks work; clearState wipes state only', () => {
    const s = createReminderStore(db); s.seed([1, 2, 3, 4, 5]);
    const lunch = s.list()[1];
    s.save({ ...lunch, schedule: { type: 'time', time: '12:15', days: [1] } }, at(8));
    s.reset('lunch', [1, 2, 3, 4, 5]);
    expect(s.get(lunch.id)?.schedule).toEqual({ type: 'time', time: '13:00', days: [1, 2, 3, 4, 5] });
    s.markShown(lunch.id, at(13), '2026-09-30'); s.markDone(lunch.id, at(13, 30));
    expect(s.states().get(lunch.id)).toEqual({ lastFiredDate: '2026-09-30', lastFiredAt: at(13), lastDoneAt: at(13, 30) });
    s.markFired(-1, '2026-09-30'); // travel reminders (negative ids) keep state too
    expect(s.states().get(-1)?.lastFiredDate).toBe('2026-09-30');
    s.clearState();
    expect(s.states().size).toBe(0);
    expect(s.list()).toHaveLength(4);
  });
});
```
Run — FAIL.

- [ ] **Step 4: Implement `main/reminders/store.ts`**

```ts
import type Database from 'better-sqlite3';
import { localDate } from '@worksight/core/date';
import { LIMITS, builtinDefaults, validateReminder, type Builtin, type Reminder, type ReminderInput, type ReminderState, type Schedule } from '../../shared/reminders';

export const REMINDERS_SQL = `
CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT, builtin TEXT UNIQUE, name TEXT NOT NULL, message TEXT NOT NULL DEFAULT '',
  animation TEXT NOT NULL, schedule_type TEXT NOT NULL CHECK (schedule_type IN ('time','interval')),
  time TEXT, days TEXT, interval_min INTEGER, break_sec INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reminder_state (
  reminder_id INTEGER PRIMARY KEY, last_fired_date TEXT, last_fired_at INTEGER, last_done_at INTEGER
);
`;

type Row = { id: number; builtin: string | null; name: string; message: string; animation: string; schedule_type: string; time: string | null; days: string | null; interval_min: number | null; break_sec: number; enabled: number };
const toReminder = (r: Row): Reminder => ({
  id: r.id, builtin: r.builtin as Builtin | null, name: r.name, message: r.message, animation: r.animation as Reminder['animation'],
  schedule: r.schedule_type === 'time' ? { type: 'time', time: r.time ?? '12:00', days: JSON.parse(r.days ?? '[]') as number[] } : { type: 'interval', minutes: r.interval_min ?? 60 },
  breakSec: r.break_sec, enabled: r.enabled === 1
});
const cols = (s: Schedule) => (s.type === 'time'
  ? { schedule_type: 'time', time: s.time, days: JSON.stringify([...new Set(s.days)].sort()), interval_min: null }
  : { schedule_type: 'interval', time: null, days: null, interval_min: s.minutes });
const pastToday = (s: Schedule, now: number): boolean => {
  if (s.type !== 'time') return false;
  const [h, m] = s.time.split(':').map(Number);
  const t = new Date(now); t.setHours(h, m, 0, 0);
  return t.getTime() <= now;
};

export type ReminderStore = ReturnType<typeof createReminderStore>;

export function createReminderStore(db: Database.Database) {
  const all = db.prepare('SELECT * FROM reminders ORDER BY (builtin IS NULL), id');
  const one = db.prepare('SELECT * FROM reminders WHERE id = ?');
  const ins = db.prepare(`INSERT INTO reminders (builtin, name, message, animation, schedule_type, time, days, interval_min, break_sec, enabled, created_at)
    VALUES (@builtin, @name, @message, @animation, @schedule_type, @time, @days, @interval_min, @break_sec, @enabled, @created_at)`);
  const seedIns = db.prepare(`INSERT OR IGNORE INTO reminders (builtin, name, message, animation, schedule_type, time, days, interval_min, break_sec, enabled, created_at)
    VALUES (@builtin, @name, @message, @animation, @schedule_type, @time, @days, @interval_min, @break_sec, @enabled, @created_at)`);
  const upd = db.prepare(`UPDATE reminders SET name=@name, message=@message, animation=@animation, schedule_type=@schedule_type, time=@time, days=@days,
    interval_min=@interval_min, break_sec=@break_sec WHERE id=@id`);
  const customCount = db.prepare('SELECT count(*) AS n FROM reminders WHERE builtin IS NULL');
  const state = db.prepare(`INSERT INTO reminder_state (reminder_id, last_fired_date, last_fired_at, last_done_at) VALUES (?, NULL, NULL, NULL)
    ON CONFLICT(reminder_id) DO NOTHING`);
  const setFiredDate = db.prepare('UPDATE reminder_state SET last_fired_date = ? WHERE reminder_id = ?');
  const setShown = db.prepare('UPDATE reminder_state SET last_fired_date = ?, last_fired_at = ? WHERE reminder_id = ?');
  const setDone = db.prepare('UPDATE reminder_state SET last_done_at = ? WHERE reminder_id = ?');
  const allState = db.prepare('SELECT reminder_id AS id, last_fired_date AS lastFiredDate, last_fired_at AS lastFiredAt, last_done_at AS lastDoneAt FROM reminder_state');
  const ensure = (id: number): void => { state.run(id); };
  // Only the columns each statement uses (better-sqlite3 rejects unknown named parameters).
  const fields = (r: Pick<Reminder, 'name' | 'message' | 'animation' | 'schedule' | 'breakSec'>) => ({ name: r.name.trim(), message: r.message.trim(), animation: r.animation, ...cols(r.schedule), break_sec: r.breakSec });
  const row = (r: Omit<Reminder, 'id'>, now: number) => ({ builtin: r.builtin, ...fields(r), enabled: r.enabled ? 1 : 0, created_at: now });

  const store = {
    seed(workdays: number[]): void { for (const d of builtinDefaults(workdays)) seedIns.run(row(d, Date.now())); },
    list: (): Reminder[] => (all.all() as Row[]).map(toReminder),
    get: (id: number): Reminder | null => { const r = one.get(id) as Row | undefined; return r ? toReminder(r) : null; },
    /** Insert (no id) or update; throws a user-facing message when invalid. A time already past today starts next time. */
    save(input: ReminderInput, now: number): Reminder {
      const err = validateReminder(input);
      if (err) throw new Error(err);
      let id = input.id;
      if (id === undefined) {
        if ((customCount.get() as { n: number }).n >= LIMITS.custom) throw new Error('You can have up to 20 reminders of your own.');
        id = Number(ins.run(row({ ...input, builtin: null, enabled: true }, now)).lastInsertRowid);
      } else {
        const cur = store.get(id);
        if (!cur) throw new Error('That reminder no longer exists.');
        upd.run({ ...fields({ ...cur, ...input }), id });
      }
      ensure(id);
      if (pastToday(input.schedule, now)) setFiredDate.run(localDate(now), id);
      return store.get(id) as Reminder;
    },
    remove(id: number): boolean {
      const r = store.get(id);
      if (!r || r.builtin) return false;
      db.prepare('DELETE FROM reminders WHERE id = ?').run(id);
      db.prepare('DELETE FROM reminder_state WHERE reminder_id = ?').run(id);
      return true;
    },
    reset(builtin: Builtin, workdays: number[]): void {
      const d = builtinDefaults(workdays).find((x) => x.builtin === builtin);
      const cur = store.list().find((r) => r.builtin === builtin);
      if (!d || !cur) return;
      upd.run({ ...fields(d), id: cur.id });
      db.prepare('UPDATE reminders SET enabled = ? WHERE id = ?').run(d.enabled ? 1 : 0, cur.id);
    },
    setEnabled(id: number, on: boolean): void { db.prepare('UPDATE reminders SET enabled = ? WHERE id = ?').run(on ? 1 : 0, id); },
    states(): Map<number, ReminderState> {
      return new Map((allState.all() as (ReminderState & { id: number })[]).map(({ id, ...s }) => [id, s]));
    },
    markFired(id: number, date: string): void { ensure(id); setFiredDate.run(date, id); },
    markShown(id: number, at: number, date: string): void { ensure(id); setShown.run(date, at, id); },
    markDone(id: number, at: number): void { ensure(id); setDone.run(at, id); },
    clearState(): void { db.exec('DELETE FROM reminder_state'); }
  };
  return store;
}
```
Run — PASS.

- [ ] **Step 5: Delete-my-activity clears reminder state and zone history**

`screen/store.ts` `deleteActivity`, inside the transaction add:
```ts
    if (hasTable(db, 'reminder_state')) db.exec('DELETE FROM reminder_state;'); // timers restart; the reminders themselves stay
    if (hasTable(db, 'tz_changes')) db.exec('DELETE FROM tz_changes;');         // where you travelled is activity history too
```
Add a case to the existing `deleteActivity` test (screen store test) that creates both tables, inserts a row each, and asserts they're empty after.

- [ ] **Step 6: Full suite, typecheck, commit**

```bash
git add apps/consumer/src/shared/reminders.ts apps/consumer/src/shared/reminders.test.ts apps/consumer/src/main/reminders apps/consumer/src/main/screen/store.ts apps/consumer/src/main/screen/store.test.ts
git commit -m "feat(consumer): reminder model, validation, built-ins and SQLite store"
```

---

### Task 3: Reminder planner (which reminder is due)

**Files:**
- Create: `apps/consumer/src/main/reminders/schedule.ts`, `apps/consumer/src/main/reminders/schedule.test.ts`

**Interfaces:**
- Consumes: `Reminder`, `ReminderState`, `localDayOf` (Task 2); `ActivitySampleRow` (`@worksight/core/types`); `restPeriods`, `atLeast`, `isActiveSample` (`main/day/time.ts`).
- Produces: `CLOCK_WINDOW_MS = 3_600_000`; `interface DueReminder { reminder: Reminder; slot: string }`; `planReminders(i: { reminders: Reminder[]; states: Map<number, ReminderState>; now: number; samples: ActivitySampleRow[]; waterIntervalMin?: number }): { due: DueReminder | null; skipped: { id: number; date: string }[] }`.

- [ ] **Step 1: Failing tests**

`schedule.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import type { ActivitySampleRow } from '@worksight/core/types';
import { planReminders } from './schedule';
import { builtinDefaults, type Reminder, type ReminderState } from '../../shared/reminders';

const at = (h: number, m = 0, d = 30) => new Date(2026, 8, d, h, m).getTime(); // Wed 30 Sep 2026
const [water, lunch, tea] = builtinDefaults([1, 2, 3, 4, 5]).map((r, i) => ({ ...r, id: i + 1 })) as Reminder[];
/** One active 60-s bucket per minute over [from, to). */
const active = (from: number, to: number): ActivitySampleRow[] =>
  Array.from({ length: Math.round((to - from) / 60_000) }, (_, i) => ({ id: i, bucketStart: from + i * 60_000, bucketEnd: from + (i + 1) * 60_000, active: 1, date: '2026-09-30' } as unknown as ActivitySampleRow));
const st = (o: Partial<ReminderState> = {}): ReminderState => ({ lastFiredDate: null, lastFiredAt: null, lastDoneAt: null, ...o });
const plan = (reminders: Reminder[], now: number, samples: ActivitySampleRow[], states = new Map<number, ReminderState>(), waterIntervalMin?: number) =>
  planReminders({ reminders, states, now, samples, waterIntervalMin });

describe('clock-time reminders', () => {
  it('are due from their time for 60 minutes, on their days, once per local day', () => {
    const s = active(at(12, 30), at(13, 5));
    expect(plan([lunch], at(12, 59), s).due).toBeNull();
    expect(plan([lunch], at(13, 1), s).due).toEqual({ reminder: lunch, slot: '2026-09-30' });
    expect(plan([lunch], at(14, 1), active(at(12, 30), at(14, 1))).due).toBeNull();                       // window over
    expect(plan([lunch], at(13, 1), s, new Map([[lunch.id, st({ lastFiredDate: '2026-09-30' })]])).due).toBeNull(); // already fired today
    expect(plan([lunch], at(13, 1, 26), active(at(12, 30, 26), at(13, 1, 26))).due).toBeNull();          // Saturday: not a workday
  });
  it('are skipped (marked fired) when there was no input around their time — away, asleep', () => {
    const r = plan([lunch], at(13, 30), active(at(13, 25), at(13, 30))); // woke at 13:25
    expect(r.due).toBeNull();
    expect(r.skipped).toEqual([{ id: lunch.id, date: '2026-09-30' }]);
  });
  it('a disabled reminder is never due', () => {
    expect(plan([{ ...lunch, enabled: false }], at(13, 1), active(at(12, 30), at(13, 1))).due).toBeNull();
  });
  it('fired-date uses the current local date (a repeated local date after a zone change is a new day only if the date differs)', () => {
    const states = new Map([[lunch.id, st({ lastFiredDate: '2026-09-29' })]]);
    expect(plan([lunch], at(13, 1), active(at(12, 30), at(13, 1)), states).due?.slot).toBe('2026-09-30');
  });
});

describe('interval reminders', () => {
  it('are due after N minutes of active screen time since the day started', () => {
    expect(plan([water], at(9, 59), active(at(9), at(9, 59))).due).toBeNull();
    expect(plan([water], at(10, 0), active(at(9), at(10))).due?.reminder.id).toBe(water.id);
  });
  it('count from the last "I had some"/done or the last time it was shown', () => {
    const s = active(at(9), at(10, 30));
    expect(plan([water], at(10, 30), s, new Map([[water.id, st({ lastDoneAt: at(10) })]])).due).toBeNull();
    expect(plan([water], at(10, 30), s, new Map([[water.id, st({ lastFiredAt: at(9, 45) })]])).due).toBeNull();
    expect(plan([water], at(11, 0), active(at(9), at(11)), new Map([[water.id, st({ lastDoneAt: at(10) })]])).due?.slot).toBe(String(at(10)));
  });
  it('restart after 10+ minutes away (idle or asleep)', () => {
    const s = [...active(at(9), at(9, 50)), ...active(at(10, 5), at(10, 40))]; // 15-min gap
    expect(plan([water], at(10, 40), s).due).toBeNull();                         // only 35 min since the gap
  });
  it('use the travel override for water', () => {
    expect(plan([water], at(9, 45), active(at(9), at(9, 45)), undefined, 45).due?.reminder.id).toBe(water.id);
  });
});

describe('choosing one', () => {
  it('prefers a clock-time reminder over an interval one, and the earliest clock time', () => {
    const s = active(at(12), at(16, 1));
    const r = plan([water, tea, lunch], at(16, 1), s, new Map([[lunch.id, st({ lastFiredDate: null })]]));
    expect(r.due?.reminder.id).toBe(tea.id); // lunch's window (13:00–14:00) is over; tea is due; water too, but clock wins
  });
});
```
Run — FAIL.

- [ ] **Step 2: Implement `schedule.ts`**

```ts
import type { ActivitySampleRow } from '@worksight/core/types';
import { localDate } from '@worksight/core/date';
import { atLeast, isActiveSample, restPeriods } from '../day/time';
import { localDayOf, type Reminder, type ReminderState } from '../../shared/reminders';

export const CLOCK_WINDOW_MS = 60 * 60_000;
const PRESENT_BEFORE_MS = 5 * 60_000, PRESENT_AFTER_MS = 60_000, AWAY_RESET_MS = 10 * 60_000;
export interface DueReminder { reminder: Reminder; slot: string; }

const localTime = (now: number, hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  const t = new Date(now); t.setHours(h, m, 0, 0);
  return t.getTime();
};

/** Which reminder (at most one) should pop up now, plus clock reminders to mark as skipped because the user was
 * away at their time. Pure: the caller writes `skipped` to the store. `samples` = today's activity buckets. */
export function planReminders(i: {
  reminders: Reminder[]; states: Map<number, ReminderState>; now: number; samples: ActivitySampleRow[]; waterIntervalMin?: number;
}): { due: DueReminder | null; skipped: { id: number; date: string }[] } {
  const today = localDate(i.now), dow = localDayOf(i.now);
  const skipped: { id: number; date: string }[] = [];
  const clockDue: { r: Reminder; t: number }[] = [];
  const intervalDue: { r: Reminder; over: number; from: number }[] = [];
  const dayStart = new Date(i.now); dayStart.setHours(0, 0, 0, 0);
  const longRests = atLeast(restPeriods(i.samples), AWAY_RESET_MS);
  const lastRestEnd = longRests.length ? longRests[longRests.length - 1].end : 0;

  for (const r of i.reminders) {
    if (!r.enabled) continue;
    const s = i.states.get(r.id);
    if (r.schedule.type === 'time') {
      if (!r.schedule.days.includes(dow) || s?.lastFiredDate === today) continue;
      const t = localTime(i.now, r.schedule.time);
      if (i.now < t || i.now >= t + CLOCK_WINDOW_MS) continue;
      const present = i.samples.some((x) => isActiveSample(x) && x.bucketEnd >= t - PRESENT_BEFORE_MS && x.bucketStart <= t + PRESENT_AFTER_MS);
      if (!present) { skipped.push({ id: r.id, date: today }); continue; }
      clockDue.push({ r, t });
    } else {
      const minutes = r.builtin === 'water' && i.waterIntervalMin ? i.waterIntervalMin : r.schedule.minutes;
      const from = Math.max(dayStart.getTime(), s?.lastDoneAt ?? 0, s?.lastFiredAt ?? 0, lastRestEnd);
      const activeMs = i.samples.filter((x) => isActiveSample(x) && x.bucketStart >= from).reduce((a, x) => a + (x.bucketEnd - x.bucketStart), 0);
      if (activeMs >= minutes * 60_000) intervalDue.push({ r, over: activeMs / (minutes * 60_000), from });
    }
  }
  clockDue.sort((a, b) => a.t - b.t);
  intervalDue.sort((a, b) => b.over - a.over);
  const due = clockDue.length ? { reminder: clockDue[0].r, slot: today }
    : intervalDue.length ? { reminder: intervalDue[0].r, slot: String(intervalDue[0].from) } : null;
  return { due, skipped };
}
```
Run — PASS. (If `ActivitySampleRow` requires more fields, extend the `active()` fixture cast; the planner only reads `bucketStart`, `bucketEnd`, `active`.)

- [ ] **Step 3: Commit**

```bash
git add apps/consumer/src/main/reminders/schedule.ts apps/consumer/src/main/reminders/schedule.test.ts
git commit -m "feat(consumer): reminder planner — clock windows, away skip, screen-time intervals"
```

---

### Task 4: Animated break screens

**Files:**
- Create: `apps/consumer/src/shared/scenes.ts`, `apps/consumer/src/shared/scenes.css`, `apps/consumer/src/shared/scenes.test.ts`
- Modify: `apps/consumer/src/main/windows/breakOverlay.ts` (+ `breakOverlay.test.ts`), `apps/consumer/src/preload/break.ts`, `apps/consumer/src/break/main.ts`, `apps/consumer/src/break/break.css`, `apps/consumer/break.html`, `apps/consumer/src/main/coach/store.ts` (`recordBreak` kind → `string`), `apps/consumer/src/main/index.ts` (overlay call sites only: `overlay.start(PRESETS.eye)` / `PRESETS.stretch`)

**Interfaces:**
- Consumes: `Animation`, `ANIMATIONS` (Task 2).
- Produces: `SCENES: Record<Animation, string>` (static SVG markup); `interface BreakSpec { label: string; animation: Animation; seconds: number; title: string; text: string; doneLabel?: string; reminderId?: number }`; `PRESETS: { eye: BreakSpec; stretch: BreakSpec }`; `LONG_BREAK_S = 300`; overlay `start(spec: BreakSpec): boolean`, `onDone(r: { spec: BreakSpec; seconds: number; completed: boolean })`; `break:start` payload `{ animation, seconds, title, text, long, doneLabel? }`.

- [ ] **Step 1: Scenes — failing test**

`shared/scenes.test.ts`:
```ts
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
```
Run — FAIL.

- [ ] **Step 2: `shared/scenes.ts`** (water/meal/tea are the approved prototypes verbatim; the other seven follow the same style — render them in Step 8's check and nudge coordinates if anything looks off)

```ts
import type { Animation } from './reminders';

const svg = (body: string): string => `<svg class="dl-scene-svg" viewBox="0 0 120 120" aria-hidden="true">${body}</svg>`;
const STEAM = (xs: number[], y: number) => xs.map((x, i) => `<path class="sc-ink sc-steam sc-s${i + 1}" d="M${x},${y} q-5,-6 0,-12 t0,-12"/>`).join('');
const BOTTLE = 'M51,24 h18 q0,5 7,9 q9,6 9,17 v48 q0,9 -9,9 h-32 q-9,0 -9,-9 v-48 q0,-11 9,-17 q7,-4 7,-9 z';
const EYE = 'M14,70 q36,-34 72,0 q-36,34 -72,0 z';
const PALM = 'M20,92 q0,-10 12,-10 h26 q10,0 10,8 q0,10 -12,12 h-24 q-12,0 -12,-10 z';
const PHONE = 'M40,40 q-6,4 -4,14 q6,26 30,32 q10,2 14,-4 l-10,-10 q-4,2 -8,0 q-10,-6 -14,-16 q-1,-4 1,-8 z';

export const SCENES: Record<Animation, string> = {
  water: svg(`<defs><clipPath id="sc-bottle"><path d="${BOTTLE}"/></clipPath></defs>
    <g clip-path="url(#sc-bottle)"><g class="sc-fill"><rect x="20" y="52" width="90" height="70" fill="#CFE6FB"/>
    <path class="sc-wave" d="M20,52 q6,-4 12,0 t12,0 t12,0 t12,0 t12,0 t12,0 t12,0" fill="#CFE6FB" stroke="#8EC3EE" stroke-width="2"/>
    <circle class="sc-bub" cx="52" cy="98" r="2.6" fill="#fff"/><circle class="sc-bub" cx="64" cy="102" r="2" fill="#fff"/><circle class="sc-bub" cx="58" cy="100" r="3" fill="#fff"/></g></g>
    <path class="sc-ink" d="${BOTTLE}"/><rect x="49" y="13" width="22" height="10" rx="3" fill="#171717"/>
    <path class="sc-ink" d="M44,62 q-2,10 0,22" stroke="#fff" stroke-width="3" opacity=".8"/>`),
  meal: svg(`${STEAM([44, 60, 76], 48)}
    <path d="M16,62 h88 q-4,36 -44,36 q-40,0 -44,-36 z" fill="#F9DDB9"/>
    <path class="sc-ink" d="M30,62 q5,-7 10,0 t10,0 t10,0 t10,0 t10,0 t10,0" stroke="#E0A458"/>
    <path class="sc-ink" d="M16,62 h88 q-4,36 -44,36 q-40,0 -44,-36 z"/><path class="sc-ink" d="M42,98 h36"/>
    <g class="sc-chop"><path class="sc-ink" d="M84,26 L54,60" stroke-width="4"/><path class="sc-ink" d="M92,30 L60,62" stroke-width="4"/></g>`),
  tea: svg(`${STEAM([46, 58], 42)}
    <ellipse cx="56" cy="98" rx="40" ry="6" fill="#E9E3DD"/><path class="sc-ink" d="M18,98 q38,10 76,0"/>
    <path d="M28,52 h56 v16 q0,24 -28,24 q-28,0 -28,-24 z" fill="#BFEBD3"/><path class="sc-ink" d="M28,52 h56 v16 q0,24 -28,24 q-28,0 -28,-24 z"/>
    <path class="sc-ink" d="M84,58 q14,0 14,11 q0,11 -14,11"/>
    <g class="sc-bag"><path class="sc-ink" d="M62,50 L70,26" stroke-width="2"/><rect x="65" y="16" width="12" height="11" rx="2" fill="#F4C6C8" stroke="#171717" stroke-width="2.4"/></g>`),
  dinner: svg(`${STEAM([52, 66], 52)}
    <ellipse cx="60" cy="78" rx="40" ry="14" fill="#E9E3DD"/><ellipse class="sc-ink" cx="60" cy="78" rx="40" ry="14"/>
    <ellipse cx="60" cy="76" rx="22" ry="7" fill="#F4C6C8"/><path class="sc-ink" d="M50,74 q10,-6 20,0" stroke="#D98C90"/>
    <g class="sc-fork"><path class="sc-ink" d="M10,58 v34"/><path class="sc-ink" d="M5,58 v10 q5,7 10,0 v-10"/></g>
    <g class="sc-knife"><path class="sc-ink" d="M110,58 v34"/><path d="M110,58 q-8,7 0,18 z" fill="#171717"/></g>`),
  stretch: svg(`<path class="sc-ink" d="M30,102 h60" stroke="#BFEBD3" stroke-width="5"/>
    <g class="sc-body"><circle class="sc-ink" cx="60" cy="30" r="8" fill="#F9DDB9"/><path class="sc-ink" d="M60,38 v34"/>
    <g class="sc-arm-l"><path class="sc-ink" d="M60,46 l-20,-14"/></g><g class="sc-arm-r"><path class="sc-ink" d="M60,46 l20,-14"/></g></g>
    <path class="sc-ink" d="M60,72 l-12,28 M60,72 l12,28"/>`),
  walk: svg(`<g class="sc-ground"><path class="sc-ink" d="M0,98 q10,-4 20,0 t20,0 t20,0 t20,0 t20,0 t20,0 t20,0 t20,0" stroke="#D8D2FC" stroke-width="4"/></g>
    <g class="sc-walker"><circle class="sc-ink" cx="60" cy="28" r="8" fill="#BFEBD3"/><path class="sc-ink" d="M60,36 l-2,30"/>
    <g class="sc-leg-a"><path class="sc-ink" d="M58,66 l-8,26"/></g><g class="sc-leg-b"><path class="sc-ink" d="M58,66 l8,26"/></g>
    <g class="sc-arm-a"><path class="sc-ink" d="M59,44 l-10,16"/></g><g class="sc-arm-b"><path class="sc-ink" d="M59,44 l10,16"/></g></g>`),
  eyes: svg(`<defs><clipPath id="sc-eye"><path d="${EYE}"/></clipPath></defs>
    <circle cx="98" cy="30" r="9" fill="#F6B35E"/><path class="sc-ink" d="M84,40 h28" stroke="#C9BFB6"/>
    <path d="${EYE}" fill="#fff"/>
    <g clip-path="url(#sc-eye)"><g class="sc-iris"><circle cx="50" cy="70" r="12" fill="#CFE6FB"/><circle cx="50" cy="70" r="5.5" fill="#171717"/></g>
    <rect class="sc-lid" x="10" y="34" width="80" height="38" fill="#F2EBE6"/></g>
    <path class="sc-ink" d="${EYE}"/>`),
  medicine: svg(`<path d="M88,60 h20 l-3,40 h-14 z" fill="#CFE6FB"/><path class="sc-ink" d="M88,52 h20 l-3,48 h-14 z"/>
    <path d="${PALM}" fill="#F9DDB9"/><path class="sc-ink" d="${PALM}"/>
    <g class="sc-pill"><rect x="36" y="30" width="24" height="11" rx="5.5" fill="#fff"/><path d="M48,30 h6.5 a5.5,5.5 0 0 1 0,11 h-6.5 z" fill="#F4C6C8"/>
    <rect class="sc-ink" x="36" y="30" width="24" height="11" rx="5.5"/></g>`),
  call: svg(`<g class="sc-phone"><path d="${PHONE}" fill="#D8D2FC"/><path class="sc-ink" d="${PHONE}"/></g>
    <path class="sc-ink sc-ring" d="M74,38 q8,8 8,18"/><path class="sc-ink sc-ring sc-r2" d="M80,28 q14,12 14,30"/>`),
  breathe: svg(`<circle class="sc-breathe" cx="60" cy="60" r="38" fill="#BFEBD3"/>
    <circle class="sc-ink" cx="60" cy="60" r="38" stroke="#9ADBB9" opacity=".6"/>`)
};
```
Run the scenes test — PASS.

- [ ] **Step 3: `shared/scenes.css`**

```css
/* Break-scene animations (shared by the break screen and the reminder editor gallery). Hand-drawn: ink strokes, app
   pastels. --sc-dur (set by the break screen) paces the water fill to the break's length. */
.dl-scene-svg { width: 100%; height: 100%; overflow: visible; }
.dl-scene-svg * { transform-box: view-box; }
.sc-ink { fill: none; stroke: #171717; stroke-width: 3.2; stroke-linecap: round; stroke-linejoin: round; }
.sc-fill { animation: sc-rise var(--sc-dur, 12s) ease-in-out infinite; }
@keyframes sc-rise { 0% { transform: translateY(62px); } 70%, 100% { transform: translateY(0); } }
.sc-wave { animation: sc-wave 2.4s linear infinite; }
@keyframes sc-wave { to { transform: translateX(-24px); } }
.sc-bub { opacity: 0; animation: sc-bub 3s ease-in infinite; }
.sc-bub:nth-of-type(2) { animation-delay: 1s; } .sc-bub:nth-of-type(3) { animation-delay: 2s; }
@keyframes sc-bub { 0% { transform: translateY(0); opacity: 0; } 20% { opacity: .9; } 100% { transform: translateY(-46px); opacity: 0; } }
.sc-steam { stroke-dasharray: 60; opacity: 0; animation: sc-steam 3.6s ease-in-out infinite; }
.sc-s2 { animation-delay: 1.2s; } .sc-s3 { animation-delay: 2.4s; }
@keyframes sc-steam { 0% { stroke-dashoffset: 60; transform: translateY(6px); opacity: 0; } 30% { opacity: .85; } 60% { stroke-dashoffset: 0; } 100% { transform: translateY(-10px); opacity: 0; } }
.sc-chop { transform-origin: 84px 26px; animation: sc-chop 2.8s ease-in-out infinite; }
@keyframes sc-chop { 0%, 100% { transform: rotate(0); } 50% { transform: rotate(-7deg) translateY(-3px); } }
.sc-bag { transform-origin: 62px 50px; animation: sc-sway 3s ease-in-out infinite; }
@keyframes sc-sway { 0%, 100% { transform: rotate(-6deg); } 50% { transform: rotate(8deg); } }
.sc-fork { transform-origin: 10px 92px; animation: sc-sway 3.4s ease-in-out infinite; }
.sc-knife { transform-origin: 110px 92px; animation: sc-sway 3.4s ease-in-out infinite reverse; }
.sc-body { transform-origin: 60px 100px; animation: sc-lean 6s ease-in-out infinite; }
@keyframes sc-lean { 0%, 100% { transform: rotate(0); } 25% { transform: rotate(-8deg); } 75% { transform: rotate(8deg); } }
.sc-arm-l { transform-origin: 60px 46px; animation: sc-arm-l 6s ease-in-out infinite; }
.sc-arm-r { transform-origin: 60px 46px; animation: sc-arm-r 6s ease-in-out infinite; }
@keyframes sc-arm-l { 0%, 100% { transform: rotate(0); } 50% { transform: rotate(55deg); } }
@keyframes sc-arm-r { 0%, 100% { transform: rotate(0); } 50% { transform: rotate(-55deg); } }
.sc-ground { animation: sc-ground 2s linear infinite; }
@keyframes sc-ground { to { transform: translateX(-40px); } }
.sc-walker { animation: sc-bob 1s ease-in-out infinite; }
@keyframes sc-bob { 50% { transform: translateY(-2px); } }
.sc-leg-a, .sc-leg-b { transform-origin: 58px 66px; animation: sc-swing 1s ease-in-out infinite; }
.sc-leg-b { animation-direction: reverse; }
.sc-arm-a, .sc-arm-b { transform-origin: 59px 44px; animation: sc-swing 1s ease-in-out infinite reverse; }
.sc-arm-b { animation-direction: normal; }
@keyframes sc-swing { 0%, 100% { transform: rotate(-20deg); } 50% { transform: rotate(20deg); } }
.sc-iris { animation: sc-look 6s ease-in-out infinite; }
@keyframes sc-look { 0%, 20%, 100% { transform: translate(0, 0); } 40%, 75% { transform: translate(14px, -6px); } }
.sc-lid { transform-origin: 50px 34px; transform: scaleY(0); animation: sc-blink 6s ease-in-out infinite; }
@keyframes sc-blink { 0%, 86%, 100% { transform: scaleY(0); } 90% { transform: scaleY(1); } }
.sc-pill { transform-origin: 48px 36px; animation: sc-drop 3.6s cubic-bezier(.5, 0, .75, 1) infinite; }
@keyframes sc-drop { 0% { transform: translateY(-6px) rotate(-20deg); opacity: 0; } 15% { opacity: 1; } 60%, 85% { transform: translateY(40px) rotate(10deg); opacity: 1; } 100% { transform: translateY(40px) rotate(10deg); opacity: 0; } }
.sc-phone { transform-origin: 58px 62px; animation: sc-ring 2.4s ease-in-out infinite; }
@keyframes sc-ring { 0%, 40%, 100% { transform: rotate(0); } 5%, 15%, 25%, 35% { transform: rotate(-7deg); } 10%, 20%, 30% { transform: rotate(7deg); } }
.sc-ring { opacity: 0; animation: sc-pulse 2.4s ease-out infinite; }
.sc-r2 { animation-delay: .3s; }
@keyframes sc-pulse { 0% { opacity: 0; } 10%, 40% { opacity: 1; } 60%, 100% { opacity: 0; } }
.sc-breathe { transform-origin: 60px 60px; animation: sc-breathe 8s ease-in-out infinite; }
@keyframes sc-breathe { 0%, 100% { transform: scale(.72); } 50% { transform: scale(1); } }
@media (prefers-reduced-motion: reduce) {
  .dl-scene-svg * { animation: none !important; }
  .sc-fill, .sc-lid { transform: none; } .sc-lid { transform: scaleY(0); }
  .sc-steam, .sc-bub, .sc-ring { opacity: .7; stroke-dashoffset: 0; }
}
```

- [ ] **Step 4: Overlay manager — failing tests first**

In `breakOverlay.test.ts`, replace uses of `start('eye')`/`start('stretch')` with `start(PRESETS.eye)`/`start(PRESETS.stretch)` and `BREAK_SECONDS[...]` with `PRESETS.eye.seconds` etc.; update `onDone` expectations to `{ spec, seconds, completed }`. Add:
```ts
  it('sends the spec to every window, with long = seconds >= 300', () => {
    const t = harness(); // the file's existing fake-window harness
    const spec = { label: 'reminder:2', animation: 'meal' as const, seconds: 1800, title: 'Lunch time 🍱', text: 'Enjoy it.', reminderId: 2 };
    t.overlay.start(spec);
    t.readyAll();
    expect(t.sent[0]).toEqual(['break:start', { animation: 'meal', seconds: 1800, title: 'Lunch time 🍱', text: 'Enjoy it.', long: true }]);
  });
  it('a long break cut short by sleep counts as completed when at least half elapsed (watchdog)', () => {
    vi.useFakeTimers();
    const t = harness();
    const spec = { label: 'reminder:2', animation: 'meal' as const, seconds: 600, title: 'Lunch', text: '' };
    t.overlay.start(spec);
    vi.advanceTimersByTime(600_000 + 15_000 + 1);
    expect(t.done.at(-1)).toMatchObject({ spec, completed: true });
    vi.useRealTimers();
  });
  it('a short break ended by the watchdog is not completed', () => {
    vi.useFakeTimers();
    const t = harness();
    t.overlay.start(PRESETS.eye);
    vi.advanceTimersByTime(20_000 + 15_000 + 1);
    expect(t.done.at(-1)).toMatchObject({ completed: false });
    vi.useRealTimers();
  });
```
(Adapt `harness()`, `readyAll()`, `sent`, `done` to the helpers the existing test file already defines; keep every existing case passing with the new API.) Run — FAIL.

- [ ] **Step 5: Implement the overlay changes**

`breakOverlay.ts`: replace `BREAK_SECONDS`/`BreakKind` with
```ts
import type { Animation } from '../../shared/reminders';

export interface BreakSpec { label: string; animation: Animation; seconds: number; title: string; text: string; doneLabel?: string; reminderId?: number; }
export const LONG_BREAK_S = 300;
export const PRESETS = {
  eye: { label: 'eye', animation: 'eyes', seconds: 20, title: 'Look at something far away', text: 'At least 6 metres, like a window, a wall across the room, or the sky.' },
  stretch: { label: 'stretch', animation: 'stretch', seconds: 120, title: 'Stand up and stretch', text: 'Roll your shoulders, reach up, and take a few slow breaths.' }
} satisfies Record<string, BreakSpec>;
```
In `createBreakOverlay`: `onDone(r: { spec: BreakSpec; seconds: number; completed: boolean })`; state `let spec: BreakSpec | null`; `start(s: BreakSpec)`; the watchdog deadline uses `s.seconds`; the `break:start` payload is `{ animation: s.animation, seconds: s.seconds, title: s.title, text: s.text, long: s.seconds >= LONG_BREAK_S, ...(s.doneLabel ? { doneLabel: s.doneLabel } : {}) }`; the watchdog's `finish` passes `completed = s.seconds >= LONG_BREAK_S && elapsedSeconds() >= s.seconds / 2`; `extend` is ignored for long breaks; `MAX_ALLOWANCE_S` check uses `s.seconds`. Keep every existing guard (single finish, onGone, window-failure cleanup) unchanged.
`coach/store.ts`: `recordBreak(b: { …; kind: string; … })`.
`index.ts`: `overlay.start(PRESETS.eye)` / `overlay.start(PRESETS.stretch)`; `onDone: (r) => { … recordBreak({ …, kind: r.spec.label, seconds: r.seconds, completed: r.completed }) … }` (Task 5 adds the reminder handling here).

- [ ] **Step 6: Preload + break screen**

`preload/break.ts` `onStart` payload type:
```ts
onStart: (cb: (p: { animation: import('../shared/reminders').Animation; seconds: number; title: string; text: string; long: boolean; doneLabel?: string }) => void): void => { ipcRenderer.on('break:start', (_e, p) => cb(p)); },
```
`break.html` `<main>` body:
```html
      <div class="ring">
        <svg class="track" width="230" height="230"><circle cx="115" cy="115" r="110" stroke="rgba(0,0,0,.08)" stroke-width="4" fill="none"/><circle class="p" id="ring" cx="115" cy="115" r="110" stroke="#171717" stroke-width="4" fill="none" stroke-linecap="round"/></svg>
        <div class="scene" id="scene"></div>
      </div>
      <span class="left" id="num">0:20 left</span>
      <span class="hint" id="hint"></span>
      <h3 id="title"></h3>
      <p id="text"></p>
      <div class="btns"><button class="pbtn s" id="skip">Skip</button><button class="pbtn s" id="more">+1 min</button></div>
```
`break.css`: replace the `.breath*` rules with
```css
@import '../shared/scenes.css';
.ring { position: relative; width: 230px; height: 230px; display: grid; place-items: center; }
.ring .track { position: absolute; inset: 0; transform: rotate(-90deg); }
.ring circle.p { stroke-dasharray: 691; stroke-dashoffset: 0; transition: stroke-dashoffset 1s linear; }
.scene { width: 170px; height: 170px; }
.overlay .left { font-size: 13px; font-weight: 600; letter-spacing: .02em; color: #2d6b54; }
```
(keep the rest; the `@import` must be the first rule after the existing font `@import`).
`break/main.ts`:
```ts
import './break.css';
import type { BreakApi } from '../preload/break';
import { SCENES } from '../shared/scenes';

declare global { interface Window { brk: BreakApi } }

const $ = (id: string): HTMLElement => document.getElementById(id)!;
const ring = $('ring') as unknown as SVGCircleElement;
const skip = $('skip') as HTMLButtonElement, more = $('more') as HTMLButtonElement;
let total = 0, left = 0, elapsed = 0, breathe = false, timer: ReturnType<typeof setInterval> | undefined, ended = false;
const fmt = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} left`;

const end = (completed: boolean): void => {
  if (ended) return;
  ended = true;
  clearInterval(timer);
  window.brk.done({ completed, seconds: Math.min(elapsed, 3600) });
};

function tick(): void {
  left--; elapsed++;
  $('num').textContent = fmt(Math.max(0, left));
  ring.style.strokeDashoffset = String(691 * (1 - left / total));
  if (breathe) $('hint').textContent = Math.floor(elapsed / 4) % 2 ? 'Breathe out…' : 'Breathe in…';
  if (left <= 0) {
    clearInterval(timer);
    $('hint').textContent = 'Nice. Welcome back 🌿';
    more.disabled = true;
    setTimeout(() => end(true), 1400);
  }
}

window.brk.onStart(({ animation, seconds, title, text, long, doneLabel }) => {
  total = left = seconds;
  breathe = animation === 'breathe' || animation === 'eyes';
  const scene = $('scene');
  scene.innerHTML = SCENES[animation]; // static markup from shared/scenes.ts, never user input
  scene.style.setProperty('--sc-dur', `${Math.min(seconds, 60)}s`);
  $('title').textContent = title; // reminder names/messages are user text: textContent only
  $('text').textContent = text;
  $('num').textContent = fmt(left);
  if (long) { skip.textContent = "I'm back"; more.hidden = true; skip.onclick = () => end(elapsed >= total / 2); }
  else if (doneLabel) { skip.textContent = doneLabel; skip.onclick = () => end(true); }
  else skip.onclick = () => end(false);
  timer = setInterval(tick, 1000);
});
window.brk.onExtend(() => { left += 60; total += 60; });
more.onclick = () => window.brk.extend();
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') end(false); });
```

- [ ] **Step 7: Full suite, typecheck, `npx electron-vite build`**

- [ ] **Step 8: Visual check (controller will also screenshot)**

Build a throwaway HTML file in the scratchpad that imports nothing: paste each `SCENES[a]` string (e.g. via a tiny node script printing them) plus `scenes.css` into a 5×2 grid, open it with headless Edge `--screenshot`, and look at every scene. Fix any obviously broken drawing (a figure off-canvas, a shape inside out) by adjusting coordinates only. Delete the scratch file. Report what you changed.

- [ ] **Step 9: Commit**

```bash
git add apps/consumer/src/shared/scenes.ts apps/consumer/src/shared/scenes.css apps/consumer/src/shared/scenes.test.ts apps/consumer/src/main/windows/breakOverlay.ts apps/consumer/src/main/windows/breakOverlay.test.ts apps/consumer/src/preload/break.ts apps/consumer/src/break/main.ts apps/consumer/src/break/break.css apps/consumer/break.html apps/consumer/src/main/coach/store.ts apps/consumer/src/main/index.ts
git commit -m "feat(consumer): animated hand-drawn break scenes and per-break specs"
```

---

### Task 5: Reminders in the coach (pop-ups, actions, state)

**Files:**
- Create: `apps/consumer/src/main/coach/rules/reminders.ts`, `apps/consumer/src/main/coach/rules/reminders.test.ts`
- Modify: `main/coach/types.ts`, `shared/nudgeLook.ts`, `main/coach/settings.ts` (`kindsInput`), `main/coach/gate.ts` (+ test), `main/coach/engine.ts` (+ test), `main/coach/store.ts` (CHECK migration + test), `main/coach/snapshot.ts`, `main/coach/rules/index.ts`, `main/windows/pill.ts` (+ test), `preload/pill.ts`, `pill/main.ts`, `renderer/components/PopupsSection.tsx` (`KIND_TEXT`), `main/index.ts`
(All under `apps/consumer/src/`.)

**Interfaces:**
- Consumes: `planReminders`, `DueReminder` (Task 3); `createReminderStore` (Task 2); `BreakSpec` (Task 4).
- Produces: `Kind` gains `'reminder'`; `PrimaryAction` gains `'break_reminder' | 'reminder_done'`; `Candidate` gains `reminderId?: number; secondary?: { label: string }`; `PillNudge` gains `secondaryLabel?: string`; `PillAction` gains `'secondary'`; `Snapshot` gains `reminderDue: DueReminder | null`; `reminderRule: Rule`; `migrateCoachSchema(db): void`.

- [ ] **Step 1: Kind + look + switches**

`types.ts`: `export type Kind = 'health' | 'behaviour' | 'tip' | 'win' | 'reminder'; export const KINDS: readonly Kind[] = ['health', 'behaviour', 'tip', 'win', 'reminder'];` `PrimaryAction = 'break_eye' | 'break_stretch' | 'break_reminder' | 'reminder_done' | 'ack';` Candidate adds `reminderId?: number; secondary?: { label: string };` PillNudge adds `secondaryLabel?: string;` `PillAction = 'primary' | 'secondary' | 'dismiss' | 'snooze' | 'fewer' | 'expired';`
`nudgeLook.ts`: add `reminder: { color: '#CFE6FB', emoji: '⏰', label: 'Reminders' }`.
`coach/settings.ts`: `kindsInput` adds `reminder: z.boolean()`.
`PopupsSection.tsx` `KIND_TEXT`: add `reminder: 'Water, meals, tea and your own reminders'`.
Fix any test fixtures that build a full `Record<Kind, boolean>` (add `reminder: true`).

- [ ] **Step 2: Migrate the `nudges.kind` CHECK — failing test**

`coach/store.test.ts`:
```ts
  it('migrates an old nudges table so reminder rows are allowed, keeping existing rows', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE nudges (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, date TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('health','behaviour','tip','win')), rule_id TEXT NOT NULL, key TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('shown','held','dismissed','acted','snoozed','expired')));
      INSERT INTO nudges (at, date, kind, rule_id, key, title, body, status) VALUES (1, 'd', 'health', 'eye_break', 'k', 't', 'b', 'shown');`);
    db.exec(COACH_SCHEMA);
    migrateCoachSchema(db);
    migrateCoachSchema(db); // idempotent
    const s = createCoachStore(db);
    expect(s.since(0)).toHaveLength(1);
    expect(() => s.record({ at: 2, date: 'd', kind: 'reminder', ruleId: 'reminder', key: 'r', title: 't', body: 'b', status: 'shown' })).not.toThrow();
  });
```
Implement in `coach/store.ts`: change the CHECK in `COACH_SCHEMA` to include `'reminder'`, and add
```ts
/** SQLite can't alter a CHECK: an older nudges table (before 'reminder') is rebuilt with the current definition. */
export function migrateCoachSchema(db: Database.Database): void {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'nudges'").get() as { sql: string } | undefined;
  if (!row || row.sql.includes("'reminder'")) return;
  db.transaction(() => {
    db.exec('ALTER TABLE nudges RENAME TO nudges_old; DROP INDEX IF EXISTS idx_nudges_date; DROP INDEX IF EXISTS idx_nudges_at;');
    db.exec(COACH_SCHEMA); // recreates nudges (+ indexes); breaks already exists
    db.exec('INSERT INTO nudges (id, at, date, kind, rule_id, key, title, body, status) SELECT id, at, date, kind, rule_id, key, title, body, status FROM nudges_old; DROP TABLE nudges_old;');
  })();
}
```
In `index.ts` right after `db.exec(COACH_SCHEMA);` add `migrateCoachSchema(db);`.

- [ ] **Step 3: Gate — reminders skip cooldowns (failing test first)**

`gate.test.ts` (use the file's existing context helper):
```ts
  it('reminders ignore the global and rule cooldowns but still obey snooze, holds and the kind switch', () => {
    const rem = { ruleId: 'reminder', kind: 'reminder' as const, key: 'reminder:2:2026-09-30', mini: '🍱 Lunch', stat: '1:00 pm', title: 'Lunch time 🍱', body: 'b', primary: { label: 'Start break', action: 'break_reminder' as const } };
    const recentTip = { id: 1, at: NOW - 60_000, date: 'd', kind: 'tip' as const, ruleId: 'stuck_tip', key: 'x', title: '', body: '', status: 'shown' as const };
    const recentRem = { ...recentTip, id: 2, kind: 'reminder' as const, ruleId: 'reminder', key: 'reminder:1:123' };
    expect(decide(rem, ctx({ history: [recentTip, recentRem] })).status).toBe('show');
    expect(decide(rem, ctx({ snoozeUntil: NOW + 1 })).status).toBe('held');
    expect(decide(rem, ctx({ hold: 'call' })).status).toBe('held');
    expect(decide(rem, ctx({ kinds: { ...ALL_ON, reminder: false } })).status).toBe('drop');
  });
  it('a shown reminder does not start the global cooldown for other pop-ups', () => {
    const recentRem = { id: 2, at: NOW - 60_000, date: 'd', kind: 'reminder' as const, ruleId: 'reminder', key: 'reminder:1:123', title: '', body: '', status: 'shown' as const };
    expect(decide(TIP_CANDIDATE, ctx({ history: [recentRem] })).status).toBe('show');
  });
```
(Use the names the test file already has for `NOW`, a context builder and a tip candidate; add `ALL_ON`/`TIP_CANDIDATE` if missing.) Implement in `gate.ts`:
```ts
const exempt = (ruleId: string, kind: Kind): boolean => OWN_CADENCE.has(ruleId) || kind === 'reminder';
```
and use it: the global-cooldown line becomes
`if (!exempt(c.ruleId, c.kind) && shown.some((n) => !exempt(n.ruleId, n.kind) && x.now - n.at < GLOBAL_COOLDOWN_MS)) …`; add `if (c.kind !== 'reminder') { …the existing gap/rule-cooldown lines… }` so reminders skip the rule cooldown (their own schedule and unique keys prevent repeats).

- [ ] **Step 4: Engine — holds delay reminders instead of dropping them (failing test first)**

`engine.test.ts`:
```ts
  it('a held reminder is not recorded, so it shows once the hold ends', async () => {
    let hold: string | null = 'call';
    const rem = (): Candidate => ({ ruleId: 'reminder', kind: 'reminder', key: 'reminder:2:2026-09-30', mini: '🍱 Lunch', stat: '1:00 pm', title: 'Lunch time 🍱', body: 'b', primary: { label: 'Start break', action: 'break_reminder' } });
    const { d, rows, shown } = deps({ rules: [rem], holdReason: async () => hold });
    expect(await createCoach(d).tick()).toBe('held');
    expect(rows).toHaveLength(0);
    hold = null;
    expect(await createCoach(d).tick()).toBe('shown');
    expect(shown).toHaveLength(1);
  });
```
In `engine.ts`, the held branch becomes:
```ts
        if (dec.status === 'held') {
          // A held reminder isn't recorded: its key stays free, so it pops up once the call/fullscreen/snooze ends.
          if (c.kind === 'reminder') outcome = 'held';
          else recordHeld(c);
          continue;
        }
```
and `show(...)` passes `secondaryLabel: c.secondary?.label` in the `PillNudge`.

- [ ] **Step 5: The reminder rule — failing test first**

`rules/reminders.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { snap } from '../fixtures';
import { reminderRule } from './reminders';
import { builtinDefaults, type Reminder } from '../../../shared/reminders';

const [water, lunch] = builtinDefaults([1, 2, 3, 4, 5]).map((r, i) => ({ ...r, id: i + 1 })) as Reminder[];

describe('reminderRule', () => {
  it('is silent with nothing due', () => { expect(reminderRule(snap({ reminderDue: null }))).toBeNull(); });
  it('turns a due break reminder into a Start-break pop-up with a Done-style secondary', () => {
    expect(reminderRule(snap({ reminderDue: { reminder: water, slot: '123' } }))).toEqual({
      ruleId: 'reminder', kind: 'reminder', key: 'reminder:1:123', mini: '💧 Water', stat: '60 min', reminderId: 1,
      title: 'Time for some water 💧', body: 'A few big sips. Your focus will thank you.',
      primary: { label: 'Start break', action: 'break_reminder' }, secondary: { label: 'I had some' }
    });
    expect(reminderRule(snap({ reminderDue: { reminder: lunch, slot: '2026-09-30' } }))).toMatchObject({ stat: '1:00 pm', secondary: { label: 'Done' } });
  });
  it('a no-break reminder has a single Done button', () => {
    const c = reminderRule(snap({ reminderDue: { reminder: { ...lunch, breakSec: 0 }, slot: 's' } }));
    expect(c).toMatchObject({ primary: { label: 'Done', action: 'reminder_done' } });
    expect(c?.secondary).toBeUndefined();
  });
});
```
`snapshot.ts`: add `reminderDue: DueReminder | null;` to `Snapshot` (import type from `../reminders/schedule`); `fixtures.ts` `snap()` default `reminderDue: null`.
`rules/reminders.ts`:
```ts
import type { Rule } from '../snapshot';
import { ANIMATION_LOOK, clock12, reminderTitle } from '../../../shared/reminders';

export const reminderRule: Rule = (s) => {
  const due = s.reminderDue;
  if (!due) return null;
  const r = due.reminder;
  const stat = r.schedule.type === 'time' ? clock12(r.schedule.time) : `${r.schedule.minutes} min`;
  const body = r.message.trim() || 'Time for a short break.';
  return {
    ruleId: 'reminder', kind: 'reminder', key: `reminder:${r.id}:${due.slot}`, mini: `${ANIMATION_LOOK[r.animation].emoji} ${r.name.trim()}`, stat,
    reminderId: r.id, title: reminderTitle(r), body,
    ...(r.breakSec > 0
      ? { primary: { label: 'Start break', action: 'break_reminder' as const }, secondary: { label: r.builtin === 'water' ? 'I had some' : 'Done' } }
      : { primary: { label: 'Done', action: 'reminder_done' as const } })
  };
};
```
`rules/index.ts`: insert `reminderRule` right after `focusStart` in `RULES`.

- [ ] **Step 6: Pill secondary action (failing test first)**

`pill.test.ts`: add a case that `pillMessage.safeParse({ type: 'action', id: 1, action: 'secondary' }).success` is `true`. `pill.ts` enum adds `'secondary'`. `preload/pill.ts` already types `PillAction` — no change beyond the type. `pill/main.ts` `show()`:
```ts
    const primary = el('span', undefined, n.primaryLabel);
    const snooze = el('span', undefined, 'Snooze 1 h');
    const secondary = n.secondaryLabel ? el('span', undefined, n.secondaryLabel) : null;
    acts.append(...(secondary ? [primary, secondary, snooze] : [primary, snooze]));
    …
    if (secondary) secondary.onclick = () => finish(card, 'secondary');
```
and add `'secondary'` to the renderer's local `Action` type.

- [ ] **Step 7: Wire it in `main/index.ts`**

1. Store: after the coach schema lines, `db.exec(REMINDERS_SQL); const reminderStore = createReminderStore(db); reminderStore.seed(readProfile(settings.get()).days);`
2. `buildSnapshot(now)`: compute and apply the plan, then add it to the snapshot:
```ts
      const planned = planReminders({ reminders: reminderStore.list(), states: reminderStore.states(), now, samples });
      for (const sk of planned.skipped) reminderStore.markFired(sk.id, sk.date); // away at its time: skip today
```
(hoist `const samples = repo.getActivitySamples(date);` and reuse it for `samples:`), and return `reminderDue: planned.due` in the snapshot. (Task 6 adds travel reminders and the water override here.)
3. `primaryActions` meta: extend the map value to `{ kind: string; action: string; reminderId?: number }`; in `coachDeps.record`, when `status === 'shown'` store `reminderId: c.reminderId`, and when `c.reminderId !== undefined` call `reminderStore.markShown(c.reminderId, now, localDate(now))`.
4. `onAction`: status for `'secondary'` → `'acted'`. Then:
```ts
        if (meta?.reminderId !== undefined) {
          const rem = reminderStore.get(meta.reminderId) ?? travelReminderById(meta.reminderId); // Task 6 provides travelReminderById; until then use `reminderStore.get(...)` only
          if (action === 'secondary' || (action === 'primary' && meta.action === 'reminder_done')) reminderStore.markDone(meta.reminderId, Date.now());
          if (action === 'primary' && meta.action === 'break_reminder' && rem) {
            overlay.start({ label: `reminder:${rem.id}`, animation: rem.animation, seconds: rem.breakSec, title: reminderTitle(rem),
              text: rem.message.trim() || 'Time for a short break.', doneLabel: rem.builtin === 'water' ? 'I had some' : undefined, reminderId: rem.id });
          }
        }
```
(In this task, write only the `reminderStore.get(meta.reminderId)` form; Task 6 extends it.)
5. Overlay `onDone`: `if (r.completed && r.spec.reminderId !== undefined) reminderStore.markDone(r.spec.reminderId, now);`.
6. Delete-my-activity already clears `reminder_state` (Task 2).

- [ ] **Step 8: Full suite, typecheck, commit**

```bash
git add apps/consumer/src/main/coach apps/consumer/src/shared/nudgeLook.ts apps/consumer/src/main/windows/pill.ts apps/consumer/src/main/windows/pill.test.ts apps/consumer/src/preload/pill.ts apps/consumer/src/pill/main.ts apps/consumer/src/renderer/components/PopupsSection.tsx apps/consumer/src/main/index.ts
git commit -m "feat(consumer): reminder pop-ups in the coach — own kind, no cooldowns, holds delay, I-had-some, break screens"
```

---

### Task 6: Travel mode

**Files:**
- Create: `apps/consumer/src/main/time/travel.ts`, `apps/consumer/src/main/time/travel.test.ts`
- Modify: `apps/consumer/src/main/index.ts` (zone watcher timer + hooks, travel view, travel reminders, water override), `apps/consumer/src/main/channels.ts`, `apps/consumer/src/main/ipc.ts`, `apps/consumer/src/preload/index.ts`

**Interfaces:**
- Consumes: `TzChange`, `createZoneWatcher`, `readWindowsZone`, `resetClockZone`, `currentOffsetMin`, `TZ_SQL`, `createTzStore` (Task 1); `Reminder` (Task 2); `planReminders` (Task 3).
- Produces: `homeOffset(changes: TzChange[], currentOffset: number, now: number): number`; `interface TravelView { direction: 'east' | 'west'; fromHomeMin: number; back: boolean; day: number; days: number; endsAt: number; tips: string[] }`; `travelState(latest: TzChange | null, home: number, now: number, offUntil: number): TravelView | null`; `travelReminders(v: TravelView): Reminder[]` (ids −1, −2); `TRAVEL_WATER_MIN = 45`; channels `travel:get`, `travel:off`; preload `api.travel.get(): Promise<TravelView | null>`, `api.travel.off(): Promise<null>`.

- [ ] **Step 1: Failing tests**

`travel.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { homeOffset, travelReminders, travelState } from './travel';

const H = 3_600_000, D = 24 * H;
const chg = (at: number, fromOffset: number, toOffset: number) => ({ at, fromName: 'A', toName: 'B', fromOffset, toOffset });

describe('homeOffset', () => {
  it('is the current offset when nothing changed in 14 days', () => { expect(homeOffset([], 60, 100 * D)).toBe(60); });
  it('is the offset lived in longest over the last 14 days', () => {
    const now = 100 * D;
    expect(homeOffset([chg(now - 2 * D, 60, 540)], 540, now)).toBe(60);               // 12 days home, 2 in Tokyo
    expect(homeOffset([chg(now - 10 * D, 60, 540)], 540, now)).toBe(540);             // 4 days home, 10 in Tokyo
  });
});

describe('travelState', () => {
  const now = 100 * D;
  it('is off for small shifts, no change, or after its window', () => {
    expect(travelState(null, 60, now, 0)).toBeNull();
    expect(travelState(chg(now - H, 60, 120), 60, now, 0)).toBeNull();               // 1 h: not travel
    expect(travelState(chg(now - 4 * D, 60, 540), 60, now, 0)).toBeNull();           // 8 h → 3 days, over
  });
  it('east trip: direction, hours from home, day count, length', () => {
    expect(travelState(chg(now - 30 * H, 60, 540), 60, now, 0)).toMatchObject({ direction: 'east', fromHomeMin: 480, back: false, day: 2, days: 3 });
  });
  it('west trip and the length clamp (2..5 days)', () => {
    expect(travelState(chg(now - H, 60, -120), 60, now, 0)).toMatchObject({ direction: 'west', days: 2 });   // 3 h → 1 → clamp 2
    expect(travelState(chg(now - H, -480, 600), -480, now, 0)).toMatchObject({ days: 5 });                     // 18 h → 6 → clamp 5
  });
  it('flying home starts its own "back" travel mode', () => {
    expect(travelState(chg(now - H, 540, 60), 60, now, 0)).toMatchObject({ back: true, direction: 'west' });
  });
  it('turned off for this trip', () => {
    const c = chg(now - H, 60, 540);
    expect(travelState(c, 60, now, c.at + 3 * D)).toBeNull();
  });
});

describe('travelReminders', () => {
  it('daylight + last coffee at the right local times, no break', () => {
    const east = travelReminders({ direction: 'east', fromHomeMin: 480, back: false, day: 1, days: 3, endsAt: 0, tips: [] });
    expect(east.map((r) => [r.id, r.builtin, r.schedule, r.breakSec])).toEqual([
      [-1, 'travel_daylight', { type: 'time', time: '09:00', days: [1, 2, 3, 4, 5, 6, 7] }, 0],
      [-2, 'travel_coffee', { type: 'time', time: '14:00', days: [1, 2, 3, 4, 5, 6, 7] }, 0]
    ]);
    const west = travelReminders({ direction: 'west', fromHomeMin: -300, back: false, day: 1, days: 2, endsAt: 0, tips: [] });
    expect(west.map((r) => (r.schedule.type === 'time' ? r.schedule.time : ''))).toEqual(['16:00', '15:00']);
  });
});
```
Run — FAIL.

- [ ] **Step 2: Implement `travel.ts`**

```ts
import type { TzChange } from './zone';
import type { Reminder } from '../../shared/reminders';

const D = 24 * 3_600_000, WINDOW = 14 * D;
export const TRAVEL_WATER_MIN = 45;
const ALL = [1, 2, 3, 4, 5, 6, 7];

export interface TravelView { direction: 'east' | 'west'; fromHomeMin: number; back: boolean; day: number; days: number; endsAt: number; tips: string[]; }

/** The offset lived in longest over the last 14 days (wall-clock time — tracking rows don't store offsets). */
export function homeOffset(changes: TzChange[], currentOffset: number, now: number): number {
  const from = now - WINDOW;
  const inRange = changes.filter((c) => c.at > from && c.at <= now).sort((a, b) => a.at - b.at);
  const time = new Map<number, number>();
  const add = (o: number, ms: number): void => { time.set(o, (time.get(o) ?? 0) + ms); };
  let cursor = from, offset = inRange.length ? inRange[0].fromOffset : currentOffset;
  for (const c of inRange) { add(offset, c.at - cursor); cursor = c.at; offset = c.toOffset; }
  add(offset, now - cursor);
  return [...time.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

const TIPS = {
  east: ['Get daylight between 8 and 10 am.', 'Last coffee by 2 pm.', 'Aim for an early night.'],
  west: ['Get daylight in the late afternoon.', 'Stay up until your usual local bedtime.', 'Last coffee by 3 pm.'],
  both: ['Naps: 20 minutes max, before 3 pm.', 'Drink extra water — flying dries you out.', 'Your wind-down reminder already follows local time.']
};

export function travelState(latest: TzChange | null, home: number, now: number, offUntil: number): TravelView | null {
  if (!latest) return null;
  const diff = latest.toOffset - latest.fromOffset;
  if (Math.abs(diff) < 180) return null;
  const days = Math.min(5, Math.max(2, Math.round(Math.abs(diff) / 180)));
  const endsAt = latest.at + days * D;
  if (now >= endsAt || offUntil >= endsAt || now < latest.at) return null;
  const direction = diff > 0 ? 'east' : 'west';
  const fromHomeMin = latest.toOffset - home;
  return { direction, fromHomeMin, back: fromHomeMin === 0, day: Math.floor((now - latest.at) / D) + 1, days, endsAt, tips: [...TIPS[direction], ...TIPS.both] };
}

export function travelReminders(v: TravelView): Reminder[] {
  const east = v.direction === 'east';
  return [
    { id: -1, builtin: 'travel_daylight', name: 'Daylight', message: 'Step outside or sit by a window for a while.', animation: 'walk',
      schedule: { type: 'time', time: east ? '09:00' : '16:00', days: ALL }, breakSec: 0, enabled: true },
    { id: -2, builtin: 'travel_coffee', name: 'Last coffee', message: 'Caffeine after this can keep you up tonight.', animation: 'tea',
      schedule: { type: 'time', time: east ? '14:00' : '15:00', days: ALL }, breakSec: 0, enabled: true }
  ];
}
```
Run — PASS.

- [ ] **Step 3: Wire zone watching, travel view and travel reminders in `index.ts`**

1. After the reminder store: `db.exec(TZ_SQL); const tzStore = createTzStore(db);`
```ts
    const zoneWatcher = createZoneWatcher({
      read: () => readWindowsZone(), offset: currentOffsetMin, reset: resetClockZone, now: () => Date.now(),
      stored: () => ({ name: settings.get().zoneName, offset: settings.get().zoneOffset }),
      save: (z) => settings.set({ zoneName: z.name, zoneOffset: z.offset })
    });
    const checkZone = (): void => {
      zoneWatcher.check().then((c) => {
        if (!c) return;
        tzStore.record(c);
        win?.webContents.send(CH.eventsUpdate); // views re-read times in the new local zone
      }).catch((e) => console.error('[zone] check failed:', e));
    };
    checkZone();
    setInterval(checkZone, 5 * 60_000);
    powerMonitor.on('resume', checkZone);
    powerMonitor.on('unlock-screen', checkZone);
    const travelView = (): TravelView | null => {
      const now = Date.now();
      return travelState(tzStore.latest(), homeOffset(tzStore.since(now - 14 * 86_400_000), currentOffsetMin(), now), now, settings.get().travelOffUntil);
    };
    const travelReminderById = (id: number): Reminder | null => { const v = travelView(); return v ? travelReminders(v).find((r) => r.id === id) ?? null : null; };
```
(If `settings.set` rejects unknown keys via a patch schema, use the same internal setter the file already uses for `snoozeUntil`/`nudgeFewer` — those aren't in `settingsPatch` either.)
2. `buildSnapshot`: `const travel = travelView();` and pass `reminders: [...reminderStore.list(), ...(travel ? travelReminders(travel) : [])]` and `waterIntervalMin: travel ? TRAVEL_WATER_MIN : undefined` to `planReminders`.
3. `onAction`: use `reminderStore.get(meta.reminderId) ?? travelReminderById(meta.reminderId)` (as in Task 5 Step 7.4).
4. IPC: `channels.ts` add `travelGet: 'travel:get', travelOff: 'travel:off'`; `ipc.ts` `IpcDeps` add `travel: { view(): TravelView | null; off(): void }` and handlers `ipcMain.handle(CH.travelGet, () => d.travel.view()); ipcMain.handle(CH.travelOff, () => { d.travel.off(); return null; });`; `index.ts` deps: `travel: { view: travelView, off: () => { const v = travelView(); if (v) { settings.set({ travelOffUntil: v.endsAt }); win?.webContents.send(CH.eventsUpdate); } } }`; `preload/index.ts`: `travel: { get: (): Promise<TravelView | null> => ipcRenderer.invoke(CH.travelGet), off: (): Promise<null> => ipcRenderer.invoke(CH.travelOff) }` (import the type from `../main/time/travel`).

- [ ] **Step 4: Full suite, typecheck, commit**

```bash
git add apps/consumer/src/main/time/travel.ts apps/consumer/src/main/time/travel.test.ts apps/consumer/src/main/index.ts apps/consumer/src/main/channels.ts apps/consumer/src/main/ipc.ts apps/consumer/src/preload/index.ts
git commit -m "feat(consumer): follow the Windows time zone; travel mode with jet-lag tips and travel reminders"
```

---

### Task 7: Settings → Reminders

**Files:**
- Create: `apps/consumer/src/renderer/components/RemindersSection.tsx`, `apps/consumer/src/renderer/components/ReminderEditor.tsx`, `apps/consumer/src/renderer/lib/reminderForm.ts`, `apps/consumer/src/renderer/lib/reminderForm.test.ts`
- Modify: `apps/consumer/src/main/channels.ts`, `apps/consumer/src/main/ipc.ts`, `apps/consumer/src/preload/index.ts`, `apps/consumer/src/main/index.ts`, `apps/consumer/src/renderer/components/SettingsScreen.tsx`, `apps/consumer/src/renderer/styles.css`, `apps/consumer/src/renderer/main.tsx` (import `../shared/scenes.css`)

**Interfaces:**
- Consumes: shared reminder model (Task 2), `SCENES` (Task 4), `ReminderStore` (Task 2).
- Produces: channels `reminders:list|save|delete|reset|setEnabled`; preload `api.reminders.list()`, `.save(input)`, `.delete(id)`, `.reset(builtin)`, `.setEnabled(id, on)` — all resolve to `{ reminders: Reminder[]; error: string | null }`; `lib/reminderForm.ts`: `emptyForm(): ReminderInput`, `formFrom(r: Reminder): ReminderInput`, `breakLabel(sec: number): string`.

- [ ] **Step 1: Form helpers — failing test**

`reminderForm.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { breakLabel, emptyForm, formFrom } from './reminderForm';
import { builtinDefaults } from '../../shared/reminders';

describe('reminder form helpers', () => {
  it('a new reminder starts as a daily 9:00 no-break reminder with the breathe animation', () => {
    expect(emptyForm()).toEqual({ name: '', message: '', animation: 'breathe', schedule: { type: 'time', time: '09:00', days: [1, 2, 3, 4, 5, 6, 7] }, breakSec: 0 });
  });
  it('editing copies the reminder fields', () => {
    const lunch = { ...builtinDefaults([1, 2, 3, 4, 5])[1], id: 2 };
    expect(formFrom(lunch)).toEqual({ id: 2, name: 'Lunch', message: lunch.message, animation: 'meal', schedule: lunch.schedule, breakSec: 1800 });
  });
  it('labels break lengths', () => {
    expect([0, 15, 30, 60, 120, 1800, 3600].map(breakLabel)).toEqual(['No break — just remind me', '15 seconds', '30 seconds', '1 minute', '2 minutes', '30 minutes', '60 minutes']);
  });
});
```
`reminderForm.ts`:
```ts
import type { Reminder, ReminderInput } from '../../shared/reminders';

export const emptyForm = (): ReminderInput => ({ name: '', message: '', animation: 'breathe', schedule: { type: 'time', time: '09:00', days: [1, 2, 3, 4, 5, 6, 7] }, breakSec: 0 });
export const formFrom = (r: Reminder): ReminderInput => ({ id: r.id, name: r.name, message: r.message, animation: r.animation, schedule: r.schedule, breakSec: r.breakSec });
export function breakLabel(sec: number): string {
  if (sec === 0) return 'No break — just remind me';
  if (sec < 60) return `${sec} seconds`;
  const m = sec / 60;
  return m === 1 ? '1 minute' : `${m} minutes`;
}
```

- [ ] **Step 2: IPC**

`channels.ts`: `remindersList: 'reminders:list', remindersSave: 'reminders:save', remindersDelete: 'reminders:delete', remindersReset: 'reminders:reset', remindersSetEnabled: 'reminders:setEnabled'`.
`ipc.ts`: `export interface RemindersView { reminders: Reminder[]; error: string | null }`; `IpcDeps.reminders: { store: ReminderStore; workdays(): number[] }`. Inputs parsed with zod:
```ts
const scheduleInput = z.union([
  z.object({ type: z.literal('time'), time: z.string(), days: z.array(z.number().int()).max(7) }).strict(),
  z.object({ type: z.literal('interval'), minutes: z.number().int() }).strict()
]);
const reminderInput = z.object({ id: z.number().int().optional(), name: z.string().max(200), message: z.string().max(500), animation: z.enum(ANIMATIONS), schedule: scheduleInput, breakSec: z.number().int() }).strict();
```
Handlers (each returns `RemindersView`; `save` catches the store's thrown message into `error`):
```ts
  const remindersView = (error: string | null = null): RemindersView => ({ reminders: d.reminders.store.list(), error });
  ipcMain.handle(CH.remindersList, () => remindersView());
  ipcMain.handle(CH.remindersSave, (_e, raw) => {
    try { d.reminders.store.save(reminderInput.parse(raw), d.now()); d.coach.onChanged(); return remindersView(); }
    catch (e) { return remindersView(e instanceof z.ZodError ? 'Something in that reminder isn’t valid.' : (e as Error).message); }
  });
  ipcMain.handle(CH.remindersDelete, (_e, raw) => { d.reminders.store.remove(z.number().int().parse(raw)); return remindersView(); });
  ipcMain.handle(CH.remindersReset, (_e, raw) => { d.reminders.store.reset(z.enum(['water', 'lunch', 'tea', 'dinner']).parse(raw), d.reminders.workdays()); return remindersView(); });
  ipcMain.handle(CH.remindersSetEnabled, (_e, raw) => { const v = z.object({ id: z.number().int(), on: z.boolean() }).strict().parse(raw); d.reminders.store.setEnabled(v.id, v.on); return remindersView(); });
```
`index.ts` deps: `reminders: { store: reminderStore, workdays: () => readProfile(settings.get()).days }`.
`preload/index.ts`: `reminders: { list: () => invoke(CH.remindersList), save: (r: ReminderInput) => invoke(CH.remindersSave, r), delete: (id: number) => invoke(CH.remindersDelete, id), reset: (b: 'water' | 'lunch' | 'tea' | 'dinner') => invoke(CH.remindersReset, b), setEnabled: (id: number, on: boolean) => invoke(CH.remindersSetEnabled, { id, on }) }` typed `Promise<RemindersView>`.

- [ ] **Step 3: `RemindersSection.tsx` + `ReminderEditor.tsx`**

`RemindersSection.tsx`:
```tsx
import { useEffect, useState } from 'react';
import type { RemindersView } from '../../main/ipc';
import { ANIMATION_LOOK, reminderSummary, type Reminder, type ReminderInput } from '../../shared/reminders';
import { api } from '../lib/api';
import { emptyForm, formFrom } from '../lib/reminderForm';
import { ReminderEditor } from './ReminderEditor';

export function RemindersSection() {
  const [view, setView] = useState<RemindersView | null>(null);
  const [editing, setEditing] = useState<ReminderInput | null>(null);
  useEffect(() => { api.reminders.list().then(setView).catch((e) => console.error('[renderer] reminders.list failed:', e)); }, []);
  if (!view) return null;
  const apply = (p: Promise<RemindersView>): void => { p.then((v) => { setView(v); if (!v.error) setEditing(null); }).catch((e) => console.error(e)); };
  const custom = view.reminders.filter((r) => !r.builtin).length;
  return (
    <div className="grp">
      <h4>Reminders</h4>
      {view.reminders.map((r: Reminder) => (
        <div className="srow" key={r.id}>
          <p>{ANIMATION_LOOK[r.animation].emoji} {r.name}<small>{reminderSummary(r)}</small></p>
          <div className="srow-actions">
            <button className="btn s" onClick={() => setEditing(formFrom(r))}>Edit</button>
            {r.builtin
              ? <button className="btn s" onClick={() => apply(api.reminders.reset(r.builtin as 'water' | 'lunch' | 'tea' | 'dinner'))}>Reset</button>
              : <button className="btn s" onClick={() => apply(api.reminders.delete(r.id))}>Delete</button>}
            <button className={`sw${r.enabled ? ' on' : ''}`} aria-label={`${r.name} reminder`} aria-pressed={r.enabled} onClick={() => apply(api.reminders.setEnabled(r.id, !r.enabled))} />
          </div>
        </div>
      ))}
      {editing
        ? <ReminderEditor value={editing} error={view.error} onChange={setEditing} onCancel={() => { setEditing(null); setView({ ...view, error: null }); }} onSave={() => apply(api.reminders.save(editing))} />
        : <div className="srow"><p>Add your own<small>{custom} of 20 used</small></p><button className="btn" disabled={custom >= 20} onClick={() => setEditing(emptyForm())}>Add reminder</button></div>}
    </div>
  );
}
```
`ReminderEditor.tsx`:
```tsx
import { ANIMATIONS, ANIMATION_LOOK, BREAK_OPTIONS, LIMITS, validateReminder, type ReminderInput } from '../../shared/reminders';
import { SCENES } from '../../shared/scenes';
import { breakLabel } from '../lib/reminderForm';

const DAYS = [[1, 'M'], [2, 'T'], [3, 'W'], [4, 'T'], [5, 'F'], [6, 'S'], [7, 'S']] as const;
const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function ReminderEditor({ value, error, onChange, onSave, onCancel }: {
  value: ReminderInput; error: string | null; onChange: (v: ReminderInput) => void; onSave: () => void; onCancel: () => void;
}) {
  const localError = validateReminder(value);
  const s = value.schedule;
  const set = (p: Partial<ReminderInput>): void => onChange({ ...value, ...p });
  return (
    <div className="rem-editor" role="group" aria-label={value.id ? 'Edit reminder' : 'New reminder'}>
      <label>Name<input type="text" maxLength={LIMITS.name} value={value.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Take vitamins" /></label>
      <label>Message<input type="text" maxLength={LIMITS.message} value={value.message} onChange={(e) => set({ message: e.target.value })} placeholder="Optional" /></label>
      <fieldset className="rem-when"><legend>When</legend>
        <label><input type="radio" checked={s.type === 'time'} onChange={() => set({ schedule: { type: 'time', time: '09:00', days: [1, 2, 3, 4, 5, 6, 7] } })} /> At a time</label>
        <label><input type="radio" checked={s.type === 'interval'} onChange={() => set({ schedule: { type: 'interval', minutes: 60 } })} /> Every … minutes of screen time</label>
        {s.type === 'time' ? (
          <div className="rem-time">
            <input type="time" aria-label="Time" value={s.time} onChange={(e) => set({ schedule: { ...s, time: e.target.value } })} />
            <div className="rem-days">{DAYS.map(([d, l]) => (
              <button key={d} type="button" className={`chip${s.days.includes(d) ? ' on' : ''}`} aria-label={DAY_NAMES[d]} aria-pressed={s.days.includes(d)}
                onClick={() => set({ schedule: { ...s, days: s.days.includes(d) ? s.days.filter((x) => x !== d) : [...s.days, d] } })}>{l}</button>
            ))}</div>
          </div>
        ) : (
          <input type="number" aria-label="Minutes" min={LIMITS.intervalMin} max={LIMITS.intervalMax} step={5} value={s.minutes}
            onChange={(e) => set({ schedule: { type: 'interval', minutes: Number(e.target.value) } })} />
        )}
      </fieldset>
      <label>Break<select value={value.breakSec} onChange={(e) => set({ breakSec: Number(e.target.value) })}>
        {BREAK_OPTIONS.map((b) => <option key={b} value={b}>{breakLabel(b)}</option>)}
      </select></label>
      <fieldset><legend>Animation</legend>
        <div className="gal">{ANIMATIONS.map((a) => (
          <button key={a} type="button" className={`gal-tile${value.animation === a ? ' on' : ''}`} aria-pressed={value.animation === a} aria-label={ANIMATION_LOOK[a].label} onClick={() => set({ animation: a })}>
            {/* static SVG from shared/scenes.ts — never user input */}
            <span className="gal-scene" dangerouslySetInnerHTML={{ __html: SCENES[a] }} />
            <span>{ANIMATION_LOOK[a].label}</span>
          </button>
        ))}</div>
      </fieldset>
      {(error || localError) && <p className="srow-note" role="alert">{error ?? localError}</p>}
      <div className="btn-row"><button className="btn s" onClick={onCancel}>Cancel</button><button className="btn" disabled={localError !== null} onClick={onSave}>Save</button></div>
    </div>
  );
}
```
`SettingsScreen.tsx`: render `<RemindersSection />` right after `<PopupsSection />`.
`renderer/main.tsx`: `import '../shared/scenes.css';` (next to the existing styles import).
`styles.css` (append):
```css
/* ---------- Settings → Reminders ---------- */
.srow-actions { display: flex; align-items: center; gap: 8px; }
.rem-editor { display: grid; gap: 12px; padding: 14px 0; }
.rem-editor label { display: grid; gap: 6px; font-size: 13px; }
.rem-editor fieldset { border: 0; padding: 0; margin: 0; display: grid; gap: 8px; }
.rem-editor legend { font-size: 13px; font-weight: 600; margin-bottom: 4px; }
.rem-time { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.rem-days { display: flex; gap: 6px; }
.chip { width: 32px; height: 32px; border-radius: 50%; border: 1px solid var(--line); background: var(--white); cursor: pointer; font-weight: 600; }
.chip.on { background: var(--ink); color: #fff; border-color: var(--ink); }
.gal { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
.gal-tile { display: grid; justify-items: center; gap: 4px; padding: 8px 4px; border-radius: 14px; border: 1px solid var(--line); background: var(--white); cursor: pointer; font-size: 12px; }
.gal-tile.on { border-color: var(--ink); box-shadow: 0 0 0 1px var(--ink); }
.gal-scene { width: 56px; height: 56px; }
.gal-tile:not(.on):not(:hover):not(:focus-visible) .dl-scene-svg * { animation-play-state: paused; }
```

- [ ] **Step 4: Full suite, typecheck, `npx electron-vite build`, commit**

```bash
git add apps/consumer/src/renderer/components/RemindersSection.tsx apps/consumer/src/renderer/components/ReminderEditor.tsx apps/consumer/src/renderer/lib/reminderForm.ts apps/consumer/src/renderer/lib/reminderForm.test.ts apps/consumer/src/main/channels.ts apps/consumer/src/main/ipc.ts apps/consumer/src/preload/index.ts apps/consumer/src/main/index.ts apps/consumer/src/renderer/components/SettingsScreen.tsx apps/consumer/src/renderer/styles.css apps/consumer/src/renderer/main.tsx
git commit -m "feat(consumer): Settings → Reminders — list, editor, animation gallery"
```

---

### Task 8: Travel card on Today

**Files:**
- Create: `apps/consumer/src/renderer/components/TravelCard.tsx`, `apps/consumer/src/renderer/lib/travel.ts`, `apps/consumer/src/renderer/lib/travel.test.ts`
- Modify: `apps/consumer/src/renderer/components/TodayScreen.tsx`, `apps/consumer/src/renderer/styles.css`

**Interfaces:**
- Consumes: `TravelView` (Task 6), `api.travel.get/off` (Task 6).
- Produces: `travelHeadline(v: TravelView): string`.

- [ ] **Step 1: Headline helper — failing test**

`travel.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { travelHeadline } from './travel';

const v = { direction: 'east' as const, fromHomeMin: 480, back: false, day: 1, days: 3, endsAt: 0, tips: [] };
describe('travelHeadline', () => {
  it('ahead / behind / half hours / back home', () => {
    expect(travelHeadline(v)).toBe("You're 8 hours ahead of home · Day 1 of 3");
    expect(travelHeadline({ ...v, fromHomeMin: -300, direction: 'west', day: 2 })).toBe("You're 5 hours behind home · Day 2 of 3");
    expect(travelHeadline({ ...v, fromHomeMin: 330 })).toBe("You're 5.5 hours ahead of home · Day 1 of 3");
    expect(travelHeadline({ ...v, fromHomeMin: 60 })).toBe("You're 1 hour ahead of home · Day 1 of 3");
    expect(travelHeadline({ ...v, fromHomeMin: 0, back: true })).toBe('Welcome home — adjusting back · Day 1 of 3');
  });
});
```
`lib/travel.ts`:
```ts
import type { TravelView } from '../../main/time/travel';

export function travelHeadline(v: TravelView): string {
  const day = `Day ${v.day} of ${v.days}`;
  if (v.back) return `Welcome home — adjusting back · ${day}`;
  const h = Math.round((Math.abs(v.fromHomeMin) / 60) * 2) / 2;
  return `You're ${h} hour${h === 1 ? '' : 's'} ${v.fromHomeMin > 0 ? 'ahead of' : 'behind'} home · ${day}`;
}
```

- [ ] **Step 2: `TravelCard.tsx`**

```tsx
import { useEffect, useState } from 'react';
import type { TravelView } from '../../main/time/travel';
import { api } from '../lib/api';
import { travelHeadline } from '../lib/travel';

export function TravelCard() {
  const [view, setView] = useState<TravelView | null>(null);
  useEffect(() => {
    const load = (): void => { api.travel.get().then(setView).catch(() => {}); };
    load();
    return api.onUpdate(load);
  }, []);
  if (!view) return null;
  return (
    <div className="travel" role="region" aria-label="Travel mode">
      <p className="sec">✈️ Travel mode</p>
      <b>{travelHeadline(view)}</b>
      <ul>{view.tips.map((t) => <li key={t}>{t}</li>)}</ul>
      <button className="btn s" onClick={() => { api.travel.off().then(() => setView(null)).catch(() => {}); }}>Turn off travel mode</button>
    </div>
  );
}
```
`TodayScreen.tsx`: render `<TravelCard />` right after `<ScreenPrompt … />`.
`styles.css` (append): `.travel { background: var(--sky); border-radius: 18px; padding: 16px 18px; display: grid; gap: 8px; margin-bottom: 14px; } .travel ul { margin: 0; padding-left: 18px; font-size: 13px; color: #3c3834; } .travel .btn { justify-self: start; }`

- [ ] **Step 3: Full suite, typecheck, build, commit**

```bash
git add apps/consumer/src/renderer/components/TravelCard.tsx apps/consumer/src/renderer/lib/travel.ts apps/consumer/src/renderer/lib/travel.test.ts apps/consumer/src/renderer/components/TodayScreen.tsx apps/consumer/src/renderer/styles.css
git commit -m "feat(consumer): travel-mode card on Today"
```

---

### Task 9: Verification (controller)

- [ ] **Step 1:** Full consumer suite, core suite, `pnpm -r typecheck`, `npx electron-vite build` — all green.
- [ ] **Step 2: Headless screenshots** (stubbed `window.daylens` / `window.brk` over the built `out/renderer`, deleted afterwards): Settings → Reminders list; the editor with the gallery; a still frame of each of the ten break scenes (break.html with `brk.onStart` stubbed per animation, reduced motion for the still); the Today travel card (east and back-home variants); the pill with a secondary button.
- [ ] **Step 3: Human checklist:** a water reminder appears after an hour of screen time and "I had some" restarts it; change lunch to a time a few minutes ahead → it fires; a custom no-break reminder; a break screen runs its animation and "I'm back" works; change the Windows time zone (Settings → Time & language → Date & time, turn off "Set time zone automatically", pick a zone 8 h away) → reminder times, the Today clock and the travel card follow → change it back.
- [ ] **Step 4:** Then the deferred Phase 7 steps: close the dev Daylens, `pnpm --filter @worksight/consumer dist`, check-build, and the Phase 7 install checklist.
