import { headers } from 'next/headers';
import { listTeams, listInvites } from '@/lib/invites';
import { createInviteAction, revokeInviteAction } from './actions';
import { CopyField } from '@/components/admin/CopyField';

export default async function InvitesPage() {
  const [teams, invites] = await Promise.all([listTeams(), listInvites()]);
  const h = await headers();
  const origin = `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('host')}`;
  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold">Invite links</h2>
      <form action={createInviteAction} className="flex flex-wrap items-end gap-2 rounded border bg-white p-3">
        <label className="text-xs">Team
          <select name="team_id" required className="mt-1 block rounded border px-2 py-1 text-sm">
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="text-xs">Role
          <select name="role" className="mt-1 block rounded border px-2 py-1 text-sm"><option value="member">member</option><option value="manager">manager</option></select>
        </label>
        <label className="text-xs">Max uses
          <input name="max_uses" type="number" min={1} placeholder="∞" className="mt-1 block w-20 rounded border px-2 py-1 text-sm" />
        </label>
        <label className="text-xs">Expires
          <input name="expires_at" type="date" className="mt-1 block rounded border px-2 py-1 text-sm" />
        </label>
        <button className="rounded bg-gray-900 px-3 py-1 text-sm text-white">Generate link</button>
      </form>
      <ul className="space-y-2">
        {invites.map((i) => (
          <li key={i.id} className="flex items-center gap-3 rounded border bg-white p-2">
            <span className="text-xs text-gray-500">{i.team_name} · {i.role} · {i.uses}{i.max_uses ? `/${i.max_uses}` : ''} uses{i.expires_at ? ` · exp ${i.expires_at.slice(0,10)}` : ''}</span>
            <CopyField value={`${origin}/join/${i.token}`} />
            <form action={revokeInviteAction}><input type="hidden" name="id" value={i.id} /><button className="rounded border px-2 py-1 text-xs text-red-600">Revoke</button></form>
          </li>
        ))}
      </ul>
    </div>
  );
}
