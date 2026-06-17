# Agent→Cloud Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the desktop agent sign into the cloud and periodically upsert ONLY its own aggregated daily rollups to Supabase (`daily_activity`), so the manager dashboard shows real data instead of seed.

**Architecture:** A new self-write RLS policy lets an authenticated user upsert their own `daily_activity`. The agent talks to Supabase via **dependency-free `fetch` REST calls** (same approach the agent already uses for AI providers — no `@supabase/supabase-js`, no WebSocket polyfill). Sign-in/refresh hit the GoTrue token endpoint; rollups upsert via PostgREST with `on_conflict=user_id,date`. The session is persisted encrypted via the agent's existing `safeStorage` `Encryptor`. A `CloudController` orchestrates session + sync + status and is driven by typed IPC + a Settings card; a 15-min timer and an on-quit hook run sync when enabled.

**Tech Stack:** Electron (main, Node 20) · TypeScript · global `fetch` · better-sqlite3 (settings, in-memory in tests) · vitest · Supabase (Postgres + GoTrue + PostgREST, local) · React (renderer).

## Global Constraints

- Work on branch `feat/manager-dashboard` (the cloud backend + this cycle's spec/plan live there; `apps/agent` is present there too). Supabase local stack must be RUNNING for Task 1 + the manual checks.
- Commit messages MUST end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- **Privacy:** sync is opt-in, OFF by default. ONLY the aggregated rollup leaves the device — `date`, `total_tracked_sec`, `active_sec`, `idle_sec`, and per-app `{ app_name, total_sec, sessions, active_pct }`. NEVER window titles, raw events, input counts, app paths, `firstOpenAt`/`lastCloseAt`.
- **No new agent dependency:** use the global `fetch` REST approach; do NOT add `@supabase/supabase-js` to `apps/agent`.
- Agent tests run with `pnpm --filter @worksight/agent test` (its `pretest` rebuilds better-sqlite3 to the Node ABI). Cloud RLS tests run from repo root: `pnpm exec vitest run --config vitest.config.ts` with the Supabase env vars set.
- Cloud write isolation: a user may upsert ONLY rows where `user_id = auth.uid()`; managers/admins stay read-only.
- Upsert conflict target is the `(user_id, date)` unique constraint → PostgREST `?on_conflict=user_id,date` + header `Prefer: resolution=merge-duplicates,return=minimal`.
- Local dev cloud values: URL `http://127.0.0.1:54321`; anon key `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0` (the standard local demo anon key — not a secret).

## File Structure

```
supabase/migrations/0004_self_write.sql        # NEW: self-write RLS + write grant
tests/supabase/write-rls.test.ts               # NEW: self-write policy tests
apps/agent/src/shared/types.ts                 # + DailyActivityRow, CloudSession, CloudSyncStatus
apps/agent/src/main/settings.ts                # + cloudSyncEnabled, cloudSyncWindowDays, cloud session storage
apps/agent/src/main/settings.test.ts           # + cloud session round-trip test
apps/agent/src/main/cloud/
  config.ts                                     # NEW: getCloudConfig()
  client.ts                                     # NEW: REST signIn/refresh/upsert (inject fetch)
  client.test.ts
  session.ts                                    # NEW: SessionManager (persist + refresh)
  session.test.ts
  sync.ts                                       # NEW: mapDaySummaryToRow, recentDates, syncWindow
  sync.test.ts
  controller.ts                                 # NEW: CloudController (status/signIn/signOut/setEnabled/syncNow)
  controller.test.ts
apps/agent/src/main/ipc/channels.ts            # + cloud:* channels
apps/agent/src/main/ipc/handlers.ts            # + cloud handlers (forward to controller)
apps/agent/src/preload/index.ts                # + cloud bridge
apps/agent/src/renderer/lib/ipc.ts             # (type only — re-exports WorkSightApi; no change needed)
apps/agent/src/main/index.ts                   # instantiate controller + timer + on-quit
apps/agent/src/renderer/components/CloudSyncCard.tsx  # NEW
apps/agent/src/renderer/components/SettingsView.tsx   # mount CloudSyncCard
```

---

### Task 1: Cloud self-write RLS migration + write tests

**Files:**
- Create: `supabase/migrations/0004_self_write.sql`, `tests/supabase/write-rls.test.ts`

**Interfaces:**
- Consumes: existing `daily_activity` table + seeded users (password `worksight-dev`).
- Produces: INSERT/UPDATE RLS allowing `user_id = auth.uid()` only; write grant to `authenticated`.

- [ ] **Step 1: Write the migration**

`supabase/migrations/0004_self_write.sql`:
```sql
-- A user may insert/update ONLY their own daily_activity rows. Managers/admins stay read-only.
create policy daily_self_insert on daily_activity
  for insert with check (user_id = auth.uid());

create policy daily_self_update on daily_activity
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 0003 granted SELECT to authenticated; add the write privileges RLS gates.
grant insert, update on daily_activity to authenticated;
```

- [ ] **Step 2: Write the failing test**

`tests/supabase/write-rls.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const PASSWORD = 'worksight-dev';

async function signIn(email: string): Promise<SupabaseClient> {
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return c;
}

let member: SupabaseClient, memberId: string, otherId: string;

beforeAll(async () => {
  member = await signIn('member1.platform@acme.test');
  const { data: me } = await member.auth.getUser();
  memberId = me.user!.id;
  // resolve another member's id via the service role (member can't see growth team)
  const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data: other } = await admin.from('profiles').select('id').eq('email', 'member1.growth@acme.test').single();
  otherId = other!.id;
});

describe('daily_activity self-write RLS', () => {
  it('lets a user upsert their OWN row', async () => {
    const row = { user_id: memberId, date: '2099-01-01', total_tracked_sec: 3600, active_sec: 1800, idle_sec: 1800, by_app: [] };
    const { error } = await member.from('daily_activity').upsert(row, { onConflict: 'user_id,date' });
    expect(error).toBeNull();
    const { data } = await member.from('daily_activity').select('total_tracked_sec').eq('date', '2099-01-01');
    expect(data).toEqual([{ total_tracked_sec: 3600 }]);
  });

  it('updates (not duplicates) on re-upsert of the same day', async () => {
    const row = { user_id: memberId, date: '2099-01-01', total_tracked_sec: 7200, active_sec: 3600, idle_sec: 3600, by_app: [] };
    await member.from('daily_activity').upsert(row, { onConflict: 'user_id,date' });
    const { data } = await member.from('daily_activity').select('total_tracked_sec').eq('date', '2099-01-01');
    expect(data).toEqual([{ total_tracked_sec: 7200 }]);
  });

  it('rejects writing a row for ANOTHER user', async () => {
    const row = { user_id: otherId, date: '2099-01-02', total_tracked_sec: 100, active_sec: 0, idle_sec: 100, by_app: [] };
    const { error } = await member.from('daily_activity').insert(row);
    expect(error).not.toBeNull(); // RLS with check violation
  });
});
```

- [ ] **Step 3: Apply migration, seed, run the test**

Run:
```bash
supabase db reset
pnpm --filter @worksight/web seed
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0 SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU pnpm exec vitest run --config vitest.config.ts
```
Expected: all RLS tests pass (the 5 isolation tests from cycle 1 + 3 new write tests). If the self-write test fails with a permission error, confirm 0004 applied (grant + policies).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0004_self_write.sql tests/supabase/write-rls.test.ts
git commit -m "feat(web): self-write RLS for daily_activity (agent upserts own rows)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Shared types + settings fields + encrypted cloud session

**Files:**
- Modify: `apps/agent/src/shared/types.ts`, `apps/agent/src/main/settings.ts`, `apps/agent/src/main/settings.test.ts`

**Interfaces:**
- Produces: `DailyActivityRow`, `CloudSession`, `CloudSyncStatus` types; `AppSettings` gains `cloudSyncEnabled: boolean`, `cloudSyncWindowDays: number`; `SettingsStore` gains `getCloudSession(): CloudSession | null` and `setCloudSession(s: CloudSession | null): void`.

- [ ] **Step 1: Add shared types**

Append to `apps/agent/src/shared/types.ts`:
```ts
export interface DailyActivityRow {
  user_id: string;
  date: ISODate;
  total_tracked_sec: number;
  active_sec: number;
  idle_sec: number;
  by_app: { app_name: string; total_sec: number; sessions: number; active_pct: number }[];
}

export interface CloudSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch SECONDS (GoTrue expires_at)
  userId: string;
  email: string;
}

export interface CloudSyncStatus {
  connected: boolean;
  email: string | null;
  enabled: boolean;
  lastSyncedAt: number | null; // epoch ms
  lastError: string | null;
}
```
And add two fields to the `AppSettings` interface (after `consentGranted`):
```ts
  cloudSyncEnabled: boolean;
  cloudSyncWindowDays: number;
```

- [ ] **Step 2: Write the failing settings test**

Append to `apps/agent/src/main/settings.test.ts` (inside the existing `describe('settings', …)` block):
```ts
  it('defaults cloud sync off with a 7-day window', () => {
    const s = store.get();
    expect(s.cloudSyncEnabled).toBe(false);
    expect(s.cloudSyncWindowDays).toBe(7);
  });

  it('stores and clears the encrypted cloud session', () => {
    expect(store.getCloudSession()).toBeNull();
    const session = { accessToken: 'a', refreshToken: 'r', expiresAt: 123, userId: 'u1', email: 'u@x.test' };
    store.setCloudSession(session);
    expect(store.getCloudSession()).toEqual(session);
    store.setCloudSession(null);
    expect(store.getCloudSession()).toBeNull();
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @worksight/agent test`
Expected: FAIL — `getCloudSession`/`setCloudSession` not a function; cloud defaults undefined.

- [ ] **Step 4: Implement settings changes**

In `apps/agent/src/main/settings.ts`:
- Add to the `SettingsStore` interface:
```ts
  getCloudSession(): import('../shared/types').CloudSession | null;
  setCloudSession(s: import('../shared/types').CloudSession | null): void;
```
- Add to `DEFAULTS` (after `consentGranted: false`):
```ts
  cloudSyncEnabled: false,
  cloudSyncWindowDays: 7
```
- Add the constant near `keyName`:
```ts
const CLOUD_SESSION_KEY = 'cloud_session_enc';
```
- Add to the returned object (alongside the api-key methods):
```ts
    getCloudSession() {
      const raw = readRaw(CLOUD_SESSION_KEY);
      if (raw === null) return null;
      try { return JSON.parse(enc.decrypt(Buffer.from(raw, 'base64'))); }
      catch { return null; }
    },
    setCloudSession(s) {
      if (s === null) { db.prepare('DELETE FROM settings WHERE key = ?').run(CLOUD_SESSION_KEY); return; }
      writeRaw(CLOUD_SESSION_KEY, enc.encrypt(JSON.stringify(s)).toString('base64'));
    },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @worksight/agent test`
Expected: PASS. Also run `pnpm --filter @worksight/agent typecheck` → PASS (the new `AppSettings` fields compile; any inline `AppSettings` mocks elsewhere already use `as` casts or full objects — if `tracker.test.ts` constructs a literal `AppSettings`, add `cloudSyncEnabled: false, cloudSyncWindowDays: 7` to it).

- [ ] **Step 6: Commit**

```bash
git add apps/agent/src/shared/types.ts apps/agent/src/main/settings.ts apps/agent/src/main/settings.test.ts apps/agent/src/main/tracking/tracker.test.ts
git commit -m "feat(agent): cloud sync settings + encrypted session storage + types

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Cloud REST client (config + signIn/refresh/upsert)

**Files:**
- Create: `apps/agent/src/main/cloud/config.ts`, `apps/agent/src/main/cloud/client.ts`, `apps/agent/src/main/cloud/client.test.ts`

**Interfaces:**
- Consumes: `CloudSession`, `DailyActivityRow` (Task 2).
- Produces:
  - `getCloudConfig(): { url: string; anonKey: string }`
  - `type FetchFn = typeof fetch`
  - `signInWithPassword(f, cfg, email, password): Promise<{ session: CloudSession } | { error: string }>`
  - `refreshSession(f, cfg, refreshToken): Promise<{ session: CloudSession } | { error: string }>`
  - `upsertDailyActivity(f, cfg, accessToken, rows): Promise<{ ok: true } | { error: string }>`

- [ ] **Step 1: Write config**

`apps/agent/src/main/cloud/config.ts`:
```ts
export interface CloudConfig { url: string; anonKey: string }

const DEFAULT_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

export function getCloudConfig(): CloudConfig {
  return {
    url: process.env['WORKSIGHT_CLOUD_URL'] ?? 'http://127.0.0.1:54321',
    anonKey: process.env['WORKSIGHT_CLOUD_ANON_KEY'] ?? DEFAULT_ANON
  };
}
```

- [ ] **Step 2: Write the failing test**

`apps/agent/src/main/cloud/client.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { signInWithPassword, refreshSession, upsertDailyActivity } from './client';
import type { DailyActivityRow } from '../../shared/types';

const cfg = { url: 'http://cloud.test', anonKey: 'ANON' };

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe('signInWithPassword', () => {
  it('posts to the token endpoint and maps the session', async () => {
    const { f, calls } = fakeFetch(200, { access_token: 'AT', refresh_token: 'RT', expires_at: 1000, user: { id: 'u1', email: 'a@x.test' } });
    const r = await signInWithPassword(f, cfg, 'a@x.test', 'pw');
    expect(r).toEqual({ session: { accessToken: 'AT', refreshToken: 'RT', expiresAt: 1000, userId: 'u1', email: 'a@x.test' } });
    expect(calls[0].url).toBe('http://cloud.test/auth/v1/token?grant_type=password');
    expect((calls[0].init.headers as Record<string, string>)['apikey']).toBe('ANON');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ email: 'a@x.test', password: 'pw' });
  });

  it('returns an error on bad credentials', async () => {
    const { f } = fakeFetch(400, { error_description: 'Invalid login credentials' });
    const r = await signInWithPassword(f, cfg, 'a@x.test', 'wrong');
    expect(r).toEqual({ error: 'Invalid login credentials' });
  });
});

