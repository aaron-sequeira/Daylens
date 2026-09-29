// Rasterises the Sunrise marks into the icon files. Run with Electron (not Node): `pnpm --filter @worksight/consumer logo`.
// Offscreen windows only — this never starts Daylens itself.
const { app, BrowserWindow } = require('electron');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const { FULL, SMALL, markSvg, writeSources } = await import('./sunrise.mjs');
  const { buildIco } = await import('./ico.mjs');
  const res = join(__dirname, '..', '..', 'resources');
  writeSources();
  const SCALE = 4; // draw 4x, then downscale with the best filter: smooth edges at 16 px
  // Offscreen capturePage returned blank/empty buffers after the first render (see task-1-report.md),
  // so this uses a normal hidden window instead — still never shown, still not the Daylens app.
  const win = new BrowserWindow({ show: false, transparent: true, frame: false, webPreferences: {} });
  win.setBackgroundColor('#00000000');
  const png = async (mark, size) => {
    const px = size * SCALE;
    win.setContentSize(px, px);
    const html = `<html><body style="margin:0;background:transparent;overflow:hidden">${markSvg(mark, { size: px })}</body></html>`;
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    // Let the page actually paint before capturing (loadURL resolves on did-finish-load, before paint).
    await new Promise((resolve) => setTimeout(resolve, 150));
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: px, height: px });
    return img.resize({ width: size, height: size, quality: 'best' }).toPNG();
  };
  const entries = [];
  for (const size of [16, 24, 32, 48]) entries.push({ size, data: await png(SMALL, size) });
  for (const size of [64, 128, 256]) entries.push({ size, data: await png(FULL, size) });
  writeFileSync(join(res, 'icon.ico'), buildIco(entries));
  writeFileSync(join(res, 'icon.png'), entries.find((e) => e.size === 256).data);
  writeFileSync(join(res, 'tray.png'), await png(SMALL, 16));
  writeFileSync(join(res, 'tray@2x.png'), await png(SMALL, 32));
  console.log('[logo] wrote icon.ico, icon.png, tray.png, tray@2x.png, logo-*.svg, logoPaths.ts');
  app.quit();
});
