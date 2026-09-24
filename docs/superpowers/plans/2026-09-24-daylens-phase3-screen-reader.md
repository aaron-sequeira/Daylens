# Daylens Phase 3 — Screen Reader & Privacy Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A switched-off-by-default pipeline that reads the text of the foreground window every 30 s (Windows OCR in a supervised PowerShell helper), redacts it, skips excluded apps, stores it with retention, plus a Settings privacy page (switch + status, retention, never-look list, "See it for yourself", export, delete).

**Architecture:** Pure helpers (`src/shared/exclusions.ts`, `src/main/screen/redact.ts`, `src/main/screen/exclusions.ts`) are unit-tested; `src/main/screen/store.ts` owns the `screen_reads` table and data actions; `src/main/ocr/client.ts` supervises the helper process (restart/backoff/fail-safe); `src/main/screen/reader.ts` decides and records each read. `src/main/index.ts` wires them to settings, IPC and timers; `src/renderer/components/PrivacySection.tsx` renders the controls.

**Tech Stack:** Electron 33, React 19, TypeScript 5.7, zod 3, better-sqlite3, Vitest 2, Windows PowerShell 5.1 + WinRT OCR + Win32 (Add-Type C#).

**Spec:** `docs/superpowers/specs/2026-09-24-daylens-phase3-screen-reader-design.md` (extends `docs/superpowers/specs/2026-09-23-daylens-consumer-app-design.md`).

**Deliberate deltas from the spec (plan rulings):** `addExclusion` lives in `src/shared/exclusions.ts` (the renderer needs it; main re-validates with zod). No `deleteAll()` on the store — `deleteActivity(db)` already clears `screen_reads` (YAGNI). Whole-word matching uses Unicode letter/digit lookarounds instead of `` so patterns like `C++` or `1Password` match correctly. The store adds `lastWithText()` so "See it for yourself" still shows text when the newest row is a duplicate (`text = NULL`).

## Global Constraints

- Branch `feat/daylens-phase3`. Every commit message ends with a blank line then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never stage `.codex/` or `apps/consumer/.models/`.
- Windows + Git Bash; commands from the repo root. Tests: `pnpm --filter @worksight/consumer test` (its `pretest` rebuilds better-sqlite3; if that fails with EPERM a Daylens window is open — do NOT kill processes you didn't start; report it). Typecheck: `pnpm --filter @worksight/consumer typecheck`. Build: `pnpm --filter @worksight/consumer exec electron-vite build`.
- **Screen reading is OFF by default** (`screenReading: false`) and runs only when `screenReading && consentGranted && !trackingPaused`. The OCR helper process runs only in that state.
- Screenshots never leave the helper process and are never written to disk. Never print or log OCR text in tooling output (bench prints metadata only).
- Settings keys: `screenReading` (false), `rawTextRetentionDays` (7; only 1, 7 or 30), `readIntervalSec` (30, internal), `exclusions` (JSON string of the default list). Renderer may set `screenReading` and `rawTextRetentionDays` via `settings:set`; exclusions only via `privacy:setExclusions`.
- Default exclusions: `1Password, Bitwarden, KeePass, KeePassXC, LastPass, Dashlane, Windows Security, Credential Manager, InPrivate, Incognito, Private Browsing, bank, banking, PayPal, password`. Matching: whole word, case-insensitive, app name OR window title. Limits: ≤ 40 patterns, each 1–60 chars, no control characters, unique case-insensitively.
- Redaction: emails → `[email]`; ≥ 8 digits allowing single spaces/dashes → `[number]`; `sk-…`, `gh?_…`, `github_pat_…`, `AKIA…`, JWT `eyJ…`, hex ≥ 32, base64-like mixed letter+digit runs ≥ 32 → `[secret]`; then truncate to 4 000 chars.
- Reader: every 30 s; skip when off/idle (system idle ≥ `idleThresholdSec`)/foreground excluded/same app + stored title as the last read and < 2 min; discard when captured pid ≠ foreground pid or captured title is excluded; identical redacted text (sha1) → row with `text = NULL`.
- OCR client: one request in flight; 8 s timeout → kill + restart; restart backoff 1 s → 5 s → 30 s; > 3 crashes within 10 min → `failed` (until stop/start); `no-language` when the helper reports `no_ocr_language`. Status values: `off | starting | ready | no-language | restarting | failed`.
- "Delete my activity" removes focus sessions, app events, activity samples, daily summaries and screen reads; keeps settings, profile and consent.
- UI uses existing Settings styling (`.grp`, `.srow`, `.sw`, `.btn`); switches/segments are `<button aria-pressed>`; the status line is `role="status"`.

## Review Focus

1. **Window switch to a password manager mid-capture** — the text must never be stored, even though the pre-check saw a harmless window. → tests in Task 5.
2. **Screen reading off, not consented, or paused** — nothing is captured and no helper process runs. → tests in Task 5 (reader) and Task 4 (client stop).
3. **Helper that keeps crashing** (PowerShell blocked, OCR engine error) — backs off and stops after 3 crashes in 10 minutes instead of spinning. → test in Task 4.
4. **Secrets and personal numbers on screen** — API keys, card/phone numbers, emails are never stored raw; ordinary long words are not over-redacted. → tests in Task 1.
5. **Lowering retention from 30 to 1 day** — older text disappears right away, not only at the next 6-hour run. → test in Task 5 (`runRetention`) + wiring in Task 6.

---

### Task 1: Redaction and exclusion helpers

**Files:**
- Create: `apps/consumer/src/shared/exclusions.ts`
- Create: `apps/consumer/src/main/screen/redact.ts`
- Create: `apps/consumer/src/main/screen/exclusions.ts`
- Test: `apps/consumer/src/main/screen/redact.test.ts`, `apps/consumer/src/main/screen/exclusions.test.ts`

**Interfaces:**
- Produces (shared, browser-safe): `DEFAULT_EXCLUSIONS: string[]`, `MAX_EXCLUSIONS = 40`, `MAX_PATTERN = 60`, `cleanPattern(raw: string): string`, `addExclusion(list: string[], raw: string): string[]`.
- Produces (main): `redact(text: string): string`, `MAX_READ_TEXT = 4000`; `isExcluded(patterns: string[], appName: string, title: string | null): boolean`, `parseExclusions(json: string): string[]`, `exclusionsInput` (zod).

- [ ] **Step 1: Failing tests**

`apps/consumer/src/main/screen/redact.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { redact, MAX_READ_TEXT } from './redact';

describe('redact', () => {
  it.each([
    ['mail me at aaron.s+work@example.co.uk now', 'mail me at [email] now'],
    ['card 4111 1111 1111 1111 exp', 'card [number] exp'],
    ['card 4111-1111-1111-1111', 'card [number]'],
    ['call +91 98765 43210', 'call +[number]'],
    ['code 12345678', 'code [number]'],
    ['key sk-proj-abcdefghijklmnop1234 end', 'key [secret] end'],
    ['token ghp_0123456789abcdefghijABCDEFGHIJ', 'token [secret]'],
    ['pat github_pat_11ABCDEFG0123456789_abcdefghijk', 'pat [secret]'],
    ['aws AKIAIOSFODNN7EXAMPLE', 'aws [secret]'],
    ['jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcDEF123', 'jwt [secret]'],
    ['sha da39a3ee5e6b4b0d3255bfef95601890afd80709', 'sha [secret]'],
    ['b64 QWxhZGRpbjpvcGVuIHNlc2FtZQ9876543210abcd==', 'b64 [secret]']
  ])('redacts %s', (input, expected) => {
    expect(redact(input)).toBe(expected);
  });
  it('keeps ordinary text, short numbers and long plain words', () => {
    const t = 'Room 101 on floor 3, pneumonoultramicroscopicsilicovolcanoconiosis is long, 2FA code 123456';
    expect(redact(t)).toBe(t);
  });
  it('truncates to 4000 characters after redaction', () => {
    expect(redact('x '.repeat(5000))).toHaveLength(MAX_READ_TEXT);
  });
});
```

`apps/consumer/src/main/screen/exclusions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_EXCLUSIONS, MAX_EXCLUSIONS, addExclusion } from '../../shared/exclusions';
import { exclusionsInput, isExcluded, parseExclusions } from './exclusions';

describe('isExcluded', () => {
  it('matches whole words in app name or title, case-insensitively', () => {
    expect(isExcluded(DEFAULT_EXCLUSIONS, '1Password', 'Vault')).toBe(true);
    expect(isExcluded(DEFAULT_EXCLUSIONS, 'Google Chrome', 'Bank of Baroda - Google Chrome')).toBe(true);
    expect(isExcluded(DEFAULT_EXCLUSIONS, 'Microsoft Edge', 'New tab - [InPrivate] - Microsoft Edge')).toBe(true);
    expect(isExcluded(DEFAULT_EXCLUSIONS, 'Google Chrome', 'Change your password - Google Chrome')).toBe(true);
  });
  it('does not match inside other words', () => {
    expect(isExcluded(DEFAULT_EXCLUSIONS, 'Google Chrome', 'Bankai - Bleach Wiki')).toBe(false);
    expect(isExcluded(DEFAULT_EXCLUSIONS, 'Visual Studio Code', 'passwordless.ts')).toBe(false);
    expect(isExcluded(DEFAULT_EXCLUSIONS, 'Visual Studio Code', null)).toBe(false);
  });
  it('escapes regex characters in patterns', () => {
    expect(isExcluded(['C++ (secret)'], 'Editor', 'notes C++ (secret) draft')).toBe(true);
    expect(isExcluded(['a.b'], 'axb', null)).toBe(false);
  });
});

describe('addExclusion', () => {
  it('adds a cleaned, unique pattern', () => {
    expect(addExclusion(['bank'], '  My   Journal ')).toEqual(['bank', 'My Journal']);
    expect(addExclusion(['bank'], 'BANK')).toEqual(['bank']);
    expect(addExclusion(['bank'], '   ')).toEqual(['bank']);
    expect(addExclusion(['bank'], 'x'.repeat(61))).toEqual(['bank']);
    expect(addExclusion(['bank'], 'a\u0007b')).toEqual(['bank']);
  });
  it('stops at 40 patterns', () => {
    const full = Array.from({ length: MAX_EXCLUSIONS }, (_, i) => `p${i}`);
    expect(addExclusion(full, 'new')).toBe(full);
  });
});

describe('parseExclusions / exclusionsInput', () => {
  it('falls back to defaults on corrupt data, keeps an explicitly empty list', () => {
    expect(parseExclusions('{bad')).toEqual(DEFAULT_EXCLUSIONS);
    expect(parseExclusions('"x"')).toEqual(DEFAULT_EXCLUSIONS);
    expect(parseExclusions('[]')).toEqual([]);
    expect(parseExclusions('["ok", 5, "", "ok2"]')).toEqual(['ok', 'ok2']);
  });
  it('validates the IPC payload', () => {
    expect(exclusionsInput.parse(['  a  b ', 'c'])).toEqual(['a b', 'c']);
    expect(exclusionsInput.safeParse(['a', 'A']).success).toBe(false);
    expect(exclusionsInput.safeParse(['']).success).toBe(false);
    expect(exclusionsInput.safeParse(['x'.repeat(61)]).success).toBe(false);
    expect(exclusionsInput.safeParse(Array.from({ length: 41 }, (_, i) => `p${i}`)).success).toBe(false);
    expect(exclusionsInput.safeParse(['a\nb']).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @worksight/consumer test`
Expected: FAIL — cannot resolve `./redact`, `./exclusions`, `../../shared/exclusions`.

- [ ] **Step 3: Implement**

`apps/consumer/src/shared/exclusions.ts`:

```ts
// Browser-safe exclusion list helpers (renderer edits the list; main validates and matches).
export const DEFAULT_EXCLUSIONS: string[] = [
  '1Password', 'Bitwarden', 'KeePass', 'KeePassXC', 'LastPass', 'Dashlane', 'Windows Security', 'Credential Manager',
  'InPrivate', 'Incognito', 'Private Browsing', 'bank', 'banking', 'PayPal', 'password'
];
export const MAX_EXCLUSIONS = 40;
export const MAX_PATTERN = 60;
const CONTROL = /[\u0000-\u001f\u007f]/;

export const cleanPattern = (raw: string): string => raw.trim().replace(/\s+/g, ' ');

/** Returns the list with `raw` added, or the same list when it is empty, too long, invalid, duplicate or the list is full. */
export function addExclusion(list: string[], raw: string): string[] {
  if (CONTROL.test(raw)) return list;
  const v = cleanPattern(raw);
  if (!v || v.length > MAX_PATTERN || list.length >= MAX_EXCLUSIONS) return list;
  if (list.some((p) => p.toLowerCase() === v.toLowerCase())) return list;
  return [...list, v];
}
```

`apps/consumer/src/main/screen/exclusions.ts`:

```ts
import { z } from 'zod';
import { DEFAULT_EXCLUSIONS, MAX_EXCLUSIONS, MAX_PATTERN, cleanPattern } from '../../shared/exclusions';

const CONTROL = /[\u0000-\u001f\u007f]/;
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Whole-word match that also works for patterns starting/ending with symbols ("C++", "1Password").
const matcher = (p: string): RegExp => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(p)}(?![\\p{L}\\p{N}])`, 'iu');

export function isExcluded(patterns: string[], appName: string, title: string | null): boolean {
  return patterns.some((p) => {
    const re = matcher(p);
    return re.test(appName) || (title !== null && re.test(title));
  });
}

/** Stored JSON → list; anything that isn't a JSON array falls back to the defaults. Invalid entries are dropped. */
export function parseExclusions(json: string): string[] {
  try {
    const v: unknown = JSON.parse(json);
    if (!Array.isArray(v)) return [...DEFAULT_EXCLUSIONS];
    return v.filter((p): p is string => typeof p === 'string' && !CONTROL.test(p) && cleanPattern(p).length > 0 && p.length <= MAX_PATTERN)
      .map(cleanPattern).slice(0, MAX_EXCLUSIONS);
  } catch {
    return [...DEFAULT_EXCLUSIONS];
  }
}

/** IPC trust boundary for privacy:setExclusions. */
export const exclusionsInput = z.array(
  z.string().refine((s) => !CONTROL.test(s), 'control characters').transform(cleanPattern).pipe(z.string().min(1).max(MAX_PATTERN))
).max(MAX_EXCLUSIONS).refine((a) => new Set(a.map((s) => s.toLowerCase())).size === a.length, 'duplicate pattern');
```

`apps/consumer/src/main/screen/redact.ts`:

```ts
export const MAX_READ_TEXT = 4000;

// Order matters: emails and structured secrets first, generic runs last.
const RULES: [RegExp, string][] = [
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]'],
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}(?:\.[A-Za-z0-9_-]+)?/g, '[secret]'],
  [/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})/g, '[secret]'],
  [/\b[A-Fa-f0-9]{32,}\b/g, '[secret]'],
  // base64-like: 32+ chars that contain both a letter and a digit (so long plain words survive)
  [/(?=[A-Za-z0-9+/_-]*\d)(?=[A-Za-z0-9+/_-]*[A-Za-z])[A-Za-z0-9+/_-]{32,}={0,2}/g, '[secret]'],
  // ponytail: 8+ digits with single spaces/dashes — also catches ISO dates (2026-09-24); acceptable loss for now.
  [/\d(?:[ -]?\d){7,}/g, '[number]']
];

