import { headers } from 'next/headers';
import { listTeams, listInvites } from '@/lib/invites';
import { createInviteAction, revokeInviteAction } from './actions';
import { CopyField } from '@/components/admin/CopyField';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export default async function InvitesPage() {
  const [teams, invites] = await Promise.all([listTeams(), listInvites()]);
  const h = await headers();
  const origin = `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('host')}`;
  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-fg">Invite links</h2>
      <Card>
        <form action={createInviteAction} className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-muted">Team
            <select name="team_id" required className="mt-1 block rounded-lg border border-subtle bg-surface-2 px-2 py-1 text-sm text-fg">
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="text-xs text-muted">Role
            <select name="role" className="mt-1 block rounded-lg border border-subtle bg-surface-2 px-2 py-1 text-sm text-fg"><option value="member">member</option><option value="manager">manager</option></select>
          </label>
          <label className="text-xs text-muted">Max uses
            <input name="max_uses" type="number" min={1} placeholder="∞" className="mt-1 block w-20 rounded-lg border border-subtle bg-surface-2 px-2 py-1 text-sm text-fg" />
          </label>
          <label className="text-xs text-muted">Expires
            <input name="expires_at" type="date" className="mt-1 block rounded-lg border border-subtle bg-surface-2 px-2 py-1 text-sm text-fg" />
          </label>
          <Button icon="✉">Generate link</Button>
        </form>
      </Card>
      <ul className="space-y-2">
        {invites.map((i) => (
          <li key={i.id} className="flex items-center gap-3 rounded-2xl border border-subtle bg-surface p-3">
            <span className="text-xs text-muted">{i.team_name} · {i.role} · {i.uses}{i.max_uses ? `/${i.max_uses}` : ''} uses{i.expires_at ? ` · exp ${i.expires_at.slice(0,10)}` : ''}</span>
            <CopyField value={`${origin}/join/${i.token}`} />
            <form action={revokeInviteAction}><input type="hidden" name="id" value={i.id} /><Button variant="danger" size="sm">Revoke</Button></form>
          </li>
        ))}
      </ul>
    </div>
  );
}
