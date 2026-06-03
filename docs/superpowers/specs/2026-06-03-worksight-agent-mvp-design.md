# WorkSight Agent — MVP Design Spec

**Status:** Approved (design) · **Date:** 2026-06-03 · **Owner:** Aaron

## 1. Overview & Goal

WorkSight AI (full product) is a hybrid workforce-intelligence platform: a **desktop agent** that collects activity on each employee's machine, plus a cloud/web side (dashboards, multi-tenant management, AI assistant). This spec covers **only the desktop agent MVP** — a standalone, local-only app to validate the core tracking + summarization experience before any cloud work.

**Goal:** A user installs and runs the agent on their own machine. It tracks which applications they use, how long, when each was opened/closed, and their cursor/input activity (active vs idle). It presents a daily summary — structured stats plus an optional AI-written paragraph.

This is an MVP "to test out the main functionality." Everything cloud (Supabase, FastAPI, multi-tenant, the 9 dashboards) is **out of scope** and deferred to later specs.

## 2. Scope

**In scope**
- Foreground application tracking → time spent per app.
- App open / close lifecycle events.
- Cursor / mouse / keyboard **activity** (counts + timestamps only — never content).
- Active vs idle derivation.
- Local SQLite persistence; data never leaves the device.
- "Today" summary view: per-app table, charts, active/idle.
- Optional AI natural-language summary (Anthropic), with graceful offline fallback.
- First-run consent, pause/resume, clear-data, minimal settings.
- Windows-verified; cross-platform code with macOS/Linux build configured.

**Out of scope (deferred)**
- Any cloud/server, account, sync, or multi-tenant features.
- Browser URL/tab capture, screenshots, project/Git/Jira correlation.
- The web dashboards, FastAPI backend, Supabase, Celery, reporting engine.
- Auto-update, code signing, app-store distribution.

## 3. Locked Decisions

| Decision | Choice |
|---|---|
| Deployment | **Standalone, local-only** desktop app. No account, no network except optional AI call. |
| Privacy posture | **Consent-based.** Opt-in on first run; pause anytime; window-title capture toggle; clear-data. No keylogging, no passwords, no coordinates/heatmap. |
| "Open an app" | Window comes to **foreground** = opened (drives time-spent); process exit = closed (pid-liveness check). |
| Cursor tracking | **Activity level** — move count, distance, clicks, scrolls, keypress *events* — never content. |
| Summary | **Both** — structured stats always; AI paragraph when an Anthropic key is configured, else stats-only with a note. |
| Platform | **Windows-first**, cross-platform code; mac/Linux builds configured, verified later. |

## 4. Architecture (Electron process model)

- **Main process** — owns the tracking engine, SQLite, settings, tray, and lifecycle. All sampling/writing/rollup happens here.
- **Preload** — `contextBridge` exposes a typed, minimal IPC API. `contextIsolation` on, `nodeIntegration` off in the renderer.
- **Renderer (React)** — the viewer only. Reads summaries via IPC, subscribes to live-update events, renders tables/charts and the AI card.

Data flow: samplers (main) → SQLite (main) → rollup (main) → IPC → React (renderer). The renderer never touches Node/DB directly.

## 5. Tracking Engine (main process)

Orchestrated by `tracker.ts`, started only after consent and when not paused.

- **Foreground tracking** — `active-win` polled every `poll_interval_ms` (default 2000). On a change of app/pid/title: finalize the open `focus_session` (`ended_at`, `duration_sec`) and insert a new one. Captures app name, executable path, window title (omitted if capture disabled), pid.
- **Open/close** — the first foreground appearance of an app's pid emits an `opened` event and registers the pid for a liveness watch. Each poll, registered pids are tested for liveness (`process.kill(pid, 0)` → `ESRCH` means gone); a dead pid emits `closed`. No full process enumeration.
- **Input activity** — `uiohook-napi` global hooks increment **in-memory counters** for mouse moves, accumulated move distance (px), clicks, scrolls, and keypress events. A bucket timer (every `bucket_size_sec`, default 60) flushes counters to an `activity_samples` row tagged with the current foreground app, then resets them. **No key identities are ever read or stored.**
- **Active vs idle** — a bucket is `active = 1` if it saw any input OR `powerMonitor.getSystemIdleTime() < idle_threshold_sec` (default 60); else `0`. Idle is derived from samples, not stored separately.
- **Lifecycle** — pause stops hooks/polls and finalizes the open session; quit finalizes + flushes; resume restarts samplers.

