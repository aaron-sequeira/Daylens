import type { DaylensSettings } from '../../main/settings';
import type { ModelStatus } from '../../main/models/downloader';
import type { LabellingStatus } from '../../main/brain/scheduler';
import { formatClock } from './format';

const gb = (n: number): string => (n / 1e9).toFixed(1);
const pct = (m: { received: number; total: number }): number => (m.total ? Math.floor((m.received / m.total) * 100) : 0);

export function shouldAskScreenReading(s: DaylensSettings): boolean {
  return s.consentGranted && !s.screenReadingAsked && !s.screenReading;
}

export function modelStatusText(m: ModelStatus): string {
  switch (m.state) {
    case 'missing': return 'Not downloaded';
    case 'downloading': return m.retrying ? 'Download paused, retrying…' : `Downloading ${pct(m)}% (${gb(m.received)} of ${gb(m.total)} GB)`;
    case 'verifying': return 'Checking…';
    case 'ready': return 'Ready';
    case 'error': return m.reason === 'no_space' ? 'Not enough disk space (needs about 2.2 GB free)' : "Download was damaged. Try 'Download again'.";
  }
}

export function labellingText(l: LabellingStatus): string {
  if (l.state === 'waiting') return 'Waiting for the model';
  if (l.state === 'paused') return 'Paused after repeated errors';
  if (l.state === 'running') return 'Labelling now…';
  return l.lastLabelledAt === null ? 'Nothing labelled yet' : `Last labelled at ${formatClock(l.lastLabelledAt)}`;
}

export function bannerText(screenReading: boolean, m: ModelStatus): string | null {
  return screenReading && m.state === 'downloading' && !m.retrying ? `Downloading the AI model: ${pct(m)}%` : null;
}
