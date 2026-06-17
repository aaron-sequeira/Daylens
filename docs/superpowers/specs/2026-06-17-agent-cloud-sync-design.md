# WorkSight AI — Agent→Cloud Sync (Cloud Cycle 2)

**Status:** Approved (design) · **Date:** 2026-06-17 · **Owner:** Aaron

## 1. Overview & Goal

The desktop agent (local-only activity tracker) and the cloud manager dashboard both exist, but the dashboard runs on synthetic seed data. This cycle connects them: the agent **signs into the cloud and periodically upserts its own daily activity rollups** to Supabase, so a manager sees **real** team activity instead of seed.

**Goal:** A user opens the agent, connects it to WorkSight (signs in with their dashboard email/password), and enables sync. The agent then pushes its aggregated daily rollups to the cloud on a timer and on quit. The manager dashboard immediately reflects that user's real local data.

Built on the `feat/manager-dashboard` branch — the Supabase backend lives there, and `apps/agent` is present there too (the branch was cut from `main` after the agent shipped).

## 2. Scope

**In scope**
- Cloud: a **self-write RLS policy** so an authenticated user can upsert ONLY their own `daily_activity` rows.
- Agent (main): a Supabase client, an encrypted session store (reusing `safeStorage`), and a `SyncEngine` (periodic + on-quit, last-N-days window, idempotent upsert).
- Agent (renderer): a "Cloud Sync" settings card — sign in, enable/disable, "Sync now", status (account, last-synced, last error).
- Tests: pure mapping unit tests, `syncWindow` logic with fakes, and cloud RLS write tests (self-write allowed, other-user write denied).

**Out of scope (deferred to later cycles)**
- Account onboarding / profile provisioning. **This cycle assumes the signed-in user already has a `profiles` row** (true for seeded members; real onboarding is a later cycle).
- Device tokens, server-side ingest Edge Function, multi-device conflict handling beyond last-write-wins, realtime sync.
- Syncing window titles, raw events, input counts, or app paths (never sent — see Privacy).
- Any dashboard/web changes (the dashboard already reads `daily_activity`).

## 3. Privacy Posture (locked — consistent with the agent's local-only ethos)

- Cloud sync is **opt-in and OFF by default**. The agent remains local-only until the user explicitly connects and enables sync.
- Only the **aggregated daily rollup** leaves the device: `date`, `total_tracked_sec`, `active_sec`, `idle_sec`, and per-app `{ app_name, total_sec, sessions, active_pct }`. **Never** window titles, raw events, input counts, app paths, or per-session detail.
- The user can disconnect or disable at any time. A status line always shows the connected account, last-synced time, and last error, so what-syncs-when is transparent.

## 4. Architecture

```
Agent (main process)                         Cloud (Supabase)
  tracker → SQLite (focus_sessions,             daily_activity (RLS)
            activity_samples)                     ├ SELECT: existing policies (member/mgr/admin)
  rollup.computeDaySummary(date) ─┐              └ INSERT/UPDATE: NEW self-write policy
                                  │                  (user_id = auth.uid())
  SyncEngine.syncWindow ──────────┘
    map DaySummary → row
    supabase.from('daily_activity')
      .upsert(row, { onConflict: 'user_id,date' })   ← authenticated session
```

- The agent reuses `computeDaySummary` (`summary/rollup.ts`) to (re)compute each day in the window from the local SQLite repos — no new rollup logic.
- The Supabase client uses the cloud URL + anon key; all writes carry the **user session** (anon key alone cannot write — RLS requires `auth.uid()`).
- Session persistence reuses the agent's existing `safeStorage` encryption (same mechanism as the Anthropic/AI key).

## 5. Cloud Changes (Supabase)

New migration `supabase/migrations/0004_self_write.sql`:

```sql
-- A user may insert/update ONLY their own daily_activity rows.
create policy daily_self_insert on daily_activity
  for insert with check (user_id = auth.uid());

create policy daily_self_update on daily_activity
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- authenticated already has SELECT (0003); add the write privileges RLS gates.
grant insert, update on daily_activity to authenticated;
```

Isolation guarantees preserved: a user can only write rows where `user_id = auth.uid()`; managers/admins remain **read-only** (no write policy grants them writes); cross-user writes are rejected by the `with check`. The `daily_activity.user_id → profiles.id` FK means a user with no `profiles` row cannot insert (fails FK) — acceptable, since profile provisioning is deferred and the demo uses seeded members.

## 6. Agent — Main Process Modules

- **`main/cloud/config.ts`** — `CLOUD_URL` + `CLOUD_ANON_KEY` (local dev values; build-time constants, overridable by env for later). Exposes `getCloudConfig()`.
- **`main/cloud/session.ts`** — `signIn(email, password)`, `signOut()`, `loadSession()`/`saveSession()` (encrypted via `safeStorage` into the settings store), `getClient()` returning a Supabase client hydrated with the persisted session (auto-refresh). `getAccount()` → `{ userId, email } | null`.
- **`main/cloud/sync.ts`**
  - Pure: `mapDaySummaryToRow(userId: string, s: DaySummary): DailyActivityRow` — maps to snake_case; per-app `{ app_name, total_sec, sessions, active_pct }`; drops `firstOpenAt/lastCloseAt`; non-negative clamping.
  - `syncWindow(deps): Promise<SyncResult>` — for each of the last `windowDays` dates: load the day's sessions+samples from repos, `computeDaySummary`, `mapDaySummaryToRow(userId, …)`, collect, then `upsert(rows, { onConflict: 'user_id,date' })`. Returns `{ syncedDays, lastSyncedAt }` or `{ error }`. Stops early on auth error (surfaced to UI; sync auto-disables prompt). Dependency-injected client + repos + clock for testability.
