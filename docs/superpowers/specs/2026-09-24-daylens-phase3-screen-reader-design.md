# Daylens — Phase 3: Screen reader & privacy page

**Status:** Approved (design) · **Date:** 2026-09-24 · **Owner:** Aaron · **Extends:** `2026-09-23-daylens-consumer-app-design.md` §6, §7, §10, §11 (this document wins where they differ)

## 1. Goal

Build the on-screen-text pipeline (capture the active window → Windows OCR → redact → store) and the privacy page that controls it — **switched off by default**. Nothing consumes the text yet (Laya labelling is Phase 4); Phase 3 delivers a safe, supervised, user-controlled pipeline and the controls around it.

## 2. Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Consent | **Off until opted in.** New setting `screenReading` (default `false`), switched only in Settings → Privacy in this phase. The onboarding opt-in step and a one-time prompt for existing users ship in Phase 4 together with Laya. |
| Capture | **Approach A:** the OCR helper captures the foreground window itself (Win32 in the PowerShell helper) and OCRs it in-process; the image never leaves the helper process. Replaces the main spec's desktopCapturer → PNG → stdin design (spec §7 step 1–2). |
| "Delete" scope | Deletes activity (focus sessions, app events, activity samples, daily summaries) and screen reads. Keeps settings, profile and consent. |

## 3. Settings

Added to `DEFAULT_SETTINGS` (apps/consumer/src/main/settings.ts):

| Key | Default | Renderer-editable | Notes |
|---|---|---|---|
| `screenReading` | `false` | yes (`settingsPatch`, boolean) | master switch |
| `rawTextRetentionDays` | `7` | yes (`settingsPatch`, exactly 1, 7 or 30) | older `screen_reads.text` is NULLed |
| `readIntervalSec` | `30` | no | internal |
| `exclusions` | JSON of the default list (§5) | no — dedicated `privacy:setExclusions` channel | list of patterns |

## 4. Data

Consumer-only schema executed after `openDatabase` (idempotent `CREATE … IF NOT EXISTS`):

```sql
CREATE TABLE IF NOT EXISTS screen_reads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL, date TEXT NOT NULL,
  app_name TEXT NOT NULL, window_title TEXT,
  text TEXT,                    -- redacted OCR text; NULL when deduped or purged
  text_hash TEXT NOT NULL,      -- sha1 of redacted text
  category TEXT, category_conf REAL, activity TEXT, activity_conf REAL,
  stuck REAL, distraction REAL, labeled_at INTEGER   -- Phase 4 (Laya); NULL in Phase 3
);
CREATE INDEX IF NOT EXISTS idx_reads_date ON screen_reads(date, at);
```

`window_title` is stored only when `captureWindowTitles` is on (same rule as the tracker).

## 5. Exclusions

A list of patterns; a pattern matches when it appears as a whole word (case-insensitive, `\b…\b` with regex special characters escaped) in the app name **or** the window title. Defaults:
`1Password, Bitwarden, KeePass, KeePassXC, LastPass, Dashlane, Windows Security, Credential Manager, InPrivate, Incognito, Private Browsing, bank, banking, PayPal, password`.
Editable in Settings: add (1–60 chars, trimmed, case-insensitive unique, max 40 patterns) and remove; "Restore defaults".

## 6. OCR helper (protocol v2)

`apps/consumer/resources/ocr-helper.ps1` keeps its ready line and the existing `"<id> <base64 png>"` request (used by the bench), and adds:

- Request `"<id> CAPTURE"` → the helper (per-monitor DPI-aware) takes the foreground window (`GetForegroundWindow`), its visible frame (`DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS)`), captures that rectangle (`Graphics.CopyFromScreen`) into memory, downscales if larger than `OcrEngine.MaxImageDimension`, OCRs it and replies
  `{"id","text","ms","pid","title","w","h"}` — `pid` and `title` of the window actually captured.
- Minimized / zero-size / no foreground window → `{"id","error":"no_window"}`.
- Nothing is written to disk; all bitmaps/streams disposed in `finally`.

## 7. Components (main process)