describe('refreshSession', () => {
  it('posts to the refresh endpoint and maps the session', async () => {
    const { f, calls } = fakeFetch(200, { access_token: 'AT2', refresh_token: 'RT2', expires_at: 2000, user: { id: 'u1', email: 'a@x.test' } });
    const r = await refreshSession(f, cfg, 'RT');
    expect(r).toEqual({ session: { accessToken: 'AT2', refreshToken: 'RT2', expiresAt: 2000, userId: 'u1', email: 'a@x.test' } });
    expect(calls[0].url).toBe('http://cloud.test/auth/v1/token?grant_type=refresh_token');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ refresh_token: 'RT' });
  });
});

describe('upsertDailyActivity', () => {
  const rows: DailyActivityRow[] = [{ user_id: 'u1', date: '2026-06-17', total_tracked_sec: 1, active_sec: 1, idle_sec: 0, by_app: [] }];
  it('posts rows to PostgREST with the on_conflict + merge headers', async () => {
    const { f, calls } = fakeFetch(201, null);
    const r = await upsertDailyActivity(f, cfg, 'AT', rows);
    expect(r).toEqual({ ok: true });
    expect(calls[0].url).toBe('http://cloud.test/rest/v1/daily_activity?on_conflict=user_id,date');
    const h = calls[0].init.headers as Record<string, string>;
    expect(h['Authorization']).toBe('Bearer AT');
    expect(h['apikey']).toBe('ANON');
    expect(h['Prefer']).toBe('resolution=merge-duplicates,return=minimal');
    expect(JSON.parse(calls[0].init.body as string)).toEqual(rows);
  });
  it('returns an error string on non-2xx', async () => {
    const { f } = fakeFetch(403, { message: 'permission denied' });
    const r = await upsertDailyActivity(f, cfg, 'AT', rows);
    expect(r).toEqual({ error: 'permission denied' });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @worksight/agent test`
Expected: FAIL — cannot find module `./client`.

- [ ] **Step 4: Implement the client**

`apps/agent/src/main/cloud/client.ts`:
```ts
import type { CloudConfig } from './config';
import type { CloudSession, DailyActivityRow } from '../../shared/types';

export type FetchFn = typeof fetch;

interface TokenResponse { access_token: string; refresh_token: string; expires_at: number; user: { id: string; email: string }; }

function toSession(t: TokenResponse): CloudSession {
  return { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: t.expires_at, userId: t.user.id, email: t.user.email };
}

async function tokenRequest(f: FetchFn, cfg: CloudConfig, grant: 'password' | 'refresh_token', body: unknown): Promise<{ session: CloudSession } | { error: string }> {
  try {
    const res = await f(`${cfg.url}/auth/v1/token?grant_type=${grant}`, {
      method: 'POST',
      headers: { apikey: cfg.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({})) as { error_description?: string; msg?: string; message?: string };
      return { error: e.error_description ?? e.msg ?? e.message ?? `HTTP ${res.status}` };
    }
    return { session: toSession(await res.json() as TokenResponse) };
  } catch (e) {
    return { error: String(e) };
  }
}

export function signInWithPassword(f: FetchFn, cfg: CloudConfig, email: string, password: string) {
  return tokenRequest(f, cfg, 'password', { email, password });
}

export function refreshSession(f: FetchFn, cfg: CloudConfig, refreshToken: string) {
  return tokenRequest(f, cfg, 'refresh_token', { refresh_token: refreshToken });
}

export async function upsertDailyActivity(f: FetchFn, cfg: CloudConfig, accessToken: string, rows: DailyActivityRow[]): Promise<{ ok: true } | { error: string }> {
  try {
    const res = await f(`${cfg.url}/rest/v1/daily_activity?on_conflict=user_id,date`, {
      method: 'POST',
      headers: {
        apikey: cfg.anonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify(rows)
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({})) as { message?: string };
      return { error: e.message ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { error: String(e) };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @worksight/agent test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/agent/src/main/cloud/config.ts apps/agent/src/main/cloud/client.ts apps/agent/src/main/cloud/client.test.ts
git commit -m "feat(agent): dependency-free Supabase REST client (signin/refresh/upsert)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Session manager (persist + refresh)

**Files:**
- Create: `apps/agent/src/main/cloud/session.ts`, `apps/agent/src/main/cloud/session.test.ts`

**Interfaces:**
- Consumes: `client.ts` (Task 3), `CloudSession` (Task 2).
- Produces: `createSessionManager(deps): SessionManager` where
  - `deps = { fetchFn: FetchFn; config: CloudConfig; store: { get(): CloudSession|null; set(s: CloudSession|null): void }; now(): number; client?: { signInWithPassword; refreshSession } }`
  - `SessionManager = { signIn(email,password): Promise<{ok:true}|{error:string}>; signOut(): void; getAccount(): { userId: string; email: string } | null; getValidAccessToken(): Promise<string | null> }`
  - `getValidAccessToken` refreshes when the stored session expires within 60s; persists the refreshed session; returns null if not signed in or refresh fails.

- [ ] **Step 1: Write the failing test**

`apps/agent/src/main/cloud/session.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createSessionManager } from './session';
import type { CloudSession } from '../../shared/types';

const cfg = { url: 'http://c.test', anonKey: 'ANON' };

function memStore() {
  let s: CloudSession | null = null;
  return { get: () => s, set: (v: CloudSession | null) => { s = v; }, peek: () => s };
}

describe('session manager', () => {
  let store: ReturnType<typeof memStore>;
  let now: number;
  beforeEach(() => { store = memStore(); now = 1_000_000; });

  it('signs in and persists the session', async () => {
    const client = {
      signInWithPassword: async () => ({ session: { accessToken: 'AT', refreshToken: 'RT', expiresAt: now / 1000 + 3600, userId: 'u1', email: 'a@x.test' } }),
      refreshSession: async () => ({ error: 'unused' })
    };
    const m = createSessionManager({ fetchFn: (async () => ({})) as never, config: cfg, store, now: () => now, client });
    const r = await m.signIn('a@x.test', 'pw');
    expect(r).toEqual({ ok: true });
    expect(store.peek()?.accessToken).toBe('AT');
    expect(m.getAccount()).toEqual({ userId: 'u1', email: 'a@x.test' });
  });

  it('returns a valid token without refreshing when not near expiry', async () => {
    store.set({ accessToken: 'AT', refreshToken: 'RT', expiresAt: now / 1000 + 3600, userId: 'u1', email: 'a@x.test' });
    let refreshed = false;
    const client = { signInWithPassword: async () => ({ error: 'x' }), refreshSession: async () => { refreshed = true; return { error: 'x' }; } };
    const m = createSessionManager({ fetchFn: (async () => ({})) as never, config: cfg, store, now: () => now, client });
    expect(await m.getValidAccessToken()).toBe('AT');
    expect(refreshed).toBe(false);
  });

  it('refreshes and persists when the token is expiring', async () => {
    store.set({ accessToken: 'OLD', refreshToken: 'RT', expiresAt: now / 1000 + 10, userId: 'u1', email: 'a@x.test' });
    const client = {
      signInWithPassword: async () => ({ error: 'x' }),
      refreshSession: async () => ({ session: { accessToken: 'NEW', refreshToken: 'RT2', expiresAt: now / 1000 + 3600, userId: 'u1', email: 'a@x.test' } })
    };
    const m = createSessionManager({ fetchFn: (async () => ({})) as never, config: cfg, store, now: () => now, client });
    expect(await m.getValidAccessToken()).toBe('NEW');
    expect(store.peek()?.accessToken).toBe('NEW');
  });

  it('signOut clears the session', async () => {
    store.set({ accessToken: 'AT', refreshToken: 'RT', expiresAt: now / 1000 + 3600, userId: 'u1', email: 'a@x.test' });
    const client = { signInWithPassword: async () => ({ error: 'x' }), refreshSession: async () => ({ error: 'x' }) };
    const m = createSessionManager({ fetchFn: (async () => ({})) as never, config: cfg, store, now: () => now, client });
    m.signOut();
    expect(store.peek()).toBeNull();
    expect(m.getAccount()).toBeNull();
    expect(await m.getValidAccessToken()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @worksight/agent test`
Expected: FAIL — cannot find module `./session`.

- [ ] **Step 3: Implement the session manager**

`apps/agent/src/main/cloud/session.ts`:
```ts
import type { CloudConfig } from './config';
import type { CloudSession } from '../../shared/types';
import { signInWithPassword as restSignIn, refreshSession as restRefresh, type FetchFn } from './client';

export interface SessionStore { get(): CloudSession | null; set(s: CloudSession | null): void; }
interface ClientLike {
  signInWithPassword(f: FetchFn, cfg: CloudConfig, email: string, password: string): Promise<{ session: CloudSession } | { error: string }>;
  refreshSession(f: FetchFn, cfg: CloudConfig, refreshToken: string): Promise<{ session: CloudSession } | { error: string }>;
}
export interface SessionDeps {
  fetchFn: FetchFn; config: CloudConfig; store: SessionStore; now: () => number;
  // test-only override: a client whose methods ignore (f,cfg)
  client?: { signInWithPassword(...a: unknown[]): Promise<{ session: CloudSession } | { error: string }>; refreshSession(...a: unknown[]): Promise<{ session: CloudSession } | { error: string }>; };
}
export interface SessionManager {
  signIn(email: string, password: string): Promise<{ ok: true } | { error: string }>;
  signOut(): void;
  getAccount(): { userId: string; email: string } | null;
  getValidAccessToken(): Promise<string | null>;
}

const REFRESH_SKEW_SEC = 60;

export function createSessionManager(deps: SessionDeps): SessionManager {
  const real: ClientLike = { signInWithPassword: restSignIn, refreshSession: restRefresh };
  const client = deps.client ?? real;
  const callSignIn = (email: string, password: string) =>
    (deps.client ? deps.client.signInWithPassword(email, password) : real.signInWithPassword(deps.fetchFn, deps.config, email, password));
  const callRefresh = (rt: string) =>
    (deps.client ? deps.client.refreshSession(rt) : real.refreshSession(deps.fetchFn, deps.config, rt));
  void client;

  return {
    async signIn(email, password) {
      const r = await callSignIn(email, password);
      if ('error' in r) return { error: r.error };
      deps.store.set(r.session);
      return { ok: true };
    },
    signOut() { deps.store.set(null); },
    getAccount() {
      const s = deps.store.get();
      return s ? { userId: s.userId, email: s.email } : null;
    },
    async getValidAccessToken() {
      const s = deps.store.get();
      if (!s) return null;
      if (s.expiresAt - deps.now() / 1000 > REFRESH_SKEW_SEC) return s.accessToken;
      const r = await callRefresh(s.refreshToken);
      if ('error' in r) return null;
      deps.store.set(r.session);
      return r.session.accessToken;
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @worksight/agent test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/main/cloud/session.ts apps/agent/src/main/cloud/session.test.ts
git commit -m "feat(agent): cloud session manager (persist + refresh on expiry)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Sync engine (map + window + upsert)

**Files:**
- Create: `apps/agent/src/main/cloud/sync.ts`, `apps/agent/src/main/cloud/sync.test.ts`

**Interfaces:**
- Consumes: `DaySummary`, `DailyActivityRow` (types); `computeDaySummary` (`summary/rollup.ts`); `localDate` (`shared/date.ts`).
- Produces:
  - `mapDaySummaryToRow(userId: string, s: DaySummary): DailyActivityRow`
  - `recentDates(windowDays: number, nowMs: number): ISODate[]` (oldest→newest, length `windowDays`)
  - `syncWindow(deps): Promise<{ syncedDays: number; lastSyncedAt: number } | { error: string }>` where
    `deps = { userId: string; windowDays: number; now(): number; repo: { getFocusSessions(d): FocusSessionRow[]; getActivitySamples(d): ActivitySampleRow[] }; getValidAccessToken(): Promise<string|null>; upsert(token: string, rows: DailyActivityRow[]): Promise<{ok:true}|{error:string}> }`

- [ ] **Step 1: Write the failing test**

`apps/agent/src/main/cloud/sync.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mapDaySummaryToRow, recentDates, syncWindow } from './sync';
import type { DaySummary } from '../../shared/types';

const summary: DaySummary = {
  date: '2026-06-17', totalTrackedSec: 7200, activeSec: 3600, idleSec: 3600,
  apps: [{ appName: 'Code', totalSec: 5000, sessions: 3, firstOpenAt: 1, lastCloseAt: 2, activePct: 80 }]
};

describe('mapDaySummaryToRow', () => {
  it('maps to a snake_case row and drops firstOpen/lastClose', () => {
    expect(mapDaySummaryToRow('u1', summary)).toEqual({
      user_id: 'u1', date: '2026-06-17', total_tracked_sec: 7200, active_sec: 3600, idle_sec: 3600,
      by_app: [{ app_name: 'Code', total_sec: 5000, sessions: 3, active_pct: 80 }]
    });
  });
  it('clamps negatives to zero', () => {
    const r = mapDaySummaryToRow('u1', { ...summary, idleSec: -5, apps: [] });
    expect(r.idle_sec).toBe(0);
  });
});

describe('recentDates', () => {
  it('returns windowDays local dates ending today (oldest first)', () => {
    const r = recentDates(3, Date.parse('2026-06-17T12:00:00'));
    expect(r).toHaveLength(3);
    expect(r[2]).toBe('2026-06-17');
  });
});

describe('syncWindow', () => {
  const baseDeps = {
    userId: 'u1', windowDays: 2, now: () => Date.parse('2026-06-17T12:00:00'),
    repo: { getFocusSessions: () => [], getActivitySamples: () => [] }
  };

  it('upserts one row per day with a valid token', async () => {
    let upserted: unknown[] = [];
    const r = await syncWindow({
      ...baseDeps,
      getValidAccessToken: async () => 'AT',
      upsert: async (_t, rows) => { upserted = rows; return { ok: true }; }
    });
    expect('syncedDays' in r && r.syncedDays).toBe(2);
    expect(upserted).toHaveLength(2);
  });

  it('errors (no upsert) when there is no valid token', async () => {
    let called = false;
    const r = await syncWindow({
      ...baseDeps,
      getValidAccessToken: async () => null,
      upsert: async () => { called = true; return { ok: true }; }
    });
    expect(r).toEqual({ error: 'not signed in' });
    expect(called).toBe(false);
  });

  it('propagates an upsert error', async () => {
    const r = await syncWindow({
      ...baseDeps,
      getValidAccessToken: async () => 'AT',
      upsert: async () => ({ error: 'permission denied' })
    });
    expect(r).toEqual({ error: 'permission denied' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @worksight/agent test`
Expected: FAIL — cannot find module `./sync`.

- [ ] **Step 3: Implement the sync engine**

`apps/agent/src/main/cloud/sync.ts`:
```ts
import type { DaySummary, DailyActivityRow, ISODate, FocusSessionRow, ActivitySampleRow } from '../../shared/types';
import { computeDaySummary } from '../summary/rollup';
import { localDate } from '../../shared/date';

const nn = (n: number): number => Math.max(0, Math.round(n));

export function mapDaySummaryToRow(userId: string, s: DaySummary): DailyActivityRow {
  return {
    user_id: userId,
    date: s.date,
    total_tracked_sec: nn(s.totalTrackedSec),
    active_sec: nn(s.activeSec),
    idle_sec: nn(s.idleSec),
    by_app: s.apps.map((a) => ({ app_name: a.appName, total_sec: nn(a.totalSec), sessions: nn(a.sessions), active_pct: nn(a.activePct) }))
  };
}

export function recentDates(windowDays: number, nowMs: number): ISODate[] {
  const out: ISODate[] = [];
  for (let i = windowDays - 1; i >= 0; i--) out.push(localDate(nowMs - i * 86_400_000));
  return out;
}

export interface SyncDeps {
  userId: string;
  windowDays: number;
  now(): number;
  repo: { getFocusSessions(d: ISODate): FocusSessionRow[]; getActivitySamples(d: ISODate): ActivitySampleRow[] };
  getValidAccessToken(): Promise<string | null>;
  upsert(token: string, rows: DailyActivityRow[]): Promise<{ ok: true } | { error: string }>;
}

export async function syncWindow(deps: SyncDeps): Promise<{ syncedDays: number; lastSyncedAt: number } | { error: string }> {
  const token = await deps.getValidAccessToken();
  if (!token) return { error: 'not signed in' };
  const rows = recentDates(deps.windowDays, deps.now()).map((date) =>
    mapDaySummaryToRow(deps.userId, computeDaySummary(date, deps.repo.getFocusSessions(date), deps.repo.getActivitySamples(date)))
  );
  const res = await deps.upsert(token, rows);
  if ('error' in res) return { error: res.error };
  return { syncedDays: rows.length, lastSyncedAt: deps.now() };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @worksight/agent test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/main/cloud/sync.ts apps/agent/src/main/cloud/sync.test.ts
git commit -m "feat(agent): sync engine — map rollup to row + windowed upsert (TDD)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Cloud controller (orchestration)

**Files:**
- Create: `apps/agent/src/main/cloud/controller.ts`, `apps/agent/src/main/cloud/controller.test.ts`

**Interfaces:**
- Consumes: `SessionManager` (Task 4), `syncWindow` (Task 5), `CloudSyncStatus` (Task 2).
- Produces: `createCloudController(deps): CloudController` where
  - `deps = { session: SessionManager; settings: { get(): AppSettings; set(p): void }; repo; upsert(token, rows): Promise<…>; now(): number }`
  - `CloudController = { getStatus(): CloudSyncStatus; signIn(email,password): Promise<{ok:true}|{error:string}>; signOut(): void; setEnabled(b: boolean): void; syncNow(): Promise<{ syncedDays: number } | { error: string }>; maybeAutoSync(): Promise<void> }`
  - `syncNow` updates in-memory `lastSyncedAt`/`lastError`; `getStatus` reflects them + `session.getAccount()` + `settings.get().cloudSyncEnabled`. `maybeAutoSync` runs `syncNow` only when enabled && connected (used by the timer/on-quit).

- [ ] **Step 1: Write the failing test**

`apps/agent/src/main/cloud/controller.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createCloudController } from './controller';
import type { AppSettings } from '../../shared/types';

function fakeSettings(initial: Partial<AppSettings>) {
  let s = { cloudSyncEnabled: false, cloudSyncWindowDays: 2, ...initial } as AppSettings;
  return { get: () => s, set: (p: Partial<AppSettings>) => { s = { ...s, ...p }; } };
}
const repo = { getFocusSessions: () => [], getActivitySamples: () => [] };

function fakeSession(account: { userId: string; email: string } | null, token: string | null = 'AT') {
  return {
    signIn: async () => ({ ok: true as const }),
    signOut: () => {},
    getAccount: () => account,
    getValidAccessToken: async () => token
  };
}

describe('cloud controller', () => {
  it('reports disconnected status by default', () => {
    const c = createCloudController({ session: fakeSession(null), settings: fakeSettings({}), repo, upsert: async () => ({ ok: true }), now: () => 5 });
    expect(c.getStatus()).toEqual({ connected: false, email: null, enabled: false, lastSyncedAt: null, lastError: null });
  });

  it('syncNow upserts and records lastSyncedAt', async () => {
    const c = createCloudController({ session: fakeSession({ userId: 'u1', email: 'a@x.test' }), settings: fakeSettings({ cloudSyncEnabled: true }), repo, upsert: async () => ({ ok: true }), now: () => 999 });
    const r = await c.syncNow();
    expect(r).toEqual({ syncedDays: 2 });
    const st = c.getStatus();
    expect(st).toMatchObject({ connected: true, email: 'a@x.test', enabled: true, lastSyncedAt: 999, lastError: null });
  });

  it('syncNow records lastError on failure', async () => {
    const c = createCloudController({ session: fakeSession({ userId: 'u1', email: 'a@x.test' }), settings: fakeSettings({ cloudSyncEnabled: true }), repo, upsert: async () => ({ error: 'permission denied' }), now: () => 1 });
    const r = await c.syncNow();
    expect(r).toEqual({ error: 'permission denied' });
    expect(c.getStatus().lastError).toBe('permission denied');
  });

  it('maybeAutoSync does nothing when disabled or disconnected', async () => {
    let upserts = 0;
    const c = createCloudController({ session: fakeSession({ userId: 'u1', email: 'a@x.test' }), settings: fakeSettings({ cloudSyncEnabled: false }), repo, upsert: async () => { upserts++; return { ok: true }; }, now: () => 1 });
    await c.maybeAutoSync();
    expect(upserts).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @worksight/agent test`
Expected: FAIL — cannot find module `./controller`.

- [ ] **Step 3: Implement the controller**

`apps/agent/src/main/cloud/controller.ts`:
```ts
import type { AppSettings, CloudSyncStatus, DailyActivityRow, ISODate, FocusSessionRow, ActivitySampleRow } from '../../shared/types';
import { syncWindow } from './sync';
import type { SessionManager } from './session';

export interface CloudControllerDeps {
  session: SessionManager;
  settings: { get(): AppSettings; set(p: Partial<AppSettings>): void };
  repo: { getFocusSessions(d: ISODate): FocusSessionRow[]; getActivitySamples(d: ISODate): ActivitySampleRow[] };
  upsert(token: string, rows: DailyActivityRow[]): Promise<{ ok: true } | { error: string }>;
  now(): number;
}
export interface CloudController {
  getStatus(): CloudSyncStatus;
  signIn(email: string, password: string): Promise<{ ok: true } | { error: string }>;
  signOut(): void;
  setEnabled(enabled: boolean): void;
  syncNow(): Promise<{ syncedDays: number } | { error: string }>;
  maybeAutoSync(): Promise<void>;
}

export function createCloudController(deps: CloudControllerDeps): CloudController {
  let lastSyncedAt: number | null = null;
  let lastError: string | null = null;

  const controller: CloudController = {
    getStatus() {
      const acct = deps.session.getAccount();
      return { connected: acct !== null, email: acct?.email ?? null, enabled: deps.settings.get().cloudSyncEnabled, lastSyncedAt, lastError };
    },
    signIn(email, password) { return deps.session.signIn(email, password); },
    signOut() { deps.session.signOut(); lastSyncedAt = null; lastError = null; },
    setEnabled(enabled) { deps.settings.set({ cloudSyncEnabled: enabled }); },
    async syncNow() {
      const acct = deps.session.getAccount();
      if (!acct) { lastError = 'not signed in'; return { error: 'not signed in' }; }
      const res = await syncWindow({
        userId: acct.userId, windowDays: deps.settings.get().cloudSyncWindowDays, now: deps.now,
        repo: deps.repo, getValidAccessToken: deps.session.getValidAccessToken, upsert: deps.upsert
      });
      if ('error' in res) { lastError = res.error; return { error: res.error }; }
      lastSyncedAt = res.lastSyncedAt; lastError = null;
      return { syncedDays: res.syncedDays };
    },
    async maybeAutoSync() {
      if (!deps.settings.get().cloudSyncEnabled || !deps.session.getAccount()) return;
      await controller.syncNow();
    }
  };
  return controller;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @worksight/agent test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/main/cloud/controller.ts apps/agent/src/main/cloud/controller.test.ts
git commit -m "feat(agent): cloud controller orchestrating session + sync + status (TDD)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: IPC wiring (channels + handlers + preload bridge)

**Files:**
- Modify: `apps/agent/src/main/ipc/channels.ts`, `apps/agent/src/main/ipc/handlers.ts`, `apps/agent/src/preload/index.ts`

**Interfaces:**
- Consumes: `CloudController` (Task 6), `CloudSyncStatus` (Task 2).
- Produces: `IpcDeps` gains `cloud: CloudController`; preload `api.cloud` with `getStatus / signIn / signOut / setEnabled / syncNow`.

- [ ] **Step 1: Add channels**

In `apps/agent/src/main/ipc/channels.ts`, add to the `CH` object (before the closing `}`):
```ts
  cloudGetStatus: 'cloud:getStatus',
  cloudSignIn: 'cloud:signIn',
  cloudSignOut: 'cloud:signOut',
  cloudSetEnabled: 'cloud:setEnabled',
  cloudSyncNow: 'cloud:syncNow',
```

- [ ] **Step 2: Add handlers**

In `apps/agent/src/main/ipc/handlers.ts`:
- Add to the imports: `import type { CloudController } from '../cloud/controller';`
- Add `cloud: CloudController;` to the `IpcDeps` interface.
- Register handlers inside `registerIpc` (after the settings handlers):
```ts
  ipcMain.handle(CH.cloudGetStatus, () => deps.cloud.getStatus());
  ipcMain.handle(CH.cloudSignIn, (_e, raw) => {
    const { email, password } = z.object({ email: z.string(), password: z.string() }).parse(raw);
    return deps.cloud.signIn(email, password);
  });
  ipcMain.handle(CH.cloudSignOut, () => { deps.cloud.signOut(); });
  ipcMain.handle(CH.cloudSetEnabled, (_e, raw) => { deps.cloud.setEnabled(z.boolean().parse(raw)); });
  ipcMain.handle(CH.cloudSyncNow, () => deps.cloud.syncNow());
```

- [ ] **Step 3: Add the preload bridge**

In `apps/agent/src/preload/index.ts`:
- Add `CloudSyncStatus` to the type import from `../shared/types`.
- Add a `cloud` object to `api` (after `data`):
```ts
  cloud: {
    getStatus: (): Promise<CloudSyncStatus> => ipcRenderer.invoke(CH.cloudGetStatus),
    signIn: (email: string, password: string): Promise<{ ok: true } | { error: string }> => ipcRenderer.invoke(CH.cloudSignIn, { email, password }),
    signOut: (): Promise<void> => ipcRenderer.invoke(CH.cloudSignOut),
    setEnabled: (enabled: boolean): Promise<void> => ipcRenderer.invoke(CH.cloudSetEnabled, enabled),
    syncNow: (): Promise<{ syncedDays: number } | { error: string }> => ipcRenderer.invoke(CH.cloudSyncNow)
  },
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @worksight/agent typecheck`
Expected: PASS. (`registerIpc` now requires a `cloud` dep; `index.ts` is updated in Task 8, so typecheck of the whole project will still flag the missing arg until Task 8 — that is expected. To keep this task green on its own, also do Task 8's Step 1 wiring in the same session before typechecking, OR accept that full typecheck passes only after Task 8. Run `pnpm --filter @worksight/agent test` to confirm no test regressions.)

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/main/ipc/channels.ts apps/agent/src/main/ipc/handlers.ts apps/agent/src/preload/index.ts
git commit -m "feat(agent): cloud IPC channels + handlers + preload bridge

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Main wiring + renderer Cloud Sync card

**Files:**
- Modify: `apps/agent/src/main/index.ts`, `apps/agent/src/renderer/components/SettingsView.tsx`
- Create: `apps/agent/src/renderer/components/CloudSyncCard.tsx`

**Interfaces:**
- Consumes: `createCloudController`, `createSessionManager`, `getCloudConfig`, `upsertDailyActivity`; `api.cloud.*` (Task 7).

- [ ] **Step 1: Wire the controller + auto-sync in main**

In `apps/agent/src/main/index.ts`:
- Add imports:
```ts
import { getCloudConfig } from './cloud/config';
import { upsertDailyActivity } from './cloud/client';
import { createSessionManager } from './cloud/session';
import { createCloudController } from './cloud/controller';
```
- After `const settings = createSettingsStore(db, enc);`, build the controller:
```ts
  const cloudConfig = getCloudConfig();
  const sessionManager = createSessionManager({
    fetchFn: fetch, config: cloudConfig,
    store: { get: () => settings.getCloudSession(), set: (s) => settings.setCloudSession(s) },
    now: () => Date.now()
  });
  const cloud = createCloudController({
    session: sessionManager, settings,
    repo: { getFocusSessions: (d) => repo.getFocusSessions(d), getActivitySamples: (d) => repo.getActivitySamples(d) },
    upsert: (token, rows) => upsertDailyActivity(fetch, cloudConfig, token, rows),
    now: () => Date.now()
  });
```
- Pass `cloud` into `registerIpc`: change to `registerIpc({ repo, settings, tracker, cloud, onTrackingChange: pushUpdate });`
- After tracker start, add a periodic auto-sync timer + on-quit sync:
```ts
  const cloudTimer = setInterval(() => { void cloud.maybeAutoSync(); }, 15 * 60 * 1000);
  app.on('before-quit', () => { clearInterval(cloudTimer); void cloud.maybeAutoSync(); });
```
(The existing `before-quit` handler that sets `isQuitting` + `tracker.stop()` stays; this adds a second listener — Electron allows multiple.)

- [ ] **Step 2: Create the Cloud Sync card**

`apps/agent/src/renderer/components/CloudSyncCard.tsx`:
```tsx
import { useEffect, useState } from 'react';
import type { CloudSyncStatus } from '../../shared/types';
import { api } from '../lib/ipc';

export function CloudSyncCard() {
  const [status, setStatus] = useState<CloudSyncStatus | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => setStatus(await api.cloud.getStatus());
  useEffect(() => { void refresh(); }, []);

  async function signIn() {
    setBusy(true); setError(null);
    const r = await api.cloud.signIn(email, password);
    setBusy(false); setPassword('');
    if ('error' in r) { setError(r.error); return; }
    await refresh();
  }
  async function syncNow() {
    setBusy(true); setError(null);
    const r = await api.cloud.syncNow();
    setBusy(false);
    if ('error' in r) setError(r.error);
    await refresh();
  }

  if (!status) return null;

  return (
    <div className="rounded-xl border bg-white p-4 space-y-3">
      <div className="text-sm font-medium">Cloud sync</div>
      <p className="text-xs text-gray-500">Optional. Only your aggregated daily totals (apps, time, active/idle) are sent — never window titles or keystrokes. Off by default.</p>

      {!status.connected ? (
        <div className="space-y-2">
          <input type="email" placeholder="WorkSight email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded border px-2 py-1 text-sm" />
          <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded border px-2 py-1 text-sm" />
          <button disabled={busy} onClick={signIn} className="rounded bg-black px-3 py-1 text-sm text-white disabled:opacity-50">Connect to WorkSight</button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-sm">Connected as <span className="font-medium">{status.email}</span></div>
          <label className="flex items-center justify-between">
            <span className="text-sm">Enable automatic sync</span>
            <input type="checkbox" checked={status.enabled} onChange={async (e) => { await api.cloud.setEnabled(e.target.checked); await refresh(); }} />
          </label>
          <div className="flex items-center gap-2">
            <button disabled={busy} onClick={syncNow} className="rounded bg-black px-3 py-1 text-sm text-white disabled:opacity-50">{busy ? 'Syncing…' : 'Sync now'}</button>
            <button onClick={async () => { await api.cloud.signOut(); await refresh(); }} className="rounded border px-3 py-1 text-sm text-gray-600">Disconnect</button>
          </div>
          <div className="text-xs text-gray-500">
            {status.lastSyncedAt ? `Last synced ${new Date(status.lastSyncedAt).toLocaleString()}` : 'Not synced yet'}
          </div>
        </div>
      )}
      {error && <div className="text-xs text-red-600">{error}</div>}
    </div>
  );
}
```

- [ ] **Step 3: Mount the card in Settings**

In `apps/agent/src/renderer/components/SettingsView.tsx`:
- Add the import: `import { CloudSyncCard } from './CloudSyncCard';`
- Render `<CloudSyncCard />` inside the settings container (e.g. directly after the AI box `</div>`, before the "Clear all data" button).

- [ ] **Step 4: Verify**

Run:
```bash
pnpm --filter @worksight/agent typecheck
pnpm --filter @worksight/agent test
```
Expected: typecheck PASS (the `cloud` dep is now supplied to `registerIpc`); all unit tests PASS.

- [ ] **Step 5: Manual acceptance (controller-run, since it needs the GUI)**

Build and launch the agent (do NOT use `pnpm dev` per repo norms; use the packaged/preview build the maintainer runs). Then: open Settings → Cloud sync → Connect as `member1.platform@acme.test` / `worksight-dev` → toggle Enable → **Sync now**. Confirm "Last synced" updates with no error. Then open the dashboard (`apps/web`) as `manager.platform@acme.test` and confirm Platform Member 1's tile reflects the agent's real local activity for today.
> Note for the executor: this manual GUI step is performed/observed by the human or controller, not the implementer subagent. The implementer's gate is typecheck + unit tests green.

- [ ] **Step 6: Commit**

```bash
git add apps/agent/src/main/index.ts apps/agent/src/renderer/components/CloudSyncCard.tsx apps/agent/src/renderer/components/SettingsView.tsx
git commit -m "feat(agent): wire cloud controller (timer + on-quit) + Cloud Sync settings card

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- §2 self-write RLS → Task 1. ✓
- §2/§6 agent Supabase client (dependency-free REST) → Task 3. ✓
- §2/§6 encrypted session (safeStorage) → Task 2 (storage) + Task 4 (manager). ✓
- §2/§6 SyncEngine (periodic + window + idempotent upsert) → Task 5 + timer in Task 8. ✓
- §3 privacy (aggregate-only; drops titles/firstOpen/lastClose) → Task 5 `mapDaySummaryToRow` + its test; copy in the card (Task 8). ✓
- §5 cloud migration (policies + grant) → Task 1. ✓
- §7 IPC + renderer card → Tasks 7 + 8. ✓
- §8 tests (mapping, syncWindow, RLS write) → Tasks 5, 1; plus session/controller/settings tests. ✓
- §10 acceptance #1 (off by default) → Task 2 defaults; #2 (signin persists) → Tasks 3/4; #3 (idempotent upsert) → Tasks 1/5; #4 (aggregate-only) → Task 5; #5 (no cross-user write) → Task 1; #6 (dashboard reflects) → Task 8 manual; #7 (timer/on-quit, auth error surfaced) → Tasks 6/8; #8 (disconnect clears) → Tasks 4/6/8. ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code; the one manual GUI acceptance step is explicitly delegated to the human/controller with the implementer's gate stated (typecheck + tests).

**Type consistency:** `DailyActivityRow` (snake_case) used identically in Tasks 1 (test rows), 3 (client), 5 (mapping); `CloudSession` fields (`accessToken/refreshToken/expiresAt/userId/email`) consistent across Tasks 2/3/4; `CloudSyncStatus` shape consistent across Tasks 2/6/7/8; `SessionManager`/`CloudController` method names match between definition (Tasks 4/6) and consumers (Tasks 6/7/8); `getValidAccessToken`, `syncWindow`, `mapDaySummaryToRow`, `recentDates` names consistent.

**Noted deviation from spec wording:** the spec says "Supabase client"; the plan implements this as dependency-free `fetch` REST calls (`cloud/client.ts`) — same rationale the agent already uses for AI providers, avoiding a new dependency and the Node-20 WebSocket polyfill. Behavior (auth + upsert under the user session, RLS-enforced) is identical.
