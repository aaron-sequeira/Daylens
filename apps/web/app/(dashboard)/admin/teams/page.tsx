import { listTeams } from '@/lib/invites';
import { createTeamAction, renameTeamAction } from './actions';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export default async function TeamsPage() {
  const teams = await listTeams();
  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-fg">Teams</h2>
      <Card>
        <form action={createTeamAction} className="flex gap-2">
          <input name="name" placeholder="New team name" required className="rounded-lg border border-subtle bg-surface-2 px-2 py-1 text-sm text-fg" />
          <Button icon="＋">Create team</Button>
        </form>
      </Card>
      <Card className="p-0">
        <ul className="divide-y divide-subtle">
          {teams.map((t) => (
            <li key={t.id} className="flex items-center gap-2 p-3">
              <form action={renameTeamAction} className="flex items-center gap-2">
                <input type="hidden" name="id" value={t.id} />
                <input name="name" defaultValue={t.name} className="rounded-lg border border-subtle bg-surface-2 px-2 py-1 text-sm text-fg" />
                <Button variant="secondary" size="sm">Rename</Button>
              </form>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
