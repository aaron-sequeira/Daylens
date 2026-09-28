# Daylens Phase 6b — Insights, Report Search, PDF Auto-save + Email, Live AI Tips — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a weekly Insights tab (numbers from code plus an AI week summary), full-text search over past reports, an optional daily PDF auto-save plus an "Email" draft button, and AI-written tip pop-ups when memory allows — all on top of the merged 6a writer/report pipeline.

**Architecture:** New pure modules under `src/main/report/`:
- `search.ts`: FTS5 index plus query sanitiser.
- `share.ts`: auto-save path and mailto builder.
- `week.ts`: Insights numbers, the weekly store, and the week prompt/schema.

New pure modules under `src/main/coach/`:
- `tip.ts`: tip input and the tip schema.

The existing report scheduler learns a second job key form (`W:<weekStart>`), so daily and weekly writes stay one-at-a-time with labelling. The coach engine gains an optional `rewrite` dep that is used only for `stuck_tip` and `repeat_search`.

The renderer adds:
- an **Insights** rail tab;
- a search box and an Email button on Reports;
- a Settings → Reports section.

**Tech Stack:** Electron 33 (dialog, shell, BrowserWindow.printToPDF), better-sqlite3 (bundled SQLite with FTS5), React 19, TypeScript 5.7, zod 3, Vitest 2, node-llama-cpp via the existing writer.

**Spec:** `docs/superpowers/specs/2026-09-26-daylens-phase6-reports-writer-design.md` §6 (6.1–6.4), §7, §8 (6b rows). Builds on the merged 6a code (main 738f7e6).

**Deliberate deltas (plan rulings):**
- **Weekly jobs:** these run through the existing report scheduler as the key `W:<weekStart>`, rather than through a second scheduler. This keeps one job at a time without new coordination.
- **Search index is derived data:** it is backfilled from every ready report at startup and cleared by Delete my activity. It is not included in Export.
- **Tip rewriting never runs while a report/week job or a labelling batch is running:** it falls back to the template instead, so two model processes never exist at once.
- **The week AI input uses the same privacy rule as daily reports:** titles are allowed in the cloud; screen text and local headlines are never sent.

## Global Constraints

- Branch `feat/daylens-phase6b`. Commit messages end with a blank line then a `Co-Authored-By:` trailer naming the authoring model. Never stage `.codex/`.
- Tests: `cd apps/consumer && ELECTRON_RUN_AS_NODE=1 ../../node_modules/electron/dist/electron.exe ../../node_modules/vitest/vitest.mjs run [path]` (works whether or not Daylens is running). Typecheck `pnpm -r typecheck`; build `pnpm --filter @worksight/consumer exec electron-vite build`.
- Never print screen/OCR text, window titles from the real DB, or model output. Never kill processes you did not start. Don't launch the app or load a model unless the task says so.
- **Weeks:** Monday–Sunday in local time. `weekStart(date)` is that week's Monday as `YYYY-MM-DD`.
- **WeekJson:** `headline ≤ 80`, `summary ≤ 600`, `focusForNextWeek ≤ 200`. Over-long strings are cut, not rejected. The voice normaliser and numeric grounding apply, as for daily reports.
- **Weekly auto-run:** after the week's Sunday report is ready, or on the first run in the following week. Only when the week has ≥ 3 days with ≥ 30 min screen time and has no weekly row. It uses the same gate, battery rule and failure behaviour as daily reports; a failed week is retried only by hand.
- **Search:** FTS5 table `report_fts(date UNINDEXED, body)`.
  - `body` = headline, story, wins, habits, doBetter what/better, advice, plan text and top app names.
  - Results are newest first, max 50, with FTS5 `snippet()`.
  - The query is sanitised into quoted terms, so no user input reaches FTS syntax.
- **PDF auto-save:** setting `reportPdfFolder` ('' = off). Each ready or regenerated report writes `<folder>/Daylens-YYYY-MM-DD.pdf`, overwriting any existing file. Failure never blocks a report; it shows a Settings warning.
- **Email:**
  - `mailto:?subject=Daylens — <date>&body=<headline + up to 3 story sentences>`, encoded, ≤ 1800 chars total.
  - The PDF comes from the auto-save folder, else a temp export.
  - `shell.showItemInFolder(pdf)`.
- **Live AI tips:**
  - Only `stuck_tip` and `repeat_search`.
  - Rewritten only when the writer is usable and either cloud mode is on, or the local model is installed with free RAM ≥ writer need.
  - Never while a report/week job or a labelling batch runs.
  - 20 s cap; template on any failure.
  - `TipJson = { title ≤ 60, body ≤ 180 }`.
  - The nudge keeps its rule/key, so cooldowns, back-off and "Show fewer" are unchanged.
- **Privacy:** the cloud gets titles, never screen text or local headlines. Tip input titles pass the user's exclusion patterns.

## Review Focus

1. **Search input with FTS syntax** (quotes, `*`, `-`, `NEAR`, `:`) must never throw or return odd matches; empty input returns nothing. → sanitiser tests in Task 1.
2. **An auto-save folder that was deleted, is read-only, or sits on an unplugged drive:** the report is still saved, and Settings shows why the PDF wasn't. → `autoSavePdf` failure test in Task 2.
3. **A tip pop-up waiting on a slow writer:** it must show within about 20 s (the template) and never block other pop-ups for longer. → engine rewrite-timeout test in Task 6.
4. **A week with little data** (new user, holiday): no automatic week summary and no empty narrative. The numbers still show. → `weekDue` threshold test in Task 4.
5. **Delete my activity** must also clear the search index and weekly reports. → store tests in Tasks 1 and 3.

