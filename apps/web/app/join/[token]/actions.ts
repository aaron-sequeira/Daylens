'use server';
import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabaseServer';
import { redeemInvite } from '@/lib/invites';

export async function acceptInvite(token: string, formData: FormData) {
  const email = String(formData.get('email'));
  const password = String(formData.get('password'));
  const fullName = String(formData.get('full_name'));
  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
  if (error) redirect(`/join/${token}?error=${encodeURIComponent(error.message)}`);
  const status = await redeemInvite(token);
  if (status === 'ok' || status === 'already_member') redirect(`/join/${token}/done`);
  redirect(`/join/${token}?error=${encodeURIComponent('This invite is ' + status)}`);
}
