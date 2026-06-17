# WorkSight AI — Onboarding & Provisioning (Cloud Cycle 3)

**Status:** Approved (design) · **Date:** 2026-06-17 · **Owner:** Aaron

## 1. Overview & Goal

The dashboard and agent→cloud sync both work, but accounts/profiles only exist via a seed script — so no real company can use the product. This cycle makes a pilot **self-serviceable**: an operator provisions a company's org + first admin; that admin creates teams, generates **reusable invite links**, and manages members from an admin console; invited employees open a link, sign up, and get a `profiles` row automatically — after which the existing dashboard + agent sync work for them unchanged.

Built on the `feat/manager-dashboard` branch (which holds the cloud backend, dashboard, and agent sync).

## 2. The End-to-End Flow

```
Operator (you)            Admin (customer)              Employee
 create-org script   →    log in → Admin console   →    open invite link (/join/<token>)
 (org + admin acct)        • create/rename teams         • sign up (email + password)
                           • generate invite link  ────► • redeem_invite() → profile
                             (team + role, revocable)      auto-created in the right team/role
                           • manage members              • install agent, connect, sync
```

## 3. Scope

**In scope**
- New `invitations` table + `profiles.active` flag + two `SECURITY DEFINER` RPCs (`preview_invite`, `redeem_invite`).
- Admin-write RLS policies (admins may write `teams`/`invitations`/`profiles` within their own org).
- Operator script `create-org.mjs` (service role): create org + first admin.
- Admin console in the dashboard (`/admin`, admins only): Teams, Invites, Members.
- Public accept page (`/join/[token]`): preview invite, sign up, redeem.
- Tests: RPC/RLS behavior, admin-write isolation, operator script, light UI smoke.

**Out of scope (deferred)**
- Email-based invites / SMTP, self-serve company signup, SSO/SAML.
- Hard auth-account disabling (deactivation is an `active` flag this cycle; fully revoking a Supabase auth user is a later admin action).
- Billing, audit logs, bulk CSV import, agent code changes.

## 4. Locked Decisions

| Decision | Choice |
|---|---|
| Invite mechanism | **Reusable invite links** per (team, role); revocable + optional expiry/usage cap. No email/SMTP. |
| Org bootstrap | **Operator-provisioned** via a script (org + first admin); no public signup surface. |
| Profile creation | A `SECURITY DEFINER` `redeem_invite(token)` RPC creates the caller's profile from the invite (no service role in runtime). |
| Admin writes | Admins write `teams`/`invitations`/`profiles` **within their own org**, under their own session (RLS-enforced). |
| Deactivation | `profiles.active = false` (hide from active roster; keep history). Hard auth disable deferred. |
| Agent | No changes — existing Cloud Sync sign-in works once a profile exists. |

## 5. Data Model Changes (Supabase)

### 5.1 `invitations` table
```
id          uuid pk default gen_random_uuid()
org_id      uuid not null references organizations(id) on delete cascade
team_id     uuid not null references teams(id) on delete cascade
role        app_role not null            -- role granted to redeemers ('manager' | 'member')
token       text not null unique         -- random, URL-safe (generated server-side)
expires_at  timestamptz                  -- nullable = no expiry
max_uses    integer                      -- nullable = unlimited
uses        integer not null default 0
revoked     boolean not null default false
created_by  uuid references profiles(id)
created_at  timestamptz not null default now()
```
Index `(org_id)`, unique `(token)`. RLS: admins of the same org may SELECT/INSERT/UPDATE; nobody else can read it (the accept flow uses RPCs, never a direct select).

### 5.2 `profiles.active`
Add `active boolean not null default true`. The dashboard roster and `getTeamMembers` filter to `active = true`; deactivated members keep their `daily_activity` rows for history.

### 5.3 RPCs (`SECURITY DEFINER`, `search_path = public`)
- `preview_invite(p_token text)` → `table(org_name text, team_name text, role app_role)` — returns one row if the token is valid (exists, not revoked, not expired, under `max_uses`), else no rows. Callable by `anon` + `authenticated` (the accept page shows it before the user signs up). Exposes only display fields, never the token table.
- `redeem_invite(p_token text)` → `text` (status: `'ok'` | `'invalid'` | `'expired'` | `'revoked'` | `'exhausted'` | `'already_member'`) — runs as the **authenticated** caller; validates the token; if the caller (`auth.uid()`) has no profile, inserts `profiles(id=auth.uid(), org_id, team_id, role, full_name, email, active=true)` from the invite + the auth user's metadata, and increments `uses` atomically. Idempotent guard: a caller who already has a profile returns `'already_member'` and does not create a second one.

### 5.4 Admin-write RLS
New policies (in addition to cycle-1 SELECT policies), all gated on `viewer_role() = 'admin'` AND same-org:
- `teams`: INSERT/UPDATE where `org_id = viewer_org()`.
- `invitations`: SELECT/INSERT/UPDATE where `org_id = viewer_org()`.
- `profiles`: UPDATE where `org_id = viewer_org()` (for change team/role/active). INSERT stays restricted (profiles are created only by `redeem_invite` or the operator script).
- Grants: `grant insert, update on teams, invitations to authenticated` (RLS still gates rows); `update on profiles` already needs to be granted to `authenticated`.

## 6. Operator Script

