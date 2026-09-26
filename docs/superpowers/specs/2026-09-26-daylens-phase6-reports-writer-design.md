# Daylens Phase 6: Writer, Daily Report, Plan, PDF, Insights, Search, Live AI Tips

**Status:** Approved (design) · **Date:** 2026-09-26 · **Owner:** Aaron
**Parent spec:** `2026-09-23-daylens-consumer-app-design.md` (§8.2 Writer, §9.5 Daily report pipeline, §13 row 6). Where this spec differs from the parent, this spec wins.
**Builds on:** Phase 4 (Brain utilityProcess, resumable downloader, manifest pinning), Phase 5 (coach engine, memory gating `batchAllowed`, pill, rules).

## 1. Goal

Every day, Daylens writes the user a report on-device: what they did, wins, habits to watch, grounded "do it better" tips, a plan for tomorrow and one piece of advice, on top of stats computed in code. The user can tick plan items that change tomorrow's coaching, export or auto-save the report as a PDF, email it, search past reports, see weekly Insights, and get AI-written tip pop-ups when memory allows.

Delivered as **two plans on one branch, built back to back**:
- **6a:** writer runtime (local + cloud), report pipeline, Reports screen, plan items → coach, PDF export.
- **6b:** weekly Insights, report search, PDF auto-save + email draft, AI-written live tips.

## 2. Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Writer mode | **Local by default, runs only under the memory gate** (idle ≥ 180 s, or locked, or plenty of free RAM), loaded per job and unloaded after. Cloud (user's own key) optional in Settings. |
| Local runtime | **`node-llama-cpp`** in the existing Brain utilityProcess; GPU auto (CUDA/Vulkan), CPU fallback; output constrained by a JSON-schema grammar. |
| Models | RAM ≥ 12 GB → **Qwen3-4B-Instruct-2507 Q4_K_M** (`unsloth/Qwen3-4B-Instruct-2507-GGUF`, 2 497 281 120 bytes); < 12 GB → **Qwen3-1.7B Q4_K_M** (`unsloth/Qwen3-1.7B-GGUF`, thinking disabled). Both pinned to a commit and SHA-256 in the bundled manifest (values recorded during implementation). Apache-2.0: LICENSE + attribution kept alongside. |
| Live tips | **Template instantly; AI-rewritten when memory allows** (local: free RAM ≥ writer need, no idle requirement; cloud: when cloud mode is on). 20 s cap, else template. |
| Writer download | Offered on the Reports screen and in Settings → AI model. **Onboarding unchanged.** |
| Reports UI | New **Reports** rail tab: newest report, ← → day navigation, per `daily-report.html`. |
| Insights | New **Insights** rail tab, weekly (Mon–Sun), numbers from code + short AI week summary. |
| Search | Full-text search over report text and top apps (SQLite FTS5). |
| PDF | Export button; optional **auto-save to a chosen folder** (`Daylens-YYYY-MM-DD.pdf`); **Email** button opens a `mailto:` draft and reveals the PDF in Explorer. No mail credentials stored. |
| Cloud code | Agent's provider code moves to `packages/core` as a generic `complete()`; the agent's summary becomes a thin caller, behaviour unchanged. |

## 3. Writer runtime (6a)

### 3.1 Brain jobs
The Brain utilityProcess (Phase 4) gains two ops beside `label`:

```ts
type BrainRequest =
  | { op: 'label'; ... }                                   // unchanged
  | { op: 'write'; kind: 'report' | 'week' | 'tip'; modelPath: string; gpu: 'auto' | 'off'; schema: object; system: string; user: string; maxTokens: number };
type BrainResponse = ... | { op: 'written'; json: unknown } | { op: 'error'; message: string };
```

- One job at a time across label and write; the scheduler serialises them. If both are due, **labelling goes first** (reports benefit from fresh labels).
- The process exits after each job (as today), so the writer's memory is held only while writing.
- Local timeout: **report/week 180 s, tip 20 s** (watchdog in main kills the process). Cloud timeout 60 s (tip 20 s).
- Qwen3-1.7B: thinking disabled (`/no_think` in the system prompt or the chat-template flag, whichever node-llama-cpp exposes).
- Output: grammar from the JSON schema (`llama.createGrammarForJsonSchema`), so it always parses; main still validates with zod.

### 3.2 Memory gate
- `WRITER_NEED_BYTES` = model file size + 1 GiB (≈ 3.4 GiB for 4B, ≈ 2.1 GiB for 1.7B).
- Reports/weeks use Phase 5's `batchAllowed({ freeBytes, idleSec, locked, needBytes: WRITER_NEED_BYTES })`.
- Live tips use only `freeBytes ≥ WRITER_NEED_BYTES` (no idle requirement).
- Cloud mode skips the gate.

