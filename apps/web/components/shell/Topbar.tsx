import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';

export function Topbar({ orgName, teamName, role, fullName }:
  { orgName: string; teamName: string | null; role: string; fullName: string }) {
  return (
    <header className="flex items-center gap-3 border-b border-subtle bg-surface px-6 py-3">
      <span className="text-sm font-semibold text-fg">{orgName}</span>
      {teamName && <span className="text-sm text-muted">· {teamName}</span>}
      <Badge tone="accent">{role}</Badge>
      <div className="ml-auto flex items-center gap-3">
        <span className="text-sm text-muted">{fullName}</span>
        <Avatar name={fullName} size={32} />
      </div>
    </header>
  );
}
