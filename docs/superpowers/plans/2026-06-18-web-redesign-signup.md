# Web Redesign + Self-Serve Org Signup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the entire web dashboard to a modern Midnight+cyan dark theme (default) with a clean light mode, a sidebar/topbar shell and clearly-labeled buttons, and add a public self-serve "Create your company" signup.

**Architecture:** A CSS-variable theme system (`darkMode:'class'`, default dark via a cookie read in the root layout — no flash) feeds a small reusable UI kit (`components/ui/`). A new sidebar+topbar shell replaces the top-tab header. Every existing page is restyled (presentational only — data/queries/RLS untouched). Self-serve signup is a public page + a `SECURITY DEFINER create_organization` RPC (no service-role at runtime), mirroring the invite-redeem pattern.

**Tech Stack:** Next.js 15 App Router · React 19 · Tailwind (class dark mode + CSS vars) · Supabase (anon key + session; one new RPC) · Recharts · vitest.

## Global Constraints

- Work on branch `feat/manager-dashboard`. Supabase local stack RUNNING for the RPC task + smokes.
- Commit messages MUST end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- **Presentational-only** for existing pages: do NOT change data fetching, queries, RLS, or metric/aggregate math. Keep all existing function/prop signatures.
- **Security unchanged:** web runtime uses ONLY the anon key + the user's session. `create_organization` is `SECURITY DEFINER`, `search_path=public`; no service-role key in app runtime.
- **Theme:** `darkMode:'class'`; **dark is the default**; cyan is the shared accent. Theme tokens are CSS vars (`--bg/--surface/--surface-2/--fg/--muted/--subtle/--accent/--accent-strong/--accent-fg`) exposed as Tailwind colors `bg/surface/surface-2/fg/muted/subtle/accent/accent-strong/accent-fg`. No flash: the root layout reads the `ws-theme` cookie (default `dark`) and sets `<html class>`.
- **Buttons:** every action button uses the `Button` kit component with an icon + text label.
- `create_organization` status strings: `'ok' | 'already_member' | 'invalid'`. Migration numbering continues at `0009`.
- Verify each web task with `pnpm --filter @worksight/web typecheck` and `pnpm --filter @worksight/web build`; existing `pnpm --filter @worksight/web test` and the full RLS suite stay green. Do NOT run `next dev` (it blocks); use `build` + controller smokes.
- Local cloud values (not secret): URL `http://127.0.0.1:54321`; anon `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0`; service-role `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU`.

## File Structure

```
supabase/migrations/0009_create_org_rpc.sql           # create_organization RPC
tests/supabase/create-org-rls.test.ts                 # RPC behavior
apps/web/
  tailwind.config.ts                                  # darkMode:'class' + color tokens
  app/globals.css                                     # CSS vars (:root/.dark) + base
  app/layout.tsx                                       # read ws-theme cookie -> <html class>
  components/ui/{Button,Card,Badge,Avatar,StatCard,Segmented,Table,ThemeToggle}.tsx
  components/shell/{Sidebar,Topbar}.tsx
  app/(dashboard)/layout.tsx                           # sidebar+topbar shell
  app/(dashboard)/page.tsx                             # overview restyle
  app/(dashboard)/members/[id]/page.tsx                # member detail restyle
  app/(dashboard)/admin/{teams,invites,members}/page.tsx + admin/layout.tsx  # restyle
  components/{TrendChart,ActiveIdleDonut,TimePerAppChart,RosterTable,AppTable,TrendArrow}.tsx + admin/CopyField.tsx  # theme restyle
  lib/org.ts                                           # createOrganization wrapper
  app/login/page.tsx                                   # restyle + link to /signup
  app/signup/page.tsx · app/signup/actions.ts          # NEW self-serve signup
  app/join/[token]/page.tsx · join/[token]/done/page.tsx  # restyle
```

---

### Task 1: `create_organization` RPC + test

**Files:** Create `supabase/migrations/0009_create_org_rpc.sql`, `tests/supabase/create-org-rls.test.ts`

**Interfaces:**
- Produces: RPC `create_organization(p_org_name text, p_full_name text) returns text` (status `ok|already_member|invalid`), granted to `authenticated`.

- [ ] **Step 1: Write the migration**

