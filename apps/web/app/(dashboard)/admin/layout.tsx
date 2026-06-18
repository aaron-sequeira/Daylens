import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { getViewerProfile } from '@/lib/queries';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const viewer = await getViewerProfile();
  if (!viewer || viewer.role !== 'admin') notFound();
  return <>{children}</>;
}
