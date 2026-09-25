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
  it('keeps confident choices, marks unsure ones uncertain, keeps scores', () => {
    expect(toStoredLabel(7, { category: choice('work', 0.8), activity: choice('coding', 0.3), stuck: score(0.4), distraction: score(1.6) }))
      .toEqual({ id: 7, category: 'work', categoryConf: 0.8, activity: 'uncertain', activityConf: 0.3, stuck: 0.4, distraction: 1.6 });
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
    expect(labels.oldestUnlabelledAt()).toBe(1000);
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
  it('returns only confident categories for a day', () => {
    const a = add(1000, 'a', 'ha', 'Chrome'); const b = add(2000, 'b', 'hb', 'Chrome'); add(3000, 'c', 'hc', 'Chrome', '2026-09-24');
    labels.applyLabels([
      { id: a, category: 'social', categoryConf: 0.9, activity: null, activityConf: null, stuck: null, distraction: null },
      { id: b, category: 'uncertain', categoryConf: 0.2, activity: null, activityConf: null, stuck: null, distraction: null }
    ], 5000);
    expect(labels.confidentForDay('2026-09-25')).toEqual([{ at: 1000, appName: 'Chrome', category: 'social' }]);
  });
});
