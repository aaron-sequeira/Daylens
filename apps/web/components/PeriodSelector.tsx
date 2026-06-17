import Link from 'next/link';
export function PeriodSelector({ period }: { period: number }) {
  return (
    <div className="flex gap-1">
      {[7, 14, 30].map((p) => (
        <Link key={p} href={`?period=${p}`}
          className={`rounded px-2 py-1 text-xs ${p === period ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>
          {p}d
        </Link>
      ))}
    </div>
  );
}