## 6. Data Model (SQLite via better-sqlite3)

All timestamps are epoch milliseconds; `date` is local `YYYY-MM-DD` for grouping/indexing. Schema is created/migrated on first launch by `db/database.ts`.

- **focus_sessions** — `id` PK · `app_name` · `app_path` · `window_title` (nullable) · `pid` · `started_at` · `ended_at` (null while active) · `duration_sec` · `date`. Index `(date, app_name)`.
- **app_events** — `id` PK · `app_name` · `app_path` · `pid` · `type` CHECK in (`opened`,`closed`) · `at` · `date`.
- **activity_samples** — `id` PK · `bucket_start` · `bucket_end` · `mouse_moves` · `mouse_distance_px` · `clicks` · `scrolls` · `key_events` · `active` (0/1) · `app_name` (foreground during bucket, nullable) · `date`. Index `(date)`.
- **daily_summaries** (cache) — `date` PK · `total_tracked_sec` · `active_sec` · `idle_sec` · `by_app_json` · `ai_summary` · `ai_model` · `ai_generated_at` · `updated_at`.
- **settings** — `key` PK · `value`. Keys: `idle_threshold_sec` (60), `capture_window_titles` (true), `ai_enabled` (false), `anthropic_api_key` (encrypted via Electron `safeStorage`), `ai_model` (`claude-haiku-4-5`), `tracking_paused` (false), `poll_interval_ms` (2000), `bucket_size_sec` (60), `consent_granted` (false).

## 7. Summary

**Structured rollup** (`summary/rollup.ts`), computed per date and cached in `daily_summaries`:
- **Per app** — from `focus_sessions` grouped by `app_name`: `SUM(duration_sec)` (foreground time), `COUNT(*)` (sessions), `MIN(started_at)` (first open), `MAX(ended_at)` (last close), and active% from joined `activity_samples`.
- **Totals** — `total_tracked_sec` = sum of focus-session durations; `active_sec` = summed duration of `active=1` buckets; `idle_sec` = `total_tracked_sec − active_sec` (clamped ≥ 0).

**AI summary** (`summary/ai.ts`) — builds a compact JSON of the day's rollup and calls the Anthropic Messages API (model from settings, default `claude-haiku-4-5`) with a concise factual system prompt to produce a paragraph like: *"You spent 4.2 hours in VS Code across 9 sessions (mostly active), 48 minutes in Chrome, and were idle for ~35 minutes after 3pm."* System prompt uses prompt caching. If `ai_enabled` is false or no key is present, returns `{ error: 'no_key' }` and the UI shows the stats-only note. Generated text is cached in `daily_summaries`.

## 8. IPC API (preload `contextBridge`)

- `tracking.getStatus()` → `{ paused, currentApp, sessionStartedAt }`
- `tracking.pause()` / `tracking.resume()`
- `summary.getDay(date)` → structured rollup object
- `summary.getAvailableDays()` → `string[]`
- `summary.generateAi(date)` → `{ text, model, generatedAt } | { error }`
- `settings.get()` / `settings.set(partial)`
- `data.clearAll()`
- `events.onUpdate(cb)` — main pushes on session close / sample flush so the UI refreshes.

All payloads validated with Zod at the IPC boundary.

## 9. UI (renderer, React + Tailwind + Recharts)

- **Consent gate** — shown until `consent_granted`; explains exactly what is/isn't tracked; "Start tracking" opts in.
- **Today view** — day-picker (defaults to today); header cards for total tracked + active/idle; **per-app table** (app, time, sessions, first open, last close, active %); **time-per-app bar chart** + **active/idle donut**; **AI summary card** with a "Generate" action (or cached text) and a clear fallback when no key.
- **Settings** — idle threshold, capture-titles toggle, AI on/off + API-key field, data location, **Clear all data**.
- **Tray** — show/hide window, **Pause/Resume**, Quit. App runs in the background via the tray.

## 10. Privacy & Consent

