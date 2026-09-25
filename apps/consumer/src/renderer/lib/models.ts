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
  if (l.state === 'deferred') return `Waiting for a quiet moment (${l.pending} reads queued)`;
  if (l.state === 'waiting') return 'Waiting for the model';
  if (l.state === 'paused') return 'Paused after repeated errors';
  if (l.state === 'running') return 'Labelling now…';
  return l.lastLabelledAt === null ? 'Nothing labelled yet' : `Last labelled at ${formatClock(l.lastLabelledAt)}`;
}

export function bannerText(screenReading: boolean, m: ModelStatus, l: LabellingStatus): string | null {
  if (!screenReading) return null;
  if (m.state === 'downloading' && !m.retrying) return `Downloading the AI model: ${pct(m)}%`;
  // A paused labeller soon stops screen reading (backlog guard): say why on Today.
  if (l.state === 'paused') return 'Labelling paused after errors. See Settings → AI model.';
  return null;
}

/** 'Download again' only makes sense when there is no usable model and no download under way. */
export function canRedownload(m: ModelStatus): boolean {
  return m.state === 'missing' || m.state === 'error';
}

export function modelHint(s: DaylensSettings, m: ModelStatus): string | null {
  return !s.screenReading && m.state !== 'ready' ? 'Turn on screen reading to download the model.' : null;
}
