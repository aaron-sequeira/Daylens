import { describe, it, expect } from 'vitest';
import { settingsPatch, DEFAULT_SETTINGS } from './settings';

describe('settingsPatch', () => {
  it('accepts valid user-editable settings', () => {
    expect(settingsPatch.parse({ dailyGoalMin: 300, windDownTime: '22:30', breakIntervalMin: 45, captureWindowTitles: false, openAtLogin: true }))
      .toEqual({ dailyGoalMin: 300, windDownTime: '22:30', breakIntervalMin: 45, captureWindowTitles: false, openAtLogin: true });
  });
  it.each([
    [{ dailyGoalMin: 5 }], [{ dailyGoalMin: 2000 }], [{ windDownTime: '25:00' }], [{ windDownTime: '9pm' }],
    [{ breakIntervalMin: 3 }], [{ consentGranted: true }], [{ trackingPaused: true }], [{ pollIntervalMs: 1 }]
  ])('rejects %j', (patch) => {
    expect(settingsPatch.safeParse(patch).success).toBe(false);
  });
  it('ships sane defaults', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ consentGranted: false, dailyGoalMin: 420, windDownTime: '23:00', breakIntervalMin: 50 });
  });
});

describe('privacy settings', () => {
  it('defaults screen reading off with 7-day retention', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ screenReading: false, rawTextRetentionDays: 7, readIntervalSec: 30 });
    expect(JSON.parse(DEFAULT_SETTINGS.exclusions)).toContain('1Password');
  });
  it('lets the renderer set screen reading and retention 1/7/30 only', () => {
    expect(settingsPatch.parse({ screenReading: true, rawTextRetentionDays: 30 })).toEqual({ screenReading: true, rawTextRetentionDays: 30 });
    expect(settingsPatch.safeParse({ rawTextRetentionDays: 2 }).success).toBe(false);
    expect(settingsPatch.safeParse({ exclusions: '[]' }).success).toBe(false);
    expect(settingsPatch.safeParse({ readIntervalSec: 5 }).success).toBe(false);
  });
});

describe('screen reading opt-in', () => {
  it('defaults screenReadingAsked to false and lets the renderer set it', () => {
    expect(DEFAULT_SETTINGS.screenReadingAsked).toBe(false);
    expect(settingsPatch.parse({ screenReadingAsked: true })).toEqual({ screenReadingAsked: true });
    expect(settingsPatch.safeParse({ screenReadingAsked: 'yes' }).success).toBe(false);
  });
});
