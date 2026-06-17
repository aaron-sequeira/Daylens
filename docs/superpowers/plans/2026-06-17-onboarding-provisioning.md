# Onboarding & Provisioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a pilot company self-serviceable — an operator script creates an org + first admin; the admin generates reusable invite links and manages teams/members from an admin console; invited employees sign up via a link and get a `profiles` row automatically (then the existing dashboard + agent sync work for them).

**Architecture:** New `invitations` table + `profiles.active` flag. Two `SECURITY DEFINER` Postgres RPCs (`preview_invite`, `redeem_invite`) let the public accept page show an invite and create the caller's profile without exposing the table or using a service-role key at runtime. Admin-write RLS lets admins write `teams`/`invitations`/`profiles` within their own org under their own session. A Node operator script (service role) bootstraps org+admin. The admin console + accept page are Next.js routes using server actions.

**Tech Stack:** Supabase (Postgres + Auth + RLS + RPC) · Next.js 15 App Router · React 19 · `@supabase/ssr`/`supabase-js` · vitest · Node (operator script).

## Global Constraints

- Work on branch `feat/manager-dashboard`. Supabase local stack must be RUNNING for DB tasks + smokes.
- Commit messages MUST end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- **Security:** dashboard runtime + accept page use ONLY the anon key + the user's session. The **service-role key is used ONLY by the operator script** (`apps/web/scripts/create-org.mjs`), never in app runtime/components.
- RLS helper functions are `viewer_role()` / `viewer_org()` / `viewer_team()` (existing).
- Invite links are **reusable**, per `(team, role)`, **revocable**, with optional `expires_at` + `max_uses`. Roles granted are `'manager'` or `'member'`.
- `redeem_invite` is idempotent: a caller who already has a profile returns `'already_member'` and creates no second profile. Status strings: `'ok' | 'invalid' | 'expired' | 'revoked' | 'exhausted' | 'already_member'`.
- Admin writes (`teams`/`invitations`/`profiles`) are allowed ONLY for `viewer_role()='admin'` AND same `org_id = viewer_org()`. Members/managers stay read-only. Profiles are INSERTed only by `redeem_invite` (SECURITY DEFINER) or the operator script (service role) — no user-facing profile INSERT policy.
- Migrations continue numbering: `0005`, `0006`, `0007`. After adding a migration, run `supabase db reset` then `pnpm --filter @worksight/web seed`.
- Local cloud values (not secret): URL `http://127.0.0.1:54321`; anon key `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0`; service role `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU`. `enable_confirmations = false` is already set, so `signUp` returns a session immediately.

## File Structure

```
supabase/migrations/
  0005_invitations.sql        # invitations table + profiles.active
  0006_invite_rpcs.sql        # preview_invite + redeem_invite + invitations RLS
  0007_admin_write_rls.sql    # admin-write policies + grants (teams/profiles)
apps/web/
  scripts/create-org.mjs      # operator provisioning (service role)
  lib/invites.ts              # generateInviteToken + previewInvite/redeemInvite + listInvites/createInvite/revokeInvite + admin queries
  lib/invites.test.ts         # generateInviteToken unit test
  app/join/[token]/page.tsx           # public accept page (preview + signup form)
  app/join/[token]/actions.ts         # signUp + redeem server action
  app/join/[token]/done/page.tsx      # confirmation
  app/(dashboard)/admin/layout.tsx    # admin-only guard + sub-nav
  app/(dashboard)/admin/teams/page.tsx     · teams/actions.ts
  app/(dashboard)/admin/invites/page.tsx   · invites/actions.ts
  app/(dashboard)/admin/members/page.tsx   · members/actions.ts
  components/admin/{CopyField,InviteForm}.tsx
tests/supabase/
  invites-rls.test.ts         # preview/redeem behavior + admin-write isolation
apps/web/README.md            # operator script + onboarding docs
```

---

### Task 1: Migration 0005 — invitations table + profiles.active

**Files:** Create `supabase/migrations/0005_invitations.sql`

**Interfaces:**
- Produces: table `invitations(id, org_id, team_id, role, token unique, expires_at, max_uses, uses, revoked, created_by, created_at)`; column `profiles.active boolean not null default true`.

- [ ] **Step 1: Write the migration**

`supabase/migrations/0005_invitations.sql`:
```sql
alter table profiles add column active boolean not null default true;

create table invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  role app_role not null,
  token text not null unique,
  expires_at timestamptz,
  max_uses integer,
  uses integer not null default 0,
  revoked boolean not null default false,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index idx_invitations_org on invitations(org_id);
```

- [ ] **Step 2: Apply + verify**

Run:
```bash
supabase db reset && pnpm --filter @worksight/web seed
docker exec supabase_db_WorkTrackerProject psql -U postgres -d postgres -c "\d invitations" -c "select column_name from information_schema.columns where table_name='profiles' and column_name='active';"
```
Expected: `invitations` table prints with all columns; `active` column listed on `profiles`. Seed completes (11 profiles, all `active=true` by default).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0005_invitations.sql
git commit -m "feat(web): invitations table + profiles.active

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Migration 0006 — invite RPCs + invitations RLS

**Files:** Create `supabase/migrations/0006_invite_rpcs.sql`, `tests/supabase/invites-rls.test.ts`