### 3.3 Cloud
- `packages/core/src/ai/complete.ts`: `complete({ system, user, maxTokens, json: true }, deps): Promise<{ ok: true; text: string } | { ok: false; error: string }>` over Anthropic, OpenAI, Gemini, OpenRouter, custom base URL, reusing the agent's request code.
- The agent's `generateAiSummary` becomes a caller of `complete()`. All agent tests pass unchanged.
- Consumer: output parsed + zod-validated; **one retry** on invalid JSON; then failed.
- Settings keys: `writerMode` ('local'|'cloud', default 'local'), `writerModelTier` ('4b'|'1.7b', default by `os.totalmem()`), `aiProvider`, `aiModel`, `aiBaseUrl`; API key encrypted with `safeStorage` (as in the agent). Only the compact input JSON is ever sent.

### 3.4 Download
- Reuse the Phase 4 resumable, SHA-256-verified downloader with a new `WRITER_MANIFEST` per tier, into `userData/models/writer/`.
- Settings → AI model gets a **Writer** row: status, download/delete, tier picker, Local/Cloud switch; Cloud shows provider/model/key form.

## 4. Report pipeline (6a)

### 4.1 Stats (code)
From `loadTodayView` for the date (screen time, category totals, top apps, timeline, 7-day bars) and `computeHealth` (score, breaks, expected, longest stretch, late night). New: **deep work** = sum of work/learning episodes ≥ 25 min with average distraction < 0.5. **No number shown in the UI comes from the model.**

### 4.2 Episodes (code)
Consecutive `screen_reads` of the day with the same app and final category, gaps < 5 min → `{ id, start, end, category, activity, apps[], titles[≤3], samples[≤3 × 300 chars], avgStuck, avgDistraction }`. Samples only from reads whose `text` is still present (retention) and only when screen reading is on. Writer input gets the **40 longest** episodes.

### 4.3 Candidates (code)
Each with a stable `id`:
- stuck episodes (avgStuck ≥ 1.5 or ≥ 3 stuck reads), with one ≤ 200-char error sample;
- repeated searches (Phase 5 `repeat_search` logic, exclusions applied);
- the day's nudges (from the `nudges` table: rule, title, status);
- app limits passed.

### 4.4 Writer contract
`ReportInput = { date, stats, episodes, candidates, goals: { dailyGoalMin, windDownTime, breakIntervalMin } }` (~3–4 k tokens).

```ts
ReportJson = {
  headline: string;              // ≤ 80 chars
  story: string;                 // ≤ 900 chars
  wins: string[];                // ≤ 3
  habits: string[];              // ≤ 3
  doBetter: { candidateId: string; what: string; better: string }[];   // ≤ 4
  plan: { text: string; kind: 'focus_block' | 'app_cap' | 'break_interval' | 'wind_down'; payload: object }[]; // ≤ 4
  advice: string;                // ≤ 300 chars
}
```
- **Grounding guard:** `doBetter` items whose `candidateId` is not in the candidate set are dropped.
- **Plan validation:** payload per kind — `focus_block { start: 'HH:MM', minutes: 15–240 }`, `app_cap { app: 1–60 chars, minutes: 15–240 }`, `break_interval { minutes: 10–180 }`, `wind_down { time: 'HH:MM' }`. Invalid items dropped individually, not the whole report.

