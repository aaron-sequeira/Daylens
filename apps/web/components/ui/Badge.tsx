import type { ReactNode } from 'react';
type Tone = 'accent' | 'success' | 'danger' | 'neutral';
const tones: Record<Tone, string> = {
  accent: 'bg-accent/15 text-accent', success: 'bg-emerald-500/15 text-emerald-500',
  danger: 'bg-rose-500/15 text-rose-500', neutral: 'bg-surface-2 text-muted'
};
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}
