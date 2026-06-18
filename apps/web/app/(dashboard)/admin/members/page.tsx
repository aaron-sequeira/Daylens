import { listTeams, listAllMembers } from '@/lib/invites';
import { updateMemberAction } from './actions';
import { Table, Th, Tr, Td } from '@/components/ui/Table';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

export default async function MembersPage() {
  const [teams, members] = await Promise.all([listTeams(), listAllMembers()]);
  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-fg">Members</h2>
      <Table>
        <thead>
          <tr>
            <Th>Name</Th>
            <Th>Email</Th>
            <Th>Team</Th>
            <Th>Role</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <Tr key={m.id}>
              <Td>
                <div className="flex items-center gap-2">
                  <Avatar name={m.full_name ?? m.email ?? '?'} size={28} />
                  <span>{m.full_name}</span>
                </div>
              </Td>
              <Td className="text-muted">{m.email}</Td>
              <Td>
                <form action={updateMemberAction} className="flex items-center gap-1">
                  <input type="hidden" name="id" value={m.id} />
                  <select name="team_id" defaultValue={m.team_id ?? ''} className="rounded-lg border border-subtle bg-surface-2 px-1 py-0.5 text-xs text-fg">
                    <option value="">—</option>
                    {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  <Button variant="secondary" size="sm" icon="✓">Save</Button>
                </form>
              </Td>
              <Td>
                <form action={updateMemberAction} className="flex items-center gap-1">
                  <input type="hidden" name="id" value={m.id} />
                  <select name="role" defaultValue={m.role} className="rounded-lg border border-subtle bg-surface-2 px-1 py-0.5 text-xs text-fg"><option value="member">member</option><option value="manager">manager</option><option value="admin">admin</option></select>
                  <Button variant="secondary" size="sm" icon="✓">Save</Button>
                </form>
              </Td>
              <Td>
                <div className="flex items-center gap-2">
                  <Badge tone={m.active ? 'success' : 'neutral'}>{m.active ? 'Active' : 'Inactive'}</Badge>
                  <form action={updateMemberAction} className="flex items-center gap-1">
                    <input type="hidden" name="id" value={m.id} />
                    <input type="hidden" name="active" value={m.active ? 'false' : 'true'} />
                    <Button variant={m.active ? 'danger' : 'secondary'} size="sm" icon={m.active ? '⊘' : '✓'}>{m.active ? 'Deactivate' : 'Reactivate'}</Button>
                  </form>
                </div>
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
