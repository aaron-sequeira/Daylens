import { createServerSupabase } from './supabaseServer';
export async function createOrganization(orgName: string, fullName: string): Promise<string> {
  const s = await createServerSupabase();
  const { data, error } = await s.rpc('create_organization', { p_org_name: orgName, p_full_name: fullName });
  return error ? 'invalid' : (data as string);
}