**Interfaces:**
- Consumes: `invitations` (Task 1), `viewer_role()/viewer_org()` (existing).
- Produces: RPC `preview_invite(p_token text) → table(org_name, team_name, role)` (anon+authenticated); RPC `redeem_invite(p_token text) → text` (authenticated); invitations RLS (admin same-org select/insert/update).

- [ ] **Step 1: Write the migration**

`supabase/migrations/0006_invite_rpcs.sql`:
```sql
-- Public, safe preview: only display fields, only for currently-valid tokens.
create or replace function public.preview_invite(p_token text)
returns table(org_name text, team_name text, role app_role)
language sql stable security definer set search_path = public as $$
  select o.name, t.name, i.role
  from invitations i
  join organizations o on o.id = i.org_id
  join teams t on t.id = i.team_id
  where i.token = p_token
    and i.revoked = false
    and (i.expires_at is null or i.expires_at > now())
    and (i.max_uses is null or i.uses < i.max_uses);
$$;
grant execute on function public.preview_invite(text) to anon, authenticated;

-- Redeem: creates the CALLER's profile from the invite. Idempotent.
create or replace function public.redeem_invite(p_token text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  inv invitations%rowtype;
  uid uuid := auth.uid();
  u_email text;
  u_name text;
begin
  if uid is null then return 'invalid'; end if;
  select * into inv from invitations where token = p_token for update;
  if not found then return 'invalid'; end if;
  if inv.revoked then return 'revoked'; end if;
  if inv.expires_at is not null and inv.expires_at <= now() then return 'expired'; end if;
  if inv.max_uses is not null and inv.uses >= inv.max_uses then return 'exhausted'; end if;
  if exists (select 1 from profiles where id = uid) then return 'already_member'; end if;
  select email, coalesce(raw_user_meta_data->>'full_name', email)
    into u_email, u_name from auth.users where id = uid;
  insert into profiles (id, org_id, team_id, full_name, email, role, active)
    values (uid, inv.org_id, inv.team_id, u_name, u_email, inv.role, true);
  update invitations set uses = uses + 1 where id = inv.id;
  return 'ok';
end;
$$;
grant execute on function public.redeem_invite(text) to authenticated;

-- Admins manage invitations within their own org. (Redeem path uses the SECURITY DEFINER fn above.)
alter table invitations enable row level security;
create policy inv_admin_select on invitations for select
  using (public.viewer_role() = 'admin' and org_id = public.viewer_org());
create policy inv_admin_insert on invitations for insert
  with check (public.viewer_role() = 'admin' and org_id = public.viewer_org());
create policy inv_admin_update on invitations for update
  using (public.viewer_role() = 'admin' and org_id = public.viewer_org())
  with check (public.viewer_role() = 'admin' and org_id = public.viewer_org());
grant select, insert, update on invitations to authenticated;
```

- [ ] **Step 2: Write the failing test**

`tests/supabase/invites-rls.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PW = 'worksight-dev';

const admin = () => createClient(URL, SERVICE, { auth: { persistSession: false } });
async function signIn(email: string): Promise<SupabaseClient> {
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PW });
  if (error) throw error;
  return c;
}
async function makeInvite(orgName: string, teamName: string, role: string, token: string, opts: { revoked?: boolean; expires_at?: string; max_uses?: number } = {}) {
  const db = admin();
  const { data: org } = await db.from('organizations').select('id').eq('name', orgName).single();
  const { data: team } = await db.from('teams').select('id').eq('name', teamName).eq('org_id', org!.id).single();
  await db.from('invitations').insert({ org_id: org!.id, team_id: team!.id, role, token, ...opts });
}

describe('preview_invite', () => {
  beforeAll(async () => { await makeInvite('Acme Inc', 'Platform', 'member', 'tok-valid'); await makeInvite('Acme Inc', 'Platform', 'member', 'tok-revoked', { revoked: true }); });
  it('returns display info for a valid token (anon)', async () => {
    const c = createClient(URL, ANON, { auth: { persistSession: false } });
    const { data } = await c.rpc('preview_invite', { p_token: 'tok-valid' });
    expect(data).toEqual([{ org_name: 'Acme Inc', team_name: 'Platform', role: 'member' }]);
  });
  it('returns nothing for a revoked token', async () => {
    const c = createClient(URL, ANON, { auth: { persistSession: false } });
    const { data } = await c.rpc('preview_invite', { p_token: 'tok-revoked' });
    expect(data).toEqual([]);
  });
  it('does not let anon read the invitations table directly', async () => {
    const c = createClient(URL, ANON, { auth: { persistSession: false } });
    const { data } = await c.from('invitations').select('token');
    expect(data ?? []).toEqual([]);
  });
});

describe('redeem_invite', () => {
  let newUserClient: SupabaseClient;
  let newUserId: string;
  beforeAll(async () => {
    await makeInvite('Acme Inc', 'Growth', 'member', 'tok-redeem');
    const email = `invitee_${Date.now()}@acme.test`;
    const c = createClient(URL, ANON, { auth: { persistSession: false } });
    const { data } = await c.auth.signUp({ email, password: PW, options: { data: { full_name: 'New Hire' } } });
    newUserClient = c; newUserId = data.user!.id;
  });
  it('creates the caller profile in the invite team/role and returns ok', async () => {
    const { data: status } = await newUserClient.rpc('redeem_invite', { p_token: 'tok-redeem' });
    expect(status).toBe('ok');
    const { data: prof } = await admin().from('profiles').select('team_id, role, full_name, active').eq('id', newUserId).single();
    const { data: growth } = await admin().from('organizations').select('id').eq('name', 'Acme Inc').single().then(async (o) =>
      admin().from('teams').select('id').eq('name', 'Growth').eq('org_id', o.data!.id).single());
    expect(prof).toMatchObject({ team_id: growth!.id, role: 'member', full_name: 'New Hire', active: true });
  });
  it('is idempotent — second redeem returns already_member, no duplicate', async () => {
    const { data: status } = await newUserClient.rpc('redeem_invite', { p_token: 'tok-redeem' });
    expect(status).toBe('already_member');
    const { count } = await admin().from('profiles').select('*', { count: 'exact', head: true }).eq('id', newUserId);
    expect(count).toBe(1);
  });
  it('a redeemed user can self-write their own daily_activity', async () => {
    const { error } = await newUserClient.from('daily_activity').upsert(
      { user_id: newUserId, date: '2099-02-02', total_tracked_sec: 60, active_sec: 30, idle_sec: 30, by_app: [] },
      { onConflict: 'user_id,date' });
    expect(error).toBeNull();
  });
  it('rejects a revoked token without creating a profile', async () => {
    await makeInvite('Acme Inc', 'Growth', 'member', 'tok-rv2', { revoked: true });
    const email = `invitee2_${Date.now()}@acme.test`;
    const c = createClient(URL, ANON, { auth: { persistSession: false } });
    await c.auth.signUp({ email, password: PW });
    const { data: status } = await c.rpc('redeem_invite', { p_token: 'tok-rv2' });
    expect(status).toBe('revoked');
  });
});
```

