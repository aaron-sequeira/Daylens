import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getViewerProfile } from '@/lib/queries';
import { signOut } from '@/app/login/actions';
import { Sidebar } from '@/components/shell/Sidebar';
import { Topbar } from '@/components/shell/Topbar';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const viewer = await getViewerProfile();
  if (!viewer) redirect('/login');
  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar role={viewer.role} signOutAction={signOut} />
      <div className="flex min-h-screen flex-1 flex-col">
        <Topbar orgName={viewer.orgName} teamName={viewer.teamName} role={viewer.role} fullName={viewer.full_name} />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
