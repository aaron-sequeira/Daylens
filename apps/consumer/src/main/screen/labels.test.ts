import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import type { LayaAnswer } from '../brain/laya';
import { SCREEN_SCHEMA, createScreenStore, type ScreenStore } from './store';
import { createLabelStore, toStoredLabel, type LabelStore } from './labels';

const choice = (c: string, conf: number): LayaAnswer => ({ type: 'choice', choice: c, probabilities: {}, confidence: conf });
const score = (s: number): LayaAnswer => ({ type: 'score', score: s, probabilities: {}, confidence: 0.9 });

let db: Database.Database; let screen: ScreenStore; let labels: LabelStore;
beforeEach(() => { db = new Database(':memory:'); db.exec(SCREEN_SCHEMA); screen = createScreenStore(db); labels = createLabelStore(db); });
const add = (at: number, text: string | null, hash: string, app = 'Code', date = '2026-09-25'): number =>
  screen.insert({ at, date, appName: app, windowTitle: 't', text, textHash: hash });
const row = (id: number) => db.prepare('SELECT category, category_conf AS categoryConf, activity, stuck, distraction, labeled_at AS labeledAt FROM screen_reads WHERE id = ?').get(id) as Record<string, unknown>;

describe('toStoredLabel', () => {
  it('always keeps Laya\'s own choice, confident or not, keeps scores', () => {
    expect(toStoredLabel(7, { category: choice('work', 0.8), activity: choice('coding', 0.3), stuck: score(0.4), distraction: score(1.6) }))
      .toEqual({ id: 7, category: 'work', categoryConf: 0.8, activity: 'coding', activityConf: 0.3, stuck: 0.4, distraction: 1.6 });
  });
  it('tolerates missing answers', () => {
    expect(toStoredLabel(1, {})).toEqual({ id: 1, category: null, categoryConf: null, activity: null, activityConf: null, stuck: null, distraction: null });
  });
});

