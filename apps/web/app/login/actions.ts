'use server';
import { createServerSupabase } from '@/lib/supabaseServer';
import { redirect } from 'next/navigation';

export async function login(formData: FormData) {
  const email = String(formData.get('email'));
  const password = String(formData.get('password'));
  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect('/login?error=' + encodeURIComponent(error.message));
  redirect('/');
}

export async function signOut() {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  redirect('/login');
}
