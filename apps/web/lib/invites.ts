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
  if (!me.user) throw new Error('Unauthenticated');
  const { data: prof } = await s.from('profiles').select('org_id').eq('id', me.user.id).single();
  if (!prof) throw new Error('Profile not found');
  await s.from('teams').insert({ org_id: prof.org_id, name });
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
  return (data ?? []).map((r: { id: string; team_id: string; role: string; token: string; uses: number; max_uses: number | null; expires_at: string | null; revoked: boolean; teams: Array<{ name: string }> }) => ({
    id: r.id, team_id: r.team_id, role: r.role, token: r.token, uses: r.uses, max_uses: r.max_uses, expires_at: r.expires_at,
    team_name: r.teams?.[0]?.name ?? ''
  }));
}
export async function createInvite(input: { teamId: string; role: string; maxUses: number | null; expiresAt: string | null }): Promise<void> {
  const s = await createServerSupabase();
  const { data: me } = await s.auth.getUser();
  if (!me.user) throw new Error('Unauthenticated');
  const { data: prof } = await s.from('profiles').select('org_id').eq('id', me.user.id).single();
  if (!prof) throw new Error('Profile not found');
  await s.from('invitations').insert({
    org_id: prof.org_id, team_id: input.teamId, role: input.role, token: generateInviteToken(),
    max_uses: input.maxUses, expires_at: input.expiresAt, created_by: me.user.id
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
