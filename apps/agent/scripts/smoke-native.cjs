// Headless Electron smoke: loads the native modules under Electron's ABI and exits.
// Run with: ./node_modules/.bin/electron apps/agent/scripts/smoke-native.cjs
const { app } = require('electron');
const timeout = setTimeout(() => { console.error('SMOKE_FAIL timeout'); app.exit(3); }, 8000);
app.whenReady().then(() => {
  try {
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    db.exec('CREATE TABLE t(x)');
    db.prepare('INSERT INTO t VALUES (1)').run();
    const n = db.prepare('SELECT count(*) AS c FROM t').get().c;
    require('uiohook-napi'); // load-only check (do not start global hooks)
    clearTimeout(timeout);
    console.log('SMOKE_OK better-sqlite3 + uiohook-napi loaded under Electron ABI; rows=' + n);
    app.exit(0);
  } catch (e) {
    clearTimeout(timeout);
    console.error('SMOKE_FAIL ' + (e && e.message ? e.message : e));
    app.exit(1);
  }
});