describe('label store', () => {
  it('lists unlabelled reads with text, oldest first, and counts them', () => {
    add(2000, 'b', 'hb'); add(1000, 'a', 'ha'); add(3000, null, 'ha');
    expect(labels.unlabelled(10).map((r) => r.text)).toEqual(['a', 'b']);
    expect(labels.countUnlabelled()).toBe(2);
    expect(labels.unlabelledSummary()).toEqual({ count: 2, oldest: 1000 });
  });
  it('reports no oldest read when nothing is waiting', () => {
    expect(labels.unlabelledSummary()).toEqual({ count: 0, oldest: null });
  });
  it('pending-read and last-labelled queries use an index, never a full-table scan', () => {
    const plan = (sql: string) => (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[]).map((r) => r.detail).join(' | ');
    const indexed = /USING (COVERING )?INDEX idx_reads_(unlabelled|labeled)\b/;
    const pending = 'labeled_at IS NULL AND text IS NOT NULL'; // same WHERE as labels.ts
    // The planner may pick either the partial idx_reads_unlabelled or idx_reads_labeled (labeled_at IS NULL search).
    expect(plan(`SELECT id FROM screen_reads WHERE ${pending} ORDER BY at, id LIMIT 50`)).toMatch(indexed);
    expect(plan(`SELECT count(*), min(at) FROM screen_reads WHERE ${pending}`)).toMatch(indexed);
    expect(plan('SELECT max(labeled_at) FROM screen_reads')).toMatch(indexed);
    expect(plan(`SELECT id FROM screen_reads INDEXED BY idx_reads_unlabelled WHERE ${pending} ORDER BY at, id`)).toMatch(/idx_reads_unlabelled/); // partial index matches this WHERE
  });
  it('applies labels in one go and reports the last labelling time', () => {
    const a = add(1000, 'a', 'ha');
    labels.applyLabels([{ id: a, category: 'social', categoryConf: 0.9, activity: 'chatting', activityConf: 0.8, stuck: 0, distraction: 1.2 }], 5000);
    expect(row(a)).toMatchObject({ category: 'social', categoryConf: 0.9, activity: 'chatting', distraction: 1.2, labeledAt: 5000 });
    expect(labels.countUnlabelled()).toBe(0);
    expect(labels.lastLabelledAt()).toBe(5000);
  });
  it('copies labels onto a duplicate only once its original is labelled', () => {
    const a = add(1000, 'a', 'ha');
    const dup = add(2000, null, 'ha');
    expect(labels.copyDupLabels(3000)).toBe(0);
    expect(row(dup).labeledAt).toBeNull();
    labels.applyLabels([{ id: a, category: 'work', categoryConf: 0.7, activity: 'coding', activityConf: 0.6, stuck: 0.1, distraction: 0 }], 4000);
    expect(labels.copyDupLabels(5000)).toBe(1);
    expect(row(dup)).toMatchObject({ category: 'work', activity: 'coding', labeledAt: 5000 });
  });
  it('does not label a row whose text was purged before labels arrived', () => {
    const a = add(1000, null, ''); // text already purged
    labels.applyLabels([{ id: a, category: 'social', categoryConf: 0.9, activity: null, activityConf: null, stuck: null, distraction: null }], 5000);
    expect(row(a)).toMatchObject({ category: null, labeledAt: null });
  });
  it('marks purged unlabelled rows as done with no labels', () => {
    const p = add(1000, null, '');
    expect(labels.markPurged(9000)).toBe(1);
    expect(row(p)).toMatchObject({ category: null, labeledAt: 9000 });
  });
  it('marks a read that keeps failing as done with no labels, leaving labelled rows alone', () => {
    const bad = add(1000, 'a', 'ha'); const good = add(2000, 'b', 'hb');
    labels.applyLabels([{ id: good, category: 'work', categoryConf: 0.9, activity: null, activityConf: null, stuck: null, distraction: null }], 3000);
    labels.markFailed(bad, 9000);
    labels.markFailed(good, 9000);
    expect(row(bad)).toMatchObject({ category: null, labeledAt: 9000 });
    expect(row(good)).toMatchObject({ category: 'work', labeledAt: 3000 });
    expect(labels.countUnlabelled()).toBe(0);
  });
  it('returns all labelled categories (with confidence) for a day, excluding legacy uncertain rows', () => {
    const a = add(1000, 'a', 'ha', 'Chrome'); const b = add(2000, 'b', 'hb', 'Chrome'); add(3000, 'c', 'hc', 'Chrome', '2026-09-24');
    labels.applyLabels([
      { id: a, category: 'social', categoryConf: 0.9, activity: null, activityConf: null, stuck: null, distraction: null },
      // simulates a legacy dev-DB row from before Laya always stored its own choice
      { id: b, category: 'uncertain', categoryConf: 0.2, activity: null, activityConf: null, stuck: null, distraction: null }
    ], 5000);
    expect(labels.labelsForDay('2026-09-25')).toEqual([{ at: 1000, appName: 'Chrome', category: 'social', conf: 0.9 }]);
  });
  it('includes a low-confidence category now that Laya always stores its own guess', () => {
    const a = add(1000, 'a', 'ha', 'Discord');
    labels.applyLabels([{ id: a, category: 'entertainment', categoryConf: 0.2, activity: null, activityConf: null, stuck: null, distraction: null }], 5000);
    expect(labels.labelsForDay('2026-09-25')).toEqual([{ at: 1000, appName: 'Discord', category: 'entertainment', conf: 0.2 }]);
  });
  it('lists labelled reads since a time with scores', () => {
    const a = add(1000, 'a', 'ha'); add(2000, 'b', 'hb');
    labels.applyLabels([{ id: a, category: 'work', categoryConf: 0.8, activity: 'coding', activityConf: 0.7, stuck: 1.6, distraction: 0.2 }], 3000);
    expect(labels.readsSince(500)).toEqual([{ at: 1000, appName: 'Code', windowTitle: 't', category: 'work', conf: 0.8, stuck: 1.6, distraction: 0.2 }]);
  });
});
