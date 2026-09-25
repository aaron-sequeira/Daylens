# Daylens — Consumer Desktop App (AI day-report & screen-health coach)

**Status:** Approved (design) · **Date:** 2026-09-23 · **Owner:** Aaron · **Working name:** Daylens

## 1. Overview & Goal

WorkSight was built for companies. Daylens is its **consumer** sibling: a Windows desktop app that tells a person what they did on their computer today, how long they spent in each app and on the screen overall, and coaches them in real time toward healthier, more effective computer use.

**Goal:** A user installs Daylens, grants consent, downloads two on-device AI models, and from then on:
1. sees live screen time, app usage and a categorized timeline of their day;
2. receives a written **daily report** (what they did, wins, habits to watch, "do it better" tips, a plan for tomorrow);
3. gets **top-right animated pop-ups** in real time — health nudges, behaviour callouts, task tips, wins;
4. with **everything running locally by default** (cloud writer optional).

## 2. Locked Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| How the app "sees" | **Screen text via Windows OCR** every ~30 s. Screenshots exist only in memory; never saved. |
| Observer model | **Laya** (`convaiinnovations/laya`, 421M, ModernBERT, Apache-2.0) — typed *choice*/*score* classifier. Labels every screen read. Cannot generate text. |
| Laya runtime | **A: ONNX export + `onnxruntime-node`**, gated by a Phase 0 parity spike. **Fallback B:** bundled Python sidecar running official `laya-serve`. |
| Writer model | **Local first, cloud optional.** Local: Qwen3 via `node-llama-cpp` (no Ollama install). Optional: user's own key via the existing multi-provider code. |
| Codebase | **New `apps/consumer`** in this monorepo; shared tracking/DB/AI code extracted to **`packages/core`**. `apps/agent` behaviour unchanged. |
| Pop-up types | All four: **Health**, **Behaviour**, **Task tips**, **Wins & streaks**. |
| Pop-up style | **Pastel morphing pill** (B's colours + C's morph) — see `pill-v2.html`. |
| Platform | **Windows 10/11 first** (Windows OCR). |

## 3. Scope

**In scope (v1):** everything in §5–§12.

**Out of scope (v1) — explicitly deferred, revisit after v1:** macOS · accounts / cloud sync · local vision model on screenshots · multilingual Laya variant · mobile.

## 4. UI Reference (approved mockups)

Interactive HTML mockups live in `docs/superpowers/specs/assets/daylens-mockups/` and are the visual source of truth:

| File | Screen | Notes |
|---|---|---|
| `today-dashboard.html` | Today dashboard | Toast in this file is superseded by `pill-v2.html`. |
| `daily-report.html` | Daily report | Word-by-word story reveal, count-up stats. |
| `pill-v2.html` | **Pop-up (final)** | Header pinned top; card grows downward; hover pauses auto-close. |
| `popups.html` | Break overlay (§2), stacking & manners (§3) | §1 style picker is superseded by `pill-v2.html`. |
| `onboarding-settings.html` | Onboarding (3 steps), Settings → Privacy | §1 pill in this file is superseded by `pill-v2.html`. |

**Design tokens** (from mockups): background `#FBF8F4`, panel `#F2EBE6`, ink `#171717`, muted `#77716C`, line `#E7DFD8`; pastels — lavender `#D8D2FC` (work / tip), mint `#BFEBD3` (learning / health), pink `#F4C6C8` (social / behaviour), peach `#F9DDB9` (entertainment / win). Font **DM Sans** (self-hosted woff2 — app must work offline). Radii 22–28 px cards, full-round pills. Motion: `--spring: cubic-bezier(.2,1.3,.35,1)`, `--ease: cubic-bezier(.22,.8,.26,1)`; staggered rise-in, grow-in bars, count-ups. All motion via CSS keyframes/transitions — no animation library. Respect `prefers-reduced-motion` (disable morph/stagger, keep fades).

## 5. Architecture

```
WorkTrackerProject/
├─ packages/core/     NEW — moved from apps/agent: tracking/*, db/database + base schema + repositories,
│                     summary/rollup, summary/ai (refactored to a generic `complete()`), shared/date, shared/types
├─ apps/agent/        company agent — imports from @worksight/core; behaviour unchanged, tests still pass
├─ apps/web/          unchanged
└─ apps/consumer/     NEW — Daylens Electron app (electron-vite + React 19 + Tailwind, like apps/agent)
```

`pnpm-workspace.yaml` gains `packages/*`.

**Processes inside Daylens**

```
Main process
  Tracker (reused, 1 s poll)       → focus_sessions, app_events, activity_samples
  ScreenReader (30 s)              → capture active window (memory) → OcrHelper → redact → screen_reads
  Coach (30 s)                     → rules over recent rows → candidate nudges → MannersGate → PillWindow
  ReportScheduler                  → at wind-down / next launch / on demand → Brain.write('report')
  Windows: MainWindow · PillWindow · BreakOverlay(s) · Tray
     │ MessagePort (typed)                    │ stdin/stdout JSON lines
Brain (Electron utilityProcess)             OcrHelper (long-lived powershell.exe, WinRT)
  Laya ONNX (onnxruntime-node) → labels       ocr(png) → text ; notifState() → QUNS_*
  Writer: node-llama-cpp (Qwen3) | cloud
```

- **Isolation:** the Brain is a separate process so native inference crashes/OOM never stop tracking; it is restarted by the main process (§11).
- **Dependency injection:** every main-process unit takes its collaborators as deps (same pattern as `createTracker(deps)`), so tests use fakes (fake Brain, fake OCR, fake clock).
- `ForegroundInfo` (core) gains `bounds: {x,y,width,height} | null` from `active-win` — needed for window cropping and fullscreen detection. Agent ignores it.

## 6. Data Model (SQLite, consumer-only tables added to the core base schema)

```sql
CREATE TABLE IF NOT EXISTS screen_reads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL, date TEXT NOT NULL,
  app_name TEXT NOT NULL, window_title TEXT,
  text TEXT,                    -- redacted OCR text; NULLed by retention purge
  text_hash TEXT NOT NULL,      -- sha1 of redacted text, for dedupe
  category TEXT, category_conf REAL,
  activity TEXT, activity_conf REAL,
  stuck REAL, distraction REAL, -- Laya scores 0..2
  labeled_at INTEGER            -- NULL = awaiting Brain
);
CREATE INDEX IF NOT EXISTS idx_reads_date ON screen_reads(date, at);

CREATE TABLE IF NOT EXISTS nudges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL, date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('health','behaviour','tip','win')),
  rule_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, detail TEXT,
  status TEXT NOT NULL CHECK (status IN ('shown','held','dismissed','acted','snoozed','expired'))
);
CREATE INDEX IF NOT EXISTS idx_nudges_date ON nudges(date, at);

CREATE TABLE IF NOT EXISTS daily_reports (
  date TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('pending','ready','failed')),
  report_json TEXT,             -- validated ReportJson (§9)
  model TEXT, generated_at INTEGER, error TEXT
);

CREATE TABLE IF NOT EXISTS plan_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  for_date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('focus_block','app_cap','break_interval','wind_down')),
  payload_json TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1
);
```

Settings reuse the existing key-value `settings` table (new keys listed in §10). Episodes and stats are **computed on demand**, not stored.

## 7. Screen Reader & Privacy Pipeline

Every 30 s (`readIntervalSec`, setting), **skip** when any is true: tracking paused · no consent · user idle (existing idle logic) · foreground matches **exclusion list** · same app+title as last read *and* < 2 min since that read.

1. **Capture:** `desktopCapturer.getSources({ types:['screen'], thumbnailSize: display size })` for the display containing the foreground window; crop to `ForegroundInfo.bounds`. Image held only as a `NativeImage`/Buffer in memory.
2. **OCR:** PNG → `OcrHelper.ocr()` (Windows.Media.Ocr, user profile languages). Buffer dropped immediately after.
3. **Redact** (pure function, unit-tested): emails → `[email]`; digit runs ≥ 8 (allowing spaces/dashes) → `[number]`; secrets — `sk-…`, `ghp_…`/`github_pat_…`, `AKIA…`, JWT `eyJ…`, any hex/base64 run ≥ 32 chars → `[secret]`. Truncate to 4 000 chars.
4. **Dedupe:** if `text_hash` equals the previous read's, store the row with `text = NULL` (time still counts).
5. **Insert** `screen_reads` row with `labeled_at = NULL`; post to Brain for labelling.

**Default exclusions** (editable in Settings): apps `1Password, Bitwarden, KeePass, KeePassXC, LastPass, Dashlane, Windows Security, Credential Manager`; title contains `InPrivate, Incognito, Private Browsing`; title matches `/\b(bank|banking|paypal|password)\b/i`. Excluded time still counts toward screen time (from the tracker), but no text is read.

**Retention:** a daily job NULLs `screen_reads.text` older than `rawTextRetentionDays` (1 / **7** / 30). Labels, nudges, reports are kept. **Export** (JSON of all tables) and **Delete everything** (drop + recreate DB, delete nothing else) in Settings → Privacy. **"See it for yourself"** panel shows the latest read's redacted text + labels.

## 8. Brain Process

Electron `utilityProcess.fork`, typed request/response over `MessagePort`:

```ts
type BrainRequest =
  | { id: string; op: 'label'; reads: { id: number; app: string; title: string | null; text: string | null }[] }
  | { id: string; op: 'writeReport'; input: ReportInput }
  | { id: string; op: 'writeTip'; input: TipInput }
  | { id: string; op: 'status' };
```

### 8.1 Laya (observer)
- Loads `laya.onnx` + `tokenizer.json` from `userData/models/laya/`. Tokenizer via `@huggingface/transformers` `AutoTokenizer` (ModernBERT tokenizer). **The Phase 0 spike must also port Laya's input formatting (state + question/option markers) to TS** and prove parity.
- **State string:** `App: {app}\nWindow: {title}\nScreen text: {text (first 1 500 chars)}`.
- **Questions (single forward pass):**

| key | type | options / criteria |
|---|---|---|
| `category` | choice | `work` job/study tasks, coding, documents, spreadsheets, design · `learning` tutorials, docs, courses, educational video · `social` social feeds, DMs, forums · `entertainment` video, streaming, games, memes · `communication` email, work chat, calendars, calls · `other` system, settings, file management |
| `activity` | choice | `coding, writing, reading, watching, scrolling, chatting, designing, gaming, browsing, other` |
| `stuck` | score | 0 working smoothly · 1 minor friction, searching · 2 visible errors, failures, repeated attempts |
| `distraction` | score | 0 on-task · 1 mild detour · 2 infinite feed, autoplay, clickbait, unrelated to recent work |

- Choices with confidence < 0.5 are stored as `uncertain` and **never trigger rules**. Reads with `text = NULL` (dedupe) inherit the previous read's labels. (Superseded by the Phase 4 spec §3.1: Laya's choice is always stored with its confidence; rules act only when confidence ≥ 0.5.)

### 8.2 Writer
- **Local:** `node-llama-cpp`, GPU auto-detected (CUDA/Vulkan, CPU fallback). Model tier by RAM: ≥ 12 GB → **Qwen3-4B-Instruct-2507 Q4_K_M** (~2.5 GB); < 12 GB → **Qwen3-1.7B Q4_K_M** (~1.1 GB, thinking disabled). Output constrained with a **JSON-schema grammar** → always parseable.
- **Cloud (optional):** `packages/core` `summary/ai.ts` is refactored from `generateAiSummary(summary)` to a generic `complete({ system, user, maxTokens, json })` over the same providers (Anthropic, OpenAI, Gemini, OpenRouter, custom). Output validated with `zod`; one retry on validation failure. The agent's summary becomes a thin caller of `complete()`.
- Only the compact `ReportInput` / `TipInput` JSON (already redacted) is ever sent to a cloud provider — never raw screenshots.

## 9. Coach Engine, Pop-ups & Reports

### 9.1 Rules (every 30 s; pure functions over recent rows + settings + clock)
| rule_id | kind | trigger (defaults) | pop-up |
|---|---|---|---|
| `eye_break` | health | ≥ `breakIntervalMin` (50) min active without a ≥ 2 min idle gap | "Give your eyes a break" → Start break (overlay) |
| `stretch` | health | ≥ 90 min without a ≥ 2 min idle gap | "Stand up & stretch" |
| `wind_down` | health | active after `windDownTime` (23:00) | "Time to wind down" |
| `goal_80` / `goal_100` | health | today's screen time crosses 80 % / 100 % of `dailyGoalMin` | goal check |
| `doomscroll` | behaviour | same app, `distraction ≥ 1.5` on reads spanning ≥ 20 min | "You've been scrolling {app} {n} min" |
| `scattered` | behaviour | ≥ 40 foreground switches in 15 min | "Feeling scattered?" → Focus 25m |
| `stuck_escape` | behaviour | a social/entertainment read within 2 min after `stuck ≥ 1.5`, ≥ 3× today | "Stuck → {app} is becoming a reflex" |
| `app_cap` | behaviour | plan item app cap exceeded | "{app}: {cap} min limit reached" |
| `stuck_tip` | tip | `stuck ≥ 1.5` on ≥ 3 reads within 10 min, same app | Brain.writeTip → title/body/detail |
| `repeat_search` | tip | same normalized search query (browser title `… - Google Search`/Bing/DDG) ≥ 3× in 7 days | Brain.writeTip |
| `deep_work` | win | 60 / 90 min of work+learning, avg distraction < 0.5, ≤ 10 switches | "90-min deep-work streak 🎉" |
| `below_avg` | win | at 18:00, today's screen time < 7-day avg by ≥ 10 % | "Down {p}% today" |

`writeTip` is rate-limited to 1 per 10 min; `TipInput` = app, title, last 3 redacted texts (≤ 1 500 chars). Output `{ title ≤ 40, body ≤ 160, detail ≤ 800 markdown }`. "Show me" opens the main window on the tip detail.

### 9.2 MannersGate (pure, unit-tested)
- Global: ≤ 1 pop-up per 20 min (`eye_break`/`stretch` exempt, they have their own cadence); per rule: ≤ 1 per 2 h.
- **Silence** (→ status `held`) when: foreground bounds equal the display bounds (fullscreen/games) · video-call apps/titles (`Zoom.exe`, `ms-teams.exe`, titles containing `Meet -`, `Zoom Meeting`, `Discord` + `Voice Connected`) · `OcrHelper.notifState()` ∈ {`QUNS_BUSY`, `QUNS_RUNNING_D3D_FULL_SCREEN`, `QUNS_PRESENTATION_MODE`, `QUNS_QUIET_TIME`} · user snooze active · kind disabled in settings.
- Held nudges surface as a "While you were busy" card on the Today screen.
- **Back-off:** 3 dismissals of the same `kind` within 7 days → that kind's cooldown doubles, and the next pop-up of that kind offers "Show fewer like this?".

### 9.3 PillWindow
`BrowserWindow({ frame:false, transparent:true, focusable:false, skipTaskbar:true, resizable:false, hasShadow:false, width:400, height:260 })`, `setAlwaysOnTop(true,'screen-saver')`, `showInactive()`, positioned top-right of `screen.getDisplayNearestPoint(cursor).workArea` with 16 px margin. `setIgnoreMouseEvents(true, { forward:true })` by default; renderer toggles it off while the pointer is over the pill. Stack of ≤ 3 (older ones scaled behind, fan out on hover). Auto-collapse after 8 s, paused on hover. Global shortcut **`Ctrl+Alt+D`** dismisses all (the mockup's `Win+Shift+D` can't be registered — Win-key combos are reserved by Windows). Animation exactly per `pill-v2.html`.

### 9.4 BreakOverlay
One fullscreen window per display; `backgroundMaterial: 'acrylic'` on Windows 11 22H2+, fallback semi-opaque `#FBF8F4E6` on Windows 10. Breathing circle + countdown ring per `popups.html` §2. Skip / +1 min. Esc skips. Completed break is recorded (counts as a break for the health score).

### 9.5 Daily report pipeline
1. **Episodes (code):** consecutive reads with the same category and app cluster, gaps < 5 min → `{start,end,category,activity,apps[],titles[≤3],samples[≤3 × 300 chars],avgStuck,avgDistraction}`.
2. **Stats (code, reuse `rollup`):** screen time, active, deep work (work/learning episodes ≥ 25 min with avg distraction < 0.5), foreground switches, breaks (idle gaps ≥ 2 min + completed overlays), 7-day averages, top apps.
3. **Health score (code):** `100 − 5·max(0, expectedBreaks − breaks) − 10·max(0, longestStretchH − 1) − 15·[lateNightUse] − 20·min(1, max(0, screen/goal − 1))`, clamped 0–100; `expectedBreaks = floor(activeMin / breakIntervalMin)`. Constants tunable in one place.
4. **Candidates (code):** stuck episodes (with error text sample), repeated searches, today's fired rules — each with an `id`.
5. **Writer** gets `ReportInput = { date, stats, episodes, candidates, plan settings }` (~3–4k tokens) and returns:
   ```ts
   ReportJson = { headline: string; story: string;
     wins: string[≤3]; habits: string[≤3];
     doBetter: { candidateId: string; what: string; better: string }[≤4];
     plan: { text: string; kind: 'focus_block'|'app_cap'|'break_interval'|'wind_down'; payload: object }[≤4];
     advice: string }
   ```
   `doBetter` items whose `candidateId` is not in the candidate set are **dropped** (grounding guard). **All numbers shown in stat tiles/charts come from step 2, never from the model.**
6. **Schedule:** at `windDownTime`, or on first launch next day for a missing yesterday, or "Generate" button. On battery < 20 % the auto run waits for AC. Local timeout 3 min, cloud 60 s → `status='failed'`; the report still renders stats/timeline/candidates + retry card.
7. **Plan ticks** create `plan_items` for tomorrow, which the Coach reads (focus-block reminder, `app_cap`, break interval override, wind-down override).
8. **Export PDF:** `webContents.printToPDF` of the report route.

## 10. Onboarding, Settings, Models

**Onboarding (3 steps, per mockup):** (1) Welcome + privacy promises + consent → sets `consentGranted`; (2) hardware check (`os.totalmem()`, `fs.statfs` free space, `node-llama-cpp` GPU detection) + model downloads, or "use my own key" → provider/key form (key stored with `safeStorage`, as in the agent); (3) goals: `dailyGoalMin` (default 420), `windDownTime` (23:00), kinds on/off. Then tracking starts and the app sets `openAtLogin` (args `--hidden` → start to tray).

**Model downloads:** HTTP Range-resumable, SHA-256 verified against a manifest bundled in the app, stored under `userData/models/`. Laya ONNX + tokenizer hosted on the owner's Hugging Face repo (Apache-2.0: include LICENSE + attribution); Qwen3 GGUF from the official Qwen HF repos. Settings → AI models: status, re-download, delete, switch local/cloud, pick tier.

**Settings sections:** Privacy & data (§7) · Pop-ups (kinds, cooldowns, snooze) · Goals & health (`dailyGoalMin`, `windDownTime`, `breakIntervalMin`) · AI models · Categories (per-app override: always work / always social …, applied over Laya's label) · General (start at login, read interval, pause).

**New settings keys:** `readIntervalSec`=30, `rawTextRetentionDays`=7, `exclusions` (JSON), `dailyGoalMin`=420, `windDownTime`="23:00", `breakIntervalMin`=50, `nudgeKinds` (JSON, all on), `snoozeUntil`, `writerMode` ('local'|'cloud'), `writerModelTier` ('4b'|'1.7b'), `categoryOverrides` (JSON).

**Main window:** 1280×860 (min 1100×720), `titleBarStyle:'hidden'` + `titleBarOverlay` (native Windows controls, cream colours). Routes: Today · Reports · Insights (weekly trends) · Apps · Settings. Closing hides to tray (as in the agent). Tray: Open, Pause/Resume, Snooze pop-ups 1h, Quit.

## 11. Error Handling

| Failure | Behaviour |
|---|---|
| Brain crash / OOM | Restart with backoff 1 s → 5 s → 30 s; > 3 crashes in 10 min → AI features paused, banner, tracking continues; unlabelled reads are labelled on recovery. |
| OcrHelper dies | Restart; if no OCR language available → **metadata-only mode** (no screen_reads text) + banner linking `ms-settings:regionlanguage`. |
| OCR/label backlog | If > 20 reads unlabelled, skip new captures until drained (bounded memory/CPU). |
| Laya low confidence | `uncertain`, never triggers rules. (Superseded by the Phase 4 spec §3.1: Laya's choice is always stored with its confidence; rules act only when confidence ≥ 0.5.) |
| Writer timeout/invalid JSON | One retry (cloud) / grammar-constrained (local); then `failed` + retry card. |
| Download interrupted / bad hash | Resume / delete + re-download. |
| DB | Reuse core `openDatabase` (better-sqlite3, WAL). Per-memory note: inspect DB via `ELECTRON_RUN_AS_NODE`. |

## 12. Testing

- **Unit (Vitest, colocated `*.test.ts`, repo convention):** redaction, exclusion matching, dedupe, episode builder, stats + health score, **each coach rule** (fake clock + fixture rows), MannersGate (cooldowns, silence conditions, back-off), report grounding filter, zod schemas, retention purge, download resume/hash logic, search-query normalization.
- **Laya parity (Phase 0 gate):** ~50 real screen-text samples labelled by official Python Laya → JSON golden file committed; ONNX must match **≥ 98 % of choice labels** and **scores within ±0.05**. Kept as a test that runs when the model file is present (skipped in CI without it).
- **Brain/OCR** tested through their interfaces with fakes; no real model in unit tests.
- **core extraction:** all existing `apps/agent` tests pass unchanged after Phase 1.
- **Manual checklist:** pill never steals focus while typing; click-through outside the pill; silent in fullscreen game / Zoom / DND; overlay on multi-monitor; reduced-motion.

## 13. Build Phases (each gets its own implementation plan)

| # | Phase | Exit criterion |
|---|---|---|
| 0 | **Spike:** Laya → ONNX + TS input formatting, parity test; OcrHelper latency on a 1080p window | Parity met (→ approach A) or not (→ B); OCR < 400 ms median |
| 1 | Extract `packages/core` from `apps/agent` | Agent tests + typecheck green; agent runs |
| 2 | `apps/consumer` shell: theme, fonts, Today dashboard (screen time, apps, simple timeline from focus sessions), tray, consent | Usable screen-time tracker |
| 3 | ScreenReader + OcrHelper + redaction + exclusions + retention + Settings → Privacy | Redacted reads stored; privacy page live |
| 4 | Brain process + Laya labelling + model downloader + onboarding | Categories/timeline from Laya labels |
| 5 | Coach rules + MannersGate + PillWindow + BreakOverlay | All 4 pop-up kinds fire correctly |
| 6 | Writer (local + cloud) + daily report + tips + plan items + PDF | Full report generated on-device |
| 7 | Packaging (NSIS, reuse agent's winCodeSign workaround), auto-start, polish, reduced-motion | Installable build |

## 14. Risks

- **Laya ONNX export** (custom decision head + input formatting) — mitigated by Phase 0 gate and fallback B (bundled Python, +~700 MB).
- **Windows OCR via PowerShell WinRT** interop can be slow/fragile — Phase 0 measures; fallback is a tiny compiled C# helper exe.
- **Small local writer quality** — mitigated by structured input (episodes, not raw text), grammar-constrained JSON, grounding guard, and the cloud option.
- **Laptop battery/thermals** — reads skipped when idle, dedupe, single-pass Laya, report deferred on low battery.
- **Privacy perception** — local by default, never-saved screenshots, redaction, exclusions, "See it for yourself", one-click delete.