`apps/web/scripts/create-org.mjs` (Node, service role; mirrors the existing `seed.mjs` env-loading):
```
node scripts/create-org.mjs --org "Acme Inc" --admin-email admin@acme.test [--admin-password <pw>] [--admin-name "Avery Admin"]
```
Creates the organization, the admin auth user (admin API; random password printed if none given), and the admin `profiles` row (`role='admin'`, `team_id=null`, `active=true`). Idempotent: reuses an existing org by name and an existing auth user by email; never duplicates. Documented in `apps/web/README.md`.

## 7. Dashboard — Admin Console (`/admin`, admins only)

A role-gated route group: the layout calls `getViewerProfile()` and `notFound()`/redirects if `role !== 'admin'`. Server Components read under the admin's session; mutations are **server actions** (RLS-enforced; no service-role key in runtime).

- **Teams** (`/admin/teams`): list teams in the org; create a team (name); rename.
- **Invites** (`/admin/invites`): pick a team + role + optional expiry/max-uses → generate (server action creates an `invitations` row with a random token and shows the full `/join/<token>` URL with copy-to-clipboard); list active (non-revoked, non-expired) links with their team/role/uses; revoke (sets `revoked=true`).
- **Members** (`/admin/members`): list members (name, email, team, role, active); change a member's team; change role; deactivate/reactivate (toggles `active`).

Token generation uses a server-side cryptographically-random URL-safe string.

## 8. Accept Page (`/join/[token]`, public)

Server Component calls `preview_invite(token)`:
- **Valid:** "You've been invited to **{org} · {team}** as **{role}**." + an email/password sign-up form. On submit (server action): `supabase.auth.signUp({ email, password, options: { data: { full_name } } })` → on success, `redeem_invite(token)` → if `'ok'`/`'already_member'`, redirect to `/join/[token]/done` (a short "You're in — download & connect the agent" page); other statuses show the reason.
- **Invalid/expired/revoked:** a clear "This invite link is no longer valid" message.

If a signed-in user without a profile opens the link, they can redeem directly (skip sign-up).

## 9. Agent

No code changes. The post-join confirmation page links to where the agent installer lives (documentation link). Once redeemed, the user signs the agent into Cloud Sync with the same credentials and their data flows to the dashboard.

## 10. Testing

- **`redeem_invite` (RPC/RLS, `tests/supabase/`):** a fresh auth user redeeming a valid token gets a profile in the correct org/team/role and `uses` increments; redeeming returns `'revoked'`/`'expired'`/`'exhausted'`/`'invalid'` appropriately and creates no profile; a second redeem by the same user returns `'already_member'` and does not duplicate; a redeemed member can then `upsert` their own `daily_activity` (ties to cycle 2's self-write RLS).
- **`preview_invite`:** returns display fields for a valid token; no rows for an invalid/expired/revoked token; never exposes the token or other columns.
- **Admin-write isolation:** an admin can INSERT a team/invitation and UPDATE a profile in their **own** org; the same operations targeting **another** org are rejected; a `member`/`manager` cannot write teams/invitations/profiles.
- **Operator script:** creates org + admin (profile `role='admin'`); re-running does not duplicate.
- **Roster filter:** `getTeamMembers`/overview exclude `active = false` members.
- **Light UI smoke** for the console pages + accept flow.

## 11. Acceptance Criteria

1. `node scripts/create-org.mjs --org … --admin-email …` creates an org + an admin who can log into the dashboard; re-running is idempotent.
2. The admin sees an **Admin** section (non-admins do not); can create/rename a team.
3. The admin can generate a reusable invite link for a team+role, copy it, see it listed, and revoke it.
4. Opening a valid `/join/<token>` shows the org/team/role; signing up creates an account and a profile in that team/role; the user lands on the confirmation page.
5. A revoked or expired link shows an "no longer valid" message and creates no profile; an over-`max_uses` link is rejected.
6. A redeemed user appears in the manager/admin roster and can sync activity from the agent (their `daily_activity` self-writes succeed).
7. The admin can change a member's team/role and deactivate a member; deactivated members drop out of the active roster but keep their historical data.
8. No service-role key is used in the dashboard runtime; all admin writes are RLS-enforced under the admin's session; `preview_invite`/`redeem_invite` never expose the invitations table directly.

## 12. Project Structure (additions)

```
supabase/migrations/
  0005_invitations.sql        # invitations table + profiles.active + indexes
  0006_invite_rpcs.sql        # preview_invite + redeem_invite (SECURITY DEFINER)
  0007_admin_write_rls.sql    # admin-write policies + grants
apps/web/
  scripts/create-org.mjs      # operator provisioning script
  app/(dashboard)/admin/
    layout.tsx                # admin-only guard
    teams/page.tsx · teams/actions.ts
    invites/page.tsx · invites/actions.ts
    members/page.tsx · members/actions.ts
  app/join/[token]/
    page.tsx · actions.ts     # preview + sign-up + redeem
    done/page.tsx             # confirmation
  lib/invites.ts              # token generation + typed RPC wrappers
  components/admin/*          # small console UI components
tests/supabase/
  invites-rls.test.ts         # preview/redeem + admin-write isolation
apps/web/README.md            # operator script + admin/onboarding docs
```

## 13. Deferred (future cycles)

Email/SMTP invites · self-serve company signup · SSO/SAML · hard auth-account disabling · audit logs · bulk import · billing · agent installer download hosting.
