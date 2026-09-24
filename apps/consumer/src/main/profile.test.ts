import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, settingsPatch } from './settings';
import { profileInput, readProfile, toSettingsPatch } from './profile';
import { DEFAULT_PROFILE, ROLES, type Profile } from '../shared/profileOptions';

const valid: Profile = {
  name: '  Aaron   S ', roles: ['dev', 'design'], goals: ['focus', 'sleep'],
  start: '09:30', bed: '22:30', days: [5, 1, 3], distractions: ['Instagram', ' my  game 🎮 ']
};

describe('profileInput', () => {
  it('accepts valid input and cleans whitespace', () => {
    const p = profileInput.parse(valid);
    expect(p.name).toBe('Aaron S');
    expect(p.distractions).toEqual(['Instagram', 'my game 🎮']);
  });
  it('accepts an empty (all skipped) profile', () => {
    expect(profileInput.safeParse({ name: '', roles: [], goals: [], start: '09:00', bed: '23:00', days: [], distractions: [] }).success).toBe(true);
  });
  it.each([
    ['unknown role', { roles: ['pilot'] }],
    ['duplicate goal', { goals: ['focus', 'focus'] }],
    ['bad start time', { start: '25:00' }],
    ['bad bed time', { bed: '9pm' }],
    ['day 0', { days: [0] }],
    ['day 8', { days: [8] }],
    ['duplicate day', { days: [1, 1] }],
    ['too many roles', { roles: [...ROLES, 'dev'] }],
    ['too many days', { days: [1, 2, 3, 4, 5, 6, 7, 1] }],
    ['41-char name', { name: 'x'.repeat(41) }],
    ['control char in name', { name: 'Aa\u0007ron' }],
    ['newline in name', { name: 'Aa\nron' }],
    ['13 distractions', { distractions: Array.from({ length: 13 }, (_, i) => `app${i}`) }],
    ['41-char distraction', { distractions: ['y'.repeat(41)] }],
    ['empty distraction', { distractions: ['   '] }],
    ['case-insensitive duplicate distraction', { distractions: ['YouTube', 'youtube'] }],
    ['extra key', { consentGranted: true }]
  ])('rejects %s', (_label, patch) => {
    expect(profileInput.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
});

describe('toSettingsPatch', () => {
  it('writes exactly the profile keys plus windDownTime', () => {
    const patch = toSettingsPatch(profileInput.parse(valid));
    expect(Object.keys(patch).sort()).toEqual(['profileDays', 'profileDistractions', 'profileGoals', 'profileName', 'profileRoles', 'profileStart', 'windDownTime']);
    expect(patch.windDownTime).toBe('22:30');
    expect(patch.profileDays).toBe('[1,3,5]');
    expect(JSON.parse(patch.profileRoles!)).toEqual(['dev', 'design']);
  });
});

describe('readProfile', () => {
  it('round-trips a saved profile', () => {
    const saved = { ...DEFAULT_SETTINGS, ...toSettingsPatch(profileInput.parse(valid)) };
    expect(readProfile(saved)).toEqual({ name: 'Aaron S', roles: ['dev', 'design'], goals: ['focus', 'sleep'], start: '09:30', bed: '22:30', days: [1, 3, 5], distractions: ['Instagram', 'my game 🎮'] });
  });
  it('gives defaults for a fresh install', () => {
    expect(readProfile(DEFAULT_SETTINGS)).toEqual({ name: '', roles: [], goals: [], start: '09:00', bed: '23:00', days: [1, 2, 3, 4, 5], distractions: [] });
  });
  it('tolerates corrupt or unknown stored values', () => {
    const p = readProfile({
      ...DEFAULT_SETTINGS, profileRoles: '{bad json', profileGoals: '["focus","nope",42]', profileDays: 'x',
      profileStart: '99:99', windDownTime: 'late', profileDistractions: '["ok", "", 7, "' + 'z'.repeat(60) + '"]', profileName: 'n'.repeat(80)
    });
    expect(p).toEqual({ name: 'n'.repeat(40), roles: [], goals: ['focus'], start: '09:00', bed: '23:00', days: [1, 2, 3, 4, 5], distractions: ['ok'] });
  });
  it('drops case-insensitive duplicate distractions (keeps the first) so a re-save validates', () => {
    const p = readProfile({ ...DEFAULT_SETTINGS, profileDistractions: '["youtube","YouTube","Reddit","REDDIT"]' });
    expect(p.distractions).toEqual(['youtube', 'Reddit']);
    expect(profileInput.safeParse(p).success).toBe(true);
  });
  it('does not alias or mutate DEFAULT_PROFILE.days when stored days are corrupt', () => {
    const corrupt = { ...DEFAULT_SETTINGS, profileDays: 'not json' };
    const p1 = readProfile(corrupt);
    p1.days.sort((a, b) => b - a);
    const p2 = readProfile(corrupt);
    expect(p1.days).not.toBe(DEFAULT_PROFILE.days);
    expect(DEFAULT_PROFILE.days).toEqual([1, 2, 3, 4, 5]);
    expect(p2.days).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('settingsPatch', () => {
  it('does not let the renderer write profile keys through settings:set', () => {
    expect(settingsPatch.safeParse({ profileName: 'x' }).success).toBe(false);
  });
});