- **Wiring (`main/index.ts`):** when `cloudSyncEnabled` && signed-in, run `syncWindow` on a 15-minute timer and once on `before-quit` (best-effort). Failures are logged + surfaced via status, never crash the app.
- **Settings (`settings.ts`):** add `cloudSyncEnabled: boolean` (default `false`), `cloudSyncWindowDays: number` (default `7`). The encrypted Supabase session is stored under its own settings key (never returned raw to the renderer).

## 7. Agent — IPC + Renderer

- **IPC (`ipc/channels.ts` + `handlers.ts`, typed via preload):**
  - `cloud.getStatus()` → `{ connected: boolean; email: string | null; enabled: boolean; lastSyncedAt: number | null; lastError: string | null }`
  - `cloud.signIn(email, password)` → `{ ok: true } | { error: string }`
  - `cloud.signOut()` → `void`
  - `cloud.setEnabled(enabled: boolean)` → `void`
  - `cloud.syncNow()` → `{ syncedDays: number } | { error: string }`
- **Renderer (`components/CloudSyncCard.tsx`, shown in `SettingsView`):**
  - Disconnected: a brief privacy line + email/password sign-in form ("Connect to WorkSight").
  - Connected: shows the account email, an **Enable sync** toggle, a **Sync now** button, last-synced time + last error, and **Disconnect**.
  - The raw session/password never leaves the main process; the renderer sees only `getStatus()` fields.

## 8. Testing

- **`sync.test.ts` — `mapDaySummaryToRow`:** a `DaySummary` maps to the exact snake_case row (`user_id`, `date`, `total_tracked_sec`, `active_sec`, `idle_sec`, `by_app:[{app_name,total_sec,sessions,active_pct}]`); titles/firstOpen/lastClose absent; negatives clamped.
- **`sync.test.ts` — `syncWindow`:** with a fake client (records upsert calls) + fake repos + fake clock: upserts exactly `windowDays` dates, passes `onConflict: 'user_id,date'`, returns `syncedDays`; on an injected auth error it stops and returns `{ error }` without partial-crashing. (Native modules not loaded — pure logic + fakes, same pattern as the existing tracker tests.)
- **Cloud RLS write tests (`tests/supabase/`):** signed in as a seeded member — `upsert` of a row with `user_id = self` succeeds and is visible; `insert` of a row with another user's `user_id` is rejected by RLS; a member still cannot write to another member's row.
- **Manual acceptance:** sign the agent in as `member1.platform@acme.test`, click **Sync now**, then load the dashboard as `manager.platform@acme.test` and confirm that member's tile reflects the agent's real local activity for today (replacing seed for synced dates).

## 9. Project Structure (additions)

```
supabase/migrations/0004_self_write.sql        # self-write RLS + grants
apps/agent/src/main/cloud/
  config.ts · session.ts · sync.ts · sync.test.ts
apps/agent/src/main/ipc/{channels,handlers}.ts # + cloud.* channels
apps/agent/src/main/index.ts                   # timer + on-quit wiring
apps/agent/src/main/settings.ts                # cloudSyncEnabled, window, session key
apps/agent/src/shared/types.ts                 # CloudSyncStatus, DailyActivityRow
apps/agent/src/preload/index.ts                # cloud.* bridge
apps/agent/src/renderer/components/CloudSyncCard.tsx  # + SettingsView wiring
apps/agent/src/renderer/lib/ipc.ts             # cloud.* typed wrappers
tests/supabase/write-rls.test.ts               # self-write policy tests
```

## 10. Acceptance Criteria

1. With sync disabled (default), the agent behaves exactly as today; nothing leaves the device.
2. A user can sign the agent into the cloud with dashboard credentials; bad credentials show a clear error; the session persists across agent restarts (encrypted via `safeStorage`).
3. Enabling sync and clicking **Sync now** upserts the last 7 days of the user's rollups into `daily_activity` (idempotent — re-running doesn't duplicate; `onConflict: user_id,date`).
4. Only aggregated rollup fields are sent — no titles, raw events, input counts, or paths (verified by the mapping test asserting the row shape).
5. A signed-in user cannot write another user's `daily_activity` (RLS write test); managers/admins remain read-only.
6. The dashboard reflects synced data: a member synced from the agent shows real activity in the manager view.
7. Sync runs automatically every ~15 min and on quit when enabled + connected; an auth error disables further attempts and surfaces in the status line without crashing the app.
8. Disconnect clears the stored session and stops syncing.

## 11. Deferred (future cycles)

Account onboarding + profile provisioning · device tokens · server-side ingest Edge Function · multi-device conflict resolution · realtime · richer agent UI (sync history/log) · syncing additional (still privacy-safe) aggregates.
