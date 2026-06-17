import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { getViewerProfile } from '@/lib/queries';
import { signOut } from '@/app/login/actions';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const viewer = await getViewerProfile();
  if (!viewer) redirect('/login');
  return (
    <div>
      <header className="flex items-center gap-4 border-b bg-white px-6 py-3">
        <span className="font-semibold">WorkSight AI</span>
        <span className="text-sm text-gray-500">
          {viewer.orgName}{viewer.teamName ? ` · ${viewer.teamName}` : ''}
        </span>
        <span className="rounded bg-gray-100 px-2 py-0.5 text-xs uppercase text-gray-600">{viewer.role}</span>
        {viewer.role === 'admin' && <Link href="/admin/teams" className="text-sm text-gray-600 hover:text-gray-900">Admin</Link>}
        <form action={signOut} className="ml-auto">
          <button className="text-sm text-gray-500 hover:text-gray-900">Sign out</button>
        </form>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
