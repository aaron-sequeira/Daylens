import { describe, it, expect, afterEach } from 'vitest';
import { applyZone, createZoneWatcher, currentOffsetMin, readIanaZone, readWindowsZone } from './zone';

describe('applyZone (V8 follows a named TZ immediately)', () => {
  const host = Intl.DateTimeFormat().resolvedOptions().timeZone;
  afterEach(() => { process.env.TZ = host; });
  it('switches between named zones', () => {
    applyZone('Asia/Tokyo');
    expect(currentOffsetMin()).toBe(540);
    applyZone('Asia/Kolkata');
    expect(currentOffsetMin()).toBe(330);
  });
});

describe('readWindowsZone', () => {
  it('parses the reg query output', async () => {
    const out = '\r\nHKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\TimeZoneInformation\r\n    TimeZoneKeyName    REG_SZ    India Standard Time\r\n\r\n';
    expect(await readWindowsZone(async () => out)).toBe('India Standard Time');
  });
  it('returns null when the command fails', async () => {
    expect(await readWindowsZone(async () => { throw new Error('x'); })).toBeNull();
  });
});

describe('readIanaZone', () => {
  it('accepts a standard zone name and rejects junk or failures', async () => {
    expect(await readIanaZone(async () => 'Asia/Kolkata\r\n')).toBe('Asia/Kolkata');
    expect(await readIanaZone(async () => 'America/Argentina/Buenos_Aires\n')).toBe('America/Argentina/Buenos_Aires');
    expect(await readIanaZone(async () => 'UTC')).toBe('UTC');
    expect(await readIanaZone(async () => 'Something went wrong')).toBeNull();
    expect(await readIanaZone(async () => { throw new Error('x'); })).toBeNull();
  });
});

describe('createZoneWatcher', () => {
  const mk = (names: (string | null)[], offsets: number[], stored = { name: '', offset: 0 }, applyOk = true) => {
    let i = 0, applied = 0;
    const saved: { name: string; offset: number }[] = [];
    const w = createZoneWatcher({
      read: async () => names[Math.min(i, names.length - 1)],
      offset: () => offsets[Math.min(i, offsets.length - 1)],
      apply: async () => { applied++; return applyOk; },
      stored: () => stored, save: (z) => { stored = z; saved.push(z); },
      now: () => 1000
    });
    return { w, next: () => { i++; }, applied: () => applied, saved };
  };
  it('first run stores the zone without reporting a change', async () => {
    const t = mk(['GMT Standard Time'], [60]);
    expect(await t.w.check()).toBeNull();
    expect(t.saved).toEqual([{ name: 'GMT Standard Time', offset: 60 }]);
  });
  it('reports a change (after applying the new zone) and stores it', async () => {
    const t = mk(['GMT Standard Time', 'Tokyo Standard Time'], [60, 540], { name: 'GMT Standard Time', offset: 60 });
    expect(await t.w.check()).toBeNull();
    t.next();
    expect(await t.w.check()).toEqual({ at: 1000, fromName: 'GMT Standard Time', toName: 'Tokyo Standard Time', fromOffset: 60, toOffset: 540 });
    expect(t.applied()).toBe(1);
  });
  it('detects a change that happened while the app was closed', async () => {
    const t = mk(['Tokyo Standard Time'], [540], { name: 'GMT Standard Time', offset: 60 });
    expect(await t.w.check()).toMatchObject({ fromName: 'GMT Standard Time', toName: 'Tokyo Standard Time' });
  });
  it('does nothing when the zone cannot be read', async () => {
    const t = mk([null], [60], { name: 'GMT Standard Time', offset: 60 });
    expect(await t.w.check()).toBeNull();
    expect(t.applied()).toBe(0);
  });
  it('if the new zone cannot be applied, records nothing and retries next check', async () => {
    const t = mk(['Tokyo Standard Time'], [540], { name: 'GMT Standard Time', offset: 60 }, false);
    expect(await t.w.check()).toBeNull();
    expect(t.saved).toEqual([]);
  });
});
