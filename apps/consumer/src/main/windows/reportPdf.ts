export const pdfFileName = (date: string): string => `Daylens-${date}.pdf`;

export const PDF_OPTIONS = {
  pageSize: 'A4', printBackground: true,
  margins: { marginType: 'custom', top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 }
} as const;

/** Where the hidden export window should load: the dev server (with the print query) or the packaged index.html file. */
export function printUrl(base: { devUrl?: string; file: string }, date: string): { kind: 'url' | 'file'; target: string; query: { print: string } } {
  return base.devUrl ? { kind: 'url', target: base.devUrl, query: { print: date } } : { kind: 'file', target: base.file, query: { print: date } };
}

/** Renders the report to PDF bytes and writes it to `path`; failures are returned as text, not thrown. */
export async function exportPdf(date: string, deps: { render(date: string): Promise<Buffer>; write(path: string, data: Buffer): Promise<void> }, path: string): Promise<'ok' | string> {
  try {
    await deps.write(path, await deps.render(date));
    return 'ok';
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
