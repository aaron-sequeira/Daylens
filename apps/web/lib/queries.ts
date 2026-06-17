import { cache } from 'react';
import { createServerSupabase } from './supabaseServer';
import type { DailyActivity } from './types';

export interface ViewerProfile {
  id: string; full_name: string; email: string;
  role: 'admin' | 'manager' | 'member';
  org_id: string; team_id: string | null;
  orgName: string; teamName: string | null;
}

export const getViewerProfile = cache(async (): Promise<ViewerProfile | null> => {
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data: p } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, org_id, team_id, organizations(name), teams(name)')
    .eq('id', auth.user.id)
    .single();
  if (!p) return null;
  return {
    id: p.id, full_name: p.full_name, email: p.email, role: p.role,
    org_id: p.org_id, team_id: p.team_id,
    orgName: (p.organizations as unknown as { name: string } | null)?.name ?? '',
    teamName: (p.teams as unknown as { name: string } | null)?.name ?? null
  };
});

export async function getTeamMembers(viewer: ViewerProfile): Promise<{ id: string; full_name: string }[]> {
  const supabase = await createServerSupabase();
  // RLS already restricts what we can see; exclude the viewer for the roster.
  const { data } = await supabase.from('profiles').select('id, full_name, role').neq('id', viewer.id);
  return (data ?? []).filter((p) => p.role === 'member').map((p) => ({ id: p.id, full_name: p.full_name }));
}

export async function getMember(id: string): Promise<{ id: string; full_name: string } | null> {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from('profiles').select('id, full_name').eq('id', id).maybeSingle();
  return data ?? null;
}

export async function getActivityForUsers(userIds: string[], dates: string[]): Promise<DailyActivity[]> {
  if (userIds.length === 0 || dates.length === 0) return [];
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from('daily_activity')
    .select('user_id, date, total_tracked_sec, active_sec, idle_sec, by_app')
    .in('user_id', userIds)
    .gte('date', dates[0])
    .lte('date', dates[dates.length - 1]);
  return (data ?? []).map((r) => ({
    userId: r.user_id, date: r.date,
    totalTrackedSec: r.total_tracked_sec, activeSec: r.active_sec, idleSec: r.idle_sec,
    byApp: (r.by_app as { app_name: string; total_sec: number; sessions: number; active_pct: number }[])
      .map((a) => ({ appName: a.app_name, totalSec: a.total_sec, sessions: a.sessions, activePct: a.active_pct }))
  }));
}
