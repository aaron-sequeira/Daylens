import type Database from 'better-sqlite3';
import type { FocusSessionRow, ActivitySampleRow, ISODate } from '../types';

export interface StartSessionInput {
  appName: string; appPath: string | null; windowTitle: string | null; pid: number | null; startedAt: number; date: ISODate;
}
export interface AppEventInput {
  appName: string; appPath: string | null; pid: number | null; type: 'opened' | 'closed'; at: number; date: ISODate;
}
export type ActivitySampleInput = Omit<ActivitySampleRow, 'id'>;

export interface DailySummaryCache {
  date: ISODate; totalTrackedSec: number; activeSec: number; idleSec: number;
  byAppJson: string | null; aiSummary: string | null; aiModel: string | null; aiGeneratedAt: number | null; updatedAt: number;
}

export interface Repositories {
  startFocusSession(i: StartSessionInput): number;
  finalizeFocusSession(id: number, endedAt: number): void;
  insertAppEvent(i: AppEventInput): void;
  insertActivitySample(i: ActivitySampleInput): void;
  getFocusSessions(date: ISODate): FocusSessionRow[];
  getActivitySamples(date: ISODate): ActivitySampleRow[];
  getAppEvents(date: ISODate): { id: number; appName: string; type: 'opened' | 'closed'; at: number }[];
  getAvailableDays(): ISODate[];
  upsertDailySummary(c: DailySummaryCache): void;
  getDailySummary(date: ISODate): DailySummaryCache | null;
  clearAll(): void;
}

export function createRepositories(db: Database.Database): Repositories {
  return {
    startFocusSession(i) {
      const r = db.prepare(
        `INSERT INTO focus_sessions (app_name, app_path, window_title, pid, started_at, date)
         VALUES (@appName, @appPath, @windowTitle, @pid, @startedAt, @date)`
      ).run(i);
      return Number(r.lastInsertRowid);
    },
    finalizeFocusSession(id, endedAt) {
      const row = db.prepare('SELECT started_at AS startedAt FROM focus_sessions WHERE id = ?').get(id) as { startedAt: number } | undefined;
      if (!row) return;
      const durationSec = Math.max(0, Math.round((endedAt - row.startedAt) / 1000));
      db.prepare('UPDATE focus_sessions SET ended_at = ?, duration_sec = ? WHERE id = ?').run(endedAt, durationSec, id);
    },
    insertAppEvent(i) {
      db.prepare(
        `INSERT INTO app_events (app_name, app_path, pid, type, at, date)
         VALUES (@appName, @appPath, @pid, @type, @at, @date)`
      ).run(i);
    },
    insertActivitySample(i) {
      db.prepare(
        `INSERT INTO activity_samples (bucket_start, bucket_end, mouse_moves, mouse_distance_px, clicks, scrolls, key_events, active, app_name, date)
         VALUES (@bucketStart, @bucketEnd, @mouseMoves, @mouseDistancePx, @clicks, @scrolls, @keyEvents, @active, @appName, @date)`
      ).run(i);
    },
    getFocusSessions(date) {
      return db.prepare(
        `SELECT id, app_name AS appName, app_path AS appPath, window_title AS windowTitle, pid,
                started_at AS startedAt, ended_at AS endedAt, duration_sec AS durationSec, date
         FROM focus_sessions WHERE date = ? ORDER BY started_at`
      ).all(date) as FocusSessionRow[];
    },
    getActivitySamples(date) {
      return db.prepare(
        `SELECT id, bucket_start AS bucketStart, bucket_end AS bucketEnd, mouse_moves AS mouseMoves,
                mouse_distance_px AS mouseDistancePx, clicks, scrolls, key_events AS keyEvents, active, app_name AS appName, date
         FROM activity_samples WHERE date = ? ORDER BY bucket_start`
      ).all(date) as ActivitySampleRow[];
    },
    getAppEvents(date) {
      return db.prepare(
        `SELECT id, app_name AS appName, type, at FROM app_events WHERE date = ? ORDER BY at`
      ).all(date) as { id: number; appName: string; type: 'opened' | 'closed'; at: number }[];
    },
    getAvailableDays() {
      const rows = db.prepare(
        `SELECT DISTINCT date FROM (
           SELECT date FROM focus_sessions UNION SELECT date FROM activity_samples
         ) ORDER BY date DESC`
      ).all() as { date: ISODate }[];
      return rows.map(r => r.date);
    },
    upsertDailySummary(c) {
      db.prepare(
        `INSERT INTO daily_summaries (date, total_tracked_sec, active_sec, idle_sec, by_app_json, ai_summary, ai_model, ai_generated_at, updated_at)
         VALUES (@date, @totalTrackedSec, @activeSec, @idleSec, @byAppJson, @aiSummary, @aiModel, @aiGeneratedAt, @updatedAt)
         ON CONFLICT(date) DO UPDATE SET
           total_tracked_sec=@totalTrackedSec, active_sec=@activeSec, idle_sec=@idleSec,
           by_app_json=@byAppJson, ai_summary=@aiSummary, ai_model=@aiModel, ai_generated_at=@aiGeneratedAt, updated_at=@updatedAt`
      ).run(c);
    },
    getDailySummary(date) {
      const r = db.prepare(
        `SELECT date, total_tracked_sec AS totalTrackedSec, active_sec AS activeSec, idle_sec AS idleSec,
                by_app_json AS byAppJson, ai_summary AS aiSummary, ai_model AS aiModel, ai_generated_at AS aiGeneratedAt, updated_at AS updatedAt
         FROM daily_summaries WHERE date = ?`
      ).get(date) as DailySummaryCache | undefined;
      return r ?? null;
    },
    clearAll() {
      db.exec('DELETE FROM focus_sessions; DELETE FROM app_events; DELETE FROM activity_samples; DELETE FROM daily_summaries;');
    }
  };
}