Opt-in before any capture; pause from the tray at any time; window-title capture can be disabled; "Clear all data" wipes the DB; the Anthropic key is encrypted at rest via `safeStorage`. Nothing is transmitted anywhere except the optional, user-triggered AI call (which sends only the aggregated rollup, never raw events or titles unless titles are part of the rollup the user can inspect first).

## 11. Tech Stack & Key Libraries

Electron · TypeScript · React 19 + Vite (via `electron-vite`) · `better-sqlite3` · `active-win` · `uiohook-napi` (with `powerMonitor` idle fallback) · Tailwind CSS · Recharts · `@anthropic-ai/sdk` · `zod` · packaged with `electron-builder`; native modules rebuilt via `@electron/rebuild`. Default AI model `claude-haiku-4-5`. Specific versions pinned at implementation time to latest stable.

## 12. Project Structure

Set up as a minimal pnpm workspace (`pnpm-workspace.yaml` → `apps/*`) so it slots into the future monorepo; full Turborepo tooling deferred.

```
worksight/
├─ apps/
│  └─ agent/
│     ├─ src/
│     │  ├─ main/
│     │  │  ├─ index.ts            # app entry, window, tray, lifecycle
│     │  │  ├─ tracking/{activeWindow,inputActivity,processLifecycle,tracker}.ts
│     │  │  ├─ db/{database,repositories}.ts + migrations/
│     │  │  ├─ summary/{rollup,ai}.ts
│     │  │  ├─ ipc/handlers.ts
│     │  │  └─ settings.ts
│     │  ├─ preload/index.ts        # typed contextBridge API
│     │  ├─ renderer/               # React: Dashboard, AppTable, Charts, AiSummaryCard, Settings, ConsentGate
│     │  └─ shared/types.ts         # shared main<->renderer types
│     ├─ electron.vite.config.ts
│     ├─ electron-builder.yml
│     ├─ package.json · tsconfig.json · tailwind.config.ts
├─ pnpm-workspace.yaml · package.json · README.md · .gitignore
```

## 13. Build, Run, Package

- Bootstrap: `corepack enable` → `pnpm install` (triggers `@electron/rebuild` for native modules).
- Dev: `pnpm --filter @worksight/agent dev` (electron-vite, hot reload).
- Package: `pnpm --filter @worksight/agent build` → Windows installer (mac/Linux targets configured).

## 14. Risks & Mitigations

- **Native module ABI** (`better-sqlite3`, `uiohook-napi`) — must match Electron's ABI. Mitigation: `@electron/rebuild` wired into install; pin Electron + module versions.
- **`uiohook-napi` platform needs** — fine on Windows; macOS needs Accessibility permission, Linux needs X11. Mitigation: verify on Windows; if the input hook is unavailable, idle/active still works via `powerMonitor` (we lose only detailed cursor counts) — engine degrades gracefully.
- **`active-win` permissions** — macOS needs Screen Recording permission for titles; Windows fine. Documented; Windows-first.
- **Poll vs precision** — 2s polling can miss sub-2s app switches. Acceptable for MVP; interval is configurable.

## 15. Acceptance Criteria

1. App launches on Windows; consent gate shown; tracking starts only after opt-in.
2. Switching foreground apps produces `focus_sessions` with correct durations (±1 poll interval).
3. Mouse/keyboard activity recorded as per-bucket counts; idle detected after threshold; active/idle split shown.
4. `opened` recorded on first foreground; `closed` recorded on process exit.
5. "Today" view shows total tracked, active/idle, per-app table (time, sessions, first open, last close, active %), and the time-per-app chart.
6. With `ANTHROPIC_API_KEY`/key set, an AI paragraph is generated and cached; without a key, the structured view shows with a clear "stats-only" note.
7. Data persists across app restarts (SQLite).
8. Pause/resume and Clear-all-data work as described.
9. Core tracking logic contains no Windows-only assumptions; mac/Linux builds are configured.

## 16. Deferred (future specs)

Cloud Foundations (monorepo + Supabase schema, RLS, multi-tenant, auth/RBAC, consent/retention) · ingestion API + sync · intelligence/analytics engine · full AI engine + manager assistant · web dashboards + realtime · reporting · integrations (Git/Jira/Calendar). Each gets its own design → plan → build cycle.
