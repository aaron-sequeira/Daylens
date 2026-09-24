import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import type { ForegroundInfo } from '@worksight/core/types';
import { DEFAULT_SETTINGS, type DaylensSettings } from '../settings';
import { SCREEN_SCHEMA, createScreenStore, type ScreenStore } from './store';
import type { CaptureResult } from '../ocr/client';
import { createScreenReader, runRetention, SAME_WINDOW_MS } from './reader';

let store: ScreenStore;
let settings: DaylensSettings;
let fg: ForegroundInfo | null;
let cap: CaptureResult | null;
let captures: number;
let idle: number;
let now: number;

const reader = () => createScreenReader({
  ocr: { capture: async () => { captures++; return cap; } },
  foreground: { get: async () => fg },
  settings: () => settings, idleSec: () => idle, store, now: () => now
});

beforeEach(() => {
  const db = new Database(':memory:'); db.exec(SCREEN_SCHEMA);
  store = createScreenStore(db);
  settings = { ...DEFAULT_SETTINGS, consentGranted: true, screenReading: true };
  fg = { appName: 'Visual Studio Code', appPath: null, title: 'app.ts - proj', pid: 42 };
  cap = { text: 'const x = 1 // mail a@b.co', ms: 90, pid: 42, title: 'app.ts - proj', w: 800, h: 600 };
  captures = 0; idle = 0; now = new Date(2026, 8, 24, 10, 0).getTime();
});

describe('screen reader', () => {
  it('does nothing when off, not consented, or paused', async () => {
    for (const patch of [{ screenReading: false }, { consentGranted: false }, { trackingPaused: true }]) {
      settings = { ...DEFAULT_SETTINGS, consentGranted: true, screenReading: true, ...patch };
      await expect(reader().tick()).resolves.toBe('skipped-off');
    }
    expect(captures).toBe(0);
    expect(store.last()).toBeNull();
  });

  it('skips while idle', async () => {
    idle = settings.idleThresholdSec;
    await expect(reader().tick()).resolves.toBe('skipped-idle');
    expect(captures).toBe(0);
  });

  it('skips an excluded foreground app without capturing', async () => {
    fg = { appName: '1Password', appPath: null, title: 'Vault', pid: 7 };
    await expect(reader().tick()).resolves.toBe('skipped-excluded');
    expect(captures).toBe(0);
  });

  it('stores redacted text with app, title and date', async () => {
    await expect(reader().tick()).resolves.toBe('stored');
    expect(store.last()).toMatchObject({ appName: 'Visual Studio Code', windowTitle: 'app.ts - proj', text: 'const x = 1 // mail [email]', date: '2026-09-24', at: now });
  });

  it('discards a capture whose window changed to another process', async () => {
    cap = { ...cap!, pid: 99 };
    await expect(reader().tick()).resolves.toBe('discarded');
    expect(store.last()).toBeNull();
  });

  it('discards a capture whose actual window title is excluded (switched to a password page mid-capture)', async () => {
    cap = { ...cap!, title: 'Sign in - Bank of Baroda' };
    await expect(reader().tick()).resolves.toBe('discarded');
    expect(store.last()).toBeNull();
  });

  it('skips the same window within 2 minutes, then stores identical text as a duplicate', async () => {
    const r = reader();
    await r.tick();
    now += SAME_WINDOW_MS - 1;
    await expect(r.tick()).resolves.toBe('skipped-same');
    now += 1;
    await expect(r.tick()).resolves.toBe('stored-dup');
    expect(store.last()).toMatchObject({ text: null });
    expect(store.lastWithText()).toMatchObject({ text: 'const x = 1 // mail [email]' });
  });

  it('does not store window titles when title capture is off', async () => {
    settings = { ...settings, captureWindowTitles: false };
    await reader().tick();
    expect(store.last()).toMatchObject({ windowTitle: null });
  });

  it('reports no-capture when the helper returns nothing', async () => {
    cap = null;
    await expect(reader().tick()).resolves.toBe('no-capture');
    expect(store.last()).toBeNull();
  });

  it('returns skipped-off when tracking is paused during the capture', async () => {
    const r = createScreenReader({
      ocr: { capture: async () => { settings.trackingPaused = true; return cap; } },
      foreground: { get: async () => fg },
      settings: () => settings, idleSec: () => idle, store, now: () => now
    });
    await expect(r.tick()).resolves.toBe('skipped-off');
    expect(store.last()).toBeNull();
  });

  it('disables window title capture if captureWindowTitles changed during capture', async () => {
    const r = createScreenReader({
      ocr: { capture: async () => { settings.captureWindowTitles = false; return cap; } },
      foreground: { get: async () => fg },
      settings: () => settings, idleSec: () => idle, store, now: () => now
    });
    await expect(r.tick()).resolves.toBe('stored');
    expect(store.last()).toMatchObject({ windowTitle: null });
  });

  it('stores the title actually captured, not the pre-capture foreground title', async () => {
    cap = { ...cap!, title: 'new-window.ts - proj' };
    await expect(reader().tick()).resolves.toBe('stored');
    expect(store.last()).toMatchObject({ windowTitle: 'new-window.ts - proj' });
  });

  it('does not skip if clock moved backwards', async () => {
    const r = reader();
    await r.tick();
    now -= 60_000;
    const result = await r.tick();
    expect(result).not.toBe('skipped-same');
  });

  it('discards a capture when exclusion is added during capture', async () => {
    const r = createScreenReader({
      ocr: { capture: async () => { settings = { ...settings, exclusions: JSON.stringify([...JSON.parse(settings.exclusions), 'Visual Studio Code']) }; return cap; } },
      foreground: { get: async () => fg },
      settings: () => settings, idleSec: () => idle, store, now: () => now
    });
    await expect(r.tick()).resolves.toBe('discarded');
    expect(store.last()).toBeNull();
  });
});

describe('runRetention', () => {
  it('erases text older than the retention window', async () => {
    await reader().tick();
    now += 2 * 86_400_000;
    expect(runRetention(store, 1, now)).toBe(1);
    expect(store.lastWithText()).toBeNull();
    expect(store.last()).not.toBeNull();
  });

  it('does not purge if days <= 0', async () => {
    await reader().tick();
    now += 1000;
    expect(runRetention(store, 0, now)).toBe(0);
    expect(store.lastWithText()).not.toBeNull();
  });

  it('stores identical text after hash was purged', async () => {
    const r = reader();
    await r.tick();
    now += 2 * 86_400_000;
    runRetention(store, 1, now);
    // Hash now blanked, so identical text should not be deduped
    await expect(r.tick()).resolves.toBe('stored');
    expect(store.last()).toMatchObject({ text: 'const x = 1 // mail [email]' });
  });
});