export function redact(text: string): string {
  let t = text;
  for (const [re, rep] of RULES) t = t.replace(re, rep);
  return t.slice(0, MAX_READ_TEXT);
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @worksight/consumer test`
Expected: PASS. If a redaction case fails because two rules interact (e.g. a token also matching the base64 rule first), fix the RULE ORDER or the regex, not the expectation; note it in the report.

- [ ] **Step 5: Commit**

```bash
git add apps/consumer/src/shared/exclusions.ts apps/consumer/src/main/screen/redact.ts apps/consumer/src/main/screen/redact.test.ts apps/consumer/src/main/screen/exclusions.ts apps/consumer/src/main/screen/exclusions.test.ts
git commit -m "feat(consumer): screen-text redaction and exclusion helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: Screen-read store, data actions, settings keys

**Files:**
- Create: `apps/consumer/src/main/screen/store.ts`
- Test: `apps/consumer/src/main/screen/store.test.ts`
- Modify: `apps/consumer/src/main/settings.ts`, `apps/consumer/src/main/settings.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_EXCLUSIONS` (Task 1); core `SCHEMA_SQL`; `Profile`, `readProfile` (existing `src/main/profile.ts`).
- Produces:
  ```ts
  export const SCREEN_SCHEMA: string;
  export interface ScreenReadInput { at: number; date: string; appName: string; windowTitle: string | null; text: string | null; textHash: string }
  export interface ScreenReadRow extends ScreenReadInput { id: number }
  export interface ScreenStore { insert(r: ScreenReadInput): number; last(): ScreenReadRow | null; lastWithText(): ScreenReadRow | null; purgeTextBefore(ms: number): number }
  export function createScreenStore(db: Database.Database): ScreenStore;
  export function deleteActivity(db: Database.Database): void;
  export interface ExportData { exportedAt: number; settings: DaylensSettings; profile: Profile; focusSessions: unknown[]; appEvents: unknown[]; activitySamples: unknown[]; screenReads: unknown[] }
  export function exportAll(db: Database.Database, settings: DaylensSettings, profile: Profile, now: number): ExportData;
  ```
  Settings gain `screenReading: false`, `rawTextRetentionDays: 7`, `readIntervalSec: 30`, `exclusions: JSON.stringify(DEFAULT_EXCLUSIONS)`; `settingsPatch` gains `screenReading: z.boolean()`, `rawTextRetentionDays: z.union([z.literal(1), z.literal(7), z.literal(30)])`.

- [ ] **Step 1: Settings keys**

In `apps/consumer/src/main/settings.ts` add the import and keys:

```ts
import { DEFAULT_EXCLUSIONS } from '../shared/exclusions';
```

```ts
  profileDistractions: '[]',
  screenReading: false,
  rawTextRetentionDays: 7,
  readIntervalSec: 30,
  exclusions: JSON.stringify(DEFAULT_EXCLUSIONS)
```

and in `settingsPatch` add (before `}).partial().strict();`):

```ts
  screenReading: z.boolean(),
  rawTextRetentionDays: z.union([z.literal(1), z.literal(7), z.literal(30)])
```

Append to `apps/consumer/src/main/settings.test.ts` (inside the existing file, new describe):

```ts
describe('privacy settings', () => {
  it('defaults screen reading off with 7-day retention', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ screenReading: false, rawTextRetentionDays: 7, readIntervalSec: 30 });
    expect(JSON.parse(DEFAULT_SETTINGS.exclusions)).toContain('1Password');
  });
  it('lets the renderer set screen reading and retention 1/7/30 only', () => {
    expect(settingsPatch.parse({ screenReading: true, rawTextRetentionDays: 30 })).toEqual({ screenReading: true, rawTextRetentionDays: 30 });
    expect(settingsPatch.safeParse({ rawTextRetentionDays: 2 }).success).toBe(false);
    expect(settingsPatch.safeParse({ exclusions: '[]' }).success).toBe(false);
    expect(settingsPatch.safeParse({ readIntervalSec: 5 }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Failing store tests**

`apps/consumer/src/main/screen/store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL, createRepositories } from '@worksight/core';
import { DEFAULT_SETTINGS } from '../settings';
import { DEFAULT_PROFILE } from '../../shared/profileOptions';
import { SCREEN_SCHEMA, createScreenStore, deleteActivity, exportAll, type ScreenReadInput } from './store';

