import type { ReactNode } from 'react';
export function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`rounded-2xl border border-subtle bg-surface p-4 shadow-[0_6px_16px_-10px_rgba(2,6,23,.5)] ${className}`}>{children}</div>;
}
