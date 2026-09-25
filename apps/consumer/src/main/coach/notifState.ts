import { execFile } from 'node:child_process';

// One PowerShell: SHQueryUserNotificationState, then whether any microphone is in use right now (a consent-store
// entry, packaged or NonPackaged, with LastUsedTimeStart > 0 and LastUsedTimeStop == 0). Prints "<state> <0|1>".
// Nothing but those two numbers is ever printed: no app registry paths.
const SCRIPT = String.raw`Add-Type -Namespace D -Name Q -MemberDefinition '[DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int s);'; $s = 0; [void][D.Q]::SHQueryUserNotificationState([ref]$s); $m = 0; $k = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone'; foreach ($p in @(Get-ChildItem -LiteralPath $k -ErrorAction SilentlyContinue) + @(Get-ChildItem -LiteralPath ($k + '\NonPackaged') -ErrorAction SilentlyContinue)) { $v = Get-ItemProperty -LiteralPath $p.PSPath -ErrorAction SilentlyContinue; if ($v.LastUsedTimeStart -gt 0 -and $v.LastUsedTimeStop -eq 0) { $m = 1 } }; '{0} {1}' -f $s, $m`;

export interface HoldSignals { state: number | null; micInUse: boolean; }
const UNKNOWN: HoldSignals = { state: null, micInUse: false };

const defaultRun = (cmd: string, args: string[], timeoutMs: number): Promise<string> => new Promise((resolve, reject) => {
  execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
});

/** "<state 1–7> <0|1>" → signals; anything else → state null, mic false. */
export function parseHoldSignals(out: string): HoldSignals {
  const m = /^([1-7]) ([01])$/.exec(out.trim());
  return m ? { state: Number(m[1]), micInUse: m[2] === '1' } : UNKNOWN;
}

/** Windows notification state (1–7, or null if unknown) and whether a microphone is in use — only called when
 * a pop-up is about to show. */
export async function queryNotificationState(run = defaultRun): Promise<HoldSignals> {
  try {
    return parseHoldSignals(await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SCRIPT], 2000));
  } catch {
    return UNKNOWN;
  }
}
