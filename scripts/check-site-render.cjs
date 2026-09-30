// Renders website/index.html headless (Electron offscreen) at desktop and phone widths: fails if either width
// scrolls sideways, saves full-page screenshots to <outDir>, and with --og writes the 1200×630 share image.
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
app.on('window-all-closed', () => {}); // renders run one window at a time; don't quit between them
process.on('unhandledRejection', (e) => { console.error(e); app.exit(1); });

function paint(win, minHeight) {
  return new Promise((resolve) => {
    const onPaint = (_e, _dirty, img) => {
      if (!img.isEmpty() && img.getSize().height >= minHeight) { win.webContents.off('paint', onPaint); resolve(img); }
    };
    win.webContents.on('paint', onPaint);
    win.webContents.invalidate();
  });
}

async function render(width, name) {
  const win = new BrowserWindow({ width, height: 900, show: false, enableLargerThanScreen: true, webPreferences: { offscreen: true } });
  await win.loadFile(page);
  const m = await win.webContents.executeJavaScript(
    'document.fonts.ready.then(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, sh: document.documentElement.scrollHeight }))');
  const ok = m.sw <= m.iw;
  console.log(`${name} ${m.iw}px: scrollWidth ${m.sw} → ${ok ? 'OK' : 'HORIZONTAL SCROLL'}`);
  const full = Math.min(m.sh, 9000);
  win.setSize(width, full);
  await new Promise((r) => setTimeout(r, 1600)); // reveals and the sunrise finish
  fs.writeFileSync(path.join(outDir, `${name}.png`), (await paint(win, Math.min(full, 1000))).toPNG());
  win.destroy();
  return ok;
}

async function og() {
  const win = new BrowserWindow({ width: 1200, height: 630, show: false, webPreferences: { offscreen: true } });
  await win.loadFile(page);
  await win.webContents.executeJavaScript('document.fonts.ready');
  await new Promise((r) => setTimeout(r, 2000));
  fs.writeFileSync(path.join(__dirname, '..', 'website', 'assets', 'og.png'), (await paint(win, 630)).toPNG());
  win.destroy();
  console.log('wrote website/assets/og.png');
}

app.whenReady().then(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const results = [await render(1440, 'desktop'), await render(390, 'phone')];
  if (wantOg) await og();
  app.exit(results.every(Boolean) ? 0 : 1);
});