---

### Task 1: Report search (FTS5 index, IPC, Reports search box)

**Files:**
- Create: `apps/consumer/src/main/report/search.ts`, `search.test.ts`
- Modify: `apps/consumer/src/main/index.ts` (create the index, backfill at startup, upsert after a ready report, IPC), `apps/consumer/src/main/ipc.ts`, `channels.ts`, `apps/consumer/src/preload/index.ts`, `apps/consumer/src/main/screen/store.ts` (Delete my activity clears `report_fts`), `apps/consumer/src/renderer/components/ReportsScreen.tsx`, `apps/consumer/src/renderer/styles.css`

**Interfaces:**
- Consumes: `ReportJson` (`report/schema.ts`), `ReportStore.get/dates` (`report/store.ts`).
- Produces:
  ```ts
  export const REPORT_FTS_SQL: string;
  export function reportBody(r: ReportJson, topApps: string[]): string;
  export function ftsQuery(raw: string): string | null;          // null = nothing searchable
  export interface SearchHit { date: string; snippet: string; }
  export interface ReportSearch { upsert(date: string, body: string): void; remove(date: string): void; search(raw: string): SearchHit[]; clear(): void; count(): number; }
  export function createReportSearch(db: Database.Database): ReportSearch;
  ```
  Channel `reportsSearch: 'reports:search'` (string ≤ 200 chars) → `SearchHit[]`; preload `api.reports.search(q)`.

- [ ] **Step 1: Failing test** — `search.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { createReportSearch, ftsQuery, REPORT_FTS_SQL, reportBody } from './search';
import type { ReportJson } from './schema';

const rep = (o: Partial<ReportJson> = {}): ReportJson => ({ headline: 'A focused morning', story: 'You fixed the Figma export bug.', wins: ['Shipped the pill'], habits: ['Late YouTube'],
  doBetter: [{ candidateId: 'stuck:e1', what: 'Stuck on a TypeError', better: 'Read the stack first' }], plan: [{ kind: 'wind_down', text: 'Bed by 23:00', payload: { time: '23:00' } }], advice: 'Rest more.', ...o });
const mk = () => { const db = new Database(':memory:'); db.exec(REPORT_FTS_SQL); return createReportSearch(db); };

describe('report search', () => {
  it('builds a searchable body from the report text and top apps', () => {
    const b = reportBody(rep(), ['Figma', 'Code']);
    for (const w of ['focused', 'Figma export', 'Shipped', 'YouTube', 'TypeError', 'stack', 'Bed by', 'Rest', 'Code']) expect(b).toContain(w);
  });
  it('sanitises queries into quoted prefix terms and rejects empty ones', () => {
    expect(ftsQuery('figma bug')).toBe('"figma"* "bug"*');
    expect(ftsQuery('  "quote" OR -x NEAR(a b) col:val * ')).toBe('"quote"* "OR"* "x"* "NEAR"* "a"* "b"* "col"* "val"*');
    expect(ftsQuery('')).toBeNull();
    expect(ftsQuery('  ** -- ')).toBeNull();
  });
  it('finds reports newest first with a highlighted snippet, and upsert replaces', () => {
    const s = mk();
    s.upsert('2026-09-20', reportBody(rep({ story: 'You worked in Figma all day.' }), []));
    s.upsert('2026-09-25', reportBody(rep({ story: 'Figma again, then YouTube.' }), []));
    s.upsert('2026-09-22', reportBody(rep({ story: 'Only email today.', headline: 'Quiet', wins: [], habits: [], doBetter: [], plan: [], advice: 'x' }), []));
    const hits = s.search('figma');
    expect(hits.map((h) => h.date)).toEqual(['2026-09-25', '2026-09-20']);
    expect(hits[0].snippet).toMatch(/\[Figma\]/i);
    s.upsert('2026-09-25', reportBody(rep({ story: 'Nothing relevant.', headline: 'H', wins: [], habits: [], doBetter: [], plan: [], advice: 'a' }), []));
    expect(s.search('figma').map((h) => h.date)).toEqual(['2026-09-20']);
  });
  it('never throws on FTS syntax, caps at 50, and clears', () => {
    const s = mk();
    for (let i = 1; i <= 60; i++) s.upsert(`2026-07-${String((i % 28) + 1).padStart(2, '0')}-${i}`, 'figma');
    expect(() => s.search('"unterminated')).not.toThrow();
    expect(() => s.search('a AND OR NOT')).not.toThrow();
    expect(s.search('figma').length).toBeLessThanOrEqual(50);
    s.clear();
    expect(s.count()).toBe(0);
    expect(s.search('')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to confirm failure.**

- [ ] **Step 3: Implement `search.ts`**
```ts
import type Database from 'better-sqlite3';
import type { ReportJson } from './schema';

export const REPORT_FTS_SQL = `CREATE VIRTUAL TABLE IF NOT EXISTS report_fts USING fts5(date UNINDEXED, body, tokenize = 'unicode61');`;
export interface SearchHit { date: string; snippet: string; }
export interface ReportSearch { upsert(date: string, body: string): void; remove(date: string): void; search(raw: string): SearchHit[]; clear(): void; count(): number; }

export function reportBody(r: ReportJson, topApps: string[]): string {
  return [r.headline, r.story, ...r.wins, ...r.habits, ...r.doBetter.flatMap((d) => [d.what, d.better]), r.advice, ...r.plan.map((p) => p.text), ...topApps].join('\n');
}