`supabase/migrations/0009_create_org_rpc.sql`:
```sql
-- Self-serve signup: the caller (a freshly signed-up auth user with no profile)
-- creates an organization and becomes its admin. SECURITY DEFINER so no service role.
create or replace function public.create_organization(p_org_name text, p_full_name text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  new_org uuid;
  u_email text;
begin
  if uid is null then return 'invalid'; end if;
  if p_org_name is null or length(trim(p_org_name)) = 0 then return 'invalid'; end if;
  if exists (select 1 from profiles where id = uid) then return 'already_member'; end if;
  insert into organizations (name) values (trim(p_org_name)) returning id into new_org;
  select email into u_email from auth.users where id = uid;
  insert into profiles (id, org_id, team_id, full_name, email, role, active)
    values (uid, new_org, null, coalesce(nullif(trim(p_full_name), ''), u_email), u_email, 'admin', true);
  return 'ok';
end;
$$;
grant execute on function public.create_organization(text, text) to authenticated;
```

- [ ] **Step 2: Write the failing test**

`tests/supabase/create-org-rls.test.ts`:
```ts
import { describe, it, expect, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PW = 'worksight-dev';
const admin = () => createClient(URL, SERVICE, { auth: { persistSession: false } });
const createdUsers: string[] = [];
const createdOrgs: string[] = [];

async function freshUser() {
  const email = `founder_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@e2e.test`;
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data } = await c.auth.signUp({ email, password: PW, options: { data: { full_name: 'Founder F' } } });
  createdUsers.push(data.user!.id);
  return { c, id: data.user!.id, email };
}

afterAll(async () => {
  const db = admin();
  for (const id of createdUsers) await db.auth.admin.deleteUser(id).catch(() => {});
  for (const o of createdOrgs) await db.from('organizations').delete().eq('id', o);
});

describe('create_organization', () => {
  it('creates an org + admin profile for a brand-new user', async () => {
    const { c, id } = await freshUser();
    const { data: status } = await c.rpc('create_organization', { p_org_name: 'Globex LLC', p_full_name: 'Founder F' });
    expect(status).toBe('ok');
    const { data: prof } = await admin().from('profiles').select('role, org_id, full_name, active, team_id').eq('id', id).single();
    expect(prof).toMatchObject({ role: 'admin', full_name: 'Founder F', active: true, team_id: null });
    const { data: org } = await admin().from('organizations').select('name').eq('id', prof!.org_id).single();
    expect(org!.name).toBe('Globex LLC');
    createdOrgs.push(prof!.org_id);
    // the new admin can then create a team in their org
    const { error } = await c.from('teams').insert({ org_id: prof!.org_id, name: 'Eng' });
    expect(error).toBeNull();
  });

  it('rejects a second org for a user who already has a profile', async () => {
    const { c } = await freshUser();
    const { data: s1 } = await c.rpc('create_organization', { p_org_name: 'First Co', p_full_name: 'X' });
    expect(s1).toBe('ok');
    const { data: org } = await admin().from('profiles').select('org_id').eq('id', createdUsers[createdUsers.length - 1]).single();
    createdOrgs.push(org!.org_id);
    const { data: s2 } = await c.rpc('create_organization', { p_org_name: 'Second Co', p_full_name: 'X' });
    expect(s2).toBe('already_member');
  });
});
```

- [ ] **Step 3: Run RED, apply, GREEN**

RED (RPC missing):
```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon> SUPABASE_SERVICE_ROLE_KEY=<service> pnpm exec vitest run --config vitest.config.ts tests/supabase/create-org-rls.test.ts
```
Expected: FAIL (function `create_organization` does not exist). Then apply + reseed + re-run the FULL suite:
```bash
supabase db reset && pnpm --filter @worksight/web seed
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon> SUPABASE_SERVICE_ROLE_KEY=<service> pnpm exec vitest run --config vitest.config.ts
```
Expected: all RLS tests pass (cycle-3 suite + the 2 new create-org tests). The `WARN: no files matched pattern: supabase/seed.sql` line is harmless.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0009_create_org_rpc.sql tests/supabase/create-org-rls.test.ts
git commit -m "feat(web): create_organization RPC for self-serve signup

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Theme foundation (tokens + dark default + toggle)

**Files:** Modify `apps/web/tailwind.config.ts`, `apps/web/app/globals.css`, `apps/web/app/layout.tsx`; Create `apps/web/components/ui/ThemeToggle.tsx`

**Interfaces:**
- Produces: Tailwind color tokens `bg/surface/surface-2/fg/muted/subtle/accent/accent-strong/accent-fg`; `<html>` carries `dark` by default (or per `ws-theme` cookie); `<ThemeToggle />` client component.

- [ ] **Step 1: Tailwind dark mode + color tokens**

`apps/web/tailwind.config.ts`:
```ts
import type { Config } from 'tailwindcss';
export default {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)', surface: 'var(--surface)', 'surface-2': 'var(--surface-2)',
        fg: 'var(--fg)', muted: 'var(--muted)', subtle: 'var(--subtle)',
        accent: 'var(--accent)', 'accent-strong': 'var(--accent-strong)', 'accent-fg': 'var(--accent-fg)'
      },
      borderRadius: { xl2: '1rem' }
    }
  },
  plugins: []
} satisfies Config;
```

