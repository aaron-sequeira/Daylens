import { z } from 'zod';

export const DEFAULT_SETTINGS = {
  consentGranted: false,
  trackingPaused: false,
  idleThresholdSec: 60,
  captureWindowTitles: true,
  pollIntervalMs: 2000,
  bucketSizeSec: 60,
  dailyGoalMin: 420,
  windDownTime: '23:00',
  breakIntervalMin: 50,
  openAtLogin: true,
  profileName: '',
  profileRoles: '[]',
  profileGoals: '[]',
  profileStart: '09:00',
  profileDays: '[1,2,3,4,5]',
  profileDistractions: '[]'
};
export type DaylensSettings = typeof DEFAULT_SETTINGS;

// Only these are editable from the renderer; consent and pause have dedicated channels, tracker internals none.
export const settingsPatch = z.object({
  dailyGoalMin: z.number().int().min(60).max(1440),
  windDownTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  breakIntervalMin: z.number().int().min(10).max(180),
  captureWindowTitles: z.boolean(),
  openAtLogin: z.boolean()
}).partial().strict();
export type SettingsPatch = z.infer<typeof settingsPatch>;