let db: Database.Database;
beforeEach(() => { db = new Database(':memory:'); db.exec(SCHEMA_SQL); db.exec(SCREEN_SCHEMA); });
const read = (at: number, text: string | null, hash = 'h' + at): ScreenReadInput =>
  ({ at, date: '2026-09-24', appName: 'Code', windowTitle: 'a.ts', text, textHash: hash });

describe('screen store', () => {
  it('schema is idempotent', () => { expect(() => db.exec(SCREEN_SCHEMA)).not.toThrow(); });
  it('inserts and returns the latest read, and the latest read that has text', () => {
    const s = createScreenStore(db);
    s.insert(read(1000, 'first'));
    s.insert(read(2000, null, 'h1000'));
    expect(s.last()).toMatchObject({ at: 2000, text: null, textHash: 'h1000', appName: 'Code', windowTitle: 'a.ts' });
    expect(s.lastWithText()).toMatchObject({ at: 1000, text: 'first' });
  });
  it('returns null when empty', () => {
    const s = createScreenStore(db);
    expect(s.last()).toBeNull();
    expect(s.lastWithText()).toBeNull();
  });
  it('purges text older than a cutoff but keeps the rows', () => {
    const s = createScreenStore(db);
    s.insert(read(1000, 'old'));
    s.insert(read(5000, 'new'));
    expect(s.purgeTextBefore(3000)).toBe(1);
    expect(db.prepare('SELECT count(*) AS n FROM screen_reads').get()).toEqual({ n: 2 });
    expect(s.lastWithText()).toMatchObject({ text: 'new' });
  });
});

describe('deleteActivity', () => {
  it('removes activity and screen reads but keeps settings', () => {
    const repo = createRepositories(db);
    const id = repo.startFocusSession({ appName: 'Code', appPath: null, windowTitle: null, pid: 1, startedAt: 1, date: '2026-09-24' });
    repo.finalizeFocusSession(id, 60_000);
    repo.insertAppEvent({ appName: 'Code', appPath: null, pid: 1, type: 'opened', at: 1, date: '2026-09-24' });
    repo.insertActivitySample({ bucketStart: 0, bucketEnd: 60_000, mouseMoves: 1, mouseDistancePx: 1, clicks: 0, scrolls: 0, keyEvents: 0, active: 1, appName: 'Code', date: '2026-09-24' });
    createScreenStore(db).insert(read(1000, 'x'));
    db.prepare("INSERT INTO settings (key, value) VALUES ('consentGranted', 'true')").run();
    deleteActivity(db);
    for (const t of ['focus_sessions', 'app_events', 'activity_samples', 'daily_summaries', 'screen_reads']) {
      expect(db.prepare(`SELECT count(*) AS n FROM ${t}`).get()).toEqual({ n: 0 });
    }
    expect(db.prepare('SELECT count(*) AS n FROM settings').get()).toEqual({ n: 1 });
  });
});

describe('exportAll', () => {
  it('exports every table plus settings and profile', () => {
    createScreenStore(db).insert(read(1000, 'x'));
    const out = exportAll(db, DEFAULT_SETTINGS, DEFAULT_PROFILE, 42);
    expect(Object.keys(out).sort()).toEqual(['activitySamples', 'appEvents', 'exportedAt', 'focusSessions', 'profile', 'screenReads', 'settings']);
    expect(out.exportedAt).toBe(42);
    expect(out.screenReads).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run to confirm failure**

Run: `pnpm --filter @worksight/consumer test`
Expected: FAIL — cannot resolve `./store`.

- [ ] **Step 4: Implement**

`apps/consumer/src/main/screen/store.ts`:

```ts
import type Database from 'better-sqlite3';
import type { DaylensSettings } from '../settings';
import type { Profile } from '../../shared/profileOptions';

export const SCREEN_SCHEMA = `
CREATE TABLE IF NOT EXISTS screen_reads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL, date TEXT NOT NULL,
  app_name TEXT NOT NULL, window_title TEXT,
  text TEXT,
  text_hash TEXT NOT NULL,
  category TEXT, category_conf REAL, activity TEXT, activity_conf REAL,
  stuck REAL, distraction REAL, labeled_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_reads_date ON screen_reads(date, at);
`;

export interface ScreenReadInput { at: number; date: string; appName: string; windowTitle: string | null; text: string | null; textHash: string; }
export interface ScreenReadRow extends ScreenReadInput { id: number; }
export interface ScreenStore {
  insert(r: ScreenReadInput): number;
  last(): ScreenReadRow | null;
  lastWithText(): ScreenReadRow | null;
  purgeTextBefore(ms: number): number;
}

const COLS = 'id, at, date, app_name AS appName, window_title AS windowTitle, text, text_hash AS textHash';

export function createScreenStore(db: Database.Database): ScreenStore {
  const ins = db.prepare('INSERT INTO screen_reads (at, date, app_name, window_title, text, text_hash) VALUES (@at, @date, @appName, @windowTitle, @text, @textHash)');
  const lastQ = db.prepare(`SELECT ${COLS} FROM screen_reads ORDER BY at DESC, id DESC LIMIT 1`);
  const lastTextQ = db.prepare(`SELECT ${COLS} FROM screen_reads WHERE text IS NOT NULL ORDER BY at DESC, id DESC LIMIT 1`);
  const purge = db.prepare('UPDATE screen_reads SET text = NULL WHERE at < ? AND text IS NOT NULL');
  return {
    insert: (r) => Number(ins.run(r).lastInsertRowid),
    last: () => (lastQ.get() as ScreenReadRow | undefined) ?? null,
    lastWithText: () => (lastTextQ.get() as ScreenReadRow | undefined) ?? null,
    purgeTextBefore: (ms) => purge.run(ms).changes
  };
}

/** "Delete my activity": everything tracked and read; settings, profile and consent are kept. */
export function deleteActivity(db: Database.Database): void {
  db.transaction(() => {
    db.exec('DELETE FROM focus_sessions; DELETE FROM app_events; DELETE FROM activity_samples; DELETE FROM daily_summaries; DELETE FROM screen_reads;');
  })();
}

export interface ExportData {
  exportedAt: number; settings: DaylensSettings; profile: Profile;
  focusSessions: unknown[]; appEvents: unknown[]; activitySamples: unknown[]; screenReads: unknown[];
}

export function exportAll(db: Database.Database, settings: DaylensSettings, profile: Profile, now: number): ExportData {
  const all = (t: string): unknown[] => db.prepare(`SELECT * FROM ${t} ORDER BY id`).all();
  return {
    exportedAt: now, settings, profile,
    focusSessions: all('focus_sessions'), appEvents: all('app_events'),
    activitySamples: all('activity_samples'), screenReads: all('screen_reads')
  };
}
```

- [ ] **Step 5: Run tests, typecheck, commit**

```bash
pnpm --filter @worksight/consumer test && pnpm --filter @worksight/consumer typecheck
git add apps/consumer/src/main/screen/store.ts apps/consumer/src/main/screen/store.test.ts apps/consumer/src/main/settings.ts apps/consumer/src/main/settings.test.ts
git commit -m "feat(consumer): screen_reads store, delete/export actions, privacy settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: OCR helper — CAPTURE op (protocol v2)

**Files:**
- Modify: `apps/consumer/resources/ocr-helper.ps1`
- Modify: `apps/consumer/scripts/bench-ocr.mjs`

**Interfaces:**
- Produces (helper protocol): existing ready line and `"<id> <base64 png>"` unchanged; new request `"<id> CAPTURE"` → `{"id","text","ms","pid","title","w","h"}` or `{"id","error":"no_window"}` / `{"id","error":"<message>"}`.

- [ ] **Step 1: Helper**

Replace `apps/consumer/resources/ocr-helper.ps1` with:

```powershell
# Daylens OCR helper: long-lived Windows PowerShell 5.1 process wrapping Windows.Media.Ocr (built into Windows 10/11).
# Protocol (stdin lines → stdout JSON lines):
#   "<id> CAPTURE"       capture the foreground window in memory and OCR it → {id,text,ms,pid,title,w,h} | {id,error}
#   "<id> <base64 png>"  OCR a PNG (dev bench)                              → {id,text,ms} | {id,error}
# Images live only in this process's memory; nothing is written to disk.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class DaylensFg {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
}
"@
# Per-monitor DPI aware (v2) so window bounds and screen copies use physical pixels.
[void][DaylensFg]::SetProcessDpiAwarenessContext([IntPtr]::new(-4))

$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataWriter, Windows.Storage.Streams, ContentType = WindowsRuntime]

$asTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
function Await($op, [Type]$type) {
  $task = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))
  $task.Wait(-1) | Out-Null
  $task.Result
}
function Emit($obj) { [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress)) }

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) { Emit @{ ready = $false; error = 'no_ocr_language' }; exit 2 }
$maxDim = [int][Windows.Media.Ocr.OcrEngine]::MaxImageDimension