/** Words only, each quoted with a prefix star, so no user input can reach FTS5 query syntax. */
export function ftsQuery(raw: string): string | null {
  const terms = (raw.normalize('NFKC').match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 12);
  return terms.length ? terms.map((t) => `"${t}"*`).join(' ') : null;
}

export function createReportSearch(db: Database.Database): ReportSearch {
  const del = db.prepare('DELETE FROM report_fts WHERE date = ?');
  const ins = db.prepare('INSERT INTO report_fts (date, body) VALUES (?, ?)');
  const find = db.prepare(`SELECT date, snippet(report_fts, 1, '[', ']', '…', 12) AS snippet FROM report_fts WHERE report_fts MATCH ? ORDER BY date DESC LIMIT 50`);
  const upsert = db.transaction((date: string, body: string) => { del.run(date); ins.run(date, body); });
  return {
    upsert: (date, body) => { upsert(date, body); },
    remove: (date) => { del.run(date); },
    search(raw) {
      const q = ftsQuery(raw);
      if (!q) return [];
      try { return find.all(q) as SearchHit[]; } catch (e) { console.error('[search] query failed:', String(e).slice(0, 80)); return []; }
    },
    clear: () => { db.exec('DELETE FROM report_fts'); },
    count: () => (db.prepare('SELECT count(*) AS n FROM report_fts').get() as { n: number }).n
  };
}
```

- [ ] **Step 4: Wire it up**
  - **index.ts:** after `db.exec(REPORT_SQL)`, run `db.exec(REPORT_FTS_SQL)` and create `const reportSearch = createReportSearch(db)`.
  - **Backfill:** once at startup, for every `reportStore.dates()` with a ready row, upsert `reportBody(row.report, topAppsFor(date))`. `topAppsFor` = the top 5 `appName`s from `pastDay(date).detail.apps` or the day view. Wrap it in try/catch.
  - **After a ready report:** in the scheduler's `generate` dep, when the outcome is `'ok'`, upsert the fresh row.
  - **Delete my activity:** in `screen/store.ts` `deleteActivity`, add `if (hasTable(db, 'report_fts')) db.exec('DELETE FROM report_fts;')`. Add a store test that creates the table, inserts a row, deletes, and gets 0 rows.
  - **IPC** `reports:search` (zod: `z.string().max(200)`) → `reportSearch.search(q)`.
  - **ReportsScreen:** a search input in the header (`aria-label="Search reports"`, debounced 250 ms). While results exist, show a dropdown list of `date label — snippet`. Render the snippet with `[`/`]` turned into `<mark>`: split on the brackets and never use `dangerouslySetInnerHTML`. Clicking a result navigates to that date and clears the search. Escape closes it. Hide it in print.
  - **Styles:** `.rep-search`, `.rep-hits`, `mark` (lavender background).

- [ ] **Step 5: Verify + commit** — focused tests, the whole suite, typecheck, build.
```bash
git add apps/consumer/src
git commit -m "feat(consumer): search past reports (FTS5) from the Reports screen"
```

---

### Task 2: PDF auto-save and Email

**Files:**
- Create: `apps/consumer/src/main/report/share.ts`, `share.test.ts`, `apps/consumer/src/renderer/components/ReportsSettings.tsx`
- Modify: `apps/consumer/src/main/settings.ts` (key `reportPdfFolder: ''`, not in settingsPatch), `index.ts`, `ipc.ts`, `channels.ts`, `preload/index.ts`, `renderer/components/SettingsScreen.tsx` (mount after WriterSection), `ReportsScreen.tsx` (Email button), `styles.css`

**Interfaces:**
- Consumes: `exportPdf`, `pdfFileName` (`windows/reportPdf.ts`), `renderReportPdf` (`windows/reportPdfElectron.ts`), `ReportJson`.
- Produces:
  ```ts
  export function autoSavePath(folder: string, date: string): string;               // join(folder, pdfFileName(date))
  export function mailtoUrl(date: string, r: ReportJson | null): string;            // ≤ 1800 chars
  export async function autoSavePdf(date: string, folder: string, deps: { render(date: string): Promise<Buffer>; write(p: string, b: Buffer): Promise<void>; exists(dir: string): Promise<boolean> }): Promise<'ok' | 'off' | string>;
  ```
  Channels:
  - `reportsChoosePdfFolder: 'reports:choosePdfFolder'` → `{ folder: string }` (dialog `openDirectory`; unchanged on cancel)
  - `reportsClearPdfFolder: 'reports:clearPdfFolder'`
  - `reportsShareGet: 'reports:shareGet'` → `{ folder: string; lastError: string | null }`
  - `reportsEmail: 'reports:email'` (date) → `{ ok: true } | { ok: false; reason: string }`

  Preload `api.reports.{ choosePdfFolder, clearPdfFolder, shareGet, email }`.

- [ ] **Step 1: Failing test** — `share.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { autoSavePath, autoSavePdf, mailtoUrl } from './share';
import type { ReportJson } from './schema';

