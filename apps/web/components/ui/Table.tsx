import type { ReactNode } from 'react';
export function Table({ children }: { children: ReactNode }) {
  return <div className="overflow-hidden rounded-2xl border border-subtle bg-surface"><table className="w-full text-sm">{children}</table></div>;
}
export function Th({ children }: { children: ReactNode }) {
  return <th className="border-b border-subtle p-3 text-left text-[10px] font-bold uppercase tracking-wide text-muted">{children}</th>;
}
export function Tr({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <tr className={`border-b border-subtle last:border-0 ${className}`}>{children}</tr>;
}
export function Td({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <td className={`p-3 text-fg ${className}`}>{children}</td>;
}
