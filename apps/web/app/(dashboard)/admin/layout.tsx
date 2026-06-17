import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { getViewerProfile } from '@/lib/queries';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const viewer = await getViewerProfile();
  if (!viewer || viewer.role !== 'admin') notFound();
  return (
    <div className="space-y-4">
      <nav className="flex gap-3 border-b pb-2 text-sm">
        <Link href="/admin/teams" className="text-gray-700 hover:underline">Teams</Link>
        <Link href="/admin/invites" className="text-gray-700 hover:underline">Invites</Link>
        <Link href="/admin/members" className="text-gray-700 hover:underline">Members</Link>
      </nav>
      {children}
    </div>
  );
}
