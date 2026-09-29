import { z } from 'zod';
import { DEFAULT_EXCLUSIONS } from '../shared/exclusions';

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
  profileDistractions: '[]',
  screenReading: false,
  rawTextRetentionDays: 7,
  readIntervalSec: 30,
  exclusions: JSON.stringify(DEFAULT_EXCLUSIONS),
  screenReadingAsked: false,
  nudgeKinds: '{"health":true,"behaviour":true,"tip":true,"win":true}',
  snoozeUntil: 0,
  appLimits: '[]',
  nudgeFewer: '{}',
  writerMode: 'local' as 'local' | 'cloud',
  writerModelTier: '',
  writerDeclined: false,
  aiProvider: 'anthropic',
  aiModel: 'claude-haiku-4-5',
  aiBaseUrl: '',
  reportPdfFolder: '',
  zoneName: '',
  zoneOffset: 0,
  travelOffUntil: 0
};
export type DaylensSettings = typeof DEFAULT_SETTINGS;

// Only these are editable from the renderer; consent and pause have dedicated channels, tracker internals none.
export const settingsPatch = z.object({
  dailyGoalMin: z.number().int().min(60).max(1440),
  windDownTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  breakIntervalMin: z.number().int().min(10).max(180),
  captureWindowTitles: z.boolean(),
  openAtLogin: z.boolean(),
  screenReading: z.boolean(),
  rawTextRetentionDays: z.union([z.literal(1), z.literal(7), z.literal(30)]),
  screenReadingAsked: z.boolean()
}).partial().strict();
export type SettingsPatch = z.infer<typeof settingsPatch>;
