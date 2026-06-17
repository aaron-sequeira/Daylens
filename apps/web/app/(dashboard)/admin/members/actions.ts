'use server';
import { revalidatePath } from 'next/cache';
import { updateMember } from '@/lib/invites';

export async function updateMemberAction(formData: FormData) {
  const id = String(formData.get('id'));
  const patch: { team_id?: string | null; role?: string; active?: boolean } = {};
  if (formData.has('team_id')) patch.team_id = String(formData.get('team_id')) || null;
  if (formData.has('role')) patch.role = String(formData.get('role'));
  if (formData.has('active')) patch.active = formData.get('active') === 'true';
  await updateMember(id, patch);
  revalidatePath('/admin/members');
}
