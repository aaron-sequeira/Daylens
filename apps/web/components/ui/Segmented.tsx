import Link from 'next/link';
export function Segmented({ options, value, paramKey = 'period' }:
  { options: { label: string; value: string | number }[]; value: string | number; paramKey?: string }) {
  return (
    <div className="inline-flex gap-0.5 rounded-lg bg-surface-2 p-0.5 text-xs font-semibold">
      {options.map((o) => (
        <Link key={o.value} href={`?${paramKey}=${o.value}`}
          className={`rounded-md px-2.5 py-1 ${String(o.value) === String(value) ? 'bg-surface text-accent shadow-sm' : 'text-muted'}`}>
          {o.label}
        </Link>
      ))}
    </div>
  );
}
