import { execFile } from 'node:child_process';

// One PowerShell: SHQueryUserNotificationState, then whether any microphone is in use right now (a consent-store
// entry with LastUsedTimeStart > 0 and LastUsedTimeStop == 0). Packaged entries count as they are. A NonPackaged
// entry counts only if a running process has its path (key name with '#' for '\', case-insensitive): an app that
// exited mid-call can leave LastUsedTimeStop == 0 behind forever. Running paths are listed at most once, and only
// if some NonPackaged entry looks in use. Only meeting/call apps count (MEETING_EXE for a NonPackaged entry's exe,
// MEETING_PKG for a packaged app's name): Discord or in-game voice chat must not silence break reminders. Prints "<state> <0|1>" — nothing else, no app registry paths.
/** Exe names (without .exe) of meeting/call apps and browsers (Google Meet etc.); matched case-insensitively. */
export const MEETING_EXE = '^(zoom|ms-teams|teams|webex|webexhost|ciscocollabhost|atmgr|slack|skype|whatsapp|ringcentral|chrome|msedge|firefox|brave|opera|vivaldi|arc)$';
/** Packaged (Store) app names of meeting/call apps, e.g. MSTeams_8wekyb3d8bbwe. */
export const MEETING_PKG = '(teams|skype|zoom|whatsapp|webex|slack)';

export const SCRIPT = String.raw`$me = '${MEETING_EXE}'; $mp = '${MEETING_PKG}'; Add-Type -Namespace D -Name Q -MemberDefinition '[DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int s);'; $s = 0; [void][D.Q]::SHQueryUserNotificationState([ref]$s); $m = 0; $k = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone'; $inUse = { param($p) $v = Get-ItemProperty -LiteralPath $p.PSPath -ErrorAction SilentlyContinue; $v.LastUsedTimeStart -gt 0 -and $v.LastUsedTimeStop -eq 0 }; foreach ($p in @(Get-ChildItem -LiteralPath $k -ErrorAction SilentlyContinue)) { if ($p.PSChildName -ne 'NonPackaged' -and $p.PSChildName -match $mp -and (& $inUse $p)) { $m = 1 } }; if ($m -eq 0) { $run = $null; foreach ($p in @(Get-ChildItem -LiteralPath ($k + '\NonPackaged') -ErrorAction SilentlyContinue)) { if (($p.PSChildName.Split('#')[-1] -replace '\.exe$', '') -match $me -and (& $inUse $p)) { if ($null -eq $run) { $run = @{}; Get-Process | Where-Object Path | ForEach-Object { $run[$_.Path] = 1 } }; if ($run.ContainsKey($p.PSChildName.Replace('#', '\'))) { $m = 1 } } } }; '{0} {1}' -f $s, $m`;

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
    return parseHoldSignals(await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SCRIPT], 5000));
  } catch {
    return UNKNOWN;
  }
}
