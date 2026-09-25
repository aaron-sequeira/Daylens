import { execFile } from 'node:child_process';

const SCRIPT = "Add-Type -Namespace D -Name Q -MemberDefinition '[DllImport(\"shell32.dll\")] public static extern int SHQueryUserNotificationState(out int s);'; $s = 0; [void][D.Q]::SHQueryUserNotificationState([ref]$s); $s";

const defaultRun = (cmd: string, args: string[], timeoutMs: number): Promise<string> => new Promise((resolve, reject) => {
  execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
});

/** Windows notification state (1–7), or null if unknown — only called when a pop-up is about to show. */
export async function queryNotificationState(run = defaultRun): Promise<number | null> {
  try {
    const n = Number.parseInt((await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SCRIPT], 2000)).trim(), 10);
    return Number.isInteger(n) && n >= 1 && n <= 7 ? n : null;
  } catch {
    return null;
  }
}
