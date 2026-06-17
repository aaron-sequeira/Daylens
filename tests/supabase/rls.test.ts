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

let manager: SupabaseClient, member: SupabaseClient, admin: SupabaseClient;

beforeAll(async () => {
  manager = await signIn('manager.platform@acme.test');
  member = await signIn('member1.platform@acme.test');
  admin = await signIn('admin@acme.test');
});

describe('RLS isolation', () => {
  it('member sees only their own profile', async () => {
    const { data } = await member.from('profiles').select('email');
    expect(data).toHaveLength(1);
    expect(data![0].email).toBe('member1.platform@acme.test');
  });

  it('member sees only their own daily_activity', async () => {
    const { data } = await member.from('daily_activity').select('user_id');
    const others = (data ?? []).filter((r) => r.user_id !== undefined);
    const ids = new Set(others.map((r) => r.user_id));
    expect(ids.size).toBe(1);
  });

  it('platform manager sees only Platform-team members', async () => {
    const { data } = await manager.from('profiles').select('email, team_id');
    const emails = (data ?? []).map((r) => r.email).sort();
    // 4 platform members + the manager themselves; no growth members
    expect(emails.every((e) => e.includes('platform') || e === 'manager.platform@acme.test')).toBe(true);
    expect(emails.some((e) => e.includes('growth'))).toBe(false);
  });

  it('admin sees the whole org (all 11 profiles)', async () => {
    const { data } = await admin.from('profiles').select('id');
    expect((data ?? []).length).toBe(11);
  });

  it('manager cannot read a non-team member activity directly', async () => {
    const { data: growth } = await admin.from('profiles').select('id').eq('email', 'member1.growth@acme.test').single();
    const { data } = await manager.from('daily_activity').select('id').eq('user_id', growth!.id);
    expect(data).toHaveLength(0);
  });
});