- [ ] **Step 3: Run — fails (no migration yet), then apply + pass**

Run (RED — RPCs missing):
```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon> SUPABASE_SERVICE_ROLE_KEY=<service> pnpm exec vitest run --config vitest.config.ts tests/supabase/invites-rls.test.ts
```
Expected: FAIL (function `preview_invite` does not exist). Then apply + reseed and re-run:
```bash
supabase db reset && pnpm --filter @worksight/web seed
<same vitest command>
```
Expected: PASS (preview + redeem suites). (Other RLS suites unaffected.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0006_invite_rpcs.sql tests/supabase/invites-rls.test.ts
git commit -m "feat(web): preview_invite + redeem_invite RPCs + invitations RLS

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Migration 0007 — admin-write RLS for teams + profiles

**Files:** Create `supabase/migrations/0007_admin_write_rls.sql`; extend `tests/supabase/invites-rls.test.ts`

**Interfaces:**
- Consumes: `viewer_role()/viewer_org()`; `teams`/`profiles`.
- Produces: admin INSERT/UPDATE policies on `teams`; admin UPDATE on `profiles`; grants to `authenticated`.

- [ ] **Step 1: Write the migration**

`supabase/migrations/0007_admin_write_rls.sql`:
```sql
create policy teams_admin_insert on teams for insert
  with check (public.viewer_role() = 'admin' and org_id = public.viewer_org());
create policy teams_admin_update on teams for update
  using (public.viewer_role() = 'admin' and org_id = public.viewer_org())
  with check (public.viewer_role() = 'admin' and org_id = public.viewer_org());

create policy profiles_admin_update on profiles for update
  using (public.viewer_role() = 'admin' and org_id = public.viewer_org())
  with check (public.viewer_role() = 'admin' and org_id = public.viewer_org());

grant insert, update on teams to authenticated;
grant update on profiles to authenticated;
```

- [ ] **Step 2: Write the failing admin-isolation tests**

Append to `tests/supabase/invites-rls.test.ts`:
```ts
describe('admin-write isolation', () => {
  it('an admin can create a team + invitation in their own org', async () => {
    const adminC = await signIn('admin@acme.test');
    const { data: org } = await adminC.from('organizations').select('id').single();
    const { error: teamErr } = await adminC.from('teams').insert({ org_id: org!.id, name: `T_${Date.now()}` });
    expect(teamErr).toBeNull();
    const { data: team } = await adminC.from('teams').select('id').limit(1).single();
    const { error: invErr } = await adminC.from('invitations').insert({ org_id: org!.id, team_id: team!.id, role: 'member', token: `at_${Date.now()}` });
    expect(invErr).toBeNull();
  });
  it('a manager CANNOT create a team', async () => {
    const mgr = await signIn('manager.platform@acme.test');
    const { data: org } = await mgr.from('organizations').select('id').single();
    const { error } = await mgr.from('teams').insert({ org_id: org!.id, name: 'nope' });
    expect(error).not.toBeNull();
  });
  it('an admin can deactivate a member (UPDATE profiles.active)', async () => {
    const adminC = await signIn('admin@acme.test');
    const { data: m } = await adminC.from('profiles').select('id').eq('email', 'member4.growth@acme.test').single();
    const { error } = await adminC.from('profiles').update({ active: false }).eq('id', m!.id);
    expect(error).toBeNull();
    // reactivate so the suite is re-runnable
    await adminC.from('profiles').update({ active: true }).eq('id', m!.id);
  });
});
```

- [ ] **Step 3: Run — fails, apply, pass**

RED (policies/grants missing → manager-insert might error already, but admin-insert will fail without the policy):
```bash
<vitest command for tests/supabase/invites-rls.test.ts>
```
Expected: FAIL (admin insert rejected). Apply + reseed + re-run:
```bash
supabase db reset && pnpm --filter @worksight/web seed
<vitest command>
```
Expected: PASS (all invites-rls tests, including admin isolation). Also re-run the full RLS suite (`pnpm exec vitest run --config vitest.config.ts`) → all green (cycle 1/2 isolation untouched).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0007_admin_write_rls.sql tests/supabase/invites-rls.test.ts
git commit -m "feat(web): admin-write RLS for teams + profiles (own-org only)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Operator provisioning script

**Files:** Create `apps/web/scripts/create-org.mjs`; modify `apps/web/README.md`

**Interfaces:**
- Produces: `node scripts/create-org.mjs --org <name> --admin-email <email> [--admin-password <pw>] [--admin-name <name>]` → org + admin auth user + admin profile (role='admin', team_id=null, active=true). Idempotent.

- [ ] **Step 1: Write the script**

`apps/web/scripts/create-org.mjs`:
```js
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

const envPath = join(dirname(fileURLToPath(import.meta.url)), '..', '.env.local');
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2];
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error('Missing SUPABASE url/service-role key in apps/web/.env.local');

function arg(name) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; }
const orgName = arg('org');
const adminEmail = arg('admin-email');
const adminName = arg('admin-name') ?? 'Org Admin';
const adminPassword = arg('admin-password') ?? randomBytes(9).toString('base64url');
if (!orgName || !adminEmail) { console.error('Usage: node scripts/create-org.mjs --org "<name>" --admin-email <email> [--admin-password <pw>] [--admin-name "<name>"]'); process.exit(1); }

const db = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

async function ensureOrg(name) {
  const { data: existing } = await db.from('organizations').select('id').eq('name', name).maybeSingle();
  if (existing) return existing.id;
  const { data, error } = await db.from('organizations').insert({ name }).select('id').single();
  if (error) throw error; return data.id;
}
async function ensureUser(email, fullName, password) {
  const { data: list } = await db.auth.admin.listUsers();
  const found = list.users.find((u) => u.email === email);
  if (found) return found.id;
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName } });
  if (error) throw error; return data.user.id;
}

const orgId = await ensureOrg(orgName);
const adminId = await ensureUser(adminEmail, adminName, adminPassword);
const { data: prof } = await db.from('profiles').select('id').eq('id', adminId).maybeSingle();
if (!prof) {
  const { error } = await db.from('profiles').insert({ id: adminId, org_id: orgId, team_id: null, full_name: adminName, email: adminEmail, role: 'admin', active: true });
  if (error) throw error;
}
console.log(`Org "${orgName}" ready. Admin: ${adminEmail}`);
if (!arg('admin-password')) console.log(`Generated admin password: ${adminPassword}`);
process.exit(0);
```

- [ ] **Step 2: Run it + verify idempotency**

Run:
```bash
pnpm --filter @worksight/web exec node scripts/create-org.mjs --org "Pilot Co" --admin-email admin@pilot.test --admin-password pilotpass1
pnpm --filter @worksight/web exec node scripts/create-org.mjs --org "Pilot Co" --admin-email admin@pilot.test --admin-password pilotpass1
docker exec supabase_db_WorkTrackerProject psql -U postgres -d postgres -c "select count(*) from organizations where name='Pilot Co'; select role from profiles where email='admin@pilot.test';"
```
Expected: first run prints "ready"; second run does not error or duplicate; org count = 1; profile role = `admin`.

- [ ] **Step 3: Document in README**

Add a "Provisioning a pilot company" section to `apps/web/README.md`:
```markdown
## Provisioning a pilot company (operator)
Create an org + its first admin (service-role; run once per company):
\`\`\`
pnpm --filter @worksight/web exec node scripts/create-org.mjs --org "Acme Inc" --admin-email admin@acme.test
\`\`\`
The admin then logs in, opens **Admin**, creates teams, and generates invite links (`/join/<token>`) to share with employees.
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/scripts/create-org.mjs apps/web/README.md
git commit -m "feat(web): operator script to provision org + first admin

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Invite token + typed RPC/query helpers

**Files:** Create `apps/web/lib/invites.ts`, `apps/web/lib/invites.test.ts`

**Interfaces:**
- Consumes: `createServerSupabase` (existing).
- Produces (used by Tasks 6/8):
  - `generateInviteToken(): string` — 32-char URL-safe random.
  - `previewInvite(token): Promise<{ orgName: string; teamName: string; role: string } | null>`
  - `redeemInvite(token): Promise<string>` (status)
  - `listInvites(): Promise<InviteRow[]>` · `createInvite(input): Promise<void>` · `revokeInvite(id): Promise<void>`
  - `listTeams()` · `createTeam(name)` · `renameTeam(id,name)`
  - `listAllMembers()` · `updateMember(id, patch)`

- [ ] **Step 1: Write the failing token test**

`apps/web/lib/invites.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { generateInviteToken } from './invites';

describe('generateInviteToken', () => {
  it('is 32 url-safe chars and unique across calls', () => {
    const a = generateInviteToken();
    const b = generateInviteToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(a).not.toBe(b);
  });
});
```
> `apps/web` has no vitest test yet besides `lib/*.test.ts`; this runs under `pnpm --filter @worksight/web test`.

- [ ] **Step 2: Run — fails**

Run: `pnpm --filter @worksight/web test`
Expected: FAIL — cannot find module `./invites`.

- [ ] **Step 3: Implement `lib/invites.ts`**

`apps/web/lib/invites.ts`:
```ts
import { randomBytes } from 'node:crypto';
import { createServerSupabase } from './supabaseServer';

export function generateInviteToken(): string {
  return randomBytes(24).toString('base64url').slice(0, 32);
}

export interface InviteRow { id: string; team_id: string; team_name: string; role: string; token: string; uses: number; max_uses: number | null; expires_at: string | null; }

export async function previewInvite(token: string): Promise<{ orgName: string; teamName: string; role: string } | null> {
  const s = await createServerSupabase();
  const { data } = await s.rpc('preview_invite', { p_token: token });
  const row = (data as { org_name: string; team_name: string; role: string }[] | null)?.[0];
  return row ? { orgName: row.org_name, teamName: row.team_name, role: row.role } : null;
}

export async function redeemInvite(token: string): Promise<string> {
  const s = await createServerSupabase();
  const { data, error } = await s.rpc('redeem_invite', { p_token: token });
  return error ? 'invalid' : (data as string);
}

export async function listTeams(): Promise<{ id: string; name: string }[]> {
  const s = await createServerSupabase();
  const { data } = await s.from('teams').select('id, name').order('name');
  return data ?? [];
}
export async function createTeam(name: string): Promise<void> {
  const s = await createServerSupabase();
  const { data: me } = await s.auth.getUser();
  const { data: prof } = await s.from('profiles').select('org_id').eq('id', me.user!.id).single();
  await s.from('teams').insert({ org_id: prof!.org_id, name });
}
export async function renameTeam(id: string, name: string): Promise<void> {
  const s = await createServerSupabase();
  await s.from('teams').update({ name }).eq('id', id);
}

export async function listInvites(): Promise<InviteRow[]> {
  const s = await createServerSupabase();
  const { data } = await s.from('invitations')
    .select('id, team_id, role, token, uses, max_uses, expires_at, revoked, teams(name)')
    .eq('revoked', false).order('created_at', { ascending: false });
  return (data ?? []).map((r) => ({
    id: r.id, team_id: r.team_id, role: r.role, token: r.token, uses: r.uses, max_uses: r.max_uses, expires_at: r.expires_at,
    team_name: (r.teams as { name: string } | null)?.name ?? ''
  }));
}
export async function createInvite(input: { teamId: string; role: string; maxUses: number | null; expiresAt: string | null }): Promise<void> {
  const s = await createServerSupabase();
  const { data: me } = await s.auth.getUser();
  const { data: prof } = await s.from('profiles').select('org_id').eq('id', me.user!.id).single();
  await s.from('invitations').insert({
    org_id: prof!.org_id, team_id: input.teamId, role: input.role, token: generateInviteToken(),
    max_uses: input.maxUses, expires_at: input.expiresAt, created_by: me.user!.id
  });
}
export async function revokeInvite(id: string): Promise<void> {
  const s = await createServerSupabase();
  await s.from('invitations').update({ revoked: true }).eq('id', id);
}

export interface MemberRow { id: string; full_name: string; email: string; team_id: string | null; role: string; active: boolean; }
export async function listAllMembers(): Promise<MemberRow[]> {
  const s = await createServerSupabase();
  const { data } = await s.from('profiles').select('id, full_name, email, team_id, role, active').order('full_name');
  return data ?? [];
}
export async function updateMember(id: string, patch: { team_id?: string | null; role?: string; active?: boolean }): Promise<void> {
  const s = await createServerSupabase();
  await s.from('profiles').update(patch).eq('id', id);
}
```

- [ ] **Step 4: Run — passes + typecheck**

Run: `pnpm --filter @worksight/web test && pnpm --filter @worksight/web typecheck`
Expected: token test PASS; typecheck PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/invites.ts apps/web/lib/invites.test.ts
git commit -m "feat(web): invite token + typed RPC/admin query helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Accept page (`/join/[token]`) — preview, sign up, redeem

**Files:** Create `apps/web/app/join/[token]/page.tsx`, `apps/web/app/join/[token]/actions.ts`, `apps/web/app/join/[token]/done/page.tsx`

**Interfaces:**
- Consumes: `previewInvite`, `redeemInvite` (Task 5), `createServerSupabase`.

- [ ] **Step 1: Write the accept action**

`apps/web/app/join/[token]/actions.ts`:
```ts
'use server';
import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabaseServer';
import { redeemInvite } from '@/lib/invites';

export async function acceptInvite(token: string, formData: FormData) {
  const email = String(formData.get('email'));
  const password = String(formData.get('password'));
  const fullName = String(formData.get('full_name'));
  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
  if (error) redirect(`/join/${token}?error=${encodeURIComponent(error.message)}`);
  const status = await redeemInvite(token);
  if (status === 'ok' || status === 'already_member') redirect(`/join/${token}/done`);
  redirect(`/join/${token}?error=${encodeURIComponent('This invite is ' + status)}`);
}
```

- [ ] **Step 2: Write the accept page**

`apps/web/app/join/[token]/page.tsx`:
```tsx
import { previewInvite } from '@/lib/invites';
import { acceptInvite } from './actions';

export default async function JoinPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string }> }) {
  const { token } = await params;
  const { error } = await searchParams;
  const invite = await previewInvite(token);

  if (!invite) {
    return <div className="mx-auto mt-24 max-w-sm rounded-xl border bg-white p-6 text-center text-sm text-gray-600">This invite link is no longer valid.</div>;
  }
  const accept = acceptInvite.bind(null, token);
  return (
    <div className="mx-auto mt-24 max-w-sm rounded-xl border bg-white p-6 shadow-sm">
      <h1 className="text-lg font-semibold">Join {invite.orgName}</h1>
      <p className="mb-4 text-sm text-gray-500">You've been invited to <span className="font-medium">{invite.teamName}</span> as <span className="font-medium">{invite.role}</span>.</p>
      <form action={accept} className="space-y-3">
        <input name="full_name" placeholder="Full name" required className="w-full rounded border px-3 py-2 text-sm" />
        <input name="email" type="email" placeholder="Work email" required className="w-full rounded border px-3 py-2 text-sm" />
        <input name="password" type="password" placeholder="Choose a password" required minLength={6} className="w-full rounded border px-3 py-2 text-sm" />
        <button className="w-full rounded bg-gray-900 px-3 py-2 text-sm text-white">Create account & join</button>
      </form>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </div>
  );
}
```

`apps/web/app/join/[token]/done/page.tsx`:
```tsx
import Link from 'next/link';
export default function JoinDone() {
  return (
    <div className="mx-auto mt-24 max-w-sm rounded-xl border bg-white p-6 text-center">
      <h1 className="text-lg font-semibold">You're in 🎉</h1>
      <p className="mt-2 text-sm text-gray-600">Your account is set up. Open the dashboard, or install the WorkSight agent and sign in with the same credentials to start syncing your activity.</p>
      <Link href="/" className="mt-4 inline-block rounded bg-gray-900 px-3 py-2 text-sm text-white">Go to dashboard</Link>
    </div>
  );
}
```

- [ ] **Step 3: Verify (typecheck + build)**

Run: `pnpm --filter @worksight/web typecheck && pnpm --filter @worksight/web build`
Expected: PASS. `/join/[token]` is dynamic (uses params/searchParams + cookies). (The controller runs the live signup→redeem smoke after commit.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/join
git commit -m "feat(web): public invite accept page (preview + signup + redeem)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Admin console — guard layout + Teams

**Files:** Create `apps/web/app/(dashboard)/admin/layout.tsx`, `app/(dashboard)/admin/teams/page.tsx`, `app/(dashboard)/admin/teams/actions.ts`; modify `apps/web/app/(dashboard)/layout.tsx` (add Admin nav link for admins)

**Interfaces:**
- Consumes: `getViewerProfile` (existing), `listTeams`/`createTeam`/`renameTeam` (Task 5).

- [ ] **Step 1: Admin guard layout + nav link**

`apps/web/app/(dashboard)/admin/layout.tsx`:
```tsx
import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { getViewerProfile } from '@/lib/queries';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const viewer = await getViewerProfile();
  if (!viewer || viewer.role !== 'admin') notFound();
  return (
    <div className="space-y-4">
      <nav className="flex gap-3 border-b pb-2 text-sm">
        <Link href="/admin/teams" className="text-gray-700 hover:underline">Teams</Link>
        <Link href="/admin/invites" className="text-gray-700 hover:underline">Invites</Link>
        <Link href="/admin/members" className="text-gray-700 hover:underline">Members</Link>
      </nav>
      {children}
    </div>
  );
}
```
In `apps/web/app/(dashboard)/layout.tsx`, add an Admin link in the header shown only when `viewer.role === 'admin'` (next to the existing org/role badge):
```tsx
{viewer.role === 'admin' && <a href="/admin/teams" className="text-sm text-gray-600 hover:text-gray-900">Admin</a>}
```

- [ ] **Step 2: Teams action + page**

`apps/web/app/(dashboard)/admin/teams/actions.ts`:
```ts
'use server';
import { revalidatePath } from 'next/cache';
import { createTeam, renameTeam } from '@/lib/invites';

export async function createTeamAction(formData: FormData) {
  await createTeam(String(formData.get('name')));
  revalidatePath('/admin/teams');
}
export async function renameTeamAction(formData: FormData) {
  await renameTeam(String(formData.get('id')), String(formData.get('name')));
  revalidatePath('/admin/teams');
}
```

`apps/web/app/(dashboard)/admin/teams/page.tsx`:
```tsx
import { listTeams } from '@/lib/invites';
import { createTeamAction, renameTeamAction } from './actions';

export default async function TeamsPage() {
  const teams = await listTeams();
  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold">Teams</h2>
      <form action={createTeamAction} className="flex gap-2">
        <input name="name" placeholder="New team name" required className="rounded border px-2 py-1 text-sm" />
        <button className="rounded bg-gray-900 px-3 py-1 text-sm text-white">Create team</button>
      </form>
      <ul className="divide-y rounded border bg-white">
        {teams.map((t) => (
          <li key={t.id} className="flex items-center gap-2 p-2">
            <form action={renameTeamAction} className="flex items-center gap-2">
              <input type="hidden" name="id" value={t.id} />
              <input name="name" defaultValue={t.name} className="rounded border px-2 py-1 text-sm" />
              <button className="rounded border px-2 py-1 text-xs text-gray-600">Rename</button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Run: `pnpm --filter @worksight/web typecheck && pnpm --filter @worksight/web build`
Expected: PASS. (Controller verifies admin-only access + create/rename in the live smoke.)

- [ ] **Step 4: Commit**

```bash
git add "apps/web/app/(dashboard)/admin/layout.tsx" "apps/web/app/(dashboard)/admin/teams" "apps/web/app/(dashboard)/layout.tsx"
git commit -m "feat(web): admin console guard + nav + Teams management

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Admin console — Invites

**Files:** Create `apps/web/app/(dashboard)/admin/invites/page.tsx`, `invites/actions.ts`, `apps/web/components/admin/CopyField.tsx`

**Interfaces:**
- Consumes: `listTeams`, `listInvites`, `createInvite`, `revokeInvite` (Task 5).

- [ ] **Step 1: Copy-to-clipboard field (client component)**

`apps/web/components/admin/CopyField.tsx`:
```tsx
'use client';
import { useState } from 'react';
export function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <input readOnly value={value} className="w-80 rounded border px-2 py-1 text-xs" />
      <button onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        className="rounded border px-2 py-1 text-xs text-gray-600">{copied ? 'Copied' : 'Copy'}</button>
    </div>
  );
}
```

- [ ] **Step 2: Invites actions**

`apps/web/app/(dashboard)/admin/invites/actions.ts`:
```ts
'use server';
import { revalidatePath } from 'next/cache';
import { createInvite, revokeInvite } from '@/lib/invites';

export async function createInviteAction(formData: FormData) {
  const teamId = String(formData.get('team_id'));
  const role = String(formData.get('role'));
  const maxUsesRaw = String(formData.get('max_uses'));
  const expiresRaw = String(formData.get('expires_at'));
  await createInvite({
    teamId, role,
    maxUses: maxUsesRaw ? Number(maxUsesRaw) : null,
    expiresAt: expiresRaw ? new Date(expiresRaw).toISOString() : null
  });
  revalidatePath('/admin/invites');
}
export async function revokeInviteAction(formData: FormData) {
  await revokeInvite(String(formData.get('id')));
  revalidatePath('/admin/invites');
}
```

- [ ] **Step 3: Invites page**

`apps/web/app/(dashboard)/admin/invites/page.tsx`:
```tsx
import { headers } from 'next/headers';
import { listTeams, listInvites } from '@/lib/invites';
import { createInviteAction, revokeInviteAction } from './actions';
import { CopyField } from '@/components/admin/CopyField';

export default async function InvitesPage() {
  const [teams, invites] = await Promise.all([listTeams(), listInvites()]);
  const h = await headers();
  const origin = `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('host')}`;
  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold">Invite links</h2>
      <form action={createInviteAction} className="flex flex-wrap items-end gap-2 rounded border bg-white p-3">
        <label className="text-xs">Team
          <select name="team_id" required className="mt-1 block rounded border px-2 py-1 text-sm">
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="text-xs">Role
          <select name="role" className="mt-1 block rounded border px-2 py-1 text-sm"><option value="member">member</option><option value="manager">manager</option></select>
        </label>
        <label className="text-xs">Max uses
          <input name="max_uses" type="number" min={1} placeholder="∞" className="mt-1 block w-20 rounded border px-2 py-1 text-sm" />
        </label>
        <label className="text-xs">Expires
          <input name="expires_at" type="date" className="mt-1 block rounded border px-2 py-1 text-sm" />
        </label>
        <button className="rounded bg-gray-900 px-3 py-1 text-sm text-white">Generate link</button>
      </form>
      <ul className="space-y-2">
        {invites.map((i) => (
          <li key={i.id} className="flex items-center gap-3 rounded border bg-white p-2">
            <span className="text-xs text-gray-500">{i.team_name} · {i.role} · {i.uses}{i.max_uses ? `/${i.max_uses}` : ''} uses{i.expires_at ? ` · exp ${i.expires_at.slice(0,10)}` : ''}</span>
            <CopyField value={`${origin}/join/${i.token}`} />
            <form action={revokeInviteAction}><input type="hidden" name="id" value={i.id} /><button className="rounded border px-2 py-1 text-xs text-red-600">Revoke</button></form>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Verify + commit**

Run: `pnpm --filter @worksight/web typecheck && pnpm --filter @worksight/web build`
Expected: PASS.
```bash
git add "apps/web/app/(dashboard)/admin/invites" apps/web/components/admin/CopyField.tsx
git commit -m "feat(web): admin Invites — generate reusable links + revoke

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Admin console — Members + active roster filter

**Files:** Create `apps/web/app/(dashboard)/admin/members/page.tsx`, `members/actions.ts`; modify `apps/web/lib/queries.ts` (`getTeamMembers` excludes inactive)

**Interfaces:**
- Consumes: `listTeams`, `listAllMembers`, `updateMember` (Task 5).

- [ ] **Step 1: Exclude inactive members from the roster**

In `apps/web/lib/queries.ts`, in `getTeamMembers`, add `.eq('active', true)` to the profiles query so deactivated members drop out of the manager/admin overview. Exact change — find:
```ts
const { data } = await supabase.from('profiles').select('id, full_name, role').neq('id', viewer.id);
```
replace with:
```ts
const { data } = await supabase.from('profiles').select('id, full_name, role').eq('active', true).neq('id', viewer.id);
```

- [ ] **Step 2: Members actions**

`apps/web/app/(dashboard)/admin/members/actions.ts`:
```ts
'use server';
import { revalidatePath } from 'next/cache';
import { updateMember } from '@/lib/invites';

export async function updateMemberAction(formData: FormData) {
  const id = String(formData.get('id'));
  const patch: { team_id?: string | null; role?: string; active?: boolean } = {};
  if (formData.has('team_id')) patch.team_id = String(formData.get('team_id')) || null;
  if (formData.has('role')) patch.role = String(formData.get('role'));
  if (formData.has('active')) patch.active = formData.get('active') === 'true';
  await updateMember(id, patch);
  revalidatePath('/admin/members');
}
```

- [ ] **Step 3: Members page**

`apps/web/app/(dashboard)/admin/members/page.tsx`:
```tsx
import { listTeams, listAllMembers } from '@/lib/invites';
import { updateMemberAction } from './actions';

export default async function MembersPage() {
  const [teams, members] = await Promise.all([listTeams(), listAllMembers()]);
  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold">Members</h2>
      <table className="w-full rounded border bg-white text-sm">
        <thead><tr className="border-b text-left text-xs uppercase text-gray-500"><th className="p-2">Name</th><th className="p-2">Email</th><th className="p-2">Team</th><th className="p-2">Role</th><th className="p-2">Status</th></tr></thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id} className="border-b last:border-0">
              <td className="p-2">{m.full_name}</td>
              <td className="p-2 text-gray-500">{m.email}</td>
              <td className="p-2">
                <form action={updateMemberAction} className="flex items-center gap-1">
                  <input type="hidden" name="id" value={m.id} />
                  <select name="team_id" defaultValue={m.team_id ?? ''} className="rounded border px-1 py-0.5 text-xs">
                    <option value="">—</option>
                    {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  <button className="rounded border px-2 py-0.5 text-xs text-gray-600">Save</button>
                </form>
              </td>
              <td className="p-2">
                <form action={updateMemberAction} className="flex items-center gap-1">
                  <input type="hidden" name="id" value={m.id} />
                  <select name="role" defaultValue={m.role} className="rounded border px-1 py-0.5 text-xs"><option value="member">member</option><option value="manager">manager</option><option value="admin">admin</option></select>
                  <button className="rounded border px-2 py-0.5 text-xs text-gray-600">Save</button>
                </form>
              </td>
              <td className="p-2">
                <form action={updateMemberAction}>
                  <input type="hidden" name="id" value={m.id} />
                  <input type="hidden" name="active" value={m.active ? 'false' : 'true'} />
                  <button className={`rounded px-2 py-0.5 text-xs ${m.active ? 'text-red-600' : 'text-green-700'}`}>{m.active ? 'Deactivate' : 'Reactivate'}</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Verify + commit**

Run: `pnpm --filter @worksight/web typecheck && pnpm --filter @worksight/web build && pnpm --filter @worksight/web test`
Expected: PASS.
```bash
git add "apps/web/app/(dashboard)/admin/members" apps/web/lib/queries.ts
git commit -m "feat(web): admin Members management + exclude inactive from roster

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- §5.1 invitations table → Task 1. §5.2 profiles.active + roster filter → Task 1 (column) + Task 9 (filter). ✓
- §5.3 preview_invite/redeem_invite RPCs → Task 2 (+ tests). ✓
- §5.4 admin-write RLS (teams/invitations/profiles) → Task 2 (invitations) + Task 3 (teams/profiles). ✓
- §6 operator script → Task 4. ✓
- §7 admin console (Teams/Invites/Members + guard) → Tasks 7/8/9. ✓
- §8 accept page + done → Task 6. ✓
- §9 agent: no changes (post-join page links to agent) → Task 6 done page copy. ✓
- §10 tests: redeem/preview + admin isolation + self-write-after-redeem + roster filter → Tasks 2/3/9. ✓
- §11 acceptance #1 (script) → T4; #2 (admin section, teams) → T7; #3 (invite gen/revoke) → T8; #4 (accept) → T6; #5 (revoked/expired/over-uses) → T2; #6 (redeemed user syncs) → T2 self-write test; #7 (member mgmt + deactivate hides) → T9; #8 (no service-role runtime, RPCs don't expose table) → T2 (anon-can't-read test) + Global Constraints. ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code; live GUI acceptance steps are delegated to the controller smoke with the implementer gate stated (typecheck + tests).

**Type consistency:** RPC names `preview_invite`/`redeem_invite` and status strings (`ok/invalid/expired/revoked/exhausted/already_member`) consistent across Tasks 2/5/6. `lib/invites.ts` helper names (`previewInvite/redeemInvite/listTeams/createTeam/renameTeam/listInvites/createInvite/revokeInvite/listAllMembers/updateMember`) consistent between definition (Task 5) and consumers (Tasks 6/7/8/9). `viewer_role()/viewer_org()` match existing helpers. Migration numbering 0005→0007 continues from 0004.

**Note (cross-task):** Tasks 7–9 each add one route under `app/(dashboard)/admin/`; they share the Task 7 guard layout. Each is independently typecheck+build verifiable. The live end-to-end (provision org → admin generates link → invitee joins → appears in roster → agent self-write) is exercised by the controller after Tasks 2/4/6 and again at the final review.
