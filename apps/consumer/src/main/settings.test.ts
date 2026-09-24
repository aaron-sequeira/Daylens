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
