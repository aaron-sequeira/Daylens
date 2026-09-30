// Renders website/index.html headless (Electron offscreen) and checks what a visitor would hit:
// - at 1440, 1280, 1200, 1024 and 390 px wide: no sideways scroll, and the floating windows and sticker stay inside
//   the viewport (body clips overflow, so a window hanging off an edge would just look cut off);
// - with main.js blocked: every section still becomes visible;
// - clicking "watch with sound" twice keeps the visitor on the page with one player.
// Saves full-page desktop/phone screenshots to <outDir>; with --og also writes the 1200×630 share image.
// Run: node_modules/electron/dist/electron.exe scripts/check-site-render.cjs <outDir> [--og]
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2).filter((a) => !a.startsWith('--') && !a.endsWith('.cjs'));
const outDir = args[args.length - 1];
const wantOg = process.argv.includes('--og');
const page = path.join(__dirname, '..', 'website', 'index.html');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {}); // checks run one window at a time; don't quit between them
process.on('unhandledRejection', (e) => { console.error(e); app.exit(1); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function paint(win, minHeight) {
  return new Promise((resolve) => {
    const onPaint = (_e, _dirty, img) => {
      if (!img.isEmpty() && img.getSize().height >= minHeight) { win.webContents.off('paint', onPaint); resolve(img); }
    };
    win.webContents.on('paint', onPaint);
    win.webContents.invalidate();
  });
}

const open = async (width, height, partition) => {
  const win = new BrowserWindow({ width, height, show: false, enableLargerThanScreen: true, webPreferences: { offscreen: true, partition } });
  return win;
};

async function layout(width, shotName) {
  const win = await open(width, 900);
  await win.loadFile(page);
  await wait(900);
  const m = await win.webContents.executeJavaScript(`document.fonts.ready.then(() => {
    const cw = document.documentElement.clientWidth;
    const out = [...document.querySelectorAll('.float, .sticker')].map((e) => { const r = e.getBoundingClientRect(); return { c: e.className, l: Math.round(r.left), r: Math.round(r.right) }; })
      .filter((x) => x.l < 0 || x.r > cw);
    return { sw: document.documentElement.scrollWidth, iw: innerWidth, sh: document.documentElement.scrollHeight, out };
  })`);
  const ok = m.sw <= m.iw && m.out.length === 0;
  console.log(`${width}px: scrollWidth ${m.sw}${m.out.length ? `, outside the viewport: ${m.out.map((o) => `${o.c} [${o.l}, ${o.r}]`).join('; ')}` : ''} → ${ok ? 'OK' : 'FAIL'}`);
  if (shotName) {
    const full = Math.min(m.sh, 9000);
    win.setSize(width, full);
    await wait(1600); // reveals and the sunrise finish
    fs.writeFileSync(path.join(outDir, `${shotName}.png`), (await paint(win, Math.min(full, 1000))).toPNG());
  }
  win.destroy();
  return ok;
}

async function withoutMainJs() {
  const win = await open(1440, 5000, 'check-no-main-js');
  win.webContents.session.webRequest.onBeforeRequest((d, cb) => cb({ cancel: /main\.js$/.test(d.url) }));
  await win.loadFile(page);
  await wait(3500);
  const hidden = await win.webContents.executeJavaScript(
    "[...document.querySelectorAll('.reveal')].filter((e) => getComputedStyle(e).opacity !== '1').length");
  console.log(`main.js blocked: ${hidden} section(s) still hidden → ${hidden === 0 ? 'OK' : 'FAIL'}`);
  win.destroy();
  return hidden === 0;
}

async function reelTwice() {
  const win = await open(1440, 900);
  let navigated = false;
  win.webContents.on('will-navigate', (e) => { navigated = true; e.preventDefault(); });
  await win.loadFile(page);
  await wait(500);
  const videos = await win.webContents.executeJavaScript(
    "(async () => { const a = document.querySelector('[data-play-reel]'); a.click(); await new Promise((r) => setTimeout(r, 200)); a.click(); await new Promise((r) => setTimeout(r, 300)); return document.querySelectorAll('.reel-media video').length; })()");
  const ok = !navigated && videos === 1;
  console.log(`reel clicked twice: navigated=${navigated}, players=${videos} → ${ok ? 'OK' : 'FAIL'}`);
  win.destroy();
  return ok;
}

async function og() {
  const win = await open(1200, 630);
  await win.loadFile(page);
  await win.webContents.executeJavaScript('document.fonts.ready');
  await wait(2000);
  fs.writeFileSync(path.join(__dirname, '..', 'website', 'assets', 'og.png'), (await paint(win, 630)).toPNG());
  win.destroy();
  console.log('wrote website/assets/og.png');
}

app.whenReady().then(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const results = [
    await layout(1440, 'desktop'), await layout(1280), await layout(1200), await layout(1024), await layout(390, 'phone'),
    await withoutMainJs(), await reelTwice()
  ];
  if (wantOg) await og();
  app.exit(results.every(Boolean) ? 0 : 1);
});
