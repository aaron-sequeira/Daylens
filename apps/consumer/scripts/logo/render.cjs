// Rasterises the Sunrise marks into the icon files. Run with Electron (not Node): `pnpm --filter @worksight/consumer logo`.
// A hidden window only — this never starts Daylens itself.
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
    return (await painted(px)).resize({ width: size, height: size, quality: 'best' }).toPNG();
  };
  // loadURL resolves before the first paint, and a hidden window gives no reliable paint signal: retry the capture
  // until it holds a real frame (non-empty, and the tile's centre pixel is opaque), failing loudly after ~2 s so a
  // slow machine can never write blank icons.
  const painted = async (px) => {
    for (let i = 0; i < 40; i++) {
      const img = await win.webContents.capturePage({ x: 0, y: 0, width: px, height: px });
      const { width, height } = img.getSize(); // physical pixels: may differ from px under display scaling
      if (width > 0 && height > 0 && img.toBitmap()[((height >> 1) * width + (width >> 1)) * 4 + 3] === 255) return img;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`[logo] no painted frame at ${px}px`);
  };
  const entries = [];
  for (const size of [16, 24, 32, 48]) entries.push({ size, data: await png(SMALL, size) });
  for (const size of [64, 128, 256]) entries.push({ size, data: await png(FULL, size) });
  writeFileSync(join(res, 'icon.ico'), buildIco(entries));
  writeFileSync(join(res, 'icon.png'), entries.find((e) => e.size === 256).data);
  writeFileSync(join(res, 'tray.png'), entries.find((e) => e.size === 16).data); // same small-mark renders as the .ico
  writeFileSync(join(res, 'tray@2x.png'), entries.find((e) => e.size === 32).data);
  console.log('[logo] wrote icon.ico, icon.png, tray.png, tray@2x.png, logo-*.svg, logoPaths.ts');
  app.quit();
}).catch((e) => { console.error(e); app.exit(1); });
