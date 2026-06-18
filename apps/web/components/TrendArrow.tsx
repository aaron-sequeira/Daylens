import type { Trend } from '@/lib/types';
export function TrendArrow({ trend }: { trend: Trend }) {
  const map = { up: ['▲', 'text-emerald-500'], down: ['▼', 'text-rose-500'], flat: ['▬', 'text-muted'] } as const;
  const [glyph, cls] = map[trend.direction];
  return <span className={`text-xs ${cls}`} title={`${trend.delta >= 0 ? '+' : ''}${trend.delta} vs prior period`}>{glyph} {trend.delta >= 0 ? '+' : ''}{trend.delta}</span>;
}