function Ocr-Bytes([byte[]]$bytes) {
  $stream = $null; $writer = $null; $bitmap = $null
  try {
    $stream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
    $writer = New-Object Windows.Storage.Streams.DataWriter($stream)
    $writer.WriteBytes($bytes)
    $null = Await ($writer.StoreAsync()) ([UInt32])
    $null = $writer.DetachStream()
    $stream.Seek(0)
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    return (($result.Lines | ForEach-Object { $_.Text }) -join "`n")
  } finally {
    if ($null -ne $bitmap) { $bitmap.Dispose() }
    if ($null -ne $writer) { $writer.Dispose() }
    if ($null -ne $stream) { $stream.Dispose() }
  }
}

function Capture-Foreground {
  $h = [DaylensFg]::GetForegroundWindow()
  if ($h -eq [IntPtr]::Zero -or [DaylensFg]::IsIconic($h)) { return $null }
  $r = New-Object 'DaylensFg+RECT'
  if ([DaylensFg]::DwmGetWindowAttribute($h, 9, [ref]$r, 16) -ne 0) { return $null } # DWMWA_EXTENDED_FRAME_BOUNDS
  $w = $r.Right - $r.Left; $hh = $r.Bottom - $r.Top
  if ($w -le 0 -or $hh -le 0) { return $null }
  [uint32]$procId = 0
  [void][DaylensFg]::GetWindowThreadProcessId($h, [ref]$procId)
  $sb = New-Object System.Text.StringBuilder 512
  [void][DaylensFg]::GetWindowText($h, $sb, 512)
  $bmp = $null; $scaled = $null; $ms = $null
  try {
    $bmp = New-Object System.Drawing.Bitmap $w, $hh
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try { $g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size) } finally { $g.Dispose() }
    $src = $bmp
    if ($w -gt $maxDim -or $hh -gt $maxDim) {
      $k = [Math]::Min($maxDim / $w, $maxDim / $hh)
      $scaled = New-Object System.Drawing.Bitmap $bmp, ([int]($w * $k)), ([int]($hh * $k))
      $src = $scaled
    }
    $ms = New-Object System.IO.MemoryStream
    $src.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    return @{ bytes = $ms.ToArray(); pid = [int]$procId; title = $sb.ToString(); w = $w; h = $hh }
  } finally {
    if ($null -ne $ms) { $ms.Dispose() }
    if ($null -ne $scaled) { $scaled.Dispose() }
    if ($null -ne $bmp) { $bmp.Dispose() }
  }
}

Emit @{ ready = $true }

while ($null -ne ($line = [Console]::In.ReadLine())) {
  $sp = $line.IndexOf(' ')
  $id = if ($sp -gt 0) { $line.Substring(0, $sp) } else { $line }
  try {
    if ($sp -le 0) { throw 'malformed request' }
    $arg = $line.Substring($sp + 1)
    $sw = [Diagnostics.Stopwatch]::StartNew()
    if ($arg -eq 'CAPTURE') {
      $cap = Capture-Foreground
      if ($null -eq $cap) { Emit @{ id = $id; error = 'no_window' }; continue }
      $text = Ocr-Bytes $cap.bytes
      Emit @{ id = $id; text = $text; ms = $sw.ElapsedMilliseconds; pid = $cap.pid; title = $cap.title; w = $cap.w; h = $cap.h }
    } else {
      $text = Ocr-Bytes ([Convert]::FromBase64String($arg))
      Emit @{ id = $id; text = $text; ms = $sw.ElapsedMilliseconds }
    }
  } catch {
    Emit @{ id = $id; error = "$($_.Exception.Message)" }
  }
}
```

- [ ] **Step 2: Bench capture mode (metadata only)**

In `apps/consumer/scripts/bench-ocr.mjs`, add a capture mode directly after the existing `const helper = fileURLToPath(...)` line, so it runs (and exits) when invoked as `node apps/consumer/scripts/bench-ocr.mjs capture`, before the existing screen-capture code:

```js
if (process.argv[2] === 'capture') {
  // Captures whatever window is in front. Prints METADATA ONLY (never the OCR text: it may be private).
  const p = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', helper], { stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = createInterface({ input: p.stdout });
  const next = () => new Promise((res) => lines.once('line', (l) => res(JSON.parse(l))));
  console.log('ready', await next());
  const walls = [];
  for (let i = 0; i < 10; i++) {
    const s = Date.now();
    p.stdin.write(`${i} CAPTURE\n`);
    const r = await next();
    walls.push(Date.now() - s);
    console.log(r.error ? `#${i} error=${r.error}` : `#${i} pid=${r.pid} ${r.w}x${r.h} chars=${r.text.length} titleChars=${r.title.length} helperMs=${r.ms}`);
  }
  p.stdin.end();
  walls.sort((a, b) => a - b);
  console.log(`median ${walls[5]} ms, max ${walls[9]} ms`);
  process.exit(0);
}
```

(Uses the file's existing `spawn`/`createInterface` imports and `helper` path; the file already uses top-level await.)

- [ ] **Step 3: Verify on the real machine**

```bash
node apps/consumer/scripts/bench-ocr.mjs capture
node apps/consumer/scripts/bench-ocr.mjs
```

Expected: `ready {"ready":true}`; 10 lines with a real `pid`, plausible `WxH` (physical pixels of the front window), `chars` > 0 for a window with text; median well under 1 s; the original PNG bench still works. Record numbers only (never paste OCR text). If `SetProcessDpiAwarenessContext` or `Add-Type` fails, report the exact error.

- [ ] **Step 4: Commit**

```bash
git add apps/consumer/resources/ocr-helper.ps1 apps/consumer/scripts/bench-ocr.mjs
git commit -m "feat(consumer): OCR helper CAPTURE op (foreground window, in-memory, DPI-aware)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: Supervised OCR client

**Files:**
- Create: `apps/consumer/src/main/ocr/client.ts`
- Test: `apps/consumer/src/main/ocr/client.test.ts`

**Interfaces:**
- Consumes: helper protocol (Task 3).
- Produces:
  ```ts
  export type OcrStatus = 'off' | 'starting' | 'ready' | 'no-language' | 'restarting' | 'failed';
  export interface CaptureResult { text: string; ms: number; pid: number; title: string; w: number; h: number }
  export interface ChildLike { stdin: { write(s: string): unknown; end(): unknown }; stdout: NodeJS.ReadableStream; on(ev: 'exit', cb: (code: number | null) => void): unknown; kill(): unknown }
  export interface OcrClient { start(): void; stop(): void; capture(): Promise<CaptureResult | null>; status(): OcrStatus }
  export function createOcrClient(deps: { spawn: () => ChildLike; onStatus?: (s: OcrStatus) => void; timeoutMs?: number }): OcrClient;
  export const RESTART_DELAYS_MS: readonly [1000, 5000, 30000];
  ```

- [ ] **Step 1: Failing tests**

