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
