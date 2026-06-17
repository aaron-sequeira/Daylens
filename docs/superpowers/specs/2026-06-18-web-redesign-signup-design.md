# WorkSight AI — Web Redesign + Self-Serve Org Signup (Cloud Cycle 4)

**Status:** Approved (design) · **Date:** 2026-06-18 · **Owner:** Aaron

## 1. Overview & Goal

Two cohesive web changes: a **self-serve "Create your company" signup** (so a new admin can bootstrap an org without the operator script), and a **visual + UX redesign** of the entire web dashboard to a modern, professional look — a **Midnight + cyan dark theme (default) plus a clean light theme**, a left-sidebar navigation shell, and clearly **labeled, icon-bearing buttons** so users always know what each action does.

The desktop agent gets the same design language in a **separate later cycle** (Cycle 5); this spec is web-only.

Built on the `feat/manager-dashboard` branch.

## 2. Scope

**In scope**
- Theme system: light + dark (`darkMode: 'class'`), **dark default**, persisted toggle, no SSR flash; cyan brand accent in both modes.
- App shell redesign: left **sidebar** (role-aware nav) + **topbar** (title/context, period control, primary action, avatar, theme toggle), replacing the current top-tab header.
- A small reusable **UI kit** and restyle of every existing web surface (login, overview, member detail, admin Teams/Invites/Members, the `/join` accept page) — presentational only.
- **Self-serve org signup**: a public `/signup` page + a `SECURITY DEFINER` `create_organization` RPC that creates the org + the caller's **admin** profile; `/login` ↔ `/signup` links.
- Tests: the `create_organization` RPC/RLS behavior; existing suites stay green.

**Out of scope (deferred)**
- Desktop agent restyle (Cycle 5).
- Email verification on signup; anti-abuse / rate-limiting on public signup (known gap, noted).
- Org settings, billing, per-org custom branding.
- Any change to tracking, sync, RLS isolation logic, or the metric/aggregate math (purely presentational + one new signup RPC).

## 3. Locked Decisions

| Decision | Choice |
|---|---|
| Visual direction | Modern "Direction B": sidebar + topbar, rounded cards, soft depth, gradient/accent, sparkline/area charts, avatars, labeled buttons. |
| Theme | Light + dark; **dark (Midnight + cyan) is the default**; `◐` toggle persists per user; **cyan** accent shared by both. |
| Nav model | Left sidebar (role-aware) + topbar; replaces top tabs. |
| Org creation | **Public self-serve** `/signup` → `create_organization` `SECURITY DEFINER` RPC; new user becomes **admin** of the new org. |
| Runtime security | Unchanged: anon key + session only; the RPC is `SECURITY DEFINER` so no service-role key in runtime. |
| Buttons | Every action button has an icon + text label. |

## 4. Theme System

- Tailwind configured with `darkMode: 'class'`. Palette via CSS custom properties on `:root` (light) and `.dark` (dark), referenced by Tailwind theme tokens (e.g. `bg-surface`, `text-fg`, `border-subtle`, `accent`) so components are written once and theme via the class.
- **Default dark:** the `<html>` element gets `class="dark"` by default. A theme cookie (`ws-theme=dark|light`) is read in the root layout (server) to set the class on first paint → **no flash**; a small client `ThemeToggle` writes both the cookie and `localStorage` and toggles the class.
- Accent ramp: cyan (`#06b6d4`/`#22d3ee`) for primary actions, active nav, chart strokes/fills; semantic green/red for trend pills.

## 5. App Shell (layout)

`app/(dashboard)/layout.tsx` becomes a **sidebar + topbar** shell:
- **Sidebar** (`components/shell/Sidebar.tsx`): brand mark; nav links — **Overview** (`/`); an **Admin** group (admins only) — **Teams** (`/admin/teams`), **Invites** (`/admin/invites`), **Members** (`/admin/members`); footer with the **theme toggle** + **Sign out**. The active route is highlighted (cyan pill / left accent). Role comes from `getViewerProfile()`.
- **Topbar** (`components/shell/Topbar.tsx`): the page title + `org · team` context (passed in via the page or a small context), the user **avatar** (initials), and the theme toggle on mobile.
- The page body renders inside the shell. The period segmented control + primary action live in each page's header row (they're page-specific).

The `/login`, `/signup`, and `/join/[token]` pages render **outside** the dashboard shell (their own centered card layout), as today.

## 6. UI Kit (`components/ui/`)

Small, themeable, reusable — each one file:
- `Button.tsx` — variants `primary` (cyan), `secondary` (subtle), `ghost`, `danger`; supports a leading icon + label; sizes sm/md.
- `Card.tsx` — surface card (border + soft shadow, rounded-2xl), themed.
- `StatCard.tsx` — icon chip + uppercase label + big number + optional trend pill (replaces the cycle-1 StatCard).
- `Badge.tsx` — pill (accent / success / danger / neutral) for roles, trends, statuses.
- `Table.tsx` — themed table primitives (header row, row, cell) used by roster/members.
- `Avatar.tsx` — initials avatar with a deterministic gradient from the name.
- `ThemeToggle.tsx` — `'use client'`; toggles `.dark` + writes cookie/localStorage.
- `Segmented.tsx` — the 7/14/30 period control (links to `?period=`).

