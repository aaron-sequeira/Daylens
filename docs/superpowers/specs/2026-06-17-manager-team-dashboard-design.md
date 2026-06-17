# WorkSight AI — Manager/Team Dashboard (Cloud Cycle 1)

**Status:** Approved (design) · **Date:** 2026-06-17 · **Owner:** Aaron

## 1. Overview & Goal

First cloud cycle of WorkSight AI. The desktop agent MVP (local-only activity tracking) is complete and merged to `main`. This cycle builds the **multi-tenant cloud backend** and a **manager/team dashboard** that visualizes team activity, **trends over time**, and **activity-based worker performance** — seeded with synthetic data so the whole stack is real and testable **without** the agent→cloud sync (deferred to the next cycle).

**Goal:** A manager logs in and sees their team: each member's tracked time and active/idle split, team aggregates, **trend lines over a chosen period**, and a per-worker **activity score with a self-trend** (↑/↓ vs. their own prior period). They can drill into one member's day. Row-level security guarantees a manager only ever sees their own team, a member only themselves, an admin only their org.

## 2. Scope

**In scope**
- Supabase (local via CLI + Docker): Postgres schema, Auth (email/password), and **RLS** for tenant isolation.
- Multi-tenant model: **Organizations → Teams → Members**, roles `admin` / `manager` / `member`.
- Next.js (App Router) dashboard: **Team overview** (period selector, aggregate cards, trend charts, member roster with self-trend) and **Member detail** (member trend + a day's per-app breakdown).
- **Trends:** team and per-member time-series over a selectable period (7 / 14 / 30 days).
- **Performance:** a transparent, tunable **activity score** per worker, shown with a **self-trend** vs. the prior equal-length period. No worker-vs-worker ranking.
- Synthetic seed data (one org, 2 teams, ~11 people, ~30 days of activity) with documented demo logins.
- RLS isolation tests + pure-function aggregation/score tests.

**Out of scope (deferred to later cycles)**
- Agent→cloud sync / ingestion (the agent still writes locally; this cycle seeds the cloud DB directly).
- Worker-vs-worker leaderboards/ranking; configurable targets/goals.
- AI manager assistant, reporting/export, realtime updates, integrations (Git/Jira/Calendar).
- Org/team/user management UI (CRUD) — membership is seeded, not editable in-app.
- Hosted/production deployment, billing.

## 3. Locked Decisions

| Decision | Choice |
|---|---|
| Target | Manager/team dashboard, real backend + **seeded** synthetic team data; agent sync deferred. |
| Stack | **Supabase** (local, Postgres + Auth + RLS) + **Next.js** App Router + React + Tailwind + Recharts. |
| Tenancy | **Org → Teams → Members**; roles `admin` / `manager` / `member`. |
| Isolation | Postgres **RLS**; member→self, manager→their team, admin→their org, cross-org→empty. |
| Performance | **Activity score + self-trend** (vs. own prior period). No cross-worker ranking. |
| Trends | Time-series over a selectable period (7 / 14 / 30 days, default 14). |
| Data shape | `daily_activity.by_app` jsonb mirrors the agent's `DaySummary`/`AppUsage` so future sync drops in. |

## 4. Architecture

Extends the existing pnpm monorepo:

- `apps/web/` — Next.js (App Router) dashboard. Server Components query Supabase with the **logged-in user's session**, so **RLS applies automatically**. The service-role key is used **only** by the seed script, never shipped to the browser.
- `supabase/` (repo root) — `config.toml`, SQL migrations (schema + RLS + helper functions), and `seed.sql`. Runs locally via `supabase start` (Docker).

Data flow: `Supabase Postgres (RLS)` → `Next.js server component (user session)` → `React/Recharts`. Node 20 (already installed) satisfies Next.js 15.

## 5. Data Model (Postgres — all tables under RLS)

- **organizations** — `id` uuid pk · `name` · `created_at`.
- **teams** — `id` uuid pk · `org_id` → organizations · `name` · `created_at`. Index `(org_id)`.
- **profiles** — `id` uuid pk (= `auth.users.id`) · `org_id` → organizations · `team_id` → teams (nullable; admins may be org-wide) · `full_name` · `email` · `role` enum `app_role`(`admin`/`manager`/`member`) · `created_at`. Index `(org_id)`, `(team_id)`.
- **daily_activity** — `id` uuid pk · `user_id` → profiles · `date` date · `total_tracked_sec` int · `active_sec` int · `idle_sec` int · `by_app` jsonb (`[{app_name, total_sec, sessions, active_pct}]`) · `created_at` · **unique(`user_id`,`date`)**. Index `(user_id, date)`.

`enum app_role` defined in SQL. All times in seconds (the agent uses ms internally but rolls up to seconds in `DaySummary`; the seed writes seconds). Performance scores and trends are **computed at query time**, not stored.

## 6. Auth & RLS

Supabase Auth, email/password. RLS is the heart of this cycle.

**Helper functions** (schema `public`, `SECURITY DEFINER`, read the caller's row to avoid policy self-recursion):
- `current_profile()` → the caller's profile row (by `auth.uid()`).
- `current_role()` / `current_org()` / `current_team()` → scalar accessors.

**Policies** (SELECT-only for the app; writes happen via the service-role seed which bypasses RLS):
- `profiles`: visible if `role='admin'` and same `org_id`; OR `role='manager'` and same `team_id`; OR row is the caller (`id = auth.uid()`).
- `teams` / `organizations`: visible within the caller's `org_id` (so the UI can label team/org).
- `daily_activity`: visible where `user_id` resolves to a visible profile — expressed directly: `current_role()='admin'` AND owner in same org; OR `current_role()='manager'` AND owner in same team; OR `user_id = auth.uid()`.

Cross-org access yields zero rows for every table. RLS correctness is verified by the isolation tests (§9).

## 7. Metrics, Performance & Trends

All derived from `daily_activity`; defined as **pure functions** in `apps/web/lib/aggregate.ts` and unit-tested.

- **Active %** = `active_sec / total_tracked_sec` (0 when no tracked time).
- **Activity score (0–100)** — transparent, tunable heuristic, explicitly an *activity signal, not a productivity verdict*:
  `score = round( active_pct * coverage * 100 )`, where `coverage = min(active_hours / REFERENCE_ACTIVE_HOURS, 1)` and `REFERENCE_ACTIVE_HOURS = 6` (a named, tunable constant). High score needs both high active % and a full-ish active day; a 30-minute 100%-active day scores low (low coverage).
- **Period aggregation** — for a member over a period: average score, total/avg active hours, avg active %, days-with-data.
- **Self-trend** — compare the selected period's mean (active hours and score) against the **immediately preceding equal-length window**; emit `delta` and direction `up` / `down` / `flat` (flat within a small epsilon). No comparison between different workers.
- **Team aggregates** — for the manager's team over the period: total active hours, avg active %, members tracked, top app (by summed `total_sec` across `by_app`), and a team time-series (active hours/day).
- **Per-app rollup** (member day detail) — straight from that day's `by_app`.

## 8. Dashboard Views (Next.js App Router)

A global **period selector** (7 / 14 / 30 days, default 14) drives all aggregates/trends.

- `/login` — Supabase email/password sign-in; redirects to `/` on success.
- `/` **Team overview** — header (org + team name, role badge, period selector); **aggregate cards** (team active hours, avg active %, members tracked, top app); **team trend chart** (active hours/day, Recharts line/area); **member roster table** — name, avg active hours, active %, **activity score + self-trend arrow**; rows link to detail.
- `/members/[id]` **Member detail** — header (name, period); **member trend chart** (active hours and score over the period); cards (avg score + trend, avg active/idle); a **day selector** within the period that shows that day's **per-app table**, **active/idle donut**, and **time-per-app bar chart** (mirrors the agent's Today view). RLS makes opening an off-team member return not-found/empty.

Components (re-implemented in the web app, same shapes as the agent's): `RosterTable`, `StatCard`, `TrendChart`, `ActiveIdleDonut`, `TimePerAppChart`, `AppTable`, `PeriodSelector`, `DaySelector`, `TrendArrow`.

## 9. Seed Data

`supabase/seed.sql` (run after migrations, via service role): **Acme Inc** (1 org) → **2 teams** ("Platform", "Growth"); **1 admin**, **2 managers** (one per team), **8 members** (4 per team); **~30 days** of `daily_activity` per member with realistic synthetic distributions (workday active hours 3–8h, active % 55–90%, weekends lighter/absent, a few low-coverage days). Auth users seeded with documented demo logins, e.g. `admin@acme.test`, `manager.platform@acme.test`, `member1.platform@acme.test` (shared dev password documented in the web README). Seed is idempotent (safe to re-run).

## 10. Project Structure (additions)

```
worksight/
├─ apps/
│  ├─ agent/                      # existing
│  └─ web/                        # NEW — Next.js dashboard
│     ├─ app/
│     │  ├─ login/page.tsx
│     │  ├─ (dashboard)/page.tsx          # team overview
│     │  └─ members/[id]/page.tsx         # member detail
│     ├─ lib/{supabaseServer,supabaseClient,types,aggregate}.ts
│     ├─ components/{RosterTable,StatCard,TrendChart,ActiveIdleDonut,
│     │              TimePerAppChart,AppTable,PeriodSelector,DaySelector,TrendArrow}.tsx
│     ├─ lib/aggregate.test.ts
│     ├─ next.config.ts · tailwind.config.ts · package.json · tsconfig.json
│     └─ README.md                        # local run + demo logins
└─ supabase/
   ├─ config.toml
   ├─ migrations/0001_init.sql            # enum + tables + indexes
   ├─ migrations/0002_rls.sql             # helper fns + policies
   ├─ seed.sql                            # org/teams/profiles + activity + auth users
   └─ tests/rls.test.ts                   # isolation tests via supabase-js + per-role JWTs
```

## 11. Build & Run

- `supabase start` (Docker) → local Postgres + Auth + Studio.
- `supabase db reset` applies `migrations/*` then `seed.sql`.
- `pnpm --filter @worksight/web dev` → Next.js on localhost; log in with a demo account.
- Env: `apps/web/.env.local` holds `NEXT_PUBLIC_SUPABASE_URL` + anon key (from `supabase status`); service-role key used **only** by the seed step, never in `apps/web` runtime.

## 12. Testing

- **RLS isolation** (`supabase/tests/rls.test.ts`) — sign in as member / manager / admin / other-org and assert each sees exactly the right `profiles` and `daily_activity` rows (member=self only; manager=their team; admin=org; other-org=empty). This is the highest-risk surface and the primary acceptance gate.
- **Aggregation & score** (`apps/web/lib/aggregate.test.ts`, vitest) — active %, activity score (incl. coverage clamping and the 30-min-100%-active edge case), period aggregation, and self-trend direction/delta (including the prior-window comparison and the flat epsilon).
- Component rendering kept to light smoke; logic lives in tested pure functions.

## 13. Acceptance Criteria

1. `supabase start` + `db reset` provisions schema, RLS, and seed without error.
2. Logging in as a **manager** shows only their team's members; as a **member**, only themselves; as an **admin**, the whole org; an **other-org** user sees none of Acme's data. (Verified by RLS tests.)
3. Team overview shows aggregate cards, a team trend chart over the selected period, and a roster with each member's activity score + self-trend arrow.
4. Changing the period (7/14/30) updates all aggregates and trends.
5. Member detail shows the member's trend over the period and, for a selected day, the per-app table + active/idle donut + time-per-app chart.
6. Activity score and self-trend match the documented formulas (unit-tested).
7. The browser bundle never contains the service-role key; dashboard queries rely on the user session + RLS.
8. `by_app` jsonb shape matches the agent's `AppUsage` fields, so a future sync cycle can write the same structure.

## 14. Deferred (next cycles)

Agent→cloud **sync/ingestion** (real data replacing the seed) · targets/goals + leaderboards · AI manager assistant · reporting/export · realtime · integrations · org/user management UI · hosted deployment.
