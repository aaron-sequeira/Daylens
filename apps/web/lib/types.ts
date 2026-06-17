export type AppRole = 'admin' | 'manager' | 'member';

export interface AppUsage {
  appName: string;
  totalSec: number;
  sessions: number;
  activePct: number; // 0..100
}

export interface DailyActivity {
  userId: string;
  date: string; // YYYY-MM-DD
  totalTrackedSec: number;
  activeSec: number;
  idleSec: number;
  byApp: AppUsage[];
}

export interface Trend {
  delta: number; // current - prior (rounded)
  direction: 'up' | 'down' | 'flat';
}

export interface MemberPeriodStats {
  userId: string;
  fullName: string;
  avgActiveHours: number;
  avgActivePct: number; // 0..100
  activityScore: number; // 0..100, period mean
  daysWithData: number;
  trend: Trend; // self-trend on score vs prior period
}

export interface TeamAggregate {
  totalActiveHours: number;
  avgActivePct: number; // 0..100
  membersTracked: number;
  topApp: string | null;
  series: { date: string; activeHours: number }[];
}
