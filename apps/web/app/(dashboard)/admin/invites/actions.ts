'use server';
import { revalidatePath } from 'next/cache';
import { createInvite, revokeInvite } from '@/lib/invites';

export async function createInviteAction(formData: FormData) {
  const teamId = String(formData.get('team_id'));
  const role = String(formData.get('role'));
  const maxUsesRaw = String(formData.get('max_uses'));
  const expiresRaw = String(formData.get('expires_at'));
  await createInvite({
    teamId, role,
    maxUses: maxUsesRaw ? Number(maxUsesRaw) : null,
    expiresAt: expiresRaw ? new Date(expiresRaw).toISOString() : null
  });
  revalidatePath('/admin/invites');
}
export async function revokeInviteAction(formData: FormData) {
  await revokeInvite(String(formData.get('id')));
  revalidatePath('/admin/invites');
}
