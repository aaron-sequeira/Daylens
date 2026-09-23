export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS focus_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_name TEXT NOT NULL,
  app_path TEXT,
  window_title TEXT,
  pid INTEGER,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  duration_sec INTEGER,
  date TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_focus_date_app ON focus_sessions(date, app_name);

CREATE TABLE IF NOT EXISTS app_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_name TEXT NOT NULL,
  app_path TEXT,
  pid INTEGER,
  type TEXT NOT NULL CHECK (type IN ('opened','closed')),
  at INTEGER NOT NULL,
  date TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_date ON app_events(date);

CREATE TABLE IF NOT EXISTS activity_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket_start INTEGER NOT NULL,
  bucket_end INTEGER NOT NULL,
  mouse_moves INTEGER NOT NULL DEFAULT 0,
  mouse_distance_px INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  scrolls INTEGER NOT NULL DEFAULT 0,
  key_events INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 0,
  app_name TEXT,
  date TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_samples_date ON activity_samples(date);

CREATE TABLE IF NOT EXISTS daily_summaries (
  date TEXT PRIMARY KEY,
  total_tracked_sec INTEGER NOT NULL DEFAULT 0,
  active_sec INTEGER NOT NULL DEFAULT 0,
  idle_sec INTEGER NOT NULL DEFAULT 0,
  by_app_json TEXT,
  ai_summary TEXT,
  ai_model TEXT,
  ai_generated_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;
