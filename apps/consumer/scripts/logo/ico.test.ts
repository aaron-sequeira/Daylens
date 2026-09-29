import { describe, it, expect } from 'vitest';
import { buildIco } from './ico.mjs';

const png = (n: number) => Buffer.from([0x89, 0x50, 0x4e, 0x47, ...Array(n).fill(n)]);

describe('buildIco', () => {
  it('writes the ICONDIR header, one 16-byte entry per image, then the PNG bytes in order', () => {
    const a = png(3), b = png(5);
    const ico = buildIco([{ size: 16, data: a }, { size: 256, data: b }]);
    expect(ico.readUInt16LE(0)).toBe(0); // reserved
    expect(ico.readUInt16LE(2)).toBe(1); // type: icon
    expect(ico.readUInt16LE(4)).toBe(2); // count
    // entry 0
    expect(ico.readUInt8(6)).toBe(16); expect(ico.readUInt8(7)).toBe(16);
    expect(ico.readUInt16LE(6 + 4)).toBe(1); expect(ico.readUInt16LE(6 + 6)).toBe(32);
    expect(ico.readUInt32LE(6 + 8)).toBe(a.length); expect(ico.readUInt32LE(6 + 12)).toBe(6 + 32);
    // entry 1: 256 is encoded as 0
    expect(ico.readUInt8(22)).toBe(0); expect(ico.readUInt8(23)).toBe(0);
    expect(ico.readUInt32LE(22 + 8)).toBe(b.length); expect(ico.readUInt32LE(22 + 12)).toBe(6 + 32 + a.length);
    expect(ico.subarray(38, 38 + a.length).equals(a)).toBe(true);
    expect(ico.subarray(38 + a.length).equals(b)).toBe(true);
  });
});
