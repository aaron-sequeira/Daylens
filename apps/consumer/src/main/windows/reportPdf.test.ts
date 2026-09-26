import { describe, it, expect } from 'vitest';
import { exportPdf, pdfFileName, PDF_OPTIONS, printUrl } from './reportPdf';

describe('report pdf', () => {
  it('names files and prints A4 with backgrounds', () => {
    expect(pdfFileName('2026-09-26')).toBe('Daylens-2026-09-26.pdf');
    expect(PDF_OPTIONS).toMatchObject({ pageSize: 'A4', printBackground: true });
  });
  it('builds the print target for dev and packaged builds', () => {
    expect(printUrl({ devUrl: 'http://localhost:5173', file: 'C:/app/index.html' }, '2026-09-26')).toEqual({ kind: 'url', target: 'http://localhost:5173', query: { print: '2026-09-26' } });
    expect(printUrl({ file: 'C:/app/index.html' }, '2026-09-26')).toEqual({ kind: 'file', target: 'C:/app/index.html', query: { print: '2026-09-26' } });
  });
  it('writes the rendered PDF and reports failures as text', async () => {
    const written: string[] = [];
    expect(await exportPdf('2026-09-26', { render: async () => Buffer.from('%PDF'), write: async (p) => { written.push(p); } }, 'C:/out.pdf')).toBe('ok');
    expect(written).toEqual(['C:/out.pdf']);
    expect(await exportPdf('2026-09-26', { render: async () => { throw new Error('render timeout'); }, write: async () => {} }, 'C:/out.pdf')).toMatch(/render timeout/);
  });
});
