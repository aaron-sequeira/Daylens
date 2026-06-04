export type ISODate = string; // YYYY-MM-DD (local)

export interface ForegroundInfo {
  appName: string;
  appPath: string | null;
  title: string | null;
  pid: number;
}

export interface InputCounts {
  mouseMoves: number;
  mouseDistancePx: number;
  clicks: number;
  scrolls: number;
  keyEvents: number;
}

export interface FocusSessionRow {
  id: number;
  appName: string;
  appPath: string | null;
  windowTitle: string | null;
  pid: number | null;
  startedAt: number;
  endedAt: number | null;
  durationSec: number | null;
  date: ISODate;
}

export interface ActivitySampleRow {
  id: number;
  bucketStart: number;
  bucketEnd: number;
  mouseMoves: number;
  mouseDistancePx: number;
  clicks: number;
  scrolls: number;
  keyEvents: number;
  active: 0 | 1;
  appName: string | null;
  date: ISODate;
}

export interface AppUsage {
  appName: string;
  totalSec: number;
  sessions: number;
  firstOpenAt: number | null;
  lastCloseAt: number | null;
  activePct: number; // 0..100
}

export interface DaySummary {
  date: ISODate;
  totalTrackedSec: number;
  activeSec: number;
  idleSec: number;
  apps: AppUsage[];
}

export interface AiSummaryResult { text: string; model: string; generatedAt: number; }
export interface AiSummaryError { error: 'no_key' | 'failed'; message?: string; }

export type AiProvider = 'anthropic' | 'openai' | 'gemini' | 'openrouter' | 'custom';

export interface AppSettings {
  idleThresholdSec: number;
  captureWindowTitles: boolean;
  aiEnabled: boolean;
  aiProvider: AiProvider;
  aiModel: string;
  aiBaseUrl: string; // only used for the 'custom' provider
  pollIntervalMs: number;
  bucketSizeSec: number;
  trackingPaused: boolean;
  consentGranted: boolean;
  hasApiKey: boolean; // true if the CURRENT provider has a key saved; renderer never receives the raw key
}

export interface TrackingStatus { paused: boolean; currentApp: string | null; sessionStartedAt: number | null; }
