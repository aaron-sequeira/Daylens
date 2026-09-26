import { describe, it, expect } from 'vitest';
import { batteryPercent } from './battery';

describe('batteryPercent', () => {
  it('parses battery output with newlines', async () => {
    const percent = await batteryPercent(async () => '57\r\n');
    expect(percent).toBe(57);
  });
  it('returns null for empty output', async () => {
    const percent = await batteryPercent(async () => '');
    expect(percent).toBeNull();
  });
  it('returns null when run throws', async () => {
    const percent = await batteryPercent(async () => { throw new Error('cmd failed'); });
    expect(percent).toBeNull();
  });
  it('returns null for out-of-range values', async () => {
    expect(await batteryPercent(async () => '101\r\n')).toBeNull();
    expect(await batteryPercent(async () => '-1\r\n')).toBeNull();
  });
});
