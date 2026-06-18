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
