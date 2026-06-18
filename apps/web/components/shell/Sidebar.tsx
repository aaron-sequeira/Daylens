'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ThemeToggle } from '@/components/ui/ThemeToggle';

const item = (active: boolean) =>
  `flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium ${active ? 'bg-accent/12 text-accent border-l-[3px] border-accent' : 'text-muted hover:text-fg'}`;

export function Sidebar({ role, signOutAction }: { role: string; signOutAction: () => Promise<void> }) {
  const p = usePathname();
  return (
    <aside className="flex w-56 flex-col border-r border-subtle bg-surface p-4">
      <div className="mb-5 text-[15px] font-extrabold tracking-tight">✦ WorkSight <span className="text-accent">AI</span></div>
      <nav className="space-y-0.5">
        <Link href="/" className={item(p === '/')}>▦ Overview</Link>
        {role === 'admin' && <>
          <div className="px-3 pb-1 pt-4 text-[10px] font-bold uppercase tracking-wide text-muted">Admin</div>
          <Link href="/admin/teams" className={item(p.startsWith('/admin/teams'))}>👥 Teams</Link>
          <Link href="/admin/invites" className={item(p.startsWith('/admin/invites'))}>✉ Invites</Link>
          <Link href="/admin/members" className={item(p.startsWith('/admin/members'))}>⚙ Members</Link>
        </>}
      </nav>
      <div className="mt-auto flex items-center gap-2 border-t border-subtle pt-3">
        <ThemeToggle />
        <form action={signOutAction}><button type="submit" className="text-sm text-muted hover:text-fg">⎋ Sign out</button></form>
      </div>
    </aside>
  );
}