const rep: ReportJson = { headline: 'A focused morning', story: 'One. Two! Three? Four.', wins: [], habits: [], doBetter: [], plan: [], advice: 'a' };
describe('share', () => {
  it('builds the auto-save path', () => { expect(autoSavePath('C:\\Reports', '2026-09-26')).toMatch(/Reports[\\/]Daylens-2026-09-26\.pdf$/); });
  it('builds an encoded mailto with the headline and up to three sentences', () => {
    const u = mailtoUrl('2026-09-26', rep);
    expect(u.startsWith('mailto:?subject=')).toBe(true);
    const body = decodeURIComponent(u.split('&body=')[1]);
    expect(decodeURIComponent(u.split('subject=')[1].split('&')[0])).toBe('Daylens — 2026-09-26');
    expect(body).toContain('A focused morning');
    expect(body).toContain('One. Two! Three?');
    expect(body).not.toContain('Four');
    expect(mailtoUrl('2026-09-26', { ...rep, story: 'x'.repeat(5000) }).length).toBeLessThanOrEqual(1800);
    expect(decodeURIComponent(mailtoUrl('2026-09-26', null).split('&body=')[1])).toMatch(/Daylens report/);
  });
  it('auto-saves, reports off, and reports failures without throwing', async () => {
    const written: string[] = [];
    const deps = { render: async () => Buffer.from('%PDF'), write: async (p: string) => { written.push(p); }, exists: async () => true };
    expect(await autoSavePdf('2026-09-26', '', deps)).toBe('off');
    expect(await autoSavePdf('2026-09-26', 'C:\\R', deps)).toBe('ok');
    expect(written[0]).toMatch(/Daylens-2026-09-26\.pdf$/);
    expect(await autoSavePdf('2026-09-26', 'C:\\Gone', { ...deps, exists: async () => false })).toMatch(/folder/i);
    expect(await autoSavePdf('2026-09-26', 'C:\\R', { ...deps, write: async () => { throw new Error('EACCES: permission denied'); } })).toMatch(/permission/i);
  });
});
```

- [ ] **Step 2: Run to confirm failure.**

- [ ] **Step 3: Implement `share.ts`**
```ts
import { join } from 'node:path';
import { pdfFileName } from '../windows/reportPdf';
import type { ReportJson } from './schema';

const MAILTO_MAX = 1800;
export const autoSavePath = (folder: string, date: string): string => join(folder, pdfFileName(date));

export function mailtoUrl(date: string, r: ReportJson | null): string {
  const subject = `Daylens — ${date}`;
  const sentences = (r?.story.match(/[^.!?]+[.!?]+/g) ?? []).slice(0, 3).map((s) => s.trim()).join(' ');
  let body = r ? `${r.headline}\n\n${sentences}\n\n(The full report is attached as a PDF.)` : `Daylens report for ${date} (PDF attached).`;
  const make = (b: string): string => `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(b)}`;
  while (make(body).length > MAILTO_MAX && body.length > 40) body = `${body.slice(0, Math.floor(body.length * 0.9)).trimEnd()}…`;
  return make(body);
}

export async function autoSavePdf(date: string, folder: string, deps: { render(date: string): Promise<Buffer>; write(p: string, b: Buffer): Promise<void>; exists(dir: string): Promise<boolean> }): Promise<'ok' | 'off' | string> {
  if (!folder) return 'off';
  try {
    if (!(await deps.exists(folder))) return "The auto-save folder can't be found.";
    await deps.write(autoSavePath(folder, date), await deps.render(date));
    return 'ok';
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return /EACCES|EPERM|permission/i.test(m) ? "Daylens doesn't have permission to save in that folder." : "The PDF couldn't be saved to the auto-save folder.";
  }
}
```

- [ ] **Step 4: Wire it up**
  - **Settings:** add `reportPdfFolder: ''` to DEFAULT_SETTINGS. It is not in settingsPatch.
  - **index.ts:**
    - Keep `let pdfFolderError: string | null = null`.
    - After a report becomes ready (the scheduler `generate` dep, outcome `'ok'`), run `void autoSavePdf(date, settings.get().reportPdfFolder, { render, write: writeFile, exists: (d) => stat(d).then((s) => s.isDirectory(), () => false) })`. Set `pdfFolderError` to `null` on `'ok'`/`'off'`, else to the returned text.
    - Never await this inside the scheduler's critical path: run it after `generate` returns.
    - Reuse the render deps already used by `exportPdf`.
  - **IPC:**
    - `choosePdfFolder`: `dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] })`; on OK, `settings.set({ reportPdfFolder })`.
    - `clearPdfFolder`: sets `''`.
    - `shareGet`: returns `{ folder, lastError: pdfFolderError }`.
    - `email(date)` (zod date):
      1. Get the PDF path: the auto-save file if the folder is set and the file exists, else render to `join(app.getPath('temp'), pdfFileName(date))`.
      2. `shell.openExternal(mailtoUrl(date, reportStore.get(date)?.report ?? null))`.
      3. `shell.showItemInFolder(pdf)`.
      4. Return `{ ok: true }`, or `{ ok: false, reason: short text }` on error.
  - **`ReportsSettings.tsx`:** a "Reports" group.
    - Row "Auto-save PDFs": shows the folder or "Off", with a "Choose folder…" button and a "Turn off" button (when set).
    - If `lastError`, show a warning line with `role="alert"`, pink background.
    - Mount it in SettingsScreen after `<WriterSection />`.
  - **ReportsScreen header:** an "Email" button next to Export PDF, hidden in print. Show a status line on failure.

- [ ] **Step 5: Verify + commit**
```bash
git add apps/consumer/src
git commit -m "feat(consumer): auto-save daily PDFs to a folder and open an email draft"
```

---

### Task 3: Weekly Insights data, weekly store and week writer contract

**Files:**
- Create: `apps/consumer/src/main/report/week.ts`, `week.test.ts`
- Modify: `apps/consumer/src/main/screen/store.ts` (delete + export `weekly_reports`), `store.test.ts`

**Interfaces:**
- Consumes: `groundNumbers`, `normalizeVoice` (report/schema.ts). Check their exact signatures and adapt the parse wrapper: `normalizeVoice` may be typed for ReportJson, in which case add a small string-level `normalizeVoiceText(s)` export there and reuse it.
- Produces:
  ```ts
  export const weekStart: (date: string) => string;                 // Monday of that week (local)
  export const weekDates: (start: string) => string[];              // 7 dates Mon..Sun
  export interface InsightsDay { date: string; screenSec: number; byCategory: Record<string, number>; healthScore: number | null; deepWorkSec: number; }
  export interface InsightsNumbers { weekStart: string; days: InsightsDay[]; totals: { screenSec: number; deepWorkSec: number; avgHealth: number | null; activeDays: number };
    prev: { screenSec: number; deepWorkSec: number } | null; bestFocusDay: string | null; topApps: { app: string; min: number }[]; nudges: { acted: number; dismissed: number }; }
  export function buildInsights(i: { weekStart: string; days: InsightsDay[]; prevDays: InsightsDay[] | null; apps: { app: string; min: number }[][]; nudges: { status: string }[] }): InsightsNumbers;
  export interface WeekJson { headline: string; summary: string; focusForNextWeek: string; }
  export const WEEK_JSON_SCHEMA: Record<string, unknown>;
  export function parseWeek(raw: unknown): WeekJson | null;
  export interface WeekInput { weekStart: string; days: { date: string; screenMin: number; deepWorkMin: number; healthScore: number | null; topApps: string[]; topSites: string[]; headline?: string }[];
    totals: { screenMin: number; deepWorkMin: number; activeDays: number; prevScreenMin: number | null } }
  export function buildWeekInput(n: InsightsNumbers, perDay: { topApps: string[]; topSites: string[]; headline?: string }[]): WeekInput;
  export function weekForCloud(w: WeekInput): WeekInput;            // drops headlines
  export function weekPrompt(w: WeekInput): { system: string; user: string };
  export function weekAllowedMinutes(w: WeekInput): number[];
  export const WEEKLY_SQL: string;
  export interface WeeklyRow { weekStart: string; status: 'pending' | 'ready' | 'failed'; report: WeekJson | null; model: string | null; generatedAt: number | null; error: string | null; }
  export interface WeeklyStore { get(ws: string): WeeklyRow | null; setPending(ws: string, now: number): void; setReady(ws: string, r: WeekJson, model: string, now: number): void;
    setFailed(ws: string, error: string, now: number): void; noteError(ws: string, error: string): void; delete(ws: string): void; clearPending(now: number): void; }
  export function createWeeklyStore(db: Database.Database): WeeklyStore;
  ```

- [ ] **Step 1: Failing tests** — `week.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { buildInsights, buildWeekInput, createWeeklyStore, parseWeek, weekAllowedMinutes, weekDates, weekForCloud, WEEKLY_SQL, weekStart, type InsightsDay } from './week';

