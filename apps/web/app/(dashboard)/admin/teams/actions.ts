'use server';
import { revalidatePath } from 'next/cache';
import { createTeam, renameTeam } from '@/lib/invites';

export async function createTeamAction(formData: FormData) {
  await createTeam(String(formData.get('name')));
  revalidatePath('/admin/teams');
}
export async function renameTeamAction(formData: FormData) {
  await renameTeam(String(formData.get('id')), String(formData.get('name')));
  revalidatePath('/admin/teams');
}
