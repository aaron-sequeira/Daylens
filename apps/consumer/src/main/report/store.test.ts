import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { createReportStore, REPORT_SQL } from './store';
import type { ReportJson } from './schema';

const rep: ReportJson = { headline: 'H', story: 'S', wins: [], habits: [], doBetter: [], plan: [], advice: 'A' };
const mk = () => { const db = new Database(':memory:'); db.exec(REPORT_SQL); return { db, s: createReportStore(db) }; };

describe('report store', () => {
  it('moves a report through pending → ready and replaces it on regenerate', () => {
    const { s } = mk();
    expect(s.get('2026-09-26')).toBeNull();
    s.setPending('2026-09-26', 1);
    expect(s.get('2026-09-26')).toMatchObject({ status: 'pending', report: null });
    s.setReady('2026-09-26', rep, 'Qwen3 4B', 2);
    expect(s.get('2026-09-26')).toMatchObject({ status: 'ready', report: rep, model: 'Qwen3 4B', generatedAt: 2, error: null });
    s.setFailed('2026-09-26', 'timeout', 3);
    expect(s.get('2026-09-26')).toMatchObject({ status: 'failed', error: 'timeout', report: null });
  });
  it('notes a failed regenerate on a ready report without losing it, and a new report clears the note', () => {
    const { s } = mk();
    s.setReady('2026-09-26', rep, 'Qwen3 4B', 2);
    s.noteError('2026-09-26', 'The writer took too long.');
    expect(s.get('2026-09-26')).toMatchObject({ status: 'ready', report: rep, model: 'Qwen3 4B', generatedAt: 2, error: 'The writer took too long.' });
    s.setReady('2026-09-26', rep, 'Qwen3 4B', 3);
    expect(s.get('2026-09-26')?.error).toBeNull();
  });
  it('deletes one day\'s row so the automatic rule can write it again', () => {
    const { s } = mk();
    s.setFailed('2026-09-26', 'The writer took too long.', 1); s.setReady('2026-09-25', rep, 'm', 1);
    s.delete('2026-09-26');
    expect(s.get('2026-09-26')).toBeNull();
    expect(s.dates()).toEqual(['2026-09-25']);
  });
  it('lists dates newest first and fails rows left pending by a restart', () => {
    const { s } = mk();
    s.setReady('2026-09-24', rep, 'm', 1); s.setPending('2026-09-26', 1); s.setReady('2026-09-25', rep, 'm', 1);
    expect(s.dates()).toEqual(['2026-09-26', '2026-09-25', '2026-09-24']);
    s.clearPending(9);
    expect(s.get('2026-09-26')).toMatchObject({ status: 'failed', error: 'interrupted' });
  });
  it('ticks plan items for the next day and unticks them', () => {
    const { s } = mk();
    const item = { kind: 'break_interval' as const, text: 'Breaks every 40 min', payload: { minutes: 40 } };
    s.tick('2026-09-26', item, true);
    s.tick('2026-09-26', item, true); // idempotent
    expect(s.plan('2026-09-27')).toEqual([{ id: expect.any(Number), forDate: '2026-09-27', sourceDate: '2026-09-26', item, enabled: true }]);
    expect(s.tickedTexts('2026-09-26')).toEqual(['Breaks every 40 min']);
    s.setEnabled(s.plan('2026-09-27')[0].id, false);
    expect(s.plan('2026-09-27')[0].enabled).toBe(false);
    s.tick('2026-09-26', item, false);
    expect(s.plan('2026-09-27')).toEqual([]);
  });

  it('drops corrupt plan_items rows with unparseable payload_json', () => {
    const { db, s } = mk();
    const item = { kind: 'break_interval' as const, text: 'Breaks', payload: { minutes: 40 } };
    s.tick('2026-09-26', item, true);
    // Insert a corrupt row directly
    db.prepare('INSERT INTO plan_items (for_date, kind, payload_json, text, source_date) VALUES (?, ?, ?, ?, ?)')
      .run('2026-09-27', 'break_interval', 'not json', 'Corrupt', '2026-09-26');
    // plan() should return only the good item, dropping the corrupt one
    const items = s.plan('2026-09-27');
    expect(items).toHaveLength(1);
    expect(items[0].item.text).toBe('Breaks');
  });

  it('treats ready report with unparseable report_json as failed with corrupt report error', () => {
    const { db, s } = mk();
    s.setReady('2026-09-26', rep, 'model', 1);
    // Corrupt the JSON directly in the database
    db.prepare('UPDATE daily_reports SET report_json = ? WHERE date = ?').run('not json', '2026-09-26');
    const row = s.get('2026-09-26')!;
    expect(row.status).toBe('failed');
    expect(row.error).toBe('corrupt report');
    expect(row.report).toBeNull();
  });
});
