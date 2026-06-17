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