### 4.5 Storage
```sql
CREATE TABLE IF NOT EXISTS daily_reports (
  date TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('pending','ready','failed')),
  report_json TEXT, input_hash TEXT, model TEXT, generated_at INTEGER, error TEXT
);
CREATE TABLE IF NOT EXISTS plan_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  for_date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('focus_block','app_cap','break_interval','wind_down')),
  payload_json TEXT NOT NULL, text TEXT NOT NULL, source_date TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_plan_for ON plan_items(for_date);
```
Regenerate replaces the row. "Delete my activity" clears both tables (and 6b's tables); Export includes them.

### 4.6 Schedule
A report job is **due** when any of:
- local time ≥ `windDownTime` (or the day's plan override) and today has no ready/pending report;
- on launch, yesterday had tracked activity and no ready report;
- the user presses **Generate / Regenerate** (bypasses battery wait; still honours the memory gate for local, showing "Waiting for a quiet moment").

Automatic runs wait while on battery < 20 %. Checked every 60 s. Three writer crashes within 10 min pause automatic writing until restart (manual still allowed).

### 4.7 Failure
Report status `failed` with a short reason (timeout, invalid output, no model, cloud error text). The screen still renders stats, timeline and candidates plus a retry card. Tracking and pop-ups are never affected. Model output is never logged.

## 5. Reports screen, plan, PDF (6a)

### 5.1 Screen
Per `daily-report.html`: date + ← → + headline + Regenerate + Export PDF; "How your day went" story with word-by-word reveal; count-up stat tiles (Daily goal, Top apps, Health check); sections 🏆 Wins · 👀 Habits to watch · 🛠 Do it better ("what happened → better") · ☀ Plan for tomorrow (tick boxes) · ✦ Coach's advice. States: no writer ("Download the writer (2.5 GB) for written reports"), writing/waiting, failed (retry), nothing tracked. Reduced motion disables reveal/count-up/grow-in.

### 5.2 Plan items → coach
Ticking a plan item inserts it for `source_date + 1`; unticking deletes it. The coach reads enabled items for today:
- `focus_block`: new rule `focus_start` (kind `tip`) fires at `start` ("Your focus block starts now", body with minutes); during the block, `behaviour` and `tip` candidates are dropped.
- `app_cap`: merged into today's limits.
- `break_interval`: overrides `breakIntervalMin` for eye_break (and its `gapMs`).
- `wind_down`: overrides `windDownTime` for wind_down and the report schedule.
A **Today's plan** card on the Today screen lists active items with a switch each.

### 5.3 PDF export
Export → save dialog (default `Daylens-YYYY-MM-DD.pdf`) → hidden window renders the report route with a `print` flag (no animation, A4, cream kept) → `webContents.printToPDF` → file. No screen-text samples in the PDF.

## 6. 6b additions

### 6.1 Weekly Insights
- Rail tab **Insights**; week Mon–Sun with ← →.
- Numbers (code): per-day screen time by category, health score per day, totals vs previous week, best focus day (max deep work), top apps of the week, nudges acted/dismissed.
- AI week summary: `WeekInput = { weekStart, days: [{ date, stats, headline? }], totals }` → `WeekJson = { headline ≤ 80, summary ≤ 600, focusForNextWeek ≤ 200 }`, written after Sunday's report or on first run of the next week, same gate and failure behaviour.
```sql
CREATE TABLE IF NOT EXISTS weekly_reports (
  week_start TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('pending','ready','failed')),
  report_json TEXT, model TEXT, generated_at INTEGER, error TEXT
);
```

### 6.2 Report search
```sql
CREATE VIRTUAL TABLE IF NOT EXISTS report_fts USING fts5(date UNINDEXED, body);
```
`body` = headline, story, wins, habits, doBetter, advice, plan text, top app names. Upserted when a report becomes ready; cleared by Delete my activity. Search box on Reports → list of `{ date, snippet }` (FTS5 `snippet()`), newest first, max 50; click opens that day. Query input sanitised (quoted terms) to avoid FTS syntax errors.

### 6.3 PDF auto-save + email
- Settings → Reports: **Auto-save PDFs to…** folder picker (off by default). When a report becomes ready (or is regenerated), its PDF is written to `<folder>/Daylens-YYYY-MM-DD.pdf` (overwrite). A missing/unwritable folder shows a Settings warning; never blocks the report.
- **Email** button: ensures the PDF exists (auto-save folder, else a temp export), opens `mailto:?subject=Daylens — <date>&body=<headline + 3-line summary>` via `shell.openExternal`, and `shell.showItemInFolder(pdf)`.

### 6.4 AI-written live tips
- Applies to `stuck_tip` and `repeat_search` only; `focus_start` (also kind `tip`) always stays a template.
- When the engine is about to show a tip: if cloud mode, or local and free RAM ≥ `WRITER_NEED_BYTES` and the writer is installed, send `TipInput = { ruleId, app, title (exclusion-checked), episode: { minutes, category, activity, avgStuck }, template: { title, body } }` → `TipJson = { title ≤ 60, body ≤ 180 }` with a 20 s cap. Success replaces title/body; anything else keeps the template.
- The nudge row keeps the same rule/key, so cooldowns, back-off and "Show fewer" are unchanged. Never blocks other pop-ups beyond the 20 s (the coach tick guard already serialises ticks).

## 7. Error handling (summary)

| Failure | Behaviour |
|---|---|
| Writer crash / OOM | That job failed + retry card; 3 crashes / 10 min pause automatic writing until restart. |
| Timeout | Process killed, failed (report/week) or template (tip). |
| Model missing / bad hash | "Download the writer" card; bad file deleted and re-fetched. |
| Cloud key / rate limit | Failed with provider reason; no silent local fallback. |
| Invalid output | Local impossible (grammar); cloud one retry; bad items dropped individually. |
| Battery < 20 % | Automatic runs wait for AC; manual works. |
| Auto-save folder gone | Settings warning; report unaffected. |

## 8. Testing

- **Unit:** episode builder, deep-work, candidates + ids, grounding filter, plan validation, ReportJson/WeekJson/TipJson zod schemas and item-dropping, plan items → coach overrides (focus block silence, cap merge, interval, wind-down), report/week scheduler (wind-down, missing yesterday, battery, gate, crash pause), `complete()` with fake providers, Brain write op with a fake model, FTS body builder + query sanitiser, mailto builder, PDF auto-save path logic, live-tip fallback paths.
- **Agent:** all existing `apps/agent` tests pass after the `complete()` move.
- **Real model:** a test that runs only when the writer file is present and free RAM ≥ need: output parses, grounding holds (skipped otherwise).
- **Manual:** real report < 3 min on the owner's PC; PDF looks right; a ticked plan item changes tomorrow's coaching; regenerate replaces; Insights week summary; search finds a word; auto-save writes the file; Email opens a draft and reveals the PDF; a live AI tip appears when memory allows and a template when not.

## 9. Out of scope

Automatic SMTP sending; multi-week/monthly reports; editing report text; sharing links; macOS; sync; multilingual writer.
