import { join } from 'node:path';
import { pdfFileName } from '../windows/reportPdf';
import type { ReportJson } from './schema';

const MAILTO_MAX = 1800;
export const autoSavePath = (folder: string, date: string): string => join(folder, pdfFileName(date));

export function mailtoUrl(date: string, r: ReportJson | null): string {
  const subject = `Daylens — ${date}`;
  const sentences = (r?.story.match(/[^.!?]+[.!?]+/g) ?? []).slice(0, 3).map((s) => s.trim()).join(' ');
  let body = r ? `${r.headline}\n\n${sentences}\n\n(The full report is attached as a PDF.)` : `Daylens report for ${date} (PDF attached).`;
  const make = (b: string): string => `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(b)}`;
  // Array.from splits on code points, not UTF-16 code units: a plain slice() could cut a surrogate pair (an
  // emoji) in half and leave a lone surrogate, which encodeURIComponent throws on.
  while (make(body).length > MAILTO_MAX && body.length > 40) {
    const codePoints = Array.from(body);
    body = `${codePoints.slice(0, Math.floor(codePoints.length * 0.9)).join('').trimEnd()}…`;
  }
  return make(body);
}

export interface AutoSaveDeps {
  render(date: string): Promise<Buffer>;
  write(p: string, b: Buffer): Promise<void>;
  exists(dir: string): Promise<boolean>;
  /** Renames the `.tmp` file over the final path, so a crash or a race with a concurrent read never leaves a truncated PDF. */
  rename(from: string, to: string): Promise<void>;
}

export async function autoSavePdf(date: string, folder: string, deps: AutoSaveDeps): Promise<'ok' | 'off' | string> {
  if (!folder) return 'off';
  try {
    if (!(await deps.exists(folder))) return "The auto-save folder can't be found.";
    const final = autoSavePath(folder, date);
    const tmp = `${final}.tmp`;
    await deps.write(tmp, await deps.render(date));
    await deps.rename(tmp, final);
    return 'ok';
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return /EACCES|EPERM|permission/i.test(m) ? "Daylens doesn't have permission to save in that folder." : "The PDF couldn't be saved to the auto-save folder.";
  }
}
