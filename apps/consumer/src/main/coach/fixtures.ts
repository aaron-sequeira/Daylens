import type { ActivitySampleRow, FocusSessionRow } from '@worksight/core/types';
import { DEFAULT_SETTINGS } from '../settings';
import { DEFAULT_PROFILE } from '../../shared/profileOptions';
import type { TodayView } from '../day/today';
import type { Snapshot } from './snapshot';
import type { RecentRead } from './types';

export const MIN = 60_000;
export const T = (h: number, m = 0, day = 25): number => new Date(2026, 8, day, h, m).getTime();
export const active = (from: number, minutes: number, activeFlag: 0 | 1 = 1): ActivitySampleRow[] =>
  Array.from({ length: minutes }, (_, i) => ({ id: 0, bucketStart: from + i * MIN, bucketEnd: from + (i + 1) * MIN, mouseMoves: 1, mouseDistancePx: 1, clicks: 0, scrolls: 0, keyEvents: 1, active: activeFlag, appName: null, date: '2026-09-25' }));
let sid = 1;
export const sess = (appName: string, start: number, end: number | null = null, windowTitle: string | null = null): FocusSessionRow =>
  ({ id: sid++, appName, appPath: null, windowTitle, pid: 1, startedAt: start, endedAt: end, durationSec: end === null ? null : Math.round((end - start) / 1000), date: '2026-09-25' });
export const read = (at: number, appName: string, o: Partial<RecentRead> = {}): RecentRead =>
  ({ at, appName, windowTitle: null, category: null, conf: null, stuck: null, distraction: null, ...o });
export const emptyView = (o: Partial<TodayView> = {}): TodayView => ({
  date: '2026-09-25', now: T(12), screenSec: 0, activeSec: 0, goalSec: 420 * 60, firstSeenAt: null, cards: [], timeline: [], apps: [],
  health: { score: 100, breaks: 0, expectedBreaks: 0, longestStretchSec: 0, lateNight: false },
  week: Array.from({ length: 7 }, (_, i) => ({ date: `2026-09-${19 + i}`, seconds: 0, byCategory: { work: 0, learning: 0, social: 0, entertainment: 0, communication: 0, other: 0 } })),
  ...o
});
export const snap = (o: Partial<Snapshot> = {}): Snapshot => ({
  now: T(12), date: '2026-09-25', settings: { ...DEFAULT_SETTINGS, consentGranted: true }, profile: DEFAULT_PROFILE,
  samples: [], sessions: [], readsToday: [], view: emptyView(), searchTitles: [], limits: [], lastBreakAt: null, focusBlocks: [], reminderDue: null, ...o
});