- **`screen/redact.ts`** (pure): emails → `[email]`; digit runs ≥ 8 allowing spaces/dashes → `[number]`; `sk-…`, `ghp_…`, `github_pat_…`, `AKIA…`, JWT `eyJ…`, any hex/base64 run ≥ 32 → `[secret]`; truncate to 4 000 chars.
- **`screen/exclusions.ts`** (pure): `DEFAULT_EXCLUSIONS`, `isExcluded(patterns, appName, title)`, `addExclusion(list, raw)`, `parseExclusions(json)` (corrupt → defaults).
- **`screen/store.ts`**: `SCREEN_SCHEMA`, `createScreenStore(db)` → `insert`, `last()`, `purgeTextBefore(ms)`, `deleteAll()`; plus `deleteActivity(db)` and `exportAll(db, settings, profile)` for the privacy actions.
- **`ocr/client.ts`**: supervises the helper — spawn (`powershell -NoProfile -ExecutionPolicy Bypass -File …`), JSON-line parsing, one request in flight, 8 s timeout (→ kill + restart), restart backoff 1 s → 5 s → 30 s, **> 3 crashes in 10 min → `failed`** until the user toggles screen reading off/on or restarts the app. Status: `off | starting | ready | no-language | restarting | failed`. The helper runs only while screen reading is on.
- **`screen/reader.ts`**: every `readIntervalSec` (30 s) while `screenReading && consentGranted && !trackingPaused`:
  1. skip if system idle ≥ `idleThresholdSec`, if the foreground (active-win) is excluded, or if app + title equal the last read and < 2 min passed;
  2. `ocr.capture()`; **discard** if the captured `pid` ≠ the foreground pid or the captured title is excluded (window switched mid-capture);
  3. redact → sha1; if the hash equals the last read's, store the row with `text = NULL`;
  4. insert. Errors are logged and never thrown to the tracker.
- **Retention:** purge on start and every 6 h: `UPDATE screen_reads SET text = NULL WHERE at < now − days`.

## 8. IPC

| Channel | Payload / returns |
|---|---|
| `privacy:get` | → `{ screenReading, retentionDays, exclusions: string[], ocrStatus, lastRead: { at, app, title, text } \| null }` |
| `privacy:setExclusions` | `string[]` (zod: ≤ 40, each trimmed 1–60 chars, no control chars) → `privacy:get` shape |
| `privacy:export` | main shows a Save dialog and writes JSON `{ exportedAt, settings, profile, focusSessions, appEvents, activitySamples, screenReads }` → `{ saved: boolean, path? }` |
| `privacy:deleteActivity` | main shows a native confirm dialog; on confirm deletes (§2) → `{ deleted: boolean }` |
| `privacy:openLanguageSettings` | opens `ms-settings:regionlanguage` |
| `settings:set` | now also accepts `screenReading`, `rawTextRetentionDays` |

The main process pushes `events:update` when the OCR status changes.

## 9. UI (Settings, new groups at the top, existing styling)

1. **Screen reading** — switch (`aria-pressed`) with the explanation "Reads the text of the window in front every 30 seconds so Daylens can understand what you're doing. The screenshot is never saved; only the text is kept, on this PC." and a status line (`Working` · `Off` · `Starting…` · `Windows has no OCR language — Install one` (button) · `Stopped after repeated errors — turn off and on to retry`).
2. **Keep screen text for** — 1 / 7 / 30 days segmented control.
3. **Never look at** — chips with remove buttons, an add field (Enter), "Restore defaults".
4. **See it for yourself** — last read: time, app, title, redacted text (monospace, scrollable, max-height); "Nothing read yet" when empty.
5. **Your data** — "Export" and "Delete my activity" (native confirm dialog).

## 10. Testing

Unit (Vitest): redaction (each rule + truncation), exclusions (whole-word, escaping, add/unique/cap, corrupt JSON), reader decision logic with a fake OCR client + fake clock + in-memory DB (skip rules, pid mismatch discard, excluded captured title discard, dedupe, idle), OCR client protocol with a fake child process (ready, response routing, timeout → restart, backoff, failure threshold, no-language), store (insert/last/purge/deleteAll/deleteActivity/export shape), settingsPatch accepts only 1/7/30. Manual: real capture on this PC with screen reading on; excluded app is skipped; retention purge.

## 11. Out of scope (Phase 4+)

Laya labelling of reads; onboarding opt-in step and existing-user prompt; using reads in the dashboard or reports; per-app category overrides.
