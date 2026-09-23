import type { ISODate, TrackerSettings } from '@worksight/core/types';

// Tracking/storage types live in @worksight/core; re-exported so agent imports stay unchanged.
export type {
  ISODate, Rect, ForegroundInfo, InputCounts, FocusSessionRow, ActivitySampleRow, AppUsage, DaySummary, TrackingStatus, TrackerSettings
} from '@worksight/core/types';

export interface AiSummaryResult { text: string; model: string; generatedAt: number; }
export interface AiSummaryError { error: 'no_key' | 'failed'; message?: string; }

export type AiProvider = 'anthropic' | 'openai' | 'gemini' | 'openrouter' | 'custom';

export interface AppSettings extends TrackerSettings {
  aiEnabled: boolean;
  aiProvider: AiProvider;
  aiModel: string;
  aiBaseUrl: string; // only used for the 'custom' provider
  consentGranted: boolean;
  cloudSyncEnabled: boolean;
  cloudSyncWindowDays: number;
  hasApiKey: boolean; // true if the CURRENT provider has a key saved; renderer never receives the raw key
}

export interface DailyActivityRow {
  user_id: string;
  date: ISODate;
  total_tracked_sec: number;
  active_sec: number;
  idle_sec: number;
  by_app: { app_name: string; total_sec: number; sessions: number; active_pct: number }[];
}

export interface CloudSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch SECONDS (GoTrue expires_at)
  userId: string;
  email: string;
}

export interface CloudSyncStatus {
  connected: boolean;
  email: string | null;
  enabled: boolean;
  lastSyncedAt: number | null; // epoch ms
  lastError: string | null;
}