Existing chart components (`TrendChart`, `ActiveIdleDonut`, `TimePerAppChart`) are restyled to the theme (cyan stroke + gradient fill; dark-aware grid/tooltip colors).

## 7. Page Restyle (presentational; logic unchanged)

Each page keeps its current data/queries and just adopts the kit + shell:
- **`/login`** — centered card, branded, with a "**Create a company →**" link to `/signup`.
- **Overview (`/`)** — header row (title + period segmented + "＋ Generate invite link" if admin); aggregate **StatCards**; restyled trend chart; **roster Table** with avatars + score badges + trend.
- **Member detail (`/members/[id]`)** — restyled cards, donut, app table, day chips, trend chart.
- **Admin Teams / Invites / Members** — restyled forms + tables with labeled buttons ("Create team", "Generate link", "Revoke", "Deactivate", "Save"). Invite links shown in a styled `CopyField`.
- **`/join/[token]`** — restyled accept card matching `/signup`.

## 8. Self-Serve Org Signup

- **`supabase/migrations/0009_create_org_rpc.sql`** — `create_organization(p_org_name text, p_full_name text) returns text`, `SECURITY DEFINER`, `search_path=public`. Behavior, running as the authenticated caller:
  - `auth.uid()` null → `'invalid'`.
  - caller already has a profile → `'already_member'` (no second org).
  - else: insert `organizations(name=p_org_name)`; insert `profiles(id=auth.uid(), org_id=new org, team_id=null, full_name=p_full_name, email=<auth email>, role='admin', active=true)`; return `'ok'`.
  - Granted `execute` to `authenticated`.
- **`app/signup/page.tsx`** (public): "Create your company" form — company name, full name, email, password.
- **`app/signup/actions.ts`** (`'use server'`): `supabase.auth.signUp({ email, password, options:{ data:{ full_name } } })` → on success call `create_organization(orgName, fullName)` → `'ok'`/`'already_member'` → redirect to `/`; other status → back to `/signup?error=…`.
- **`lib/org.ts`** (new) exports a typed `createOrganization(orgName, fullName)` wrapper calling the RPC under the user's session.

## 9. Testing

- **`tests/supabase/create-org-rls.test.ts`**: a freshly signed-up user calling `create_organization` ends up with an org and an **admin** profile (role='admin', org matches); calling it again (already has a profile) returns `'already_member'` and creates no second org; the new admin can then insert a team (ties to cycle-3 admin-write RLS). Clean up created users/orgs in `afterAll`.
- **Theme resolver** (if any pure helper exists, e.g. reading the cookie) unit-tested; otherwise the toggle is verified via build + a controller smoke (GET `/` returns `class="dark"` on `<html>` by default).
- `pnpm --filter @worksight/web typecheck` + `build` pass; existing web unit tests + the full RLS suite stay green.
- Controller smoke: dashboard renders in dark by default; `/signup` creates an org and lands the new admin in the dashboard.

## 10. Acceptance Criteria

1. The dashboard loads in **dark (Midnight + cyan)** by default; the **◐ toggle** switches to light and the choice persists across reloads with no flash.
2. Navigation is a **left sidebar** with role-aware items; admins see the Admin group, members/managers don't.
3. Every action is a **labeled button** (icon + text); no bare/unlabeled buttons remain.
4. All existing pages (login, overview, member detail, admin Teams/Invites/Members, /join) render in the new style with their data intact.
5. Visiting **`/signup`**, filling company + name + email + password, creates an **org + admin profile** and lands the user in the dashboard as that org's admin.
6. A user who already belongs to an org cannot create a second one via the RPC (`already_member`).
7. No service-role key is used in the web runtime; `create_organization` is the only new write path and is RLS/`SECURITY DEFINER`-scoped.
8. Typecheck, build, web unit tests, and the full RLS suite are all green.

## 11. Project Structure (additions/changes)

```
supabase/migrations/0009_create_org_rpc.sql      # create_organization RPC
apps/web/
  tailwind.config.ts                              # darkMode:'class' + theme tokens
  app/globals.css                                 # CSS vars (:root / .dark) + base
  app/layout.tsx                                  # read theme cookie → <html class>
  app/(dashboard)/layout.tsx                      # sidebar + topbar shell
  app/login/page.tsx                              # restyle + link to /signup
  app/signup/page.tsx · signup/actions.ts         # NEW self-serve org signup
  app/(dashboard)/page.tsx · members/[id]/page.tsx# restyle
  app/(dashboard)/admin/{teams,invites,members}/page.tsx  # restyle
  app/join/[token]/page.tsx · done/page.tsx       # restyle
  components/ui/{Button,Card,StatCard,Badge,Table,Avatar,ThemeToggle,Segmented}.tsx
  components/shell/{Sidebar,Topbar}.tsx
  components/{TrendChart,ActiveIdleDonut,TimePerAppChart,RosterTable,CopyField}.tsx  # theme restyle
  lib/org.ts                                       # createOrganization wrapper
tests/supabase/create-org-rls.test.ts
```

## 12. Deferred (future cycles)

Desktop agent restyle (Cycle 5, same language) · email verification + signup rate-limiting/anti-abuse · org settings/branding/billing · realtime · reporting/export.
