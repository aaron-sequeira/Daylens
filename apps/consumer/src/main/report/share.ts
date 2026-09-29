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
  while (make(body).length > MAILTO_MAX && body.length > 40) body = `${body.slice(0, Math.floor(body.length * 0.9)).trimEnd()}…`;
  return make(body);
}

export async function autoSavePdf(date: string, folder: string, deps: { render(date: string): Promise<Buffer>; write(p: string, b: Buffer): Promise<void>; exists(dir: string): Promise<boolean> }): Promise<'ok' | 'off' | string> {
  if (!folder) return 'off';
  try {
    if (!(await deps.exists(folder))) return "The auto-save folder can't be found.";
    await deps.write(autoSavePath(folder, date), await deps.render(date));
    return 'ok';
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return /EACCES|EPERM|permission/i.test(m) ? "Daylens doesn't have permission to save in that folder." : "The PDF couldn't be saved to the auto-save folder.";
  }
}
