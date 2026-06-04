// Dev-only helper to drive the runtime end-to-end check against the real userData DB.
// Usage: node scripts/db-util.cjs <reset|seed|inspect>
const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');

const dir = path.join(process.env.APPDATA || process.env.HOME, 'WorkSight Agent');
const dbPath = path.join(dir, 'worksight.sqlite');
const mode = process.argv[2];

// --- formatting + rollup helpers (mirror src/main/summary/rollup.ts) ---
function fmtDur(sec) {
  sec = Math.round(sec || 0);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? h + 'h ' : '') + ((h || m) ? m + 'm ' : '') + s + 's';
}
function fmtClock(ms) {
  if (ms == null) return '--:--';
  const d = new Date(ms);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function bucketSec(s) { return Math.max(0, Math.round((s.bucket_end - s.bucket_start) / 1000)); }
function computeDaySummary(date, sessions, samples) {
  const totalTrackedSec = sessions.reduce((a, s) => a + (s.duration_sec ?? 0), 0);
  const activeSec = samples.filter((s) => s.active === 1).reduce((a, s) => a + bucketSec(s), 0);
  const idleSec = Math.max(0, totalTrackedSec - activeSec);
  const byApp = new Map();
  for (const s of sessions) {
    const u = byApp.get(s.app_name) ?? { appName: s.app_name, totalSec: 0, sessions: 0, firstOpenAt: null, lastCloseAt: null, activePct: 0 };
    u.totalSec += s.duration_sec ?? 0;
    u.sessions += 1;
    u.firstOpenAt = u.firstOpenAt === null ? s.started_at : Math.min(u.firstOpenAt, s.started_at);
    if (s.ended_at !== null) u.lastCloseAt = u.lastCloseAt === null ? s.ended_at : Math.max(u.lastCloseAt, s.ended_at);
    byApp.set(s.app_name, u);
  }
  const appBuckets = new Map();
  for (const s of samples) {
    if (!s.app_name) continue;
    const b = appBuckets.get(s.app_name) ?? { active: 0, total: 0 };
    const dur = bucketSec(s);
    b.total += dur;
    if (s.active === 1) b.active += dur;
    appBuckets.set(s.app_name, b);
  }
  for (const u of byApp.values()) {
    const b = appBuckets.get(u.appName);
    u.activePct = b && b.total > 0 ? Math.round((b.active / b.total) * 100) : 0;
  }
  const apps = [...byApp.values()].sort((a, b) => b.totalSec - a.totalSec);
  return { date, totalTrackedSec, activeSec, idleSec, apps };
}

if (mode === 'reset') {
  try { fs.rmSync(dir, { recursive: true, force: true }); console.log('reset: removed ' + dir); }
  catch (e) { console.log('reset error: ' + e.message); }
} else if (mode === 'seed') {
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(dbPath);
  db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)');
  db.prepare("INSERT INTO settings (key, value) VALUES ('consent_granted','true') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
  console.log('seed: consent_granted=true at ' + dbPath);
  db.close();
} else if (mode === 'inspect') {
  const db = new Database(dbPath);
  const c = (t) => { try { return db.prepare(`SELECT count(*) AS n FROM ${t}`).get().n; } catch (e) { return 'ERR:' + e.message; } };
  console.log('focus_sessions=' + c('focus_sessions') + ' activity_samples=' + c('activity_samples') + ' app_events=' + c('app_events'));
  const sample = db.prepare('SELECT app_name, duration_sec FROM focus_sessions ORDER BY started_at DESC LIMIT 3').all();
  console.log('recent sessions: ' + JSON.stringify(sample));
  const ev = db.prepare('SELECT type, count(*) AS n FROM app_events GROUP BY type').all();
  console.log('app_events by type: ' + JSON.stringify(ev));
  db.close();
} else if (mode === 'summary') {
  const db = new Database(dbPath);
  const date = process.argv[3] || (db.prepare('SELECT MAX(date) AS d FROM focus_sessions').get() || {}).d;
  if (!date) { console.log('summary: no tracked data yet'); db.close(); process.exit(0); }
  const sessions = db.prepare('SELECT app_name, started_at, ended_at, duration_sec FROM focus_sessions WHERE date = ?').all(date);
  const samples = db.prepare('SELECT bucket_start, bucket_end, active, app_name FROM activity_samples WHERE date = ?').all(date);
  const sum = computeDaySummary(date, sessions, samples);
  const activePct = sum.totalTrackedSec ? Math.round((sum.activeSec / sum.totalTrackedSec) * 100) : 0;
  console.log(`\n=== WorkSight Daily Summary (${sum.date}) ===`);
  console.log(`Total tracked: ${fmtDur(sum.totalTrackedSec)}   Active: ${fmtDur(sum.activeSec)}   Idle: ${fmtDur(sum.idleSec)}   (${activePct}% active)`);
  console.log(`Apps used: ${sum.apps.length}    Focus sessions: ${sessions.length}\n`);
  for (const a of sum.apps) {
    console.log(`  ${a.appName.padEnd(24)} ${fmtDur(a.totalSec).padStart(9)}   ${String(a.sessions).padStart(2)} sess   ${fmtClock(a.firstOpenAt)}–${fmtClock(a.lastCloseAt)}   ${a.activePct}% active`);
  }
  // Deterministic natural-language summary (the no-API-key fallback form).
  const top = sum.apps[0];
  if (top) {
    console.log(`\nNarrative: You tracked ${fmtDur(sum.totalTrackedSec)} across ${sum.apps.length} app${sum.apps.length === 1 ? '' : 's'} on ${sum.date}. ` +
      `Most time went to ${top.appName} (${fmtDur(top.totalSec)})` +
      (sum.apps[1] ? `, followed by ${sum.apps[1].appName} (${fmtDur(sum.apps[1].totalSec)})` : '') +
      `. You were active ${activePct}% of the tracked time.`);
  }
  db.close();
} else {
  console.log('usage: node scripts/db-util.cjs <reset|seed|inspect|summary [date]>');
}
