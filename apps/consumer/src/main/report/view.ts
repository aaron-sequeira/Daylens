import type { ModelStatus } from '../models/downloader';
import { UNAVAILABLE_TEXT, type Unavailable } from '../writer/availability';
import { WRITER_MODELS, type WriterTier } from '../writer/config';
import type { TimelineSegment } from '../day/today';
import type { ReportCandidate } from './candidates';
import type { ReportStats } from './input';
import type { ReportJson } from './schema';

export type WriterState =
  | { state: 'ready'; mode: 'local' | 'cloud'; model: string }
  | { state: 'missing'; tier: WriterTier; sizeBytes: number }
  | { state: 'downloading'; received: number; total: number }
  | { state: 'verifying' }
  | { state: 'unavailable'; reason: Unavailable; text: string }
  | { state: 'cloud_setup' };
export interface ReportView {
  date: string; prevDate: string | null; nextDate: string | null; today: string;
  status: 'none' | 'pending' | 'ready' | 'failed'; report: ReportJson | null; error: string | null; model: string | null;
  stats: ReportStats | null; timeline: TimelineSegment[]; candidates: ReportCandidate[];
  ticked: string[]; writer: WriterState; waiting: boolean; running: boolean; autoPaused: boolean;
}
// Kept here (rather than in ipc.ts, which imports electron) so the renderer can type-import it too.
export interface WriterView {
  state: WriterState; mode: 'local' | 'cloud'; tier: '' | WriterTier; autoTier: WriterTier;
  provider: string; model: string; baseUrl: string; hasKey: boolean; attribution: string;
}

export function writerState(i: { mode: 'local' | 'cloud'; hasKey: boolean; cloudModel: string; tier: WriterTier; model: ModelStatus; unavailable: Unavailable | null }): WriterState {
  if (i.mode === 'cloud') return i.hasKey ? { state: 'ready', mode: 'cloud', model: i.cloudModel } : { state: 'cloud_setup' };
  if (i.model.state === 'ready' && !i.unavailable) return { state: 'ready', mode: 'local', model: WRITER_MODELS[i.tier].label };
  if (i.unavailable) return { state: 'unavailable', reason: i.unavailable, text: UNAVAILABLE_TEXT[i.unavailable] };
  if (i.model.state === 'downloading') return { state: 'downloading', received: i.model.received, total: i.model.total };
  if (i.model.state === 'verifying') return { state: 'verifying' };
  return { state: 'missing', tier: i.tier, sizeBytes: WRITER_MODELS[i.tier].size };
}

/** Prev = the newest report day before `date`; next = the oldest report day after it, else today (if `date` isn't today). */
export function navDates(date: string, today: string, reportDates: string[]): { prevDate: string | null; nextDate: string | null } {
  const before = reportDates.filter((d) => d < date).sort().reverse();
  const after = reportDates.filter((d) => d > date && d <= today).sort();
  return { prevDate: before[0] ?? null, nextDate: after[0] ?? (date < today ? today : null) };
}
