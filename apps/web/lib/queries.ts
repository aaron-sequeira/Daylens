import { cache } from 'react';
import { createServerSupabase } from './supabaseServer';

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
