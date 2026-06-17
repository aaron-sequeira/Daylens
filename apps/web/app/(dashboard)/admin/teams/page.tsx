import { listTeams } from '@/lib/invites';
import { createTeamAction, renameTeamAction } from './actions';

export default async function TeamsPage() {
  const teams = await listTeams();
  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold">Teams</h2>
      <form action={createTeamAction} className="flex gap-2">
        <input name="name" placeholder="New team name" required className="rounded border px-2 py-1 text-sm" />
        <button type="submit" className="rounded bg-gray-900 px-3 py-1 text-sm text-white">Create team</button>
      </form>
      <ul className="divide-y rounded border bg-white">
        {teams.map((t) => (
          <li key={t.id} className="flex items-center gap-2 p-2">
            <form action={renameTeamAction} className="flex items-center gap-2">
              <input type="hidden" name="id" value={t.id} />
              <input name="name" defaultValue={t.name} className="rounded border px-2 py-1 text-sm" />
              <button type="submit" className="rounded border px-2 py-1 text-xs text-gray-600">Rename</button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