- [ ] **Step 2: CSS variables + base**

`apps/web/app/globals.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --bg: #f7f9fc; --surface: #ffffff; --surface-2: #f1f5f9;
  --fg: #0f172a; --muted: #64748b; --subtle: #e7eaf0;
  --accent: #06b6d4; --accent-strong: #0891b2; --accent-fg: #ffffff;
}
.dark {
  --bg: #0b1120; --surface: #0f172a; --surface-2: #1e293b;
  --fg: #f1f5f9; --muted: #94a3b8; --subtle: #1e293b;
  --accent: #22d3ee; --accent-strong: #06b6d4; --accent-fg: #06303a;
}
html, body { background: var(--bg); color: var(--fg); }
* { border-color: var(--subtle); }
```

- [ ] **Step 3: Root layout reads the theme cookie (default dark)**

`apps/web/app/layout.tsx`:
```tsx
import './globals.css';
import type { ReactNode } from 'react';
import { cookies } from 'next/headers';

export const metadata = { title: 'WorkSight AI' };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const theme = (await cookies()).get('ws-theme')?.value;
  const isLight = theme === 'light'; // default = dark
  return (
    <html lang="en" className={isLight ? '' : 'dark'} suppressHydrationWarning>
      <body suppressHydrationWarning className="min-h-screen bg-bg text-fg antialiased">{children}</body>
    </html>
  );
}
```

- [ ] **Step 4: ThemeToggle**

`apps/web/components/ui/ThemeToggle.tsx`:
```tsx
'use client';
import { useEffect, useState } from 'react';

export function ThemeToggle({ className = '' }: { className?: string }) {
  const [dark, setDark] = useState(true);
  useEffect(() => { setDark(document.documentElement.classList.contains('dark')); }, []);
  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    document.cookie = `ws-theme=${next ? 'dark' : 'light'};path=/;max-age=31536000`;
    try { localStorage.setItem('ws-theme', next ? 'dark' : 'light'); } catch { /* ignore */ }
  }
  return (
    <button onClick={toggle} aria-label="Toggle theme"
      className={`grid h-9 w-9 place-items-center rounded-lg border border-subtle bg-surface-2 text-accent hover:opacity-80 ${className}`}>
      {dark ? '☀' : '☾'}
    </button>
  );
}
```

- [ ] **Step 5: Verify**

