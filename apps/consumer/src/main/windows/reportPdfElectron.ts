import { BrowserWindow, ipcMain } from 'electron';
import { PDF_OPTIONS, printUrl } from './reportPdf';

/** Renders the report route in a hidden window with ?print=<date> and returns the PDF bytes.
 * No unit test: an Electron adapter (per the ledger rule that these live in separate files). */
export function renderReportPdf(date: string, deps: { preload: string; devUrl?: string; indexFile: string; timeoutMs?: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const w = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { preload: deps.preload, contextIsolation: true, nodeIntegration: false } });
    const done = (err: Error | null, pdf?: Buffer): void => {
      clearTimeout(timer);
      ipcMain.off('report:printReady', onReady);
      if (!w.isDestroyed()) w.destroy();
      if (err) reject(err); else resolve(pdf as Buffer);
    };
    // Only this window's renderer can trigger the print: another window sending the same
    // channel (e.g. the main window, if it were ever loaded with a stray ?print=) must not.
    const onReady = (e: Electron.IpcMainEvent): void => {
      if (e.sender !== w.webContents) return;
      w.webContents.printToPDF(PDF_OPTIONS).then((pdf) => done(null, pdf), (err) => done(err instanceof Error ? err : new Error(String(err))));
    };
    const timer = setTimeout(() => done(new Error('The report took too long to render.')), deps.timeoutMs ?? 20_000);
    ipcMain.on('report:printReady', onReady);
    w.webContents.once('did-fail-load', () => done(new Error('The report page failed to load.')));
    const t = printUrl({ devUrl: deps.devUrl, file: deps.indexFile }, date);
    if (t.kind === 'url') void w.loadURL(`${t.target}?print=${encodeURIComponent(date)}`);
    else void w.loadFile(t.target, { query: t.query });
  });
}