const day = (date: string, h: number, deep = 0, score: number | null = 80): InsightsDay => ({ date, screenSec: h * 3600, byCategory: { work: h * 3600 }, healthScore: score, deepWorkSec: deep * 60 });
describe('week helpers', () => {
  it('finds Monday and the 7 dates', () => {
    expect(weekStart('2026-09-28')).toBe('2026-09-28'); // a Monday
    expect(weekStart('2026-10-04')).toBe('2026-09-28'); // Sunday
    expect(weekStart('2026-09-30')).toBe('2026-09-28');
    expect(weekDates('2026-09-28')).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
  });
  it('builds insight numbers: totals, previous week, best focus day, top apps, nudges', () => {
    const days = [day('2026-09-28', 6, 90), day('2026-09-29', 4, 30), day('2026-09-30', 0, 0, null), day('2026-10-01', 5, 120), day('2026-10-02', 2), day('2026-10-03', 0, 0, null), day('2026-10-04', 1)];
    const n = buildInsights({ weekStart: '2026-09-28', days, prevDays: [day('2026-09-21', 10, 60)],
      apps: [[{ app: 'Code', min: 200 }, { app: 'Chrome', min: 60 }], [{ app: 'Chrome', min: 100 }]], nudges: [{ status: 'acted' }, { status: 'dismissed' }, { status: 'acted' }, { status: 'expired' }] });
    expect(n.totals).toEqual({ screenSec: 18 * 3600, deepWorkSec: 240 * 60, avgHealth: 80, activeDays: 5 });
    expect(n.prev).toEqual({ screenSec: 10 * 3600, deepWorkSec: 3600 });
    expect(n.bestFocusDay).toBe('2026-10-01');
    expect(n.topApps).toEqual([{ app: 'Code', min: 200 }, { app: 'Chrome', min: 160 }]);
    expect(n.nudges).toEqual({ acted: 2, dismissed: 1 });
    expect(buildInsights({ weekStart: '2026-09-28', days: days.map((d) => ({ ...d, deepWorkSec: 0 })), prevDays: null, apps: [], nudges: [] }).bestFocusDay).toBeNull();
  });
  it('parses the week JSON with cuts and rejects a missing headline', () => {
    expect(parseWeek({ headline: 'h'.repeat(120), summary: 's'.repeat(900), focusForNextWeek: 'f'.repeat(300) })).toEqual({ headline: 'h'.repeat(80), summary: 's'.repeat(600), focusForNextWeek: 'f'.repeat(200) });
    expect(parseWeek({ headline: '', summary: 's', focusForNextWeek: 'f' })).toBeNull();
    expect(parseWeek('x')).toBeNull();
  });
  it('builds the writer input in minutes, strips headlines for the cloud, and lists allowed minutes', () => {
    const n = buildInsights({ weekStart: '2026-09-28', days: [day('2026-09-28', 2, 30), ...weekDates('2026-09-28').slice(1).map((d) => day(d, 0, 0, null))], prevDays: null, apps: [], nudges: [] });
    const w = buildWeekInput(n, weekDates('2026-09-28').map(() => ({ topApps: ['Code'], topSites: ['GitHub'], headline: 'Local headline' })));
    expect(w.days[0]).toMatchObject({ screenMin: 120, deepWorkMin: 30, topApps: ['Code'], headline: 'Local headline' });
    expect(w.totals).toMatchObject({ screenMin: 120, deepWorkMin: 30, activeDays: 1, prevScreenMin: null });
    expect(weekForCloud(w).days.every((d) => d.headline === undefined)).toBe(true);
    expect(weekAllowedMinutes(w)).toEqual(expect.arrayContaining([120, 30]));
  });
  it('stores weekly rows and fails pending rows on restart', () => {
    const db = new Database(':memory:'); db.exec(WEEKLY_SQL);
    const s = createWeeklyStore(db);
    s.setPending('2026-09-28', 1);
    expect(s.get('2026-09-28')).toMatchObject({ status: 'pending' });
    s.setReady('2026-09-28', { headline: 'H', summary: 'S', focusForNextWeek: 'F' }, 'Qwen3 1.7B', 2);
    expect(s.get('2026-09-28')).toMatchObject({ status: 'ready', report: { headline: 'H' }, model: 'Qwen3 1.7B' });
    s.noteError('2026-09-28', 'busy');
    expect(s.get('2026-09-28')).toMatchObject({ status: 'ready', error: 'busy' });
    s.setPending('2026-10-05', 3); s.clearPending(4);
    expect(s.get('2026-10-05')).toMatchObject({ status: 'failed', error: 'interrupted' });
    s.delete('2026-10-05'); expect(s.get('2026-10-05')).toBeNull();
  });
});
```
Also extend `screen/store.test.ts`: `deleteActivity` empties `weekly_reports`; Export includes `weeklyReports`.

- [ ] **Step 2: Run to confirm failure.**

- [ ] **Step 3: Implement `week.ts`** — pure helpers:
  - **`weekStart` / `weekDates`:** local-date arithmetic via `shiftDate` from day/time.ts. JS `getDay()` is 0 for Sunday, so Monday offset = `(getDay() + 6) % 7`.
  - **`buildInsights`:**
    - Totals are summed; `activeDays` = days with screenSec ≥ 1800.
    - `avgHealth` = rounded mean of non-null scores, else null.
    - `prev` is summed from prevDays, or null.
    - `bestFocusDay` = argmax deepWorkSec when > 0.
    - `topApps` merges the per-day lists by app, sorted desc, top 8.
    - `nudges` counts 'acted' and 'dismissed' only.
  - **Store:** mirror `report/store.ts` (the upsert pattern, guarded JSON.parse, and 'ready' with corrupt JSON → 'failed' 'corrupt report').
    ```sql
    CREATE TABLE IF NOT EXISTS weekly_reports (week_start TEXT PRIMARY KEY, status TEXT NOT NULL CHECK (status IN ('pending','ready','failed')), report_json TEXT, model TEXT, generated_at INTEGER, error TEXT);
    ```
  - **`WEEK_JSON_SCHEMA`:** an object with three string properties with maxLength 80/600/200, all required.
  - **`weekPrompt` system text:**
    - Second-person voice, no emoji or markdown.
    - Use only the numbers given.
    - Headline: the week in one line.
    - Summary: 3–5 sentences comparing the days and the previous week.
    - focusForNextWeek: one concrete suggestion.
    - It appends the same "Reply with only one JSON object matching this JSON schema" line the daily writer uses. Check `writer.ts`, which may already add it for every job; don't double it.
  - **`weekAllowedMinutes`:** every screenMin/deepWorkMin/total/prev value.

  `screen/store.ts`:
  - Delete my activity: `if (hasTable(db, 'weekly_reports')) db.exec('DELETE FROM weekly_reports;')`.
  - Export: `weeklyReports: hasTable(...) ? SELECT * ORDER BY week_start : []`.

- [ ] **Step 4: Verify + commit**
```bash
git add apps/consumer/src/main/report/week.ts apps/consumer/src/main/report/week.test.ts apps/consumer/src/main/screen/store.ts apps/consumer/src/main/screen/store.test.ts
git commit -m "feat(consumer): weekly insight numbers, week writer contract and weekly store"
```

---

### Task 4: Weekly generation through the report scheduler, Insights IPC

**Files:**
- Modify: `apps/consumer/src/main/report/scheduler.ts`, `scheduler.test.ts`, `apps/consumer/src/main/report/generate.ts` (add `generateWeek`), `generate.test.ts`, `apps/consumer/src/main/index.ts`, `ipc.ts`, `channels.ts`, `preload/index.ts`

**Interfaces:**
- Consumes: Task 3 exports; the existing `createReportScheduler`, `Writer`, `friendlyReason`.
- Produces:
  - A scheduler dep `weekDue(): string | null` that returns `'W:<weekStart>'` or null. `autoDue` checks daily first, then `weekDue()`. The `generate(key)` dep receives either a date or a `W:` key. `request/cancel/queued` accept both.
  - `export async function generateWeek(ws: string, deps: { build(ws: string): { input: WeekInput }; writer: Writer; store: WeeklyStore; now(): number; epoch(): number; cloud(): boolean }): Promise<GenerateOutcome>` — the same failure and epoch behaviour as `generateReport`. The parse applies voice + `groundNumbers`-equivalent logic with `weekAllowedMinutes`. It uses `weekForCloud` when `cloud()`.
  - `export const WEEK_MIN_ACTIVE_DAYS = 3;`
  - `export function weekDueKey(i: { today: string; hasWeekly(ws: string): boolean; activeDays(ws: string): number; sundayReady(ws: string): boolean }): string | null;` — pure. Last week's key is due when it has no row and `activeDays(lastWs) ≥ 3`. The current week is due only when today is Sunday, `sundayReady(currentWs)`, it has no row, and it has ≥ 3 active days.
  - IPC:
    - `insightsGet: 'insights:get'` (weekStart | null → current week) → `InsightsView = { numbers: InsightsNumbers; weekStart; prevWeek: string | null; nextWeek: string | null; row: WeeklyRow | null; writer: WriterState; waiting: boolean; running: boolean; queued: boolean }`;
    - `insightsGenerate: 'insights:generate'` (weekStart);
    - `insightsCancel: 'insights:cancel'`.
  - Preload `api.insights.{ get, generate, cancel }`.

- [ ] **Step 1: Failing tests**
  - `weekDueKey`:
    - last week with 3 active days and no row → `'W:<lastWs>'`;
    - 2 active days → null;
    - row exists → null;
    - Sunday with the Sunday report ready and 4 active days → the current week key;
    - Sunday without the report → null.
  - `scheduler.test.ts`: after the daily jobs are done, a `weekDue` key runs through `generate`. A manual `request('W:2026-09-28')` runs. Mutual exclusion and the gate apply to week keys too.
  - `generate.test.ts` `generateWeek`:
    - writes 'ready' with the grounded summary;
    - a failure keeps a previous ready week and notes the error;
    - an epoch change stores nothing;
    - cloud strips headlines: the build input seen by the writer has no headline fields.

- [ ] **Step 2: Run to confirm failure.**

- [ ] **Step 3: Implement.**
  - **Scheduler:** keep the key opaque. Add the `weekDue` dep and call it at the end of `autoDue`. `canWrite`/gates are unchanged.
  - **index.ts:**
    - `db.exec(WEEKLY_SQL)`, `createWeeklyStore`, and `clearPending` at startup.
    - `generate` dep: if `key.startsWith('W:')`, call `generateWeek(key.slice(2), …)`, else the existing daily path, which also upserts search and auto-saves the PDF (Tasks 1–2).
    - `build(ws)`:
      - For each date of the week: `pastDay(d)` (screenSec, detail), the health score from `loadTodayView(...)` or a cached day view, and deepWorkSec. Add `deepWorkSec` to the `pastDay` cache; it's computed from `buildEpisodes(readsForDay(d), false)` with `deepWorkSec(...)`.
      - `prevDays` for the previous week.
      - Top apps per day come from detail.apps, and top sites from detail.sites.
      - Headlines come from ready daily rows.
      - Nudges: `coachStore.since(start)` filtered to the week's dates.
      - Then `buildInsights` → `buildWeekInput`.
    - `weekDue`: `weekDueKey({ today, hasWeekly: (ws) => !!weeklyStore.get(ws), activeDays: (ws) => weekDates(ws).filter((d) => pastDay(d).screenSec >= 1800).length, sundayReady: (ws) => reportStore.get(weekDates(ws)[6])?.status === 'ready' })`. For the current week, today's screen time uses the live view, not the cache.
    - The Insights IPC is built like `reportView`. prev/next week arrows: next is null for the current week, prev is always available back to the oldest available day's week.
    - "Delete my activity" leaves the weekly_reports clearing to deleteActivity (Task 3); bump `reportEpoch` as it already does.

- [ ] **Step 4: Verify + commit**
```bash
git add apps/consumer/src
git commit -m "feat(consumer): weekly summaries through the report scheduler, Insights IPC"
```

---

### Task 5: Insights screen

**Files:**
- Create: `apps/consumer/src/renderer/components/InsightsScreen.tsx`, `apps/consumer/src/renderer/lib/insights.ts`, `insights.test.ts`
- Modify: `renderer/components/Rail.tsx` (Route `'insights'`, icon), `Icon.tsx` (icon `insights`: `<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />`), `App.tsx`, `styles.css`

**Interfaces:**
- Consumes: `api.insights.*`, `InsightsView`, `CloudSetup`, `formatHm`, `CATEGORY_LABEL`, the existing report card styles.
- Produces: `weekLabel(weekStart: string, today: string): string` ("This week", "Last week", or "22–28 Sep"); `deltaText(now: number, prev: number | null): string` ("↑ 12% vs last week" / "↓ 5% vs last week" / "same as last week" / "" when prev null or 0); `summaryCardKind(v: InsightsView): 'summary' | 'writing' | 'waiting' | 'failed' | 'download' | 'cloud_offer' | 'notEnough' | 'generate'` — `notEnough` when `numbers.totals.activeDays < 3` and there is no row.

- [ ] **Step 1: Failing test** — `insights.test.ts` for the three helpers:
  - week labels across a month boundary ("29 Sep – 5 Oct");
  - deltas: 0 prev → "", equal → "same as last week";
  - card precedence: summary > writing > waiting > cloud_offer > failed > download > notEnough > generate.

- [ ] **Step 2: Run to confirm failure.**

- [ ] **Step 3: Implement.** Screen layout, reusing the Reports visual language:
  - **Header:** ← `weekLabel` →.
  - **Summary card:** per `summaryCardKind`. The summary shows the headline, summary paragraph and "Focus for next week". Other states mirror the Reports cards: Generate, the waiting line with need/free GB and Cancel, CloudSetup for cloud_offer, and "Not enough tracked days yet this week" for notEnough.
  - **Stat tiles:**
    - screen time with `deltaText`;
    - deep work with delta;
    - average health score;
    - active days;
    - pop-ups acted on / dismissed.
  - **"Your week":** 7 stacked bars by category (Mon–Sun, pastel category colours, `aria-label` with day + time), plus a small health-score line (inline SVG polyline over the 7 days, with null days skipped).
  - **Best focus day** callout, and **Top apps** with bars.
  - Every number comes from `view.numbers`. Reduced motion disables grow-ins.
  - Add the Rail button after Reports, and `App.tsx` routes `'insights'` to `<InsightsScreen />`.

- [ ] **Step 4: Verify + commit**
```bash
git add apps/consumer/src/renderer
git commit -m "feat(consumer): weekly Insights screen"
```

---

### Task 6: AI-written live tips

**Files:**
- Create: `apps/consumer/src/main/coach/tip.ts`, `tip.test.ts`
- Modify: `apps/consumer/src/main/coach/engine.ts`, `engine.test.ts`, `apps/consumer/src/main/index.ts`

**Interfaces:**
- Consumes: `Candidate`, `Snapshot`, `Writer`, `isExcluded`, `parseExclusions`, `normalizeVoiceText`/`groundNumbers` helpers (Task 3 note), `writerNeedBytes`.
- Produces:
  ```ts
  export const REWRITE_RULES: ReadonlySet<string>;                  // 'stuck_tip', 'repeat_search'
  export interface TipInput { ruleId: string; app: string; title: string | null; episode: { minutes: number; category: string | null; activity: string | null; avgStuck: number }; template: { title: string; body: string } }
  export function tipInput(c: Candidate, snap: Snapshot, exclusions: string[]): TipInput;
  export interface TipJson { title: string; body: string }
  export const TIP_JSON_SCHEMA: Record<string, unknown>;
  export function parseTip(raw: unknown): TipJson | null;          // title ≤ 60, body ≤ 180, voice-normalised; null if either is empty
  export function tipPrompt(t: TipInput): { system: string; user: string };
  // engine.ts: CoachDeps gains optional `rewrite?(c: Candidate, snap: Snapshot): Promise<Candidate>`
  ```

- [ ] **Step 1: Failing tests**
  - `tip.test.ts`:
    - `tipInput` takes app/title from the latest read in `snap.readsToday`, and title is null when excluded or a private window.
    - episode minutes come from that app's consecutive reads in the last 30 min.
    - `parseTip` cuts to 60/180, rejects empty strings, and rewrites "I"/"my" to "you"/"your".
    - `tipPrompt` includes the template and asks for one short, practical, kind suggestion in second person.
  - `engine.test.ts`:
    - (a) a `stuck_tip` candidate is shown with the rewritten title/body when `rewrite` resolves;
    - (b) a `goal_80` candidate is never passed to `rewrite`;
    - (c) `rewrite` rejecting leaves the template shown;
    - (d) `rewrite` is called only after the gate says show and there's no hold: a held tip is never rewritten;
    - (e) the recorded nudge keeps the original `ruleId`/`key`.

- [ ] **Step 2: Run to confirm failure.**

- [ ] **Step 3: Implement.**
  - **engine.ts:** just before `d.record(c, 'shown', now)`, if `d.rewrite && REWRITE_RULES.has(c.ruleId)`, then `c = await d.rewrite(c, snap).catch(() => c)`, keeping `ruleId`, `key`, `kind` and `primary` from the original.
  - **index.ts:** the `rewrite` dep:
    1. Return `c` straight away if any of these hold:
       - the writer can't be used: local mode without the model installed, or cloud mode without a key;
       - `reportScheduler.running() !== null`;
       - the label scheduler is running;
       - local mode and `freemem() < writerNeedBytes(tier)`.
    2. Otherwise build the `TipInput`, `writer.write({ kind: 'tip', system, user, schema: TIP_JSON_SCHEMA, maxTokens: 160, parse: parseTip })` inside `Promise.race` with a 20 s timeout. `LOCAL_TIMEOUT_MS.tip` is already 20 s; keep an outer race so a slow cloud call can't exceed it.
    3. On success return `{ ...c, title, body }`, else `c`.
    4. Never log tip text.
    - The coach tick already serialises (the `coaching` flag), so at most one tip rewrite is in flight.
  - The PillNudge uses the rewritten title/body; the stored nudge title/body can be the rewritten text too.

- [ ] **Step 4: Verify + commit**
```bash
git add apps/consumer/src/main/coach apps/consumer/src/main/index.ts
git commit -m "feat(consumer): AI-written tip pop-ups when memory allows, template otherwise"
```

---

### Task 7: Verification

- [ ] **Step 1:** The whole consumer suite (fallback runner), core suite, `pnpm -r typecheck`, build.
- [ ] **Step 2 (controller):** headless harness screenshots (stubbed `window.daylens`) of:
  - the Insights screen (summary state, notEnough state);
  - the Reports search dropdown;
  - the Settings → Reports section (with and without the warning).

  Delete the harness afterwards.
- [ ] **Step 3 (human, real app):**
  - search a word from an old report and open it;
  - choose an auto-save folder, regenerate, and check the PDF appears;
  - click Email: a mail draft opens and the folder shows the PDF;
  - open Insights for this week and last week, and generate a week summary with cloud or when memory allows;
  - when a "stuck" tip fires with enough memory or cloud mode, it reads like a personal suggestion; otherwise it shows the template.
