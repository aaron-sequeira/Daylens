// Packs PNG images into a Windows .ico (PNG-compressed entries, valid since Windows Vista).
/** @param {{ size: number, data: Buffer }[]} images */
export function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = 6 + 16 * images.length;
  images.forEach((img, i) => {
    const o = i * 16, dim = img.size >= 256 ? 0 : img.size; // 256 is stored as 0
    dir.writeUInt8(dim, o); dir.writeUInt8(dim, o + 1);
    dir.writeUInt8(0, o + 2); dir.writeUInt8(0, o + 3); // no palette, reserved
    dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6); // planes, bits per pixel
    dir.writeUInt32LE(img.data.length, o + 8); dir.writeUInt32LE(offset, o + 12);
    offset += img.data.length;
  });
  return Buffer.concat([header, dir, ...images.map((i) => i.data)]);
}
