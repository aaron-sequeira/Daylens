// Generates valid RGBA PNG icons (no external deps): a small tray.png (32px) and a
// 256px icon.png for the installer (electron-builder requires win icons >= 256x256).
// Motif: WorkSight-blue field with a white "target" ring + center dot (tracking).
// Deterministic. Replace with branded art later.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

// Background #2563eb, white target ring + center dot.
function px(size, x, y) {
  const c = (size - 1) / 2;
  const n = Math.hypot(x - c, y - c) / (size / 2); // 0 at center, ~1 at edge
  const white = (n > 0.55 && n < 0.72) || n < 0.22;
  return white ? [255, 255, 255, 255] : [37, 99, 235, 255];
}

function makePng(size) {
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 4)] = 0; // filter byte 0 (None)
    for (let x = 0; x < size; x++) {
      const o = y * (1 + size * 4) + 1 + x * 4;
      const [r, g, b, a] = px(size, x, y);
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const dir = path.join(__dirname, '..', 'resources');
fs.mkdirSync(dir, { recursive: true });
const tray = makePng(32);
const icon = makePng(256);
fs.writeFileSync(path.join(dir, 'tray.png'), tray);
fs.writeFileSync(path.join(dir, 'icon.png'), icon);
console.log(`wrote tray.png (32px, ${tray.length} bytes) and icon.png (256px, ${icon.length} bytes)`);
