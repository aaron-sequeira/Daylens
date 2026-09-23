// Puts better-sqlite3 on Electron's ABI before `dev`/`build`.
// uiohook-napi ships multi-ABI NAPI prebuilds (node-gyp-build) and needs no rebuild.
// (`pretest` flips better-sqlite3 back to the Node ABI for vitest.)
// electron-builder's `install-app-deps` can't resolve native deps under pnpm, so we
// fetch the prebuilt Electron binary straight into the hoisted load location instead.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const electronVersion = require('electron/package.json').version;
const bsqDir = path.dirname(require.resolve('better-sqlite3/package.json'));
const prebuildInstall = require.resolve('prebuild-install/bin.js');

console.log(`[rebuild-native] better-sqlite3 -> Electron ${electronVersion} (${bsqDir})`);
execFileSync(
  process.execPath,
  [prebuildInstall, '--runtime', 'electron', '--target', electronVersion, '--dist-url', 'https://electronjs.org/headers'],
  { cwd: bsqDir, stdio: 'inherit' }
);
console.log('[rebuild-native] done.');
