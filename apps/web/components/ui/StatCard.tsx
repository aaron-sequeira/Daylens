import type { ReactNode } from 'react';
export function StatCard({ label, value, icon, chipClass = 'bg-accent/15 text-accent', trend }:
  { label: string; value: string; icon?: ReactNode; chipClass?: string; trend?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-subtle bg-surface p-3.5 shadow-[0_6px_16px_-10px_rgba(2,6,23,.5)]">
      {icon && <span className={`grid h-7 w-7 place-items-center rounded-lg text-sm ${chipClass}`}>{icon}</span>}
      <div className="mt-2 text-[10px] font-bold uppercase tracking-wide text-muted">{label}</div>
      <div className="text-2xl font-extrabold tracking-tight text-fg">{value}</div>
      {trend && <div className="mt-1">{trend}</div>}
    </div>
  );
}
