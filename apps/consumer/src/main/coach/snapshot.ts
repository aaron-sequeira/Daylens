import type { ActivitySampleRow, FocusSessionRow } from '@worksight/core/types';
import type { DaylensSettings } from '../settings';
import type { Profile } from '../../shared/profileOptions';
import type { TodayView } from '../day/today';
import type { AppLimit, Candidate, RecentRead } from './types';

export interface Snapshot {
  now: number; date: string; settings: DaylensSettings; profile: Profile;
  samples: ActivitySampleRow[]; sessions: FocusSessionRow[]; readsToday: RecentRead[];
  view: TodayView; searchTitles: { at: number; title: string }[]; limits: AppLimit[]; lastBreakAt: number | null;
}
export type Rule = (s: Snapshot) => Candidate | null;
