// Generates valid 32x32 RGBA PNG placeholder icons (solid WorkSight blue) for the
// tray and app icon. Deterministic, no external deps. Replace with branded art later.
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

const W = 32, H = 32;
const raw = Buffer.alloc(H * (1 + W * 4));
for (let y = 0; y < H; y++) {
  raw[y * (1 + W * 4)] = 0; // filter byte 0 (None)
  for (let x = 0; x < W; x++) {
    const o = y * (1 + W * 4) + 1 + x * 4;
    raw[o] = 37; raw[o + 1] = 99; raw[o + 2] = 235; raw[o + 3] = 255; // #2563eb opaque
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // color type RGBA
// ihdr[10..12] = 0 (compression, filter, interlace)

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0))
]);

const dir = path.join(__dirname, '..', 'resources');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'tray.png'), png);
fs.writeFileSync(path.join(dir, 'icon.png'), png);
console.log('wrote tray.png and icon.png (' + png.length + ' bytes each)');