Run: `pnpm --filter @worksight/web typecheck && pnpm --filter @worksight/web build`
Expected: PASS. (A controller smoke later confirms `<html class="dark">` renders by default.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/tailwind.config.ts apps/web/app/globals.css apps/web/app/layout.tsx apps/web/components/ui/ThemeToggle.tsx
git commit -m "feat(web): theme system — dark-default tokens + theme toggle

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: UI kit primitives

**Files:** Create `apps/web/components/ui/{Button,Card,Badge,Avatar,StatCard,Segmented,Table}.tsx`

**Interfaces:**
- Produces (used by Tasks 4–8):
  - `Button({ variant?, size?, icon?, children, ...props })` — variants `primary|secondary|ghost|danger`, default `primary`.
  - `Card({ className?, children })`, `Badge({ tone?, children })` (`accent|success|danger|neutral`).
  - `Avatar({ name, size? })` — initials + deterministic gradient.
  - `StatCard({ label, value, icon?, chipClass?, trend? })`.
  - `Segmented({ options, value, paramKey? })` — link-based segmented control.
  - `Table`, `Th`, `Td`, `Tr` primitives.

- [ ] **Step 1: Button**

`apps/web/components/ui/Button.tsx`:
```tsx
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const styles: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:opacity-90 shadow-[0_8px_22px_-8px_var(--accent)]',
  secondary: 'bg-surface-2 text-fg border border-subtle hover:opacity-80',
  ghost: 'text-muted hover:text-fg',
  danger: 'bg-rose-500/10 text-rose-500 border border-rose-500/30 hover:bg-rose-500/20'
};

export function Button(
  { variant = 'primary', size = 'md', icon, children, className = '', ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; icon?: ReactNode }
) {
  const pad = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-sm';
  return (
    <button {...props} type={props.type ?? 'submit'}
      className={`inline-flex items-center gap-2 rounded-lg font-semibold transition ${pad} ${styles[variant]} ${className}`}>
      {icon && <span aria-hidden>{icon}</span>}{children}
    </button>
  );
}
```

- [ ] **Step 2: Card, Badge, Avatar**

`apps/web/components/ui/Card.tsx`:
```tsx
import type { ReactNode } from 'react';
export function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`rounded-2xl border border-subtle bg-surface p-4 shadow-[0_6px_16px_-10px_rgba(2,6,23,.5)] ${className}`}>{children}</div>;
}
```

`apps/web/components/ui/Badge.tsx`:
```tsx
import type { ReactNode } from 'react';
type Tone = 'accent' | 'success' | 'danger' | 'neutral';
const tones: Record<Tone, string> = {
  accent: 'bg-accent/15 text-accent', success: 'bg-emerald-500/15 text-emerald-500',
  danger: 'bg-rose-500/15 text-rose-500', neutral: 'bg-surface-2 text-muted'
};
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}
```

`apps/web/components/ui/Avatar.tsx`:
```tsx
const grads = ['from-emerald-400 to-emerald-600', 'from-sky-400 to-blue-600', 'from-fuchsia-400 to-pink-600', 'from-amber-400 to-orange-600', 'from-cyan-400 to-blue-600'];
function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?'; }
export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const g = grads[h % grads.length];
  return (
    <span className={`grid place-items-center rounded-full bg-gradient-to-br ${g} font-bold text-white`}
      style={{ width: size, height: size, fontSize: size * 0.38 }}>{initials(name)}</span>
  );
}
```

- [ ] **Step 3: StatCard, Segmented, Table**

`apps/web/components/ui/StatCard.tsx`:
```tsx
import type { ReactNode } from 'react';
export function StatCard({ label, value, icon, chipClass = 'bg-accent/15 text-accent', trend }:
  { label: string; value: string; icon?: ReactNode; chipClass?: string; trend?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-subtle bg-surface p-3.5 shadow-[0_6px_16px_-10px_rgba(2,6,23,.5)]">
      {icon && <span className={`grid h-7 w-7 place-items-center rounded-lg text-sm ${chipClass}`}>{icon}</span>}
      <div className="mt-2 text-[10px] font-bold uppercase tracking-wide text-muted">{label}</div>
      <div className="text-2xl font-extrabold tracking-tight text-fg">{value}</div>
      {trend && <div className="mt-1">{trend}</div>}
    </div>
  );
}
```

`apps/web/components/ui/Segmented.tsx`:
```tsx
import Link from 'next/link';
export function Segmented({ options, value, paramKey = 'period' }:
  { options: { label: string; value: string | number }[]; value: string | number; paramKey?: string }) {
  return (
    <div className="inline-flex gap-0.5 rounded-lg bg-surface-2 p-0.5 text-xs font-semibold">
      {options.map((o) => (
        <Link key={o.value} href={`?${paramKey}=${o.value}`}
          className={`rounded-md px-2.5 py-1 ${String(o.value) === String(value) ? 'bg-surface text-accent shadow-sm' : 'text-muted'}`}>
          {o.label}
        </Link>
      ))}
    </div>
  );
}
```

`apps/web/components/ui/Table.tsx`:
```tsx
import type { ReactNode } from 'react';
export function Table({ children }: { children: ReactNode }) {
  return <div className="overflow-hidden rounded-2xl border border-subtle bg-surface"><table className="w-full text-sm">{children}</table></div>;
}
export function Th({ children }: { children: ReactNode }) {
  return <th className="border-b border-subtle p-3 text-left text-[10px] font-bold uppercase tracking-wide text-muted">{children}</th>;
}
export function Tr({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <tr className={`border-b border-subtle last:border-0 ${className}`}>{children}</tr>;
}
export function Td({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <td className={`p-3 text-fg ${className}`}>{children}</td>;
}
```

- [ ] **Step 4: Verify + commit**

Run: `pnpm --filter @worksight/web typecheck && pnpm --filter @worksight/web build`
Expected: PASS.
```bash
git add apps/web/components/ui
git commit -m "feat(web): themeable UI kit (Button/Card/Badge/Avatar/StatCard/Segmented/Table)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: App shell (Sidebar + Topbar + dashboard layout)

**Files:** Create `apps/web/components/shell/{Sidebar,Topbar}.tsx`; Modify `apps/web/app/(dashboard)/layout.tsx`

**Interfaces:**
- Consumes: `getViewerProfile` (existing), `signOut` (existing in `app/login/actions.ts`), `ThemeToggle`.
- Produces: `<Sidebar role={...} />`, `<Topbar viewer={...} />`; the dashboard layout renders shell + children.

- [ ] **Step 1: Sidebar (client, for active-route highlight)**

`apps/web/components/shell/Sidebar.tsx`:
```tsx
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ThemeToggle } from '@/components/ui/ThemeToggle';

const item = (active: boolean) =>
  `flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium ${active ? 'bg-accent/12 text-accent border-l-[3px] border-accent' : 'text-muted hover:text-fg'}`;

