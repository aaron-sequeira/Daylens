// Verifies an unpacked Windows build (release/win-unpacked): every native part present, no CUDA/ARM/Mac/Linux
// binaries, and the total size under a limit. Run after `dist`, or alone: node scripts/check-build.mjs [dir]
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const NM = 'resources/app/node_modules';
export const REQUIRED = [
  { label: 'Daylens.exe', probe: 'Daylens.exe' },
  { label: 'OCR helper', probe: 'resources/ocr-helper.ps1' },
  { label: 'tray icon', probe: 'resources/tray.png' },
  { label: 'tray icon @2x', probe: 'resources/tray@2x.png' },
  { label: 'window/taskbar icon', probe: 'resources/icon.ico' },
  { label: 'main bundle', probe: 'resources/app/out/main/index.js' },
  { label: 'Laya worker', probe: 'resources/app/out/main/brain.js' },
  { label: 'writer worker', probe: 'resources/app/out/main/writer.js' },
  { label: 'SQLite (better-sqlite3)', probe: `${NM}/better-sqlite3/build/Release/better_sqlite3.node` },
  { label: 'window tracking (active-win)', probe: `${NM}/active-win/lib/binding/napi-6-win32-unknown-x64/node-active-win.node` },
  { label: 'Laya runtime (onnxruntime win32/x64)', probe: `${NM}/onnxruntime-node/bin/napi-v3/win32/x64/onnxruntime_binding.node` },
  { label: 'writer runtime CPU (@node-llama-cpp/win-x64)', probe: `${NM}/@node-llama-cpp/win-x64/package.json` },
  { label: 'writer runtime Vulkan (@node-llama-cpp/win-x64-vulkan)', probe: `${NM}/@node-llama-cpp/win-x64-vulkan/package.json` },
];
export const FORBIDDEN = [
  `${NM}/@node-llama-cpp/win-x64-cuda`, `${NM}/@node-llama-cpp/win-x64-cuda-ext`, `${NM}/@node-llama-cpp/win-arm64`,
  `${NM}/onnxruntime-node/bin/napi-v3/darwin`, `${NM}/onnxruntime-node/bin/napi-v3/linux`, `${NM}/onnxruntime-node/bin/napi-v3/win32/arm64`,
];
const FORBIDDEN_PREFIX = [`${NM}/@node-llama-cpp/linux-`, `${NM}/@node-llama-cpp/mac-`];
export const MAX_BYTES = 900 * 1024 * 1024;

function sizeOf(dir, perTop, top) {
  let total = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    const n = e.isDirectory() ? sizeOf(p, perTop, top ?? p) : statSync(p).size;
    total += n;
    if (!e.isDirectory() && top) perTop.set(top, (perTop.get(top) ?? 0) + n);
  }
  return total;
}

export function checkBuild(root, { maxBytes = MAX_BYTES } = {}) {
  if (!existsSync(root)) return { ok: false, problems: [`no build at ${root} — run \`dist\` first`], bytes: 0 };
  const problems = [];
  for (const r of REQUIRED) if (!existsSync(join(root, r.probe))) problems.push(`missing: ${r.label} (${r.probe})`);
  for (const f of FORBIDDEN) if (existsSync(join(root, f))) problems.push(`should not ship: ${f}`);
  const scoped = join(root, NM, '@node-llama-cpp');
  if (existsSync(scoped)) for (const d of readdirSync(scoped)) {
    const rel = `${NM}/@node-llama-cpp/${d}`;
    if (FORBIDDEN_PREFIX.some((p) => rel.startsWith(p))) problems.push(`should not ship: ${rel}`);
  }
  const perTop = new Map();
  const nm = join(root, NM);
  const bytes = sizeOf(root, new Map(), null);
  if (bytes > maxBytes) {
    if (existsSync(nm)) sizeOf(nm, perTop, null);
    const biggest = [...perTop.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([d, n]) => `  ${(n / 1048576).toFixed(1)} MB  ${relative(root, d)}`).join('\n');
    problems.push(`too big: ${(bytes / 1048576).toFixed(0)} MB > ${(maxBytes / 1048576).toFixed(0)} MB. Largest:\n${biggest}`);
  }
  return { ok: problems.length === 0, problems, bytes };
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)).toLowerCase() === resolve(process.argv[1]).toLowerCase()) {
  const dir = process.argv[2] ?? join(fileURLToPath(new URL('..', import.meta.url)), 'release', 'win-unpacked');
  const r = checkBuild(dir);
  console.log(r.ok ? `[check-build] OK — ${(r.bytes / 1048576).toFixed(0)} MB` : `[check-build] FAILED\n${r.problems.join('\n')}`);
  process.exit(r.ok ? 0 : 1);
}
