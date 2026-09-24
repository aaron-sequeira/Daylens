// Dev-only: measures ocr-helper.ps1 cold start and per-image latency on a live primary-screen capture.
// The capture stays in memory (base64 over pipes); nothing is written to disk.
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const RUNS = 20;
const helper = fileURLToPath(new URL('../resources/ocr-helper.ps1', import.meta.url));

if (process.argv[2] === 'capture') {
  // Captures whatever window is in front. Prints METADATA ONLY (never the OCR text: it may be private).
  const p = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', helper], { stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = createInterface({ input: p.stdout });
  const next = () => new Promise((res) => lines.once('line', (l) => res(JSON.parse(l))));
  const ready = await next();
  console.log('ready', ready);
  if (!ready.ready) process.exit(1);
  const walls = [];
  for (let i = 0; i < 10; i++) {
    const s = Date.now();
    p.stdin.write(`${i} CAPTURE\n`);
    const r = await next();
    walls.push(Date.now() - s);
    console.log(r.error ? `#${i} error=${r.error}` : `#${i} pid=${r.pid} ${r.w}x${r.h} chars=${r.text.length} titleChars=${r.title.length} helperMs=${r.ms}`);
  }
  p.stdin.end();
  walls.sort((a, b) => a - b);
  console.log(`median ${walls[5]} ms, max ${walls[9]} ms`);
  process.exit(0);
}

const capture = [
  'Add-Type -AssemblyName System.Windows.Forms,System.Drawing',
  '$b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds',
  '$bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height',
  '$g=[System.Drawing.Graphics]::FromImage($bmp)',
  '$g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size)',
  '$ms=New-Object System.IO.MemoryStream',
  '$bmp.Save($ms,[System.Drawing.Imaging.ImageFormat]::Png)',
  'Write-Output "$($b.Width)x$($b.Height) $([Convert]::ToBase64String($ms.ToArray()))"'
].join('; ');
const [size, png] = execFileSync('powershell', ['-NoProfile', '-Command', capture], { maxBuffer: 256 * 1024 * 1024 }).toString().trim().split(' ');
console.log(`capture ${size}, ${(png.length / 1e6).toFixed(1)} MB base64`);

const t0 = Date.now();
const p = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', helper], { stdio: ['pipe', 'pipe', 'inherit'] });
const lines = createInterface({ input: p.stdout });
const next = () => new Promise((res) => lines.once('line', (l) => res(JSON.parse(l))));

const ready = await next();
console.log('ready', ready, `cold start ${Date.now() - t0} ms`);
if (!ready.ready) process.exit(1);

const wall = [];
let first;
for (let i = 0; i < RUNS; i++) {
  const s = Date.now();
  p.stdin.write(`${i} ${png}\n`);
  const r = await next();
  if (r.error) { console.error('error', r.error); process.exit(1); }
  wall.push(Date.now() - s);
  first ??= r;
}
p.stdin.end();
wall.sort((a, b) => a - b);
console.log(`median ${wall[Math.floor(RUNS / 2)]} ms, p90 ${wall[Math.floor(RUNS * 0.9)]} ms (target median < 400 ms)`);
console.log(`text metadata: ${first.text.length} chars, ${first.text.split('\n').length} lines`);