`apps/consumer/src/main/ocr/client.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createOcrClient, type ChildLike, type OcrStatus } from './client';

class FakeChild extends EventEmitter implements ChildLike {
  stdout = new PassThrough();
  written: string[] = [];
  killed = false;
  stdin = { write: (s: string) => { this.written.push(s); return true; }, end: () => undefined };
  kill() { this.killed = true; this.emit('exit', null); return true; }
  say(obj: unknown) { this.stdout.write(JSON.stringify(obj) + '\n'); }
}

const flush = () => new Promise<void>((r) => setImmediate(r));
let children: FakeChild[];
let statuses: OcrStatus[];
const make = () => createOcrClient({
  spawn: () => { const c = new FakeChild(); children.push(c); return c; },
  onStatus: (s) => statuses.push(s)
});

beforeEach(() => { children = []; statuses = []; vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }); });
afterEach(() => { vi.useRealTimers(); });

describe('ocr client', () => {
  it('starts, becomes ready, and captures', async () => {
    const c = make();
    expect(c.status()).toBe('off');
    c.start();
    expect(c.status()).toBe('starting');
    children[0].say({ ready: true });
    await flush();
    expect(c.status()).toBe('ready');
    const p = c.capture();
    expect(children[0].written).toEqual(['1 CAPTURE\n']);
    children[0].say({ id: '1', text: 'hello', ms: 50, pid: 42, title: 'T', w: 800, h: 600 });
    await flush();
    await expect(p).resolves.toEqual({ text: 'hello', ms: 50, pid: 42, title: 'T', w: 800, h: 600 });
  });

  it('returns null when not ready, for no_window, and while a request is in flight', async () => {
    const c = make();
    await expect(c.capture()).resolves.toBeNull();
    c.start(); children[0].say({ ready: true }); await flush();
    const p1 = c.capture();
    await expect(c.capture()).resolves.toBeNull();
    children[0].say({ id: '1', error: 'no_window' }); await flush();
    await expect(p1).resolves.toBeNull();
  });

  it('reports no-language and does not restart', async () => {
    const c = make();
    c.start();
    children[0].say({ ready: false, error: 'no_ocr_language' }); await flush();
    children[0].emit('exit', 2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(c.status()).toBe('no-language');
    expect(children).toHaveLength(1);
  });

  it('times out a hung capture, kills the helper and restarts after 1 s', async () => {
    const c = make();
    c.start(); children[0].say({ ready: true }); await flush();
    const p = c.capture();
    await vi.advanceTimersByTimeAsync(8000);
    await expect(p).resolves.toBeNull();
    expect(children[0].killed).toBe(true);
    expect(c.status()).toBe('restarting');
    await vi.advanceTimersByTimeAsync(1000);
    expect(children).toHaveLength(2);
    expect(c.status()).toBe('starting');
  });

  it('backs off 1 s, 5 s, 30 s and fails after more than 3 crashes in 10 minutes', async () => {
    const c = make();
    c.start();
    children[0].emit('exit', 1); await vi.advanceTimersByTimeAsync(1000); expect(children).toHaveLength(2);
    children[1].emit('exit', 1); await vi.advanceTimersByTimeAsync(4999); expect(children).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1); expect(children).toHaveLength(3);
    children[2].emit('exit', 1); await vi.advanceTimersByTimeAsync(30_000); expect(children).toHaveLength(4);
    children[3].emit('exit', 1); await vi.advanceTimersByTimeAsync(60_000);
    expect(children).toHaveLength(4);
    expect(c.status()).toBe('failed');
  });

  it('stop() ends the helper without restarting, and stop/start clears a failure', async () => {
    const c = make();
    c.start(); children[0].say({ ready: true }); await flush();
    c.stop();
    expect(children[0].killed).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(children).toHaveLength(1);
    expect(c.status()).toBe('off');
    c.start();
    expect(children).toHaveLength(2);
    expect(statuses).toContain('off');
  });

  it('start() is idempotent while running', () => {
    const c = make();
    c.start(); c.start();
    expect(children).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd apps/consumer && npx vitest run src/main/ocr/client.test.ts`
Expected: FAIL — cannot resolve `./client`.

- [ ] **Step 3: Implement**

`apps/consumer/src/main/ocr/client.ts`:

```ts
import { createInterface } from 'node:readline';

export type OcrStatus = 'off' | 'starting' | 'ready' | 'no-language' | 'restarting' | 'failed';
export interface CaptureResult { text: string; ms: number; pid: number; title: string; w: number; h: number; }
export interface ChildLike {
  stdin: { write(s: string): unknown; end(): unknown };
  stdout: NodeJS.ReadableStream;
  on(ev: 'exit', cb: (code: number | null) => void): unknown;
  kill(): unknown;
}
export interface OcrClient { start(): void; stop(): void; capture(): Promise<CaptureResult | null>; status(): OcrStatus; }

export const RESTART_DELAYS_MS = [1000, 5000, 30000] as const;
const CRASH_WINDOW_MS = 10 * 60_000;
const MAX_CRASHES = 3; // more than this within the window → failed

type Reply = { id?: string; ready?: boolean; error?: string; text?: string; ms?: number; pid?: number; title?: string; w?: number; h?: number };

export function createOcrClient(deps: { spawn: () => ChildLike; onStatus?: (s: OcrStatus) => void; timeoutMs?: number }): OcrClient {
  const timeoutMs = deps.timeoutMs ?? 8000;
  let status: OcrStatus = 'off';
  let child: ChildLike | null = null;
  let seq = 0;
  let pending: { id: string; resolve: (r: CaptureResult | null) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let crashes: number[] = [];

  const setStatus = (s: OcrStatus): void => { if (s !== status) { status = s; deps.onStatus?.(s); } };
  const settle = (r: CaptureResult | null): void => {
    if (!pending) return;
    clearTimeout(pending.timer);
    const { resolve } = pending;
    pending = null;
    resolve(r);
  };

  function onLine(line: string): void {
    let msg: Reply;
    try { msg = JSON.parse(line) as Reply; } catch { return; }
    if (msg.ready === true) { setStatus('ready'); return; }
    if (msg.ready === false) { setStatus('no-language'); return; }
    if (!pending || msg.id !== pending.id) return;
    if (msg.error || typeof msg.text !== 'string') { settle(null); return; }
    settle({ text: msg.text, ms: msg.ms ?? 0, pid: msg.pid ?? -1, title: msg.title ?? '', w: msg.w ?? 0, h: msg.h ?? 0 });
  }

  function spawnChild(): void {
    restartTimer = null;
    setStatus('starting');
    const c = deps.spawn();
    child = c;
    createInterface({ input: c.stdout }).on('line', onLine);
    c.on('exit', () => {
      if (child !== c) return; // an old, already-replaced child
      child = null;
      settle(null);
      if (status === 'off' || status === 'no-language') return;
      const now = Date.now();
      crashes = [...crashes.filter((t) => now - t < CRASH_WINDOW_MS), now];
      if (crashes.length > MAX_CRASHES) { setStatus('failed'); return; }
      setStatus('restarting');
      restartTimer = setTimeout(spawnChild, RESTART_DELAYS_MS[Math.min(crashes.length, RESTART_DELAYS_MS.length) - 1]);
    });
  }

  return {
    start() {
      if (status !== 'off') return;
      crashes = [];
      spawnChild();
    },
    stop() {
      if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
      setStatus('off');
      settle(null);
      const c = child;
      child = null;
      if (c) { c.stdin.end(); c.kill(); }
    },
    capture() {
      if (status !== 'ready' || !child || pending) return Promise.resolve(null);
      const id = String(++seq);
      const c = child;
      return new Promise((resolve) => {
        const timer = setTimeout(() => { settle(null); c.kill(); }, timeoutMs);
        pending = { id, resolve, timer };
        c.stdin.write(`${id} CAPTURE\n`);
      });
    },
    status: () => status
  };
}
```

Notes for the implementer: in the timeout path `c.kill()` makes the child exit, which runs the crash/restart path (status `restarting`, 1 s delay) — that is intended. `stop()` sets status `off` BEFORE killing so the exit handler does not restart. `start()` only acts from `off` (so `failed` requires stop → start, and `no-language` requires stop → start too).

- [ ] **Step 4: Run tests**

Run: `cd apps/consumer && npx vitest run src/main/ocr/client.test.ts` then `pnpm --filter @worksight/consumer test`
Expected: PASS. If a timing assertion is off by the backoff index, fix the implementation to match the documented sequence (1st crash → 1 s, 2nd → 5 s, 3rd → 30 s, 4th → failed), not the test.

- [ ] **Step 5: Commit**