export function Sidebar({ role, signOutAction }: { role: string; signOutAction: () => void }) {
  const p = usePathname();
  return (
    <aside className="flex w-56 flex-col border-r border-subtle bg-surface p-4">
      <div className="mb-5 text-[15px] font-extrabold tracking-tight">✦ WorkSight <span className="text-accent">AI</span></div>
      <nav className="space-y-0.5">
        <Link href="/" className={item(p === '/')}>▦ Overview</Link>
        {role === 'admin' && <>
          <div className="px-3 pb-1 pt-4 text-[10px] font-bold uppercase tracking-wide text-muted">Admin</div>
          <Link href="/admin/teams" className={item(p.startsWith('/admin/teams'))}>👥 Teams</Link>
          <Link href="/admin/invites" className={item(p.startsWith('/admin/invites'))}>✉ Invites</Link>
          <Link href="/admin/members" className={item(p.startsWith('/admin/members'))}>⚙ Members</Link>
        </>}
      </nav>
      <div className="mt-auto flex items-center gap-2 border-t border-subtle pt-3">
        <ThemeToggle />
        <form action={signOutAction}><button className="text-sm text-muted hover:text-fg">⎋ Sign out</button></form>
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Topbar**

`apps/web/components/shell/Topbar.tsx`:
```tsx
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';

export function Topbar({ orgName, teamName, role, fullName }:
  { orgName: string; teamName: string | null; role: string; fullName: string }) {
  return (
    <header className="flex items-center gap-3 border-b border-subtle bg-surface px-6 py-3">
      <span className="text-sm font-semibold text-fg">{orgName}</span>
      {teamName && <span className="text-sm text-muted">· {teamName}</span>}
      <Badge tone="accent">{role}</Badge>
      <div className="ml-auto flex items-center gap-3">
        <span className="text-sm text-muted">{fullName}</span>
        <Avatar name={fullName} size={32} />
      </div>
    </header>
  );
}
```

- [ ] **Step 3: Dashboard layout shell**

`apps/web/app/(dashboard)/layout.tsx`:
```tsx
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getViewerProfile } from '@/lib/queries';
import { signOut } from '@/app/login/actions';
import { Sidebar } from '@/components/shell/Sidebar';
import { Topbar } from '@/components/shell/Topbar';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const viewer = await getViewerProfile();
  if (!viewer) redirect('/login');
  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar role={viewer.role} signOutAction={signOut} />
      <div className="flex min-h-screen flex-1 flex-col">
        <Topbar orgName={viewer.orgName} teamName={viewer.teamName} role={viewer.role} fullName={viewer.full_name} />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
```
> Note: the admin sub-nav previously lived in `app/(dashboard)/admin/layout.tsx`. Keep that file's **guard** (`notFound()` for non-admins) but remove its now-duplicate nav row (the sidebar owns nav). Edit `admin/layout.tsx` to just guard + render `children`.

- [ ] **Step 4: Trim the admin layout nav (guard only)**

`apps/web/app/(dashboard)/admin/layout.tsx`:
```tsx
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { getViewerProfile } from '@/lib/queries';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const viewer = await getViewerProfile();
  if (!viewer || viewer.role !== 'admin') notFound();
  return <div className="space-y-4">{children}</div>;
}
```

- [ ] **Step 5: Verify + commit**

Run: `pnpm --filter @worksight/web typecheck && pnpm --filter @worksight/web build`
Expected: PASS.
```bash
git add apps/web/components/shell "apps/web/app/(dashboard)/layout.tsx" "apps/web/app/(dashboard)/admin/layout.tsx"
git commit -m "feat(web): sidebar+topbar app shell (role-aware nav, theme toggle)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Restyle Overview + Member detail + charts

**Files:** Modify `apps/web/app/(dashboard)/page.tsx`, `apps/web/app/(dashboard)/members/[id]/page.tsx`, `apps/web/components/{TrendChart,ActiveIdleDonut,TimePerAppChart,RosterTable,AppTable,TrendArrow}.tsx`

**Interfaces:**
- Consumes: kit (Task 3), existing queries/aggregate (unchanged). Keep all data calls identical.

- [ ] **Step 1: Theme the chart components**

In `apps/web/components/TrendChart.tsx`, change the wrapper to `className="h-64 w-full rounded-2xl border border-subtle bg-surface p-4"` and the line stroke to `stroke="var(--accent)"`; for the area variant add `fill` with a cyan gradient (`<linearGradient>` stop colors `var(--accent)` at .35 → 0). Set axis tick fill via `tick={{ fontSize: 11, fill: 'var(--muted)' }}` and `<CartesianGrid stroke="var(--subtle)" />`.

In `ActiveIdleDonut.tsx`: wrapper `rounded-2xl border border-subtle bg-surface p-4`; cells `fill="var(--accent)"` (active) and `fill="var(--subtle)"` (idle).

In `TimePerAppChart.tsx`: wrapper `rounded-2xl border border-subtle bg-surface p-4`; bars `fill="var(--accent)"`; axis ticks `fill:'var(--muted)'`.

In `AppTable.tsx`: rebuild with the `Table/Th/Tr/Td` kit (same columns App/Time/Sessions/Active %).

In `TrendArrow.tsx`: keep logic; map `up→text-emerald-500`, `down→text-rose-500`, `flat→text-muted`.

`RosterTable.tsx` — rewrite with the kit + Avatar + Badge:
```tsx
import Link from 'next/link';
import type { MemberPeriodStats } from '@/lib/types';
import { Table, Th, Tr, Td } from '@/components/ui/Table';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';

export function RosterTable({ rows }: { rows: MemberPeriodStats[] }) {
  return (
    <Table>
      <thead><Tr><Th>Member</Th><Th>Avg active hrs</Th><Th>Active %</Th><Th>Score</Th><Th>Trend</Th></Tr></thead>
      <tbody>
        {rows.map((r) => (
          <Tr key={r.userId} className="hover:bg-surface-2">
            <Td><Link href={`/members/${r.userId}`} className="flex items-center gap-2 hover:underline"><Avatar name={r.fullName} size={26} />{r.fullName}</Link></Td>
            <Td>{r.avgActiveHours.toFixed(1)}</Td>
            <Td>{Math.round(r.avgActivePct)}%</Td>
            <Td className="font-bold">{r.activityScore}</Td>
            <Td><Badge tone={r.trend.direction === 'up' ? 'success' : r.trend.direction === 'down' ? 'danger' : 'neutral'}>{r.trend.direction === 'up' ? '▲' : r.trend.direction === 'down' ? '▼' : '—'} {r.trend.delta >= 0 ? '+' : ''}{r.trend.delta}</Badge></Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}
```

- [ ] **Step 2: Restyle the overview page header + cards**

In `apps/web/app/(dashboard)/page.tsx`, keep ALL data logic; replace the returned JSX so the header row uses the kit and `Segmented`, and the cards use `StatCard`:
```tsx
// imports to add at top:
// import { StatCard } from '@/components/ui/StatCard';
// import { Segmented } from '@/components/ui/Segmented';
// import { Button } from '@/components/ui/Button';
// (remove the old PeriodSelector/StatCard imports)
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-bold text-fg">Team overview</h1>
        <Segmented options={[{label:'7d',value:7},{label:'14d',value:14},{label:'30d',value:30}]} value={period} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Team active hrs" value={team.totalActiveHours.toFixed(1)} icon="⏱" />
        <StatCard label="Avg active %" value={`${Math.round(team.avgActivePct)}%`} icon="✓" chipClass="bg-emerald-500/15 text-emerald-500" />
        <StatCard label="Members tracked" value={String(team.membersTracked)} icon="👥" chipClass="bg-fuchsia-500/15 text-fuchsia-500" />
        <StatCard label="Top app" value={team.topApp ?? '—'} icon="★" chipClass="bg-amber-500/15 text-amber-500" />
      </div>
      <TrendChart data={team.series} />
      <RosterTable rows={rows} />
    </div>
  );
```

- [ ] **Step 3: Restyle the member detail page**

In `apps/web/app/(dashboard)/members/[id]/page.tsx`, keep ALL data logic; swap `StatCard`/`PeriodSelector` imports for the kit ones, wrap the day-detail blocks in `Card`, use `Segmented` for the period and `Button`/styled `<Link>` chips for days, and replace back-link/headings with `text-fg`/`text-muted` classes. (Same structure, kit components + theme classes.)

- [ ] **Step 4: Verify + commit**

Run: `pnpm --filter @worksight/web typecheck && pnpm --filter @worksight/web build && pnpm --filter @worksight/web test`
Expected: PASS (aggregate/period tests unaffected).
```bash
git add "apps/web/app/(dashboard)/page.tsx" "apps/web/app/(dashboard)/members" apps/web/components/TrendChart.tsx apps/web/components/ActiveIdleDonut.tsx apps/web/components/TimePerAppChart.tsx apps/web/components/RosterTable.tsx apps/web/components/AppTable.tsx apps/web/components/TrendArrow.tsx
git commit -m "feat(web): restyle overview + member detail + charts to the new theme

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Restyle Admin pages (Teams / Invites / Members)

**Files:** Modify `apps/web/app/(dashboard)/admin/{teams,invites,members}/page.tsx`, `apps/web/components/admin/CopyField.tsx`

**Interfaces:** Consumes the kit; keeps all server actions/queries identical.

- [ ] **Step 1: Restyle CopyField**

`apps/web/components/admin/CopyField.tsx` — keep the `'use client'` logic; theme it:
```tsx
'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
export function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <input readOnly value={value} className="w-80 rounded-lg border border-subtle bg-surface-2 px-2 py-1 text-xs text-fg" />
      <Button type="button" variant="secondary" size="sm" onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? 'Copied' : 'Copy'}</Button>
    </div>
  );
}
```

- [ ] **Step 2: Restyle the three admin pages**

For each of `teams`, `invites`, `members` `page.tsx`: keep ALL data calls + server-action wiring; wrap forms/lists in `Card`/`Table`, replace bare `<button>`s with `Button` (labeled + icon, e.g. `<Button icon="＋">Create team</Button>`, `<Button variant="danger" size="sm">Revoke</Button>`, `<Button variant="secondary" size="sm">Save</Button>`, deactivate uses `variant="danger"`, reactivate `variant="secondary"`), inputs get `border-subtle bg-surface-2 text-fg` classes, and headings use `text-fg`. The members table uses the `Table/Th/Tr/Td` kit with an `Avatar` in the name cell and a `Badge` for active/inactive status.

- [ ] **Step 3: Verify + commit**

Run: `pnpm --filter @worksight/web typecheck && pnpm --filter @worksight/web build`
Expected: PASS.
```bash
git add "apps/web/app/(dashboard)/admin" apps/web/components/admin/CopyField.tsx
git commit -m "feat(web): restyle admin Teams/Invites/Members to the new theme

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Login restyle + self-serve signup page

**Files:** Create `apps/web/lib/org.ts`, `apps/web/app/signup/page.tsx`, `apps/web/app/signup/actions.ts`; Modify `apps/web/app/login/page.tsx`

**Interfaces:**
- Consumes: kit, `createServerSupabase`, `create_organization` RPC (Task 1).
- Produces: `createOrganization(orgName, fullName): Promise<string>` in `lib/org.ts`.

- [ ] **Step 1: `lib/org.ts`**

`apps/web/lib/org.ts`:
```ts
import { createServerSupabase } from './supabaseServer';
export async function createOrganization(orgName: string, fullName: string): Promise<string> {
  const s = await createServerSupabase();
  const { data, error } = await s.rpc('create_organization', { p_org_name: orgName, p_full_name: fullName });
  return error ? 'invalid' : (data as string);
}
```

- [ ] **Step 2: signup action**

`apps/web/app/signup/actions.ts`:
```ts
'use server';
import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabaseServer';
import { createOrganization } from '@/lib/org';

export async function signUpCompany(formData: FormData) {
  const org = String(formData.get('org_name'));
  const fullName = String(formData.get('full_name'));
  const email = String(formData.get('email'));
  const password = String(formData.get('password'));
  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
  if (error) redirect('/signup?error=' + encodeURIComponent(error.message));
  const status = await createOrganization(org, fullName);
  if (status === 'ok' || status === 'already_member') redirect('/');
  redirect('/signup?error=' + encodeURIComponent('Could not create the company (' + status + ')'));
}
```

- [ ] **Step 3: signup page**

`apps/web/app/signup/page.tsx`:
```tsx
import Link from 'next/link';
import { signUpCompany } from './actions';
import { Button } from '@/components/ui/Button';

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="mx-auto mt-24 max-w-sm rounded-2xl border border-subtle bg-surface p-6 shadow-[0_24px_60px_-18px_rgba(2,6,23,.6)]">
      <h1 className="text-lg font-extrabold">✦ Create your company</h1>
      <p className="mb-4 text-sm text-muted">Set up WorkSight for your team — you'll be the admin.</p>
      <form action={signUpCompany} className="space-y-3">
        <input name="org_name" placeholder="Company name" required className="w-full rounded-lg border border-subtle bg-surface-2 px-3 py-2 text-sm text-fg" />
        <input name="full_name" placeholder="Your name" required className="w-full rounded-lg border border-subtle bg-surface-2 px-3 py-2 text-sm text-fg" />
        <input name="email" type="email" placeholder="Work email" required className="w-full rounded-lg border border-subtle bg-surface-2 px-3 py-2 text-sm text-fg" />
        <input name="password" type="password" placeholder="Choose a password" required minLength={6} className="w-full rounded-lg border border-subtle bg-surface-2 px-3 py-2 text-sm text-fg" />
        <Button className="w-full justify-center" icon="✦">Create company &amp; sign in</Button>
      </form>
      {error && <p className="mt-3 text-sm text-rose-500">{error}</p>}
      <p className="mt-4 text-sm text-muted">Already have an account? <Link href="/login" className="text-accent hover:underline">Sign in</Link></p>
    </div>
  );
}
```

- [ ] **Step 4: Restyle login + link to signup**

`apps/web/app/login/page.tsx` — keep the `login` action; restyle the card to match signup (same classes) and add at the bottom:
```tsx
      <p className="mt-4 text-sm text-muted">New here? <Link href="/signup" className="text-accent hover:underline">Create a company →</Link></p>
```
(Use the `Button` kit for the submit, `border-subtle bg-surface-2 text-fg` inputs, and `import Link from 'next/link'`.)

- [ ] **Step 5: Verify + commit**

Run: `pnpm --filter @worksight/web typecheck && pnpm --filter @worksight/web build`
Expected: PASS. (Controller smokes the full signup→org flow after.)
```bash
git add apps/web/lib/org.ts apps/web/app/signup apps/web/app/login/page.tsx
git commit -m "feat(web): self-serve company signup + restyled login

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Restyle the /join accept flow

**Files:** Modify `apps/web/app/join/[token]/page.tsx`, `apps/web/app/join/[token]/done/page.tsx`

**Interfaces:** Consumes the kit; keeps `previewInvite`/`acceptInvite` logic identical.

- [ ] **Step 1: Restyle the accept + done pages**

In `app/join/[token]/page.tsx`: keep the `previewInvite` call + `acceptInvite` action; restyle the card to the signup/login style (`rounded-2xl border border-subtle bg-surface ...`), inputs to `border-subtle bg-surface-2 text-fg`, and the submit to `<Button className="w-full justify-center" icon="✦">Create account &amp; join</Button>`. The invalid-token message uses `text-muted`. In `done/page.tsx`: restyle to the same card and use `<Button>` (wrap a `<Link>`).

- [ ] **Step 2: Verify + commit**

Run: `pnpm --filter @worksight/web typecheck && pnpm --filter @worksight/web build`
Expected: PASS.
```bash
git add apps/web/app/join
git commit -m "feat(web): restyle invite accept flow to the new theme

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- §4 theme system (darkMode class, CSS vars, dark default via cookie, no flash, toggle) → Task 2. ✓
- §5 app shell (sidebar+topbar, role-aware, replaces tabs) → Task 4. ✓
- §6 UI kit → Task 3 (+ ThemeToggle in Task 2). ✓
- §7 page restyle (login, overview, member detail, admin×3, join) → Tasks 5, 6, 7, 8. ✓
- §8 self-serve signup (RPC + page + actions + lib/org) → Task 1 (RPC) + Task 7 (page). ✓
- §9 tests (create_organization RPC/RLS; existing suites green; dark-default smoke) → Task 1 + per-task build + controller smokes. ✓
- §10 acceptance #1 (dark default+toggle) → Task 2; #2 (sidebar role-aware) → Task 4; #3 (labeled buttons) → Tasks 3/5/6/7/8 (Button kit); #4 (all pages restyled) → 5–8; #5 (/signup creates org+admin) → 1+7; #6 (already_member) → 1; #7 (no service-role; RPC scoped) → 1; #8 (green) → per-task. ✓

**Placeholder scan:** Tasks 5/6/8 describe restyles as "apply these classes / swap to kit components" with the exact class strings + the rewritten components (RosterTable, CopyField, overview header, signup, etc.) shown in full; the data logic is explicitly preserved, not re-specified. The genuinely new/foundational files (RPC, theme, kit, shell, signup, lib/org) have complete code. No TBD/TODO.

**Type consistency:** kit component prop names (`Button{variant,size,icon}`, `StatCard{label,value,icon,chipClass,trend}`, `Badge{tone}`, `Avatar{name,size}`, `Segmented{options,value,paramKey}`, `Table/Th/Tr/Td`) are consistent between Task 3 definitions and Tasks 4–8 consumers. `createOrganization(orgName, fullName)` and the RPC param names (`p_org_name`, `p_full_name`) + statuses (`ok/already_member/invalid`) match across Tasks 1 and 7. Theme tokens (`bg/surface/surface-2/fg/muted/subtle/accent/accent-strong/accent-fg`) defined in Task 2 are used consistently throughout.

**Note (controller verification):** because the page restyles can't be unit-tested, the controller should, after Task 7, run a signup smoke (a fresh user → `create_organization` → admin profile) and after Task 8 a render smoke (serve the build; GET `/login` shows `<html class="dark">` by default and the page renders; GET `/signup` renders). Visual polish itself is judged by the human in the browser.
