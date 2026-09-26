import { execFile } from 'node:child_process';

const defaultRun = (cmd: string, args: string[], ms: number): Promise<string> => new Promise((resolve, reject) => {
  execFile(cmd, args, { timeout: ms, windowsHide: true }, (err, out) => (err ? reject(err) : resolve(out)));
});
/** Battery charge 0–100, or null when unknown / no battery. Only called while on battery power. */
export async function batteryPercent(run = defaultRun): Promise<number | null> {
  try {
    const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_Battery | Select-Object -First 1).EstimatedChargeRemaining'], 5000);
    const n = Number(out.trim());
    return Number.isFinite(n) && out.trim() !== '' ? n : null;
  } catch { return null; }
}
