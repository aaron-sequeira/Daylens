import { describe, it, expect } from 'vitest';
import { parseHoldSignals, queryNotificationState } from './notifState';

describe('parseHoldSignals', () => {
  it('parses the notification state and the microphone flag', () => {
    expect(parseHoldSignals('5 0\r\n')).toEqual({ state: 5, micInUse: false });
    expect(parseHoldSignals('2 1')).toEqual({ state: 2, micInUse: true });
  });
  it('treats garbage or out-of-range output as state null, mic false', () => {
    for (const bad of ['nope', '', '5', '9 1', '5 1 extra', '5 yes', '0 1']) expect(parseHoldSignals(bad)).toEqual({ state: null, micInUse: false });
  });
});

describe('queryNotificationState', () => {
  it('runs one PowerShell with a 2 s timeout and parses both fields', async () => {
    const calls: [string, number][] = [];
    expect(await queryNotificationState(async (cmd, _args, t) => { calls.push([cmd, t]); return '5 1\r\n'; })).toEqual({ state: 5, micInUse: true });
    expect(calls).toEqual([['powershell.exe', 2000]]);
  });
  it('returns state null, mic false on failure or garbage', async () => {
    expect(await queryNotificationState(async () => { throw new Error('timeout'); })).toEqual({ state: null, micInUse: false });
    expect(await queryNotificationState(async () => 'nope')).toEqual({ state: null, micInUse: false });
  });
});