```bash
git add apps/consumer/src/main/ocr/client.ts apps/consumer/src/main/ocr/client.test.ts
git commit -m "feat(consumer): supervised OCR helper client (timeouts, backoff, fail-safe)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: Screen reader + retention

**Files:**
- Create: `apps/consumer/src/main/screen/reader.ts`
- Test: `apps/consumer/src/main/screen/reader.test.ts`

**Interfaces:**
- Consumes: `redact` (Task 1), `isExcluded`, `parseExclusions` (Task 1), `ScreenStore` (Task 2), `OcrClient` (Task 4), core `ForegroundSource`, `localDate`.
- Produces:
  ```ts
  export type ReadOutcome = 'skipped-off' | 'skipped-idle' | 'skipped-excluded' | 'skipped-same' | 'no-capture' | 'discarded' | 'stored' | 'stored-dup';
  export const SAME_WINDOW_MS = 120_000;
  export interface ScreenReader { tick(): Promise<ReadOutcome> }
  export function createScreenReader(deps: { ocr: Pick<OcrClient, 'capture'>; foreground: ForegroundSource; settings: () => DaylensSettings; idleSec: () => number; store: ScreenStore; now: () => number }): ScreenReader;
  export function runRetention(store: ScreenStore, days: number, now: number): number;
  ```

- [ ] **Step 1: Failing tests**

`apps/consumer/src/main/screen/reader.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import type { ForegroundInfo } from '@worksight/core/types';
import { DEFAULT_SETTINGS, type DaylensSettings } from '../settings';
import { SCREEN_SCHEMA, createScreenStore, type ScreenStore } from './store';
import type { CaptureResult } from '../ocr/client';
import { createScreenReader, runRetention, SAME_WINDOW_MS } from './reader';

let store: ScreenStore;
let settings: DaylensSettings;
let fg: ForegroundInfo | null;
let cap: CaptureResult | null;
let captures: number;
let idle: number;
let now: number;

const reader = () => createScreenReader({
  ocr: { capture: async () => { captures++; return cap; } },
  foreground: { get: async () => fg },
  settings: () => settings, idleSec: () => idle, store, now: () => now
});

beforeEach(() => {
  const db = new Database(':memory:'); db.exec(SCREEN_SCHEMA);
  store = createScreenStore(db);
  settings = { ...DEFAULT_SETTINGS, consentGranted: true, screenReading: true };
  fg = { appName: 'Visual Studio Code', appPath: null, title: 'app.ts - proj', pid: 42 };
  cap = { text: 'const x = 1 // mail a@b.co', ms: 90, pid: 42, title: 'app.ts - proj', w: 800, h: 600 };
  captures = 0; idle = 0; now = new Date(2026, 8, 24, 10, 0).getTime();
});

describe('screen reader', () => {
  it('does nothing when off, not consented, or paused', async () => {
    for (const patch of [{ screenReading: false }, { consentGranted: false }, { trackingPaused: true }]) {
      settings = { ...DEFAULT_SETTINGS, consentGranted: true, screenReading: true, ...patch };
      await expect(reader().tick()).resolves.toBe('skipped-off');
    }
    expect(captures).toBe(0);
    expect(store.last()).toBeNull();
  });

  it('skips while idle', async () => {
    idle = settings.idleThresholdSec;
    await expect(reader().tick()).resolves.toBe('skipped-idle');
    expect(captures).toBe(0);
  });

  it('skips an excluded foreground app without capturing', async () => {
    fg = { appName: '1Password', appPath: null, title: 'Vault', pid: 7 };
    await expect(reader().tick()).resolves.toBe('skipped-excluded');
    expect(captures).toBe(0);
  });

  it('stores redacted text with app, title and date', async () => {
    await expect(reader().tick()).resolves.toBe('stored');
    expect(store.last()).toMatchObject({ appName: 'Visual Studio Code', windowTitle: 'app.ts - proj', text: 'const x = 1 // mail [email]', date: '2026-09-24', at: now });
  });

  it('discards a capture whose window changed to another process', async () => {
    cap = { ...cap!, pid: 99 };
    await expect(reader().tick()).resolves.toBe('discarded');
    expect(store.last()).toBeNull();
  });

  it('discards a capture whose actual window title is excluded (switched to a password page mid-capture)', async () => {
    cap = { ...cap!, title: 'Sign in - Bank of Baroda' };
    await expect(reader().tick()).resolves.toBe('discarded');
    expect(store.last()).toBeNull();
  });

  it('skips the same window within 2 minutes, then stores identical text as a duplicate', async () => {
    const r = reader();
    await r.tick();
    now += SAME_WINDOW_MS - 1;
    await expect(r.tick()).resolves.toBe('skipped-same');
    now += 1;
    await expect(r.tick()).resolves.toBe('stored-dup');
    expect(store.last()).toMatchObject({ text: null });
    expect(store.lastWithText()).toMatchObject({ text: 'const x = 1 // mail [email]' });
  });

  it('does not store window titles when title capture is off', async () => {
    settings = { ...settings, captureWindowTitles: false };
    await reader().tick();
    expect(store.last()).toMatchObject({ windowTitle: null });
  });

  it('reports no-capture when the helper returns nothing', async () => {
    cap = null;
    await expect(reader().tick()).resolves.toBe('no-capture');
    expect(store.last()).toBeNull();
  });
});

