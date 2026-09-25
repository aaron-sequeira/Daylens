import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { parseHoldSignals, queryNotificationState, SCRIPT } from './notifState';

// The script reads the live HKCU consent store and process list, so its filtering can't be driven with fixtures
// without writing fake keys into the user's registry. These checks pin its shape; the Windows-only run proves it
// parses and prints only the expected two numbers.
describe('hold-signals script', () => {
  it('counts a NonPackaged entry only when a running process has its path, listing processes at most once', () => {
    expect(SCRIPT).toContain("$p.PSChildName -ne 'NonPackaged'"); // packaged pass skips the NonPackaged container
    expect(SCRIPT).toContain("($k + '\\NonPackaged')");
    expect(SCRIPT).toContain("$run.ContainsKey($p.PSChildName.Replace('#', '\\'))");
    expect(SCRIPT.match(/Get-Process/g)).toHaveLength(1);
    expect(SCRIPT).toContain('if ($null -eq $run)'); // lazily, once
    expect(SCRIPT).toContain('$run = @{}'); // PowerShell hashtables compare keys case-insensitively
  });
  it('prints nothing but "<state> <mic>"', () => {
    expect(SCRIPT.trim().endsWith("'{0} {1}' -f $s, $m")).toBe(true);
    expect(SCRIPT).not.toMatch(/Write-(Host|Output)|Out-|echo/i);
  });
  it.runIf(process.platform === 'win32')('runs in real PowerShell and prints a well-formed answer', async () => {
    const out = await new Promise<string>((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SCRIPT], { timeout: 15_000, windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(stdout))));
    expect(out.trim()).toMatch(/^[1-7] [01]$/);
  }, 20_000);
});

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
  it('runs one PowerShell with a 5 s timeout and parses both fields', async () => {
    const calls: [string, number][] = [];
    expect(await queryNotificationState(async (cmd, _args, t) => { calls.push([cmd, t]); return '5 1\r\n'; })).toEqual({ state: 5, micInUse: true });
    expect(calls).toEqual([['powershell.exe', 5000]]);
  });
  it('returns state null, mic false on failure or garbage', async () => {
    expect(await queryNotificationState(async () => { throw new Error('timeout'); })).toEqual({ state: null, micInUse: false });
    expect(await queryNotificationState(async () => 'nope')).toEqual({ state: null, micInUse: false });
  });
});
