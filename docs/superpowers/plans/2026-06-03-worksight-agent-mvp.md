# WorkSight Agent MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone, local-only Electron desktop app that tracks foreground application usage, app open/close, input activity (counts only), and active/idle time, stores it in SQLite, and shows a daily summary with structured stats plus an optional AI-generated paragraph.

**Architecture:** Electron main process owns the tracking engine, SQLite, and settings; the React renderer is a read-only viewer talking to main over a typed `contextBridge` IPC API. All OS/Electron boundaries (foreground window, global input, system clock) are dependency-injected behind small interfaces so the core orchestration and all pure logic are unit-testable with vitest + an in-memory SQLite, while thin native adapters and Electron glue get manual smoke verification.

**Tech Stack:** Electron · TypeScript · React 19 + Vite (electron-vite) · better-sqlite3 · active-win · uiohook-napi · Tailwind CSS · Recharts · @anthropic-ai/sdk · zod · vitest · electron-builder · @electron/rebuild.

---

## Native Modules & ABI (read before starting)

Two native modules are used at runtime: `better-sqlite3` (also imported by tests) and `uiohook-napi` (runtime only, never imported by tests). `active-win` is loaded via dynamic `import()` to avoid ESM/CJS friction and is never imported by tests.

A native module compiled for Electron's ABI will not load under plain Node (vitest), and vice-versa. We automate the flip with package scripts:
- `pretest` → `pnpm rebuild better-sqlite3` (Node ABI) so `vitest` works.
- `predev` / `prebuild` → `electron-builder install-app-deps` (Electron ABI) so the app works.

Tests only ever import `better-sqlite3` and pure TS. The tracker is tested with fakes for foreground/input/clock — so `uiohook-napi` and `active-win` are never loaded in tests.

## File Structure

```
worksight/
├─ pnpm-workspace.yaml            # workspace → apps/*
├─ package.json                   # root scripts
├─ .npmrc                         # node-linker=hoisted (electron-builder + native modules)
├─ README.md
├─ .gitignore                     # (exists)
└─ apps/agent/
   ├─ package.json                # @worksight/agent
   ├─ tsconfig.json · tsconfig.node.json · tsconfig.web.json
   ├─ electron.vite.config.ts
   ├─ electron-builder.yml
   ├─ vitest.config.ts
   ├─ tailwind.config.ts · postcss.config.js
   ├─ index.html
   ├─ resources/{icon.png,tray.png}
   └─ src/
      ├─ shared/types.ts          # types shared main↔preload↔renderer
      ├─ main/
      │  ├─ index.ts              # Electron entry: window, tray, lifecycle, wiring
      │  ├─ db/{schema.ts,database.ts,repositories.ts}
      │  ├─ settings.ts           # settings store + encrypted API key
      │  ├─ tracking/{types.ts,idle.ts,processLifecycle.ts,tracker.ts,activeWindow.ts,inputActivity.ts}
      │  ├─ summary/{rollup.ts,ai.ts}
      │  └─ ipc/{channels.ts,handlers.ts}
      ├─ preload/index.ts         # contextBridge typed API
      └─ renderer/
         ├─ main.tsx · App.tsx · index.css
         ├─ lib/{ipc.ts,format.ts}
         └─ components/{ConsentGate,TodayView,DayPicker,StatCard,AppTable,TimePerAppChart,ActiveIdleDonut,AiSummaryCard,SettingsView}.tsx
```

Co-locate unit tests as `*.test.ts` next to the source file (vitest `include: ['src/**/*.test.ts']`).

---

## Task 1: Workspace + Electron/React boot

**Files:**
- Create: `pnpm-workspace.yaml`, `package.json`, `.npmrc`, `README.md`
- Create: `apps/agent/package.json`, `apps/agent/tsconfig.json`, `apps/agent/tsconfig.node.json`, `apps/agent/tsconfig.web.json`, `apps/agent/electron.vite.config.ts`, `apps/agent/vitest.config.ts`, `apps/agent/tailwind.config.ts`, `apps/agent/postcss.config.js`, `apps/agent/index.html`
- Create: `apps/agent/src/main/index.ts`, `apps/agent/src/preload/index.ts`, `apps/agent/src/renderer/main.tsx`, `apps/agent/src/renderer/App.tsx`, `apps/agent/src/renderer/index.css`

- [ ] **Step 1: Create workspace root files**

`pnpm-workspace.yaml`:
```yaml
packages:
  - 'apps/*'
```

`.npmrc`:
```
node-linker=hoisted
```

`package.json`:
```json
{
  "name": "worksight",
  "private": true,
  "version": "0.0.0",
  "scripts": {
    "dev": "pnpm --filter @worksight/agent dev",
    "build": "pnpm --filter @worksight/agent build",
    "test": "pnpm --filter @worksight/agent test"
  }
}
```

`README.md`:
```markdown
# WorkSight Agent (MVP)

Standalone, local-only desktop activity tracker. See `docs/superpowers/specs/2026-06-03-worksight-agent-mvp-design.md`.

## Develop
```
corepack enable
pnpm install
pnpm --filter @worksight/agent dev
```

## Test
```
pnpm --filter @worksight/agent test
```
Native modules use Electron's ABI for the app and Node's ABI for tests; the `pretest`/`predev` scripts rebuild automatically.
```

- [ ] **Step 2: Create the agent package manifest**

`apps/agent/package.json`:
```json
{
  "name": "@worksight/agent",
  "version": "0.0.0",
  "main": "out/main/index.js",
  "scripts": {
    "predev": "electron-builder install-app-deps",
    "dev": "electron-vite dev",
    "prebuild": "electron-builder install-app-deps",
    "build": "electron-vite build && electron-builder",
    "pretest": "pnpm rebuild better-sqlite3",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit -p tsconfig.web.json && tsc --noEmit -p tsconfig.node.json"
  },
  "dependencies": {
    "better-sqlite3": "^11.8.1",
    "active-win": "^8.2.1",
    "uiohook-napi": "^1.5.4",
    "@anthropic-ai/sdk": "^0.39.0",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "electron": "^33.3.1",
    "electron-vite": "^2.3.0",
    "electron-builder": "^25.1.8",
    "@electron/rebuild": "^3.7.1",
    "vite": "^6.0.7",
    "vitest": "^2.1.8",
    "typescript": "^5.7.3",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@types/react": "^19.0.4",
    "@types/react-dom": "^19.0.2",
    "@types/better-sqlite3": "^7.6.12",
    "@vitejs/plugin-react": "^4.3.4",
    "recharts": "^2.15.0",
    "tailwindcss": "^3.4.17",
    "postcss": "^8.5.1",
    "autoprefixer": "^10.4.20"
  }
}
```

- [ ] **Step 3: Create TypeScript + build configs**

`apps/agent/tsconfig.json`:
```json
{ "files": [], "references": [{ "path": "./tsconfig.node.json" }, { "path": "./tsconfig.web.json" }] }
```

`apps/agent/tsconfig.node.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "strict": true, "esModuleInterop": true, "skipLibCheck": true,
    "resolveJsonModule": true, "noEmit": true, "types": ["node"]
  },
  "include": ["src/main/**/*", "src/preload/**/*", "src/shared/**/*"]
}
```

`apps/agent/tsconfig.web.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "strict": true, "esModuleInterop": true, "skipLibCheck": true,
    "jsx": "react-jsx", "lib": ["ES2022", "DOM", "DOM.Iterable"], "noEmit": true
  },
  "include": ["src/renderer/**/*", "src/shared/**/*"]
}
```

`apps/agent/electron.vite.config.ts`:
```ts
import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    root: '.',
    build: { rollupOptions: { input: { index: resolve(__dirname, 'index.html') } } },
    plugins: [react()]
  }
});
```

`apps/agent/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['src/**/*.test.ts'], environment: 'node' }
});
```

`apps/agent/postcss.config.js`:
```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

`apps/agent/tailwind.config.ts`:
```ts
import type { Config } from 'tailwindcss';
export default { content: ['./index.html', './src/renderer/**/*.{ts,tsx}'], theme: { extend: {} }, plugins: [] } satisfies Config;
```

- [ ] **Step 4: Create renderer entry + minimal main/preload**

`apps/agent/index.html`:
```html
<!doctype html>
<html>
  <head><meta charset="UTF-8" /><title>WorkSight Agent</title></head>
  <body><div id="root"></div><script type="module" src="/src/renderer/main.tsx"></script></body>
</html>
```

`apps/agent/src/renderer/index.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

`apps/agent/src/renderer/main.tsx`:
```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
```

`apps/agent/src/renderer/App.tsx`:
```tsx
export default function App() {
  return <div className="p-8 text-2xl font-semibold">WorkSight Agent — boot OK</div>;
}
```

