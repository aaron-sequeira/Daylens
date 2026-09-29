import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export interface TzChange { at: number; fromName: string; toName: string; fromOffset: number; toOffset: number; }

/** Minutes east of UTC right now (e.g. India +330, New York −300/−240). */
export const currentOffsetMin = (): number => -new Date().getTimezoneOffset();

/** Points this process's clock at a named zone. V8 re-reads a named process.env.TZ immediately (a delete never falls
 * back to the host zone, so we always assign the real name). */
export function applyZone(iana: string): void { process.env.TZ = iana; }

const pexec = promisify(execFile);
const KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\TimeZoneInformation';
const regQuery = async (): Promise<string> => (await pexec('reg', ['query', KEY, '/v', 'TimeZoneKeyName'], { windowsHide: true, timeout: 3000 })).stdout;
const WINRT = '$null = [Windows.Globalization.Calendar, Windows.Globalization, ContentType = WindowsRuntime]; (New-Object Windows.Globalization.Calendar).GetTimeZone()';
const winrtZone = async (): Promise<string> =>
  (await pexec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINRT], { windowsHide: true, timeout: 8000 })).stdout;

/** The Windows time-zone key name (e.g. "India Standard Time"): a cheap read, used only to notice a change. */
export async function readWindowsZone(exec: () => Promise<string> = regQuery): Promise<string | null> {
  try {
    const m = /TimeZoneKeyName\s+REG_SZ\s+(.+?)\s*$/m.exec(await exec());
    return m ? m[1].trim() : null;
  } catch { return null; }
}

const IANA = /^(UTC|[A-Za-z_]+(\/[A-Za-z0-9_+\-]+)+)$/;
/** The standard zone name Windows uses right now (e.g. "Asia/Kolkata"), via WinRT; null if unavailable. */
export async function readIanaZone(exec: () => Promise<string> = winrtZone): Promise<string | null> {
  try {
    const z = (await exec()).trim();
    return IANA.test(z) ? z : null;
  } catch { return null; }
}

export function createZoneWatcher(d: {
  read(): Promise<string | null>; offset(): number; apply(): Promise<boolean>;
  stored(): { name: string; offset: number }; save(z: { name: string; offset: number }): void; now(): number;
}) {
  return {
    /** Reads the Windows zone; on a change points the JS clock at it, stores and returns the change. */
    async check(): Promise<TzChange | null> {
      const name = await d.read();
      if (!name) return null;
      const prev = d.stored();
      if (prev.name === name) return null;
      if (prev.name !== '' && !(await d.apply())) return null; // couldn't get the standard name: try again next check
      const offset = d.offset();
      d.save({ name, offset });
      return prev.name === '' ? null : { at: d.now(), fromName: prev.name, toName: name, fromOffset: prev.offset, toOffset: offset };
    }
  };
}
