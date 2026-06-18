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
