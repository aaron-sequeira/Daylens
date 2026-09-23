// Browser-safe shared types (no runtime code). Imported by main, preload and renderer code.
export type ISODate = string; // YYYY-MM-DD (local)

export interface Rect { x: number; y: number; width: number; height: number; }

export interface ForegroundInfo {
  appName: string;
  appPath: string | null;
  title: string | null;
  pid: number;
  bounds?: Rect | null; // window bounds from active-win (Daylens: capture crop + fullscreen detection)
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

export interface TrackingStatus { paused: boolean; currentApp: string | null; sessionStartedAt: number | null; }

/** The subset of app settings the tracker reads. Each app's settings type extends this. */
export interface TrackerSettings {
  idleThresholdSec: number;
  captureWindowTitles: boolean;
  pollIntervalMs: number;
  bucketSizeSec: number;
  trackingPaused: boolean;
}