describe('runRetention', () => {
  it('erases text older than the retention window', async () => {
    await reader().tick();
    now += 2 * 86_400_000;
    expect(runRetention(store, 1, now)).toBe(1);
    expect(store.lastWithText()).toBeNull();
    expect(store.last()).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @worksight/consumer test`
Expected: FAIL — cannot resolve `./reader`.

- [ ] **Step 3: Implement**

`apps/consumer/src/main/screen/reader.ts`:

```ts
import { createHash } from 'node:crypto';
import type { ForegroundSource } from '@worksight/core';
import { localDate } from '@worksight/core/date';
import type { DaylensSettings } from '../settings';
import type { OcrClient } from '../ocr/client';
import type { ScreenStore } from './store';
import { redact } from './redact';
import { isExcluded, parseExclusions } from './exclusions';

export type ReadOutcome = 'skipped-off' | 'skipped-idle' | 'skipped-excluded' | 'skipped-same' | 'no-capture' | 'discarded' | 'stored' | 'stored-dup';
export const SAME_WINDOW_MS = 120_000;
export interface ScreenReader { tick(): Promise<ReadOutcome>; }

export function createScreenReader(deps: {
  ocr: Pick<OcrClient, 'capture'>; foreground: ForegroundSource; settings: () => DaylensSettings;
  idleSec: () => number; store: ScreenStore; now: () => number;
}): ScreenReader {
  return {
    async tick() {
      const s = deps.settings();
      if (!s.screenReading || !s.consentGranted || s.trackingPaused) return 'skipped-off';
      if (deps.idleSec() >= s.idleThresholdSec) return 'skipped-idle';
      const fg = await deps.foreground.get();
      if (!fg) return 'no-capture';
      const patterns = parseExclusions(s.exclusions);
      if (isExcluded(patterns, fg.appName, fg.title)) return 'skipped-excluded';
      const now = deps.now();
      const title = s.captureWindowTitles ? fg.title : null;
      const last = deps.store.last();
      if (last && last.appName === fg.appName && last.windowTitle === title && now - last.at < SAME_WINDOW_MS) return 'skipped-same';
      const cap = await deps.ocr.capture();
      if (!cap) return 'no-capture';
      // The window may have changed between the check above and the capture: never keep text from another
      // process or from an excluded window.
      if (cap.pid !== fg.pid || isExcluded(patterns, fg.appName, cap.title)) return 'discarded';
      const text = redact(cap.text);
      const textHash = createHash('sha1').update(text).digest('hex');
      const dup = last?.textHash === textHash;
      deps.store.insert({ at: now, date: localDate(now), appName: fg.appName, windowTitle: title, text: dup ? null : text, textHash });
      return dup ? 'stored-dup' : 'stored';
    }
  };
}

/** Erase stored text older than `days` (rows are kept for time accounting). Returns rows purged. */
export function runRetention(store: ScreenStore, days: number, now: number): number {
  return store.purgeTextBefore(now - days * 86_400_000);
}
```

- [ ] **Step 4: Run tests, typecheck, commit**

```bash
pnpm --filter @worksight/consumer test && pnpm --filter @worksight/consumer typecheck
git add apps/consumer/src/main/screen/reader.ts apps/consumer/src/main/screen/reader.test.ts
git commit -m "feat(consumer): screen reader (skip rules, mid-capture safety, dedupe) + retention

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: Main-process wiring + IPC + preload

**Files:**
- Modify: `apps/consumer/src/main/channels.ts`, `apps/consumer/src/main/ipc.ts`, `apps/consumer/src/main/index.ts`, `apps/consumer/src/preload/index.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–5; existing `readProfile`.
- Produces (preload → `window.daylens.privacy`):
  ```ts
  export interface PrivacyView { screenReading: boolean; retentionDays: number; exclusions: string[]; ocrStatus: OcrStatus; lastRead: { at: number; app: string; title: string | null; text: string } | null }
  privacy: {
    get(): Promise<PrivacyView>;
    setExclusions(list: string[]): Promise<PrivacyView>;
    export(): Promise<{ saved: boolean; path?: string }>;
    deleteActivity(): Promise<{ deleted: boolean }>;
    openLanguageSettings(): Promise<void>;
  }
  ```
  `PrivacyView` is exported from `src/main/ipc.ts`.

- [ ] **Step 1: Channels**

Add to `CH` in `apps/consumer/src/main/channels.ts`:

```ts
  privacyGet: 'privacy:get',
  privacySetExclusions: 'privacy:setExclusions',
  privacyExport: 'privacy:export',
  privacyDeleteActivity: 'privacy:deleteActivity',
  privacyOpenLanguageSettings: 'privacy:openLanguageSettings',
```

- [ ] **Step 2: IPC handlers**

In `apps/consumer/src/main/ipc.ts`:

Add imports:

```ts
import type { OcrStatus } from './ocr/client';
import type { ScreenReadRow } from './screen/store';
import { exclusionsInput, parseExclusions } from './screen/exclusions';
```

Add the exported view type and extend `IpcDeps`:

```ts
export interface PrivacyView {
  screenReading: boolean;
  retentionDays: number;
  exclusions: string[];
  ocrStatus: OcrStatus;
  lastRead: { at: number; app: string; title: string | null; text: string } | null;
}

export interface PrivacyDeps {
  ocrStatus(): OcrStatus;
  lastRead(): ScreenReadRow | null;
  exportData(): Promise<{ saved: boolean; path?: string }>;
  deleteActivity(): Promise<{ deleted: boolean }>;
  openLanguageSettings(): void;
}
```

and add `privacy: PrivacyDeps;` to `IpcDeps`. Inside `registerIpc` add:

```ts
  const privacyView = (): PrivacyView => {
    const s = d.settings.get();
    const r = d.privacy.lastRead();
    return {
      screenReading: s.screenReading, retentionDays: s.rawTextRetentionDays, exclusions: parseExclusions(s.exclusions),
      ocrStatus: d.privacy.ocrStatus(),
      lastRead: r && r.text !== null ? { at: r.at, app: r.appName, title: r.windowTitle, text: r.text } : null
    };
  };
  ipcMain.handle(CH.privacyGet, () => privacyView());
  ipcMain.handle(CH.privacySetExclusions, (_e, raw) => {
    d.settings.set({ exclusions: JSON.stringify(exclusionsInput.parse(raw)) });
    return privacyView();
  });
  ipcMain.handle(CH.privacyExport, () => d.privacy.exportData());
  ipcMain.handle(CH.privacyDeleteActivity, () => d.privacy.deleteActivity());
  ipcMain.handle(CH.privacyOpenLanguageSettings, () => { d.privacy.openLanguageSettings(); });
```

- [ ] **Step 3: Main wiring**

In `apps/consumer/src/main/index.ts`:

1. Imports — change the electron import to include `dialog, shell`, and add:

```ts
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { localDate } from '@worksight/core/date';
import { createOcrClient } from './ocr/client';
import { SCREEN_SCHEMA, createScreenStore, deleteActivity, exportAll } from './screen/store';
import { createScreenReader, runRetention } from './screen/reader';
import { readProfile } from './profile';
```

2. Right after `const settings = createKvStore(db, DEFAULT_SETTINGS);` add:

```ts
    db.exec(SCREEN_SCHEMA);
    const screenStore = createScreenStore(db);
    // ponytail: dev path; Phase 7 packaging must ship resources/ocr-helper.ps1 via extraResources.
    const helperPath = app.isPackaged ? join(process.resourcesPath, 'ocr-helper.ps1') : join(__dirname, '../../resources/ocr-helper.ps1');
    const ocr = createOcrClient({
      spawn: () => spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', helperPath], { windowsHide: true }),
      onStatus: () => win?.webContents.send(CH.eventsUpdate)
    });
```

3. After the tracker is created (after `stopTracking = () => tracker.stop();`) add:

```ts
    const reader = createScreenReader({
      ocr, foreground: new ActiveWinForegroundSource(), settings: () => settings.get(),
      idleSec: () => powerMonitor.getSystemIdleTime(), store: screenStore, now: () => Date.now()
    });
    // The helper process only exists while screen reading is allowed to run.
    const syncOcr = (): void => {
      const s = settings.get();
      if (s.screenReading && s.consentGranted && !s.trackingPaused) ocr.start(); else ocr.stop();
    };
    const retention = (): void => { runRetention(screenStore, settings.get().rawTextRetentionDays, Date.now()); };
    let reading = false;
    setInterval(() => {
      if (reading) return;
      reading = true;
      reader.tick().catch((e) => console.error('[screen] read failed:', e)).finally(() => { reading = false; });
    }, settings.get().readIntervalSec * 1000);
    setInterval(retention, 6 * 60 * 60 * 1000);
```

4. In `setTracking`, after `refreshTray();` add `syncOcr();`.

5. Replace the `registerIpc({ … })` call with:

```ts
    registerIpc({
      repo, settings, tracker, setTracking,
      onSettingsChanged: () => { applyLoginItem(); syncOcr(); retention(); },
      now: () => Date.now(),
      privacy: {
        ocrStatus: () => ocr.status(),
        lastRead: () => screenStore.lastWithText(),
        exportData: async () => {
          const r = await dialog.showSaveDialog(win!, {
            title: 'Export your Daylens data', defaultPath: `daylens-export-${localDate(Date.now())}.json`,
            filters: [{ name: 'JSON', extensions: ['json'] }]
          });
          if (r.canceled || !r.filePath) return { saved: false };
          const s = settings.get();
          writeFileSync(r.filePath, JSON.stringify(exportAll(db, s, readProfile(s), Date.now()), null, 2), 'utf8');
          return { saved: true, path: r.filePath };
        },
        deleteActivity: async () => {
          const r = await dialog.showMessageBox(win!, {
            type: 'warning', buttons: ['Delete', 'Cancel'], defaultId: 1, cancelId: 1, title: 'Delete my activity',
            message: 'Delete all your activity and screen text?',
            detail: "Screen time, app history and screen reads will be erased from this PC. Your settings and answers are kept. This can't be undone."
          });
          if (r.response !== 0) return { deleted: false };
          const s = settings.get();
          const wasRunning = s.consentGranted && !s.trackingPaused;
          tracker.stop();
          deleteActivity(db);
          if (wasRunning) tracker.start();
          win?.webContents.send(CH.eventsUpdate);
          return { deleted: true };
        },
        openLanguageSettings: () => { void shell.openExternal('ms-settings:regionlanguage'); }
      }
    });
```

6. After `applyLoginItem();` (startup) add `syncOcr(); retention();`.

7. In the `before-quit` handler add `ocr.stop();` (e.g. `app.on('before-quit', () => { quitting = true; tracker.stop(); ocr.stop(); });`).

- [ ] **Step 4: Preload**

In `apps/consumer/src/preload/index.ts` add `import type { PrivacyView } from '../main/ipc';` and the `privacy` member:

```ts
  privacy: {
    get: (): Promise<PrivacyView> => ipcRenderer.invoke(CH.privacyGet),
    setExclusions: (list: string[]): Promise<PrivacyView> => ipcRenderer.invoke(CH.privacySetExclusions, list),
    export: (): Promise<{ saved: boolean; path?: string }> => ipcRenderer.invoke(CH.privacyExport),
    deleteActivity: (): Promise<{ deleted: boolean }> => ipcRenderer.invoke(CH.privacyDeleteActivity),
    openLanguageSettings: (): Promise<void> => ipcRenderer.invoke(CH.privacyOpenLanguageSettings)
  },
```

- [ ] **Step 5: Verify and commit**

```bash
pnpm --filter @worksight/consumer typecheck && pnpm --filter @worksight/consumer test && pnpm --filter @worksight/consumer exec electron-vite build
```

Then a ~40 s background `pnpm --filter @worksight/consumer dev` launch: the log must be clean and **no `powershell.exe` child helper may be running** (screen reading defaults to off) — check with `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { $_.CommandLine -like '*ocr-helper*' } | Measure-Object | Select -Expand Count"` → `0`. Kill only your dev run's process tree (`ps -W` → WINPID → `taskkill //F //T //PID <winpid>`).

```bash
git add apps/consumer/src/main/channels.ts apps/consumer/src/main/ipc.ts apps/consumer/src/main/index.ts apps/consumer/src/preload/index.ts
git commit -m "feat(consumer): wire screen reader, OCR supervisor, retention and privacy IPC

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: Privacy section in Settings

**Files:**
- Create: `apps/consumer/src/renderer/components/PrivacySection.tsx`
- Modify: `apps/consumer/src/renderer/components/SettingsScreen.tsx`, `apps/consumer/src/renderer/styles.css`

**Interfaces:**
- Consumes: `api.privacy.*`, `api.settings.set`, `api.onUpdate` (Task 6); `PrivacyView` (type, `../../main/ipc`); `addExclusion`, `DEFAULT_EXCLUSIONS` (`../../shared/exclusions`); `formatClock` (`../lib/format`).
- Produces: `PrivacySection({ settings, onChange })` rendering 5 `.grp` groups; mounted first in SettingsScreen.

- [ ] **Step 1: Component**

`apps/consumer/src/renderer/components/PrivacySection.tsx`:

```tsx
import { useEffect, useState } from 'react';
import type { DaylensSettings } from '../../main/settings';
import type { PrivacyView } from '../../main/ipc';
import { DEFAULT_EXCLUSIONS, MAX_PATTERN, addExclusion } from '../../shared/exclusions';
import { api } from '../lib/api';
import { formatClock } from '../lib/format';

const STATUS_TEXT: Record<PrivacyView['ocrStatus'], string> = {
  off: 'Off', starting: 'Starting…', ready: 'Working', restarting: 'Restarting after an error…',
  'no-language': 'Windows has no text-recognition language installed',
  failed: 'Stopped after repeated errors. Turn it off and on to retry.'
};

export function PrivacySection({ settings, onChange }: { settings: DaylensSettings; onChange: (s: DaylensSettings) => void }) {
  const [view, setView] = useState<PrivacyView | null>(null);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState<string | null>(null);

  const load = (): void => { api.privacy.get().then(setView).catch((e) => console.error('[renderer] privacy.get failed:', e)); };
  useEffect(() => {
    load();
    const off = api.onUpdate(load);
    const t = setInterval(load, 30_000);
    return () => { off(); clearInterval(t); };
  }, [settings.screenReading, settings.rawTextRetentionDays, settings.trackingPaused]);

  const set = async (patch: { screenReading?: boolean; rawTextRetentionDays?: 1 | 7 | 30 }): Promise<void> => {
    try { onChange(await api.settings.set(patch)); } catch (e) { console.error(e); load(); }
  };
  const saveExclusions = async (list: string[]): Promise<void> => {
    try { setView(await api.privacy.setExclusions(list)); } catch (e) { console.error(e); load(); }
  };
  const add = (): void => {
    if (!view) return;
    const next = addExclusion(view.exclusions, draft);
    setDraft('');
    if (next !== view.exclusions) void saveExclusions(next);
  };

  if (!view) return null;
  const status = settings.trackingPaused && view.screenReading ? 'Paused (tracking is paused)' : STATUS_TEXT[view.ocrStatus];

  return (
    <>
      <div className="grp">
        <h4>Screen reading</h4>
        <div className="srow">
          <p>Read on-screen text
            <small>Reads the text of the window in front every 30 seconds so Daylens can understand what you're doing. The screenshot is never saved; only the text is kept, on this PC.</small>
          </p>
          <button className={`sw${view.screenReading ? ' on' : ''}`} aria-label="Read on-screen text" aria-pressed={view.screenReading}
            onClick={() => { void set({ screenReading: !view.screenReading }); }} />
        </div>
        <div className="srow">
          <p className="privacy-status" role="status">Status: <b>{status}</b></p>
          {view.ocrStatus === 'no-language' && (
            <button className="btn s" onClick={() => { void api.privacy.openLanguageSettings(); }}>Install a language</button>
          )}
        </div>
        <div className="srow">
          <p>Keep screen text for<small>Older text is erased automatically. Time and app history are kept.</small></p>
          <div className="segc" role="group" aria-label="Keep screen text for">
            {([1, 7, 30] as const).map((d) => (
              <button key={d} aria-pressed={view.retentionDays === d} onClick={() => { void set({ rawTextRetentionDays: d }); }}>
                {d === 1 ? '1 day' : `${d} days`}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grp">
        <h4>Never look at</h4>
        <div className="srow stack">
          <p><small>Nothing is read while one of these words appears in the app name or window title.</small></p>
          <div className="xchips">
            {view.exclusions.map((p) => (
              <span key={p} className="xchip">{p}
                <button aria-label={`Remove ${p}`} onClick={() => { void saveExclusions(view.exclusions.filter((x) => x !== p)); }}>×</button>
              </span>
            ))}
          </div>
          <div className="xadd">
            <input type="text" aria-label="Add an app or word to never look at" placeholder="Add an app or word…" maxLength={MAX_PATTERN} value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) add(); }} />
            <button className="btn s" onClick={add}>Add</button>
            <button className="btn s" onClick={() => { void saveExclusions([...DEFAULT_EXCLUSIONS]); }}>Restore defaults</button>
          </div>
        </div>
      </div>

      <div className="grp">
        <h4>See it for yourself</h4>
        <div className="srow stack">
          {view.lastRead ? (
            <>
              <p><small>Last read at {formatClock(view.lastRead.at)} · {view.lastRead.app}{view.lastRead.title ? ` · ${view.lastRead.title}` : ''}. This is exactly what was stored.</small></p>
              <pre className="peek">{view.lastRead.text || '(no text found)'}</pre>
            </>
          ) : <p><small>Nothing read yet.</small></p>}
        </div>
      </div>

      <div className="grp">
        <h4>Your data</h4>
        <div className="srow">
          <p>Export everything<small>A JSON file with your activity, screen reads, settings and answers.</small></p>
          <button className="btn s" onClick={() => {
            api.privacy.export().then((r) => setNote(r.saved ? `Saved to ${r.path}` : null)).catch((e) => console.error(e));
          }}>Export</button>
        </div>
        <div className="srow">
          <p>Delete my activity<small>Erases screen time, app history and screen reads from this PC. Settings and answers are kept.</small></p>
          <button className="btn s danger" onClick={() => {
            api.privacy.deleteActivity().then((r) => { if (r.deleted) { setNote('Your activity was deleted.'); load(); } }).catch((e) => console.error(e));
          }}>Delete…</button>
        </div>
        {note && <p className="srow-note" role="status">{note}</p>}
      </div>
    </>
  );
}
```

- [ ] **Step 2: Mount and style**

In `apps/consumer/src/renderer/components/SettingsScreen.tsx` add `import { PrivacySection } from './PrivacySection';` and insert `<PrivacySection settings={settings} onChange={onChange} />` directly after `<h1>Settings</h1>`.

Append to `apps/consumer/src/renderer/styles.css` (before the `@media (prefers-reduced-motion: reduce)` block):

```css
/* ---------- privacy section ---------- */
.srow.stack { flex-direction: column; align-items: stretch; gap: 10px; }
.privacy-status b { font-weight: 600; }
.segc { display: flex; background: var(--panel); border-radius: 999px; padding: 3px; }
.segc button { border: 0; background: none; font: inherit; font-size: 12.5px; padding: 6px 12px; border-radius: 999px; cursor: pointer; }
.segc button[aria-pressed="true"] { background: #fff; font-weight: 600; box-shadow: 0 2px 6px rgba(0, 0, 0, .1); }
.xchips { display: flex; flex-wrap: wrap; gap: 6px; }
.xchip { display: inline-flex; align-items: center; gap: 4px; font-size: 12.5px; border-radius: 999px; padding: 4px 6px 4px 11px; background: var(--panel); }
.xchip button { border: 0; background: none; width: 20px; height: 20px; border-radius: 50%; cursor: pointer; font-size: 14px; line-height: 1; color: var(--muted); }
.xchip button:hover { background: rgba(0, 0, 0, .08); color: var(--ink); }
.xadd { display: flex; gap: 8px; align-items: center; }
.xadd input[type=text] { flex: 1; width: auto; }
.peek { background: var(--panel); border-radius: 14px; padding: 12px 14px; font: 12px/1.5 ui-monospace, Consolas, monospace; color: #4B4642; max-height: 180px; overflow: auto; white-space: pre-wrap; word-break: break-word; }
.btn.danger { color: #B42318; border-color: #F3C1BD; }
.srow-note { color: var(--muted); font-size: 12.5px; padding: 0 0 10px; }
```

- [ ] **Step 3: Verify**

```bash
pnpm --filter @worksight/consumer typecheck && pnpm --filter @worksight/consumer test && pnpm --filter @worksight/consumer exec electron-vite build
```

Then the ~40 s background dev launch with a clean log and killing only your run's process tree (as in Task 6). Do not change the user's settings or data.

- [ ] **Step 4: Commit**

```bash
git add apps/consumer/src/renderer
git commit -m "feat(consumer): privacy section (screen reading switch, retention, exclusions, peek, export/delete)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: Verification

**Files:** none committed.

- [ ] **Step 1:** `pnpm test`, `pnpm --filter @worksight/consumer typecheck`, `pnpm --filter @worksight/consumer exec electron-vite build` — all green.
- [ ] **Step 2:** `node apps/consumer/scripts/bench-ocr.mjs capture` — metadata shows real captures (pid, size, chars > 0, sub-second median). Never print OCR text.
- [ ] **Step 3:** Headless screenshot of the Settings privacy section via a temporary preview harness (fake `window.daylens` including `privacy.get` with sample data: `screenReading: true`, `ocrStatus: 'ready'`, a sample `lastRead`), compared against `docs/superpowers/specs/assets/daylens-mockups/onboarding-settings.html` §3 (Settings: privacy first); delete the harness afterwards.
- [ ] **Step 4 (human):** In the real app: Settings → turn on "Read on-screen text" → status becomes Working → after ~30 s "See it for yourself" shows redacted text of the window you were on; open a password manager or a page with "bank" in the title → no new read; change retention to 1 day; Export saves a JSON file; Delete asks for confirmation and clears Today.
