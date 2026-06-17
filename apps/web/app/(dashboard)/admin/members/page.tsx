import { listTeams, listAllMembers } from '@/lib/invites';
import { updateMemberAction } from './actions';

export default async function MembersPage() {
  const [teams, members] = await Promise.all([listTeams(), listAllMembers()]);
  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold">Members</h2>
      <table className="w-full rounded border bg-white text-sm">
        <thead><tr className="border-b text-left text-xs uppercase text-gray-500"><th className="p-2">Name</th><th className="p-2">Email</th><th className="p-2">Team</th><th className="p-2">Role</th><th className="p-2">Status</th></tr></thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id} className="border-b last:border-0">
              <td className="p-2">{m.full_name}</td>
              <td className="p-2 text-gray-500">{m.email}</td>
              <td className="p-2">
                <form action={updateMemberAction} className="flex items-center gap-1">
                  <input type="hidden" name="id" value={m.id} />
                  <select name="team_id" defaultValue={m.team_id ?? ''} className="rounded border px-1 py-0.5 text-xs">
                    <option value="">—</option>
                    {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  <button className="rounded border px-2 py-0.5 text-xs text-gray-600">Save</button>
                </form>
              </td>
              <td className="p-2">
                <form action={updateMemberAction} className="flex items-center gap-1">
                  <input type="hidden" name="id" value={m.id} />
                  <select name="role" defaultValue={m.role} className="rounded border px-1 py-0.5 text-xs"><option value="member">member</option><option value="manager">manager</option><option value="admin">admin</option></select>
                  <button className="rounded border px-2 py-0.5 text-xs text-gray-600">Save</button>
                </form>
              </td>
              <td className="p-2">
                <form action={updateMemberAction}>
                  <input type="hidden" name="id" value={m.id} />
                  <input type="hidden" name="active" value={m.active ? 'false' : 'true'} />
                  <button className={`rounded px-2 py-0.5 text-xs ${m.active ? 'text-red-600' : 'text-green-700'}`}>{m.active ? 'Deactivate' : 'Reactivate'}</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