`apps/agent/src/preload/index.ts`:
```ts
// Minimal preload for boot; the typed API is added in Task 12.
import { contextBridge } from 'electron';
contextBridge.exposeInMainWorld('worksight', {});
```

`apps/agent/src/main/index.ts`:
```ts
import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';

function createWindow() {
  const win = new BrowserWindow({
    width: 1100, height: 760, show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.on('ready-to-show', () => win.show());
  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  else win.loadFile(join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
```

- [ ] **Step 5: Install and boot**

Run: `corepack enable && pnpm install`
Then: `pnpm --filter @worksight/agent dev`
Expected: an Electron window opens showing "WorkSight Agent — boot OK". Close it.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(agent): scaffold pnpm workspace + Electron/React boot"
```

---

## Task 2: Native pipeline + SQLite smoke (de-risk ABI early)

**Files:**
- Create: `apps/agent/src/main/db/schema.ts`
- Test: `apps/agent/src/main/db/schema.test.ts`

- [ ] **Step 1: Write the failing test (open in-memory DB, apply schema)**

`apps/agent/src/main/db/schema.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from './schema';

describe('schema', () => {
  it('applies cleanly to an in-memory database', () => {
    const db = new Database(':memory:');
    db.exec(SCHEMA_SQL);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toEqual(expect.arrayContaining(['activity_samples', 'app_events', 'daily_summaries', 'focus_sessions', 'settings']));
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @worksight/agent test`
Expected: FAIL — cannot find module `./schema`.

- [ ] **Step 3: Implement the schema**

`apps/agent/src/main/db/schema.ts`:
```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @worksight/agent test`
Expected: PASS (1 test). If better-sqlite3 fails to load with an ABI error, run `pnpm --filter @worksight/agent exec pnpm rebuild better-sqlite3` and re-run.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(agent): db schema + better-sqlite3 ABI smoke test"
```

---

## Task 3: Shared types

**Files:**
- Create: `apps/agent/src/shared/types.ts`

- [ ] **Step 1: Create the shared types (no test — type declarations only)**

`apps/agent/src/shared/types.ts`:
```ts
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

export interface AppSettings {
  idleThresholdSec: number;
  captureWindowTitles: boolean;
  aiEnabled: boolean;
  aiModel: string;
  pollIntervalMs: number;
  bucketSizeSec: number;
  trackingPaused: boolean;
  consentGranted: boolean;
  hasApiKey: boolean; // renderer never receives the raw key
}

export interface TrackingStatus { paused: boolean; currentApp: string | null; sessionStartedAt: number | null; }
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(agent): shared types"
```

---

## Task 4: Database + repositories

**Files:**
- Create: `apps/agent/src/main/db/database.ts`, `apps/agent/src/main/db/repositories.ts`
- Test: `apps/agent/src/main/db/repositories.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/agent/src/main/db/repositories.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from './schema';
import { createRepositories, Repositories } from './repositories';

let repo: Repositories;
beforeEach(() => {
  const db = new Database(':memory:');
  db.exec(SCHEMA_SQL);
  repo = createRepositories(db);
});

describe('repositories', () => {
  it('starts and finalizes a focus session with computed duration', () => {
    const id = repo.startFocusSession({ appName: 'Code', appPath: '/c', windowTitle: 'a.ts', pid: 10, startedAt: 1000, date: '2026-06-03' });
    repo.finalizeFocusSession(id, 6000);
    const rows = repo.getFocusSessions('2026-06-03');
    expect(rows).toHaveLength(1);
    expect(rows[0].durationSec).toBe(5);
    expect(rows[0].endedAt).toBe(6000);
  });

  it('records app events and activity samples and lists available days', () => {
    repo.insertAppEvent({ appName: 'Code', appPath: '/c', pid: 10, type: 'opened', at: 1000, date: '2026-06-03' });
    repo.insertActivitySample({ bucketStart: 1000, bucketEnd: 61000, mouseMoves: 3, mouseDistancePx: 50, clicks: 1, scrolls: 0, keyEvents: 4, active: 1, appName: 'Code', date: '2026-06-03' });
    expect(repo.getActivitySamples('2026-06-03')).toHaveLength(1);
    expect(repo.getAvailableDays()).toEqual(['2026-06-03']);
  });

  it('clears all activity data', () => {
    repo.startFocusSession({ appName: 'Code', appPath: null, windowTitle: null, pid: 1, startedAt: 1, date: '2026-06-03' });
    repo.clearAll();
    expect(repo.getFocusSessions('2026-06-03')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @worksight/agent test`
Expected: FAIL — cannot find module `./repositories`.

- [ ] **Step 3: Implement database + repositories**

`apps/agent/src/main/db/database.ts`:
```ts
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from './schema';

export function openDatabase(path: string): Database.Database {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA_SQL);
  return db;
}
```

`apps/agent/src/main/db/repositories.ts`:
```ts
import type Database from 'better-sqlite3';
import type { FocusSessionRow, ActivitySampleRow, ISODate } from '../../shared/types';

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @worksight/agent test`
Expected: PASS (4 tests total).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(agent): sqlite database + repositories with tests"
```

---

## Task 5: Settings store

**Files:**
- Create: `apps/agent/src/main/settings.ts`
- Test: `apps/agent/src/main/settings.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/agent/src/main/settings.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from './db/schema';
import { createSettingsStore, SettingsStore } from './settings';

// Identity encryptor stand-in for safeStorage (real impl injected in main).
const enc = { encrypt: (s: string) => Buffer.from(s, 'utf8'), decrypt: (b: Buffer) => b.toString('utf8') };

let store: SettingsStore;
beforeEach(() => {
  const db = new Database(':memory:');
  db.exec(SCHEMA_SQL);
  store = createSettingsStore(db, enc);
});

describe('settings', () => {
  it('returns defaults when empty', () => {
    const s = store.get();
    expect(s.idleThresholdSec).toBe(60);
    expect(s.consentGranted).toBe(false);
    expect(s.hasApiKey).toBe(false);
    expect(s.aiModel).toBe('claude-haiku-4-5');
  });

  it('persists a partial update', () => {
    store.set({ consentGranted: true, idleThresholdSec: 120 });
    const s = store.get();
    expect(s.consentGranted).toBe(true);
    expect(s.idleThresholdSec).toBe(120);
  });

  it('stores the api key encrypted and never returns it via get()', () => {
    store.setApiKey('sk-test');
    expect(store.get().hasApiKey).toBe(true);
    expect(store.getApiKey()).toBe('sk-test');
    expect((store.get() as unknown as Record<string, unknown>).anthropicApiKey).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @worksight/agent test`
Expected: FAIL — cannot find module `./settings`.

- [ ] **Step 3: Implement the settings store**

`apps/agent/src/main/settings.ts`:
```ts
import type Database from 'better-sqlite3';
import type { AppSettings } from '../shared/types';

export interface Encryptor { encrypt(s: string): Buffer; decrypt(b: Buffer): string; }

export interface SettingsStore {
  get(): AppSettings;
  set(patch: Partial<Omit<AppSettings, 'hasApiKey'>>): void;
  setApiKey(key: string): void;
  getApiKey(): string | null;
}

const DEFAULTS: Omit<AppSettings, 'hasApiKey'> = {
  idleThresholdSec: 60,
  captureWindowTitles: true,
  aiEnabled: false,
  aiModel: 'claude-haiku-4-5',
  pollIntervalMs: 2000,
  bucketSizeSec: 60,
  trackingPaused: false,
  consentGranted: false
};

const API_KEY = 'anthropic_api_key_enc';

export function createSettingsStore(db: Database.Database, enc: Encryptor): SettingsStore {
  const readRaw = (key: string): string | null => {
    const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return r?.value ?? null;
  };
  const writeRaw = (key: string, value: string): void => {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?').run(key, value, value);
  };

  return {
    get() {
      const out = { ...DEFAULTS } as Omit<AppSettings, 'hasApiKey'>;
      for (const key of Object.keys(DEFAULTS) as (keyof typeof DEFAULTS)[]) {
        const raw = readRaw(key);
        if (raw === null) continue;
        const def = DEFAULTS[key];
        (out as Record<string, unknown>)[key] =
          typeof def === 'number' ? Number(raw) : typeof def === 'boolean' ? raw === 'true' : raw;
      }
      return { ...out, hasApiKey: readRaw(API_KEY) !== null };
    },
    set(patch) {
      for (const [k, v] of Object.entries(patch)) writeRaw(k, String(v));
    },
    setApiKey(key) {
      writeRaw(API_KEY, enc.encrypt(key).toString('base64'));
    },
    getApiKey() {
      const raw = readRaw(API_KEY);
      return raw === null ? null : enc.decrypt(Buffer.from(raw, 'base64'));
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @worksight/agent test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(agent): settings store with encrypted api key"
```

---

## Task 6: Idle/active logic

**Files:**
- Create: `apps/agent/src/main/tracking/types.ts`, `apps/agent/src/main/tracking/idle.ts`
- Test: `apps/agent/src/main/tracking/idle.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/agent/src/main/tracking/idle.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { isActiveBucket } from './idle';

const zero = { mouseMoves: 0, mouseDistancePx: 0, clicks: 0, scrolls: 0, keyEvents: 0 };

describe('isActiveBucket', () => {
  it('is active when any input occurred', () => {
    expect(isActiveBucket({ ...zero, clicks: 1 }, 999, 60)).toBe(true);
  });
  it('is active when system idle is below threshold even with no counted input', () => {
    expect(isActiveBucket(zero, 10, 60)).toBe(true);
  });
  it('is idle when no input and system idle exceeds threshold', () => {
    expect(isActiveBucket(zero, 120, 60)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @worksight/agent test`
Expected: FAIL — cannot find module `./idle`.

- [ ] **Step 3: Implement the interfaces + idle logic**

`apps/agent/src/main/tracking/types.ts`:
```ts
import type { ForegroundInfo, InputCounts } from '../../shared/types';

export interface ForegroundSource { get(): Promise<ForegroundInfo | null>; }
export interface InputSource { start(): void; stop(): void; drain(): InputCounts; }
export interface Clock { now(): number; }
export const systemClock: Clock = { now: () => Date.now() };
```

`apps/agent/src/main/tracking/idle.ts`:
```ts
import type { InputCounts } from '../../shared/types';

export function isActiveBucket(counts: InputCounts, systemIdleSec: number, thresholdSec: number): boolean {
  const hadInput = counts.mouseMoves + counts.clicks + counts.scrolls + counts.keyEvents > 0;
  return hadInput || systemIdleSec < thresholdSec;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @worksight/agent test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(agent): tracking interfaces + idle logic"
```

---

## Task 7: Rollup (structured summary)

**Files:**
- Create: `apps/agent/src/main/summary/rollup.ts`
- Test: `apps/agent/src/main/summary/rollup.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/agent/src/main/summary/rollup.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { computeDaySummary } from './rollup';
import type { FocusSessionRow, ActivitySampleRow } from '../../shared/types';

const fs = (o: Partial<FocusSessionRow>): FocusSessionRow => ({
  id: 1, appName: 'Code', appPath: null, windowTitle: null, pid: 1,
  startedAt: 0, endedAt: 0, durationSec: 0, date: '2026-06-03', ...o
});
const sample = (o: Partial<ActivitySampleRow>): ActivitySampleRow => ({
  id: 1, bucketStart: 0, bucketEnd: 60000, mouseMoves: 0, mouseDistancePx: 0, clicks: 0, scrolls: 0,
  keyEvents: 0, active: 0, appName: 'Code', date: '2026-06-03', ...o
});

describe('computeDaySummary', () => {
  it('aggregates per-app time, sessions, first/last and totals', () => {
    const sessions = [
      fs({ id: 1, appName: 'Code', startedAt: 1000, endedAt: 4000, durationSec: 3 }),
      fs({ id: 2, appName: 'Code', startedAt: 5000, endedAt: 9000, durationSec: 4 }),
      fs({ id: 3, appName: 'Chrome', startedAt: 2000, endedAt: 4000, durationSec: 2 })
    ];
    const samples = [
      sample({ bucketStart: 0, bucketEnd: 60000, active: 1, appName: 'Code' }),
      sample({ bucketStart: 60000, bucketEnd: 120000, active: 0, appName: 'Code' })
    ];
    const out = computeDaySummary('2026-06-03', sessions, samples);
    expect(out.totalTrackedSec).toBe(9);
    expect(out.activeSec).toBe(60);
    expect(out.idleSec).toBe(0); // clamped: 9 - 60 -> 0
    const code = out.apps.find(a => a.appName === 'Code')!;
    expect(code.totalSec).toBe(7);
    expect(code.sessions).toBe(2);
    expect(code.firstOpenAt).toBe(1000);
    expect(code.lastCloseAt).toBe(9000);
    expect(code.activePct).toBe(50);
    expect(out.apps[0].appName).toBe('Code'); // sorted by totalSec desc
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @worksight/agent test`
Expected: FAIL — cannot find module `./rollup`.

- [ ] **Step 3: Implement the rollup**

`apps/agent/src/main/summary/rollup.ts`:
```ts
import type { FocusSessionRow, ActivitySampleRow, DaySummary, AppUsage, ISODate } from '../../shared/types';

const bucketSec = (s: ActivitySampleRow): number => Math.max(0, Math.round((s.bucketEnd - s.bucketStart) / 1000));

export function computeDaySummary(date: ISODate, sessions: FocusSessionRow[], samples: ActivitySampleRow[]): DaySummary {
  const totalTrackedSec = sessions.reduce((acc, s) => acc + (s.durationSec ?? 0), 0);
  const activeSec = samples.filter(s => s.active === 1).reduce((acc, s) => acc + bucketSec(s), 0);
  const idleSec = Math.max(0, totalTrackedSec - activeSec);

  const byApp = new Map<string, AppUsage>();
  for (const s of sessions) {
    const u = byApp.get(s.appName) ?? { appName: s.appName, totalSec: 0, sessions: 0, firstOpenAt: null, lastCloseAt: null, activePct: 0 };
    u.totalSec += s.durationSec ?? 0;
    u.sessions += 1;
    u.firstOpenAt = u.firstOpenAt === null ? s.startedAt : Math.min(u.firstOpenAt, s.startedAt);
    if (s.endedAt !== null) u.lastCloseAt = u.lastCloseAt === null ? s.endedAt : Math.max(u.lastCloseAt, s.endedAt);
    byApp.set(s.appName, u);
  }

  // active% per app from samples
  const appBuckets = new Map<string, { active: number; total: number }>();
  for (const s of samples) {
    if (!s.appName) continue;
    const b = appBuckets.get(s.appName) ?? { active: 0, total: 0 };
    const dur = bucketSec(s);
    b.total += dur;
    if (s.active === 1) b.active += dur;
    appBuckets.set(s.appName, b);
  }
  for (const u of byApp.values()) {
    const b = appBuckets.get(u.appName);
    u.activePct = b && b.total > 0 ? Math.round((b.active / b.total) * 100) : 0;
  }

  const apps = [...byApp.values()].sort((a, b) => b.totalSec - a.totalSec);
  return { date, totalTrackedSec, activeSec, idleSec, apps };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @worksight/agent test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(agent): daily rollup computation"
```

---

## Task 8: AI summary

**Files:**
- Create: `apps/agent/src/main/summary/ai.ts`
- Test: `apps/agent/src/main/summary/ai.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/agent/src/main/summary/ai.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildSummaryPrompt, generateAiSummary } from './ai';
import type { DaySummary } from '../../shared/types';

const summary: DaySummary = {
  date: '2026-06-03', totalTrackedSec: 15120, activeSec: 12000, idleSec: 3120,
  apps: [{ appName: 'Code', totalSec: 15120, sessions: 9, firstOpenAt: 1, lastCloseAt: 2, activePct: 80 }]
};

describe('ai summary', () => {
  it('builds a prompt that includes app names and the date', () => {
    const p = buildSummaryPrompt(summary);
    expect(p.user).toContain('Code');
    expect(p.user).toContain('2026-06-03');
    expect(p.system.length).toBeGreaterThan(0);
  });

  it('returns no_key when no api key is provided', async () => {
    const r = await generateAiSummary(summary, { apiKey: null, model: 'claude-haiku-4-5' });
    expect(r).toEqual({ error: 'no_key' });
  });

  it('returns generated text via an injected client', async () => {
    const fakeClient = { messages: { create: async () => ({ content: [{ type: 'text', text: 'You spent 4.2 hours in Code.' }] }) } };
    const r = await generateAiSummary(summary, {
      apiKey: 'sk-test', model: 'claude-haiku-4-5',
      createClient: () => fakeClient as never
    });
    expect(r).toEqual(expect.objectContaining({ text: 'You spent 4.2 hours in Code.', model: 'claude-haiku-4-5' }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @worksight/agent test`
Expected: FAIL — cannot find module `./ai`.

- [ ] **Step 3: Implement the AI summary**

`apps/agent/src/main/summary/ai.ts`:
```ts
import Anthropic from '@anthropic-ai/sdk';
import type { DaySummary, AiSummaryResult, AiSummaryError } from '../../shared/types';

const round1 = (sec: number): number => Math.round(sec / 360) / 10; // hours, 1 dp

export function buildSummaryPrompt(summary: DaySummary): { system: string; user: string } {
  const apps = summary.apps
    .map(a => `${a.appName}: ${round1(a.totalSec)}h across ${a.sessions} session(s), ${a.activePct}% active`)
    .join('\n');
  const system =
    'You are a concise productivity assistant. Given a single day of a user\'s tracked desktop activity, ' +
    'write ONE short factual paragraph (2-4 sentences) summarizing how their time was spent. ' +
    'Address the user as "You". Do not invent data; only use the numbers given.';
  const user =
    `Date: ${summary.date}\n` +
    `Total tracked: ${round1(summary.totalTrackedSec)}h (active ${round1(summary.activeSec)}h, idle ${round1(summary.idleSec)}h)\n` +
    `Applications:\n${apps || '(none)'}`;
  return { system, user };
}

export interface AiDeps {
  apiKey: string | null;
  model: string;
  createClient?: (apiKey: string) => Anthropic;
}

export async function generateAiSummary(summary: DaySummary, deps: AiDeps): Promise<AiSummaryResult | AiSummaryError> {
  if (!deps.apiKey) return { error: 'no_key' };
  const client = (deps.createClient ?? ((k) => new Anthropic({ apiKey: k })))(deps.apiKey);
  const { system, user } = buildSummaryPrompt(summary);
  try {
    const msg = await client.messages.create({
      model: deps.model,
      max_tokens: 400,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: user }]
    });
    const text = (msg.content as { type: string; text?: string }[])
      .filter(b => b.type === 'text').map(b => b.text ?? '').join('').trim();
    return { text, model: deps.model, generatedAt: Date.now() };
  } catch (e) {
    return { error: 'failed', message: String(e) };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @worksight/agent test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(agent): ai summary prompt + anthropic call with fallback"
```

---

## Task 9: Process lifecycle (pid liveness)

**Files:**
- Create: `apps/agent/src/main/tracking/processLifecycle.ts`
- Test: `apps/agent/src/main/tracking/processLifecycle.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/agent/src/main/tracking/processLifecycle.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { isPidAlive, createPidWatcher } from './processLifecycle';

describe('process lifecycle', () => {
  it('reports the current process as alive and an impossible pid as dead', () => {
    expect(isPidAlive(process.pid)).toBe(true);
    expect(isPidAlive(2147483646)).toBe(false);
  });

  it('detects newly-dead pids via the watcher', () => {
    const alive = new Set([10, 20]);
    const w = createPidWatcher((pid) => alive.has(pid));
    w.track(10, 'Code');
    w.track(20, 'Chrome');
    expect(w.collectDead()).toEqual([]);
    alive.delete(20);
    expect(w.collectDead()).toEqual([{ pid: 20, appName: 'Chrome' }]);
    expect(w.collectDead()).toEqual([]); // not reported twice
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @worksight/agent test`
Expected: FAIL — cannot find module `./processLifecycle`.

- [ ] **Step 3: Implement**

`apps/agent/src/main/tracking/processLifecycle.ts`:
```ts
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'; // exists but not permitted to signal
  }
}

export interface PidWatcher {
  track(pid: number, appName: string): void;
  collectDead(): { pid: number; appName: string }[];
}

export function createPidWatcher(aliveFn: (pid: number) => boolean = isPidAlive): PidWatcher {
  const tracked = new Map<number, string>();
  return {
    track(pid, appName) { if (pid > 0) tracked.set(pid, appName); },
    collectDead() {
      const dead: { pid: number; appName: string }[] = [];
      for (const [pid, appName] of tracked) {
        if (!aliveFn(pid)) { dead.push({ pid, appName }); tracked.delete(pid); }
      }
      return dead;
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @worksight/agent test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(agent): pid liveness + watcher"
```

---

## Task 10: Tracker orchestrator

**Files:**
- Create: `apps/agent/src/main/tracking/tracker.ts`
- Test: `apps/agent/src/main/tracking/tracker.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/agent/src/main/tracking/tracker.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../db/schema';
import { createRepositories, Repositories } from '../db/repositories';
import { createTracker, Tracker } from './tracker';
import type { ForegroundInfo, InputCounts } from '../../shared/types';

let repo: Repositories;
let nowMs: number;
let foreground: ForegroundInfo | null;
let drained: InputCounts;
let alivePids: Set<number>;
let tracker: Tracker;

const blank = (): InputCounts => ({ mouseMoves: 0, mouseDistancePx: 0, clicks: 0, scrolls: 0, keyEvents: 0 });

beforeEach(() => {
  const db = new Database(':memory:');
  db.exec(SCHEMA_SQL);
  repo = createRepositories(db);
  nowMs = 1_000_000;
  foreground = null;
  drained = blank();
  alivePids = new Set([10, 20]);
  tracker = createTracker({
    foreground: { get: async () => foreground },
    input: { start() {}, stop() {}, drain: () => drained },
    clock: { now: () => nowMs },
    repo,
    getSettings: () => ({ idleThresholdSec: 60, captureWindowTitles: true, aiEnabled: false, aiModel: 'm', pollIntervalMs: 2000, bucketSizeSec: 60, trackingPaused: false, consentGranted: true, hasApiKey: false }),
    getSystemIdleSec: () => 0,
    isPidAlive: (pid) => alivePids.has(pid)
  });
});

describe('tracker', () => {
  it('opens a session and an opened event on first foreground app', async () => {
    const day = new Date(nowMs).toISOString().slice(0, 10);
    foreground = { appName: 'Code', appPath: '/c', title: 'a.ts', pid: 10 };
    await tracker.tick();
    expect(repo.getFocusSessions(day)).toHaveLength(1);
    expect(repo.getAppEvents(day).some(e => e.type === 'opened' && e.appName === 'Code')).toBe(true);
  });

  it('finalizes the previous session with a duration when the app changes', async () => {
    const day = new Date(nowMs).toISOString().slice(0, 10);
    foreground = { appName: 'Code', appPath: '/c', title: 'a.ts', pid: 10 };
    await tracker.tick();
    nowMs += 5000;
    foreground = { appName: 'Chrome', appPath: '/ch', title: 'tab', pid: 20 };
    await tracker.tick();
    const rows = repo.getFocusSessions(day);
    expect(rows).toHaveLength(2);
    expect(rows[0].durationSec).toBe(5);
    expect(rows[1].endedAt).toBeNull();
  });

  it('emits a closed event when a tracked pid dies', async () => {
    const day = new Date(nowMs).toISOString().slice(0, 10);
    foreground = { appName: 'Code', appPath: '/c', title: 'a.ts', pid: 10 };
    await tracker.tick();
    alivePids.delete(10);
    nowMs += 2000;
    foreground = { appName: 'Chrome', appPath: '/ch', title: 'tab', pid: 20 };
    await tracker.tick();
    const events = repo.getAppEvents(day);
    expect(events.some(e => e.type === 'closed' && e.appName === 'Code')).toBe(true);
  });

  it('writes an active sample when input occurred and inactive when idle', () => {
    const day = new Date(nowMs).toISOString().slice(0, 10);
    foreground = { appName: 'Code', appPath: '/c', title: 'a.ts', pid: 10 };
    drained = { ...blank(), clicks: 3 };
    tracker.flushBucket();
    let samples = repo.getActivitySamples(day);
    expect(samples).toHaveLength(1);
    expect(samples[0].active).toBe(1);

    drained = blank();
    nowMs += 60000;
    tracker.flushBucket();
    samples = repo.getActivitySamples(day);
    expect(samples[1].active).toBe(0);
  });
});
```

- [ ] **Step 2: Add the `getAppEvents` repo helper (the test needs it)**

In `apps/agent/src/main/db/repositories.ts`, add to the `Repositories` interface:
```ts
  getAppEvents(date: ISODate): { id: number; appName: string; type: 'opened' | 'closed'; at: number }[];
```
and to the returned object:
```ts
    getAppEvents(date) {
      return db.prepare(
        `SELECT id, app_name AS appName, type, at FROM app_events WHERE date = ? ORDER BY at`
      ).all(date) as { id: number; appName: string; type: 'opened' | 'closed'; at: number }[];
    },
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @worksight/agent test`
Expected: FAIL — cannot find module `./tracker`.

- [ ] **Step 4: Implement the tracker**

`apps/agent/src/main/tracking/tracker.ts`:
```ts
import type { AppSettings } from '../../shared/types';
import type { Repositories } from '../db/repositories';
import type { ForegroundSource, InputSource, Clock } from './types';
import { isActiveBucket } from './idle';
import { createPidWatcher, isPidAlive } from './processLifecycle';

export interface TrackerDeps {
  foreground: ForegroundSource;
  input: InputSource;
  clock: Clock;
  repo: Repositories;
  getSettings: () => AppSettings;
  getSystemIdleSec: () => number;
  isPidAlive?: (pid: number) => boolean;
  onUpdate?: () => void;
}

export interface Tracker {
  start(): void;
  stop(): void;
  tick(): Promise<void>;
  flushBucket(): void;
  status(): { paused: boolean; currentApp: string | null; sessionStartedAt: number | null };
}

const dateOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export function createTracker(deps: TrackerDeps): Tracker {
  const aliveFn = deps.isPidAlive ?? isPidAlive;
  const watcher = createPidWatcher(aliveFn);
  let current: { id: number; appName: string; pid: number | null; title: string | null; startedAt: number } | null = null;
  let lastBucketEnd = deps.clock.now();
  let pollTimer: NodeJS.Timeout | null = null;
  let bucketTimer: NodeJS.Timeout | null = null;

  const changed = (fgApp: string, fgPid: number, fgTitle: string | null): boolean =>
    !current || current.appName !== fgApp || current.pid !== fgPid || current.title !== fgTitle;

  const finalizeCurrent = (at: number): void => {
    if (current) { deps.repo.finalizeFocusSession(current.id, at); current = null; }
  };

  async function tick(): Promise<void> {
    const now = deps.clock.now();
    const fg = await deps.foreground.get();

    // close events for dead pids
    for (const dead of watcher.collectDead()) {
      deps.repo.insertAppEvent({ appName: dead.appName, appPath: null, pid: dead.pid, type: 'closed', at: now, date: dateOf(now) });
    }
    if (!fg) return;

    if (changed(fg.appName, fg.pid, fg.title)) {
      finalizeCurrent(now);
      const settings = deps.getSettings();
      const title = settings.captureWindowTitles ? fg.title : null;
      const seenPid = watcherHas(fg.pid);
      if (!seenPid) {
        deps.repo.insertAppEvent({ appName: fg.appName, appPath: fg.appPath, pid: fg.pid, type: 'opened', at: now, date: dateOf(now) });
      }
      watcher.track(fg.pid, fg.appName);
      const id = deps.repo.startFocusSession({ appName: fg.appName, appPath: fg.appPath, windowTitle: title, pid: fg.pid, startedAt: now, date: dateOf(now) });
      current = { id, appName: fg.appName, pid: fg.pid, title, startedAt: now };
      deps.onUpdate?.();
    }
  }

  // PidWatcher has no "has"; track an auxiliary set for opened-event de-dup.
  const openedPids = new Set<number>();
  function watcherHas(pid: number): boolean {
    if (openedPids.has(pid)) return true;
    openedPids.add(pid);
    return false;
  }

  function flushBucket(): void {
    const now = deps.clock.now();
    const counts = deps.input.drain();
    const settings = deps.getSettings();
    const active = isActiveBucket(counts, deps.getSystemIdleSec(), settings.idleThresholdSec) ? 1 : 0;
    deps.repo.insertActivitySample({
      bucketStart: lastBucketEnd, bucketEnd: now,
      mouseMoves: counts.mouseMoves, mouseDistancePx: counts.mouseDistancePx, clicks: counts.clicks,
      scrolls: counts.scrolls, keyEvents: counts.keyEvents, active, appName: current?.appName ?? null, date: dateOf(now)
    });
    lastBucketEnd = now;
    deps.onUpdate?.();
  }

  return {
    start() {
      deps.input.start();
      const s = deps.getSettings();
      lastBucketEnd = deps.clock.now();
      pollTimer = setInterval(() => { void tick(); }, s.pollIntervalMs);
      bucketTimer = setInterval(() => flushBucket(), s.bucketSizeSec * 1000);
    },
    stop() {
      if (pollTimer) clearInterval(pollTimer);
      if (bucketTimer) clearInterval(bucketTimer);
      pollTimer = bucketTimer = null;
      finalizeCurrent(deps.clock.now());
      deps.input.stop();
    },
    tick,
    flushBucket,
    status() {
      return { paused: deps.getSettings().trackingPaused, currentApp: current?.appName ?? null, sessionStartedAt: current?.startedAt ?? null };
    }
  };
}
```

> Implementation note: `watcherHas` doubles as opened-event de-dup. The first `tick` with a new pid records `opened`; the `openedPids` set prevents duplicate `opened` events across re-focus. The `PidWatcher` handles `closed` detection.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @worksight/agent test`
Expected: PASS (all tracker cases).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(agent): tracker orchestrator with injected boundaries + tests"
```

---

## Task 11: Real native adapters (foreground + input)

**Files:**
- Create: `apps/agent/src/main/tracking/activeWindow.ts`, `apps/agent/src/main/tracking/inputActivity.ts`

These wrap native modules and are verified manually at runtime (Task 13). No unit tests — tests use fakes.

- [ ] **Step 1: Implement the foreground source (dynamic import avoids ESM/CJS issues)**

`apps/agent/src/main/tracking/activeWindow.ts`:
```ts
import type { ForegroundInfo } from '../../shared/types';
import type { ForegroundSource } from './types';

type ActiveWinFn = () => Promise<{ title?: string; owner: { name: string; path?: string; processId: number } } | undefined>;
let activeWin: ActiveWinFn | null = null;

async function load(): Promise<ActiveWinFn> {
  if (!activeWin) { const m = await import('active-win'); activeWin = m.default as unknown as ActiveWinFn; }
  return activeWin;
}

export class ActiveWinForegroundSource implements ForegroundSource {
  async get(): Promise<ForegroundInfo | null> {
    try {
      const fn = await load();
      const r = await fn();
      if (!r) return null;
      return { appName: r.owner.name, appPath: r.owner.path ?? null, title: r.title ?? null, pid: r.owner.processId };
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 2: Implement the input source**

`apps/agent/src/main/tracking/inputActivity.ts`:
```ts
import { uIOhook } from 'uiohook-napi';
import type { InputCounts } from '../../shared/types';
import type { InputSource } from './types';

const blank = (): InputCounts => ({ mouseMoves: 0, mouseDistancePx: 0, clicks: 0, scrolls: 0, keyEvents: 0 });

export class UiohookInputSource implements InputSource {
  private counts = blank();
  private last: { x: number; y: number } | null = null;
  private running = false;

  start(): void {
    if (this.running) return;
    uIOhook.on('mousemove', (e) => {
      this.counts.mouseMoves++;
      if (this.last) this.counts.mouseDistancePx += Math.round(Math.hypot(e.x - this.last.x, e.y - this.last.y));
      this.last = { x: e.x, y: e.y };
    });
    uIOhook.on('click', () => { this.counts.clicks++; });
    uIOhook.on('wheel', () => { this.counts.scrolls++; });
    uIOhook.on('keydown', () => { this.counts.keyEvents++; }); // count only — no key identity stored
    uIOhook.start();
    this.running = true;
  }

  stop(): void {
    if (!this.running) return;
    uIOhook.stop();
    uIOhook.removeAllListeners();
    this.running = false;
    this.last = null;
  }

  drain(): InputCounts {
    const c = this.counts;
    this.counts = blank();
    return c;
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @worksight/agent typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(agent): native foreground + input adapters"
```

---

## Task 12: IPC channels, handlers, preload

**Files:**
- Create: `apps/agent/src/main/ipc/channels.ts`, `apps/agent/src/main/ipc/handlers.ts`
- Modify: `apps/agent/src/preload/index.ts`

- [ ] **Step 1: Define channels**

`apps/agent/src/main/ipc/channels.ts`:
```ts
export const CH = {
  trackingGetStatus: 'tracking:getStatus',
  trackingPause: 'tracking:pause',
  trackingResume: 'tracking:resume',
  summaryGetDay: 'summary:getDay',
  summaryGetDays: 'summary:getAvailableDays',
  summaryGenerateAi: 'summary:generateAi',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsSetApiKey: 'settings:setApiKey',
  dataClearAll: 'data:clearAll',
  eventsUpdate: 'events:update'
} as const;
```

- [ ] **Step 2: Implement handlers (delegates to already-tested services)**

`apps/agent/src/main/ipc/handlers.ts`:
```ts
import { ipcMain } from 'electron';
import { z } from 'zod';
import { CH } from './channels';
import type { Repositories } from '../db/repositories';
import type { SettingsStore } from '../settings';
import type { Tracker } from '../tracking/tracker';
import { computeDaySummary } from '../summary/rollup';
import { generateAiSummary } from '../summary/ai';
import type { AppSettings } from '../../shared/types';

const dayArg = z.object({ date: z.string() });
const settingsPatch = z.record(z.union([z.string(), z.number(), z.boolean()]));

export interface IpcDeps { repo: Repositories; settings: SettingsStore; tracker: Tracker; onTrackingChange: () => void; }

export function registerIpc(deps: IpcDeps): void {
  ipcMain.handle(CH.trackingGetStatus, () => deps.tracker.status());
  ipcMain.handle(CH.trackingPause, () => { deps.settings.set({ trackingPaused: true }); deps.tracker.stop(); deps.onTrackingChange(); });
  ipcMain.handle(CH.trackingResume, () => { deps.settings.set({ trackingPaused: false }); deps.tracker.start(); deps.onTrackingChange(); });

  ipcMain.handle(CH.summaryGetDay, (_e, raw) => {
    const { date } = dayArg.parse(raw);
    return computeDaySummary(date, deps.repo.getFocusSessions(date), deps.repo.getActivitySamples(date));
  });
  ipcMain.handle(CH.summaryGetDays, () => deps.repo.getAvailableDays());
  ipcMain.handle(CH.summaryGenerateAi, async (_e, raw) => {
    const { date } = dayArg.parse(raw);
    const s: AppSettings = deps.settings.get();
    if (!s.aiEnabled) return { error: 'no_key' };
    const summary = computeDaySummary(date, deps.repo.getFocusSessions(date), deps.repo.getActivitySamples(date));
    const result = await generateAiSummary(summary, { apiKey: deps.settings.getApiKey(), model: s.aiModel });
    if ('text' in result) {
      deps.repo.upsertDailySummary({
        date, totalTrackedSec: summary.totalTrackedSec, activeSec: summary.activeSec, idleSec: summary.idleSec,
        byAppJson: JSON.stringify(summary.apps), aiSummary: result.text, aiModel: result.model, aiGeneratedAt: result.generatedAt, updatedAt: Date.now()
      });
    }
    return result;
  });

  ipcMain.handle(CH.settingsGet, () => deps.settings.get());
  ipcMain.handle(CH.settingsSet, (_e, raw) => { deps.settings.set(settingsPatch.parse(raw) as never); return deps.settings.get(); });
  ipcMain.handle(CH.settingsSetApiKey, (_e, raw) => { deps.settings.setApiKey(z.string().parse(raw)); return deps.settings.get(); });
  ipcMain.handle(CH.dataClearAll, () => { deps.repo.clearAll(); });
}
```

- [ ] **Step 3: Implement the typed preload**

`apps/agent/src/preload/index.ts`:
```ts
import { contextBridge, ipcRenderer } from 'electron';
import { CH } from '../main/ipc/channels';
import type { AppSettings, DaySummary, TrackingStatus, AiSummaryResult, AiSummaryError } from '../shared/types';

const api = {
  tracking: {
    getStatus: (): Promise<TrackingStatus> => ipcRenderer.invoke(CH.trackingGetStatus),
    pause: (): Promise<void> => ipcRenderer.invoke(CH.trackingPause),
    resume: (): Promise<void> => ipcRenderer.invoke(CH.trackingResume)
  },
  summary: {
    getDay: (date: string): Promise<DaySummary> => ipcRenderer.invoke(CH.summaryGetDay, { date }),
    getAvailableDays: (): Promise<string[]> => ipcRenderer.invoke(CH.summaryGetDays),
    generateAi: (date: string): Promise<AiSummaryResult | AiSummaryError> => ipcRenderer.invoke(CH.summaryGenerateAi, { date })
  },
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke(CH.settingsGet),
    set: (patch: Partial<AppSettings>): Promise<AppSettings> => ipcRenderer.invoke(CH.settingsSet, patch),
    setApiKey: (key: string): Promise<AppSettings> => ipcRenderer.invoke(CH.settingsSetApiKey, key)
  },
  data: { clearAll: (): Promise<void> => ipcRenderer.invoke(CH.dataClearAll) },
  onUpdate: (cb: () => void): (() => void) => {
    const listener = (): void => cb();
    ipcRenderer.on(CH.eventsUpdate, listener);
    return () => ipcRenderer.off(CH.eventsUpdate, listener);
  }
};

export type WorkSightApi = typeof api;
contextBridge.exposeInMainWorld('worksight', api);
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @worksight/agent typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(agent): typed ipc channels, handlers, preload"
```

---

## Task 13: Electron main wiring (db, tray, tracker, lifecycle)

**Files:**
- Modify: `apps/agent/src/main/index.ts`
- Create: `apps/agent/resources/tray.png`, `apps/agent/resources/icon.png` (any 256×256 PNGs; placeholders acceptable for MVP)

- [ ] **Step 1: Replace main with full wiring**

`apps/agent/src/main/index.ts`:
```ts
import { app, BrowserWindow, Tray, Menu, powerMonitor, safeStorage } from 'electron';
import { join } from 'node:path';
import { openDatabase } from './db/database';
import { createRepositories } from './db/repositories';
import { createSettingsStore } from './settings';
import { createTracker } from './tracking/tracker';
import { systemClock } from './tracking/types';
import { ActiveWinForegroundSource } from './tracking/activeWindow';
import { UiohookInputSource } from './tracking/inputActivity';
import { registerIpc } from './ipc/handlers';
import { CH } from './ipc/channels';

let win: BrowserWindow | null = null;
let tray: Tray | null = null;

function createWindow(): void {
  win = new BrowserWindow({
    width: 1100, height: 760, show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.on('ready-to-show', () => win?.show());
  win.on('close', (e) => { if (!(app as unknown as { isQuitting?: boolean }).isQuitting) { e.preventDefault(); win?.hide(); } });
  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  else win.loadFile(join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(() => {
  const db = openDatabase(join(app.getPath('userData'), 'worksight.sqlite'));
  const repo = createRepositories(db);
  const enc = {
    encrypt: (s: string) => safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(s) : Buffer.from(s, 'utf8'),
    decrypt: (b: Buffer) => safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(b) : b.toString('utf8')
  };
  const settings = createSettingsStore(db, enc);

  const pushUpdate = (): void => win?.webContents.send(CH.eventsUpdate);
  const tracker = createTracker({
    foreground: new ActiveWinForegroundSource(),
    input: new UiohookInputSource(),
    clock: systemClock,
    repo,
    getSettings: () => settings.get(),
    getSystemIdleSec: () => powerMonitor.getSystemIdleTime(),
    onUpdate: pushUpdate
  });

  registerIpc({ repo, settings, tracker, onTrackingChange: pushUpdate });

  createWindow();

  tray = new Tray(join(__dirname, '../../resources/tray.png'));
  const refreshTrayMenu = (): void => {
    const paused = settings.get().trackingPaused;
    tray?.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open WorkSight', click: () => { if (!win) createWindow(); win?.show(); } },
      { label: paused ? 'Resume tracking' : 'Pause tracking', click: () => { paused ? tracker.start() : tracker.stop(); settings.set({ trackingPaused: !paused }); refreshTrayMenu(); pushUpdate(); } },
      { type: 'separator' },
      { label: 'Quit', click: () => { (app as unknown as { isQuitting?: boolean }).isQuitting = true; app.quit(); } }
    ]));
  };
  refreshTrayMenu();
  tray.setToolTip('WorkSight Agent');

  const s = settings.get();
  if (s.consentGranted && !s.trackingPaused) tracker.start();

  app.on('before-quit', () => { (app as unknown as { isQuitting?: boolean }).isQuitting = true; tracker.stop(); });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

// Keep running in the tray when the window is closed.
app.on('window-all-closed', () => { /* intentionally do not quit */ });
```

- [ ] **Step 2: Add placeholder icons**

Create `apps/agent/resources/tray.png` and `apps/agent/resources/icon.png` as any 256×256 PNG (a solid-color square is fine for MVP). On Windows the tray icon should be a `.png` or `.ico`; a PNG works.

- [ ] **Step 3: Run the app and smoke-test tracking**

Run: `pnpm --filter @worksight/agent dev`
Manual verification:
- Window opens; tray icon appears.
- Switch between 2-3 apps for ~30s, move the mouse, then leave it idle past the threshold.
- Quit via tray. Re-launch with `pnpm --filter @worksight/agent dev`.
Expected: no crashes; the SQLite file exists under the Electron `userData` path. (Data surfaces in the UI in later tasks.)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(agent): wire main process — db, settings, tray, tracker lifecycle"
```

---

## Task 14: Renderer format helpers + IPC client

**Files:**
- Create: `apps/agent/src/renderer/lib/format.ts`, `apps/agent/src/renderer/lib/ipc.ts`
- Test: `apps/agent/src/renderer/lib/format.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/agent/src/renderer/lib/format.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { formatDuration, formatClock, formatPct } from './format';

describe('format', () => {
  it('formats durations', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(125)).toBe('2m 5s');
    expect(formatDuration(3725)).toBe('1h 2m');
  });
  it('formats percent and clock', () => {
    expect(formatPct(50)).toBe('50%');
    expect(typeof formatClock(Date.now())).toBe('string');
    expect(formatClock(null)).toBe('—');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @worksight/agent test`
Expected: FAIL — cannot find module `./format`.

- [ ] **Step 3: Implement**

`apps/agent/src/renderer/lib/format.ts`:
```ts
export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}
export function formatPct(n: number): string { return `${Math.round(n)}%`; }
export function formatClock(ms: number | null): string {
  if (ms === null) return '—';
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
```

`apps/agent/src/renderer/lib/ipc.ts`:
```ts
import type { WorkSightApi } from '../../preload';

declare global { interface Window { worksight: WorkSightApi } }
export const api: WorkSightApi = window.worksight;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @worksight/agent test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(agent): renderer format helpers + ipc client"
```

---

## Task 15: Renderer — consent gate + app shell

**Files:**
- Create: `apps/agent/src/renderer/components/ConsentGate.tsx`
- Modify: `apps/agent/src/renderer/App.tsx`

- [ ] **Step 1: Implement the consent gate**

`apps/agent/src/renderer/components/ConsentGate.tsx`:
```tsx
export function ConsentGate({ onAccept }: { onAccept: () => void }) {
  return (
    <div className="mx-auto max-w-xl p-10">
      <h1 className="text-2xl font-semibold">WorkSight Agent</h1>
      <p className="mt-4 text-sm text-gray-600">This app tracks, locally on this device only:</p>
      <ul className="mt-3 list-disc pl-6 text-sm text-gray-700 space-y-1">
        <li>Which application is in the foreground and for how long</li>
        <li>When apps are opened and closed</li>
        <li>Mouse and keyboard <strong>activity counts</strong> (never what you type — no keylogging, no passwords)</li>
        <li>Active vs idle time</li>
      </ul>
      <p className="mt-3 text-sm text-gray-600">Nothing leaves your machine. You can pause from the tray or clear all data anytime.</p>
      <button onClick={onAccept} className="mt-6 rounded-lg bg-black px-4 py-2 text-white">Start tracking</button>
    </div>
  );
}
```

- [ ] **Step 2: Wire App shell with consent + tab switch**

`apps/agent/src/renderer/App.tsx`:
```tsx
import { useEffect, useState, useCallback } from 'react';
import type { AppSettings } from '../shared/types';
import { api } from './lib/ipc';
import { ConsentGate } from './components/ConsentGate';
import { TodayView } from './components/TodayView';
import { SettingsView } from './components/SettingsView';

export default function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [tab, setTab] = useState<'today' | 'settings'>('today');

  const refreshSettings = useCallback(async () => setSettings(await api.settings.get()), []);
  useEffect(() => { void refreshSettings(); }, [refreshSettings]);

  if (!settings) return <div className="p-8 text-gray-500">Loading…</div>;

  if (!settings.consentGranted) {
    return <ConsentGate onAccept={async () => { await api.settings.set({ consentGranted: true }); await api.tracking.resume(); await refreshSettings(); }} />;
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="flex items-center gap-4 border-b bg-white px-6 py-3">
        <span className="font-semibold">WorkSight</span>
        <nav className="flex gap-2">
          <button onClick={() => setTab('today')} className={`rounded px-3 py-1 text-sm ${tab === 'today' ? 'bg-gray-900 text-white' : 'text-gray-600'}`}>Today</button>
          <button onClick={() => setTab('settings')} className={`rounded px-3 py-1 text-sm ${tab === 'settings' ? 'bg-gray-900 text-white' : 'text-gray-600'}`}>Settings</button>
        </nav>
      </header>
      <main className="p-6">
        {tab === 'today' ? <TodayView /> : <SettingsView settings={settings} onChange={refreshSettings} />}
      </main>
    </div>
  );
}
```

- [ ] **Step 3: Commit (TodayView/SettingsView added next; dev build runs after Task 18)**

```bash
git add -A
git commit -m "feat(agent): consent gate + app shell"
```

---

## Task 16: Renderer — Today view (stat cards, day picker, app table)

**Files:**
- Create: `apps/agent/src/renderer/components/StatCard.tsx`, `apps/agent/src/renderer/components/DayPicker.tsx`, `apps/agent/src/renderer/components/AppTable.tsx`, `apps/agent/src/renderer/components/TodayView.tsx`

- [ ] **Step 1: StatCard + DayPicker + AppTable**

`apps/agent/src/renderer/components/StatCard.tsx`:
```tsx
export function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}
```

`apps/agent/src/renderer/components/DayPicker.tsx`:
```tsx
export function DayPicker({ days, value, onChange }: { days: string[]; value: string; onChange: (d: string) => void }) {
  const options = days.includes(value) ? days : [value, ...days];
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-lg border bg-white px-3 py-1.5 text-sm">
      {options.map((d) => <option key={d} value={d}>{d}</option>)}
    </select>
  );
}
```

`apps/agent/src/renderer/components/AppTable.tsx`:
```tsx
import type { AppUsage } from '../../shared/types';
import { formatDuration, formatClock, formatPct } from '../lib/format';

export function AppTable({ apps }: { apps: AppUsage[] }) {
  if (apps.length === 0) return <div className="rounded-xl border bg-white p-6 text-sm text-gray-500">No activity recorded for this day yet.</div>;
  return (
    <div className="overflow-hidden rounded-xl border bg-white">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr><th className="p-3">Application</th><th className="p-3">Time</th><th className="p-3">Sessions</th><th className="p-3">First open</th><th className="p-3">Last close</th><th className="p-3">Active</th></tr>
        </thead>
        <tbody>
          {apps.map((a) => (
            <tr key={a.appName} className="border-t">
              <td className="p-3 font-medium">{a.appName}</td>
              <td className="p-3">{formatDuration(a.totalSec)}</td>
              <td className="p-3">{a.sessions}</td>
              <td className="p-3">{formatClock(a.firstOpenAt)}</td>
              <td className="p-3">{formatClock(a.lastCloseAt)}</td>
              <td className="p-3">{formatPct(a.activePct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: TodayView (loads summary, subscribes to live updates)**

`apps/agent/src/renderer/components/TodayView.tsx`:
```tsx
import { useEffect, useState, useCallback } from 'react';
import type { DaySummary } from '../../shared/types';
import { api } from '../lib/ipc';
import { formatDuration } from '../lib/format';
import { StatCard } from './StatCard';
import { DayPicker } from './DayPicker';
import { AppTable } from './AppTable';
import { TimePerAppChart } from './TimePerAppChart';
import { ActiveIdleDonut } from './ActiveIdleDonut';
import { AiSummaryCard } from './AiSummaryCard';

const today = (): string => new Date().toISOString().slice(0, 10);

export function TodayView() {
  const [days, setDays] = useState<string[]>([]);
  const [date, setDate] = useState<string>(today());
  const [summary, setSummary] = useState<DaySummary | null>(null);

  const load = useCallback(async (d: string) => {
    setSummary(await api.summary.getDay(d));
    setDays(await api.summary.getAvailableDays());
  }, []);

  useEffect(() => { void load(date); }, [date, load]);
  useEffect(() => api.onUpdate(() => { void load(date); }), [date, load]);

  if (!summary) return <div className="text-gray-500">Loading…</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Today</h2>
        <DayPicker days={days} value={date} onChange={setDate} />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Total tracked" value={formatDuration(summary.totalTrackedSec)} />
        <StatCard label="Active" value={formatDuration(summary.activeSec)} />
        <StatCard label="Idle" value={formatDuration(summary.idleSec)} />
      </div>
      <AiSummaryCard date={date} />
      <div className="grid grid-cols-2 gap-4">
        <TimePerAppChart apps={summary.apps} />
        <ActiveIdleDonut activeSec={summary.activeSec} idleSec={summary.idleSec} />
      </div>
      <AppTable apps={summary.apps} />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @worksight/agent typecheck`
Expected: errors only for the not-yet-created `TimePerAppChart`, `ActiveIdleDonut`, `AiSummaryCard`, `SettingsView` (created in Tasks 17-18). This is expected mid-build.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(agent): today view, stat cards, day picker, app table"
```

---

## Task 17: Renderer — charts + AI summary card

**Files:**
- Create: `apps/agent/src/renderer/components/TimePerAppChart.tsx`, `apps/agent/src/renderer/components/ActiveIdleDonut.tsx`, `apps/agent/src/renderer/components/AiSummaryCard.tsx`

- [ ] **Step 1: Time-per-app bar chart**

`apps/agent/src/renderer/components/TimePerAppChart.tsx`:
```tsx
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import type { AppUsage } from '../../shared/types';

export function TimePerAppChart({ apps }: { apps: AppUsage[] }) {
  const data = apps.slice(0, 8).map((a) => ({ name: a.appName, minutes: Math.round(a.totalSec / 60) }));
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="mb-2 text-sm font-medium">Time per app (minutes)</div>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} layout="vertical" margin={{ left: 24 }}>
          <XAxis type="number" /><YAxis type="category" dataKey="name" width={120} />
          <Tooltip /><Bar dataKey="minutes" fill="#111827" radius={4} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 2: Active/idle donut**

`apps/agent/src/renderer/components/ActiveIdleDonut.tsx`:
```tsx
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

export function ActiveIdleDonut({ activeSec, idleSec }: { activeSec: number; idleSec: number }) {
  const data = [{ name: 'Active', value: activeSec }, { name: 'Idle', value: idleSec }];
  const colors = ['#111827', '#d1d5db'];
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="mb-2 text-sm font-medium">Active vs idle</div>
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie data={data} dataKey="value" innerRadius={60} outerRadius={90}>
            {data.map((_, i) => <Cell key={i} fill={colors[i]} />)}
          </Pie>
          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 3: AI summary card**

`apps/agent/src/renderer/components/AiSummaryCard.tsx`:
```tsx
import { useState } from 'react';
import { api } from '../lib/ipc';

export function AiSummaryCard({ date }: { date: string }) {
  const [text, setText] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function generate() {
    setLoading(true); setNote(null);
    const r = await api.summary.generateAi(date);
    setLoading(false);
    if ('text' in r) { setText(r.text); }
    else { setText(null); setNote(r.error === 'no_key' ? 'AI summary is off. Enable it and add an Anthropic API key in Settings.' : 'Could not generate the summary. Try again.'); }
  }

  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">AI summary</div>
        <button onClick={generate} disabled={loading} className="rounded-lg bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50">
          {loading ? 'Generating…' : 'Generate'}
        </button>
      </div>
      {text && <p className="mt-3 text-sm leading-relaxed text-gray-800">{text}</p>}
      {note && <p className="mt-3 text-sm text-amber-700">{note}</p>}
      {!text && !note && <p className="mt-3 text-sm text-gray-500">Click Generate for a natural-language recap of this day.</p>}
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(agent): charts + ai summary card"
```

---

## Task 18: Renderer — settings view

**Files:**
- Create: `apps/agent/src/renderer/components/SettingsView.tsx`

- [ ] **Step 1: Implement settings view**

`apps/agent/src/renderer/components/SettingsView.tsx`:
```tsx
import { useState } from 'react';
import type { AppSettings } from '../../shared/types';
import { api } from '../lib/ipc';

export function SettingsView({ settings, onChange }: { settings: AppSettings; onChange: () => Promise<void> }) {
  const [apiKey, setApiKey] = useState('');

  async function patch(p: Partial<AppSettings>) { await api.settings.set(p); await onChange(); }

  return (
    <div className="max-w-xl space-y-6">
      <h2 className="text-lg font-semibold">Settings</h2>

      <label className="flex items-center justify-between rounded-xl border bg-white p-4">
        <span className="text-sm">Idle threshold (seconds)</span>
        <input type="number" min={10} defaultValue={settings.idleThresholdSec}
          onBlur={(e) => patch({ idleThresholdSec: Number(e.target.value) })}
          className="w-24 rounded border px-2 py-1 text-sm" />
      </label>

      <label className="flex items-center justify-between rounded-xl border bg-white p-4">
        <span className="text-sm">Capture window titles</span>
        <input type="checkbox" checked={settings.captureWindowTitles}
          onChange={(e) => patch({ captureWindowTitles: e.target.checked })} />
      </label>

      <div className="rounded-xl border bg-white p-4 space-y-3">
        <label className="flex items-center justify-between">
          <span className="text-sm">Enable AI summary</span>
          <input type="checkbox" checked={settings.aiEnabled} onChange={(e) => patch({ aiEnabled: e.target.checked })} />
        </label>
        <div className="flex items-center gap-2">
          <input type="password" placeholder={settings.hasApiKey ? 'Key saved — enter to replace' : 'Anthropic API key'}
            value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="flex-1 rounded border px-2 py-1 text-sm" />
          <button onClick={async () => { await api.settings.setApiKey(apiKey); setApiKey(''); await onChange(); }}
            className="rounded bg-black px-3 py-1 text-sm text-white">Save key</button>
        </div>
        <div className="text-xs text-gray-500">Model: {settings.aiModel}</div>
      </div>

      <button onClick={async () => { if (confirm('Delete all tracked data?')) { await api.data.clearAll(); await onChange(); } }}
        className="rounded-lg border border-red-300 px-4 py-2 text-sm text-red-700">Clear all data</button>
    </div>
  );
}
```

- [ ] **Step 2: Run the full app**

Run: `pnpm --filter @worksight/agent dev`
Manual verification:
- Consent gate → Start tracking.
- Use a few apps; the Today view populates (per-app table, charts, totals) live.
- Settings: toggle capture-titles, set idle threshold, enable AI + save a key, generate an AI summary (or see the fallback note without a key).
- Clear all data empties the Today view.

- [ ] **Step 3: Typecheck + test**

Run: `pnpm --filter @worksight/agent typecheck && pnpm --filter @worksight/agent test`
Expected: typecheck clean; all unit tests pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(agent): settings view + full renderer integration"
```

---

## Task 19: Packaging (electron-builder)

**Files:**
- Create: `apps/agent/electron-builder.yml`

- [ ] **Step 1: Configure electron-builder**

`apps/agent/electron-builder.yml`:
```yaml
appId: ai.worksight.agent
productName: WorkSight Agent
directories:
  output: release
  buildResources: resources
files:
  - out/**/*
  - package.json
asarUnpack:
  - "**/*.node"
win:
  target: nsis
  icon: resources/icon.png
mac:
  target: dmg
  category: public.app-category.productivity
linux:
  target: AppImage
  category: Utility
```

- [ ] **Step 2: Build the Windows installer**

Run: `pnpm --filter @worksight/agent build`
Expected: `electron-vite build` succeeds, then `electron-builder` produces an installer under `apps/agent/release/`. Native modules (`better-sqlite3`, `uiohook-napi`) are rebuilt for Electron by the `prebuild` `install-app-deps` step and unpacked from asar.

- [ ] **Step 3: Install + launch the packaged app (Windows)**

Run the generated installer from `apps/agent/release/`, launch the installed app, accept consent, confirm tracking + the Today view work, then quit from the tray.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "build(agent): electron-builder packaging for win/mac/linux"
```

---

## Task 20: Acceptance verification pass

**Files:** none (verification + fixes only)

- [ ] **Step 1: Run the acceptance checklist against the running app**

For each spec acceptance criterion, verify and check off:
1. Launches on Windows; consent gate shown; tracking starts only after opt-in.
2. Switching foreground apps produces `focus_sessions` with correct durations (±1 poll interval).
3. Mouse/keyboard activity recorded as per-bucket counts; idle detected after threshold; active/idle split shown.
4. `opened` on first foreground; `closed` on process exit (close an app you used and confirm a `closed` row, viewable via Settings → Clear-data confirmation or a DB inspector).
5. Today view shows totals, active/idle, per-app table, and the time-per-app chart.
6. With AI enabled + key set, a paragraph is generated and cached; without a key, the fallback note shows.
7. Data persists across restarts (quit fully via tray, relaunch, pick the same day).
8. Pause/resume (tray) and Clear-all-data (settings) behave correctly.
9. `pnpm --filter @worksight/agent test` and `typecheck` are green; core logic has no Windows-only assumptions.

- [ ] **Step 2: Fix any gaps found, re-running the relevant unit tests after each fix**

For each discrepancy, write/extend a unit test where the logic is testable, fix, and re-run `pnpm --filter @worksight/agent test`.

- [ ] **Step 3: Final verification run**

Run: `pnpm --filter @worksight/agent test && pnpm --filter @worksight/agent typecheck`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(agent): acceptance verification pass + fixes"
```

---

## Self-Review (completed by plan author)

**Spec coverage:** foreground tracking → Tasks 10/11; time-per-app → Task 7; open/close → Tasks 9/10; input activity (counts only) → Tasks 6/10/11; active/idle → Tasks 6/7/10; SQLite persistence → Tasks 2/4/13; structured summary → Tasks 7/16; AI summary + fallback → Tasks 8/12/17; consent/pause/clear → Tasks 13/15/18; privacy (no content, encrypted key) → Tasks 5/11/15; IPC → Task 12; UI (Today/charts/settings/tray) → Tasks 13/15-18; packaging cross-platform → Task 19; acceptance → Task 20. No uncovered requirements.

**Placeholder scan:** No TBD/TODO; every code step contains complete code. The only intentional "expected mid-build" typecheck error is called out in Task 16 Step 3 and resolved by Tasks 17-18.

**Type consistency:** `Repositories` methods (`startFocusSession`, `finalizeFocusSession`, `insertAppEvent`, `insertActivitySample`, `getFocusSessions`, `getActivitySamples`, `getAppEvents`, `getAvailableDays`, `upsertDailySummary`, `getDailySummary`, `clearAll`), `createTracker`/`TrackerDeps`, `isActiveBucket(counts, systemIdleSec, thresholdSec)`, `computeDaySummary(date, sessions, samples)`, `buildSummaryPrompt`/`generateAiSummary`, `CH.*` channels, and the `window.worksight` API shape are consistent across tasks and match `src/shared/types.ts`.
