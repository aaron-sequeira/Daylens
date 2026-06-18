import './globals.css';
import type { ReactNode } from 'react';
import { cookies } from 'next/headers';

export const metadata = { title: 'WorkSight AI' };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const theme = (await cookies()).get('ws-theme')?.value;
  const isLight = theme === 'light'; // default = dark
  return (
    <html lang="en" className={isLight ? '' : 'dark'} suppressHydrationWarning>
      <body suppressHydrationWarning className="min-h-screen bg-bg text-fg antialiased">{children}</body>
    </html>
  );
}
