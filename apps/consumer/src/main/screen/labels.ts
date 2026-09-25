import type Database from 'better-sqlite3';
import type { LayaAnswer } from '../brain/laya';
import { CONFIDENT } from '../brain/questions';

export interface StoredLabel { id: number; category: string | null; categoryConf: number | null; activity: string | null; activityConf: number | null; stuck: number | null; distraction: number | null; }
export interface ReadToLabel { id: number; app: string; title: string | null; text: string; }
export interface DayLabel { at: number; appName: string; category: string; }

const pick = (a: LayaAnswer | undefined): { v: string | null; c: number | null } =>
  a?.type === 'choice' ? { v: a.confidence >= CONFIDENT ? a.choice : 'uncertain', c: a.confidence } : { v: null, c: null };
const scoreOf = (a: LayaAnswer | undefined): number | null => (a?.type === 'score' ? a.score : null);

export function toStoredLabel(id: number, answers: Record<string, LayaAnswer>): StoredLabel {
  const cat = pick(answers.category), act = pick(answers.activity);
  return { id, category: cat.v, categoryConf: cat.c, activity: act.v, activityConf: act.c, stuck: scoreOf(answers.stuck), distraction: scoreOf(answers.distraction) };
}

export interface LabelStore {
  unlabelled(limit: number): ReadToLabel[];
  countUnlabelled(): number;
  oldestUnlabelledAt(): number | null;
  applyLabels(results: StoredLabel[], now: number): void;
  copyDupLabels(now: number): number;
  markPurged(now: number): number;
  lastLabelledAt(): number | null;
  confidentForDay(date: string): DayLabel[];
}

const PENDING = 'labeled_at IS NULL AND text IS NOT NULL';

export function createLabelStore(db: Database.Database): LabelStore {
  const unl = db.prepare(`SELECT id, app_name AS app, window_title AS title, text FROM screen_reads WHERE ${PENDING} ORDER BY at, id LIMIT ?`);
  const cnt = db.prepare(`SELECT count(*) AS n, min(at) AS oldest FROM screen_reads WHERE ${PENDING}`);
  // AND text IS NOT NULL: if the text was purged mid-batch, leave labels NULL (markPurged marks it done).
  const upd = db.prepare(`UPDATE screen_reads SET category = @category, category_conf = @categoryConf, activity = @activity, activity_conf = @activityConf,
    stuck = @stuck, distraction = @distraction, labeled_at = @now WHERE id = @id AND text IS NOT NULL`);
  // A duplicate (text NULL, hash kept) takes the labels of the latest earlier labelled read with the same hash.
  const copy = db.prepare(`UPDATE screen_reads AS d SET (category, category_conf, activity, activity_conf, stuck, distraction, labeled_at) =
    (SELECT s.category, s.category_conf, s.activity, s.activity_conf, s.stuck, s.distraction, @now FROM screen_reads s
      WHERE s.text_hash = d.text_hash AND s.labeled_at IS NOT NULL AND s.at <= d.at AND s.id <> d.id ORDER BY s.at DESC, s.id DESC LIMIT 1)
    WHERE d.labeled_at IS NULL AND d.text IS NULL AND d.text_hash <> ''
      AND EXISTS (SELECT 1 FROM screen_reads s WHERE s.text_hash = d.text_hash AND s.labeled_at IS NOT NULL AND s.at <= d.at AND s.id <> d.id)`);
  const purged = db.prepare(`UPDATE screen_reads SET labeled_at = ? WHERE labeled_at IS NULL AND text IS NULL AND text_hash = ''`);
  const last = db.prepare('SELECT max(labeled_at) AS t FROM screen_reads');
  const day = db.prepare(`SELECT at, app_name AS appName, category FROM screen_reads WHERE date = ? AND category IS NOT NULL AND category <> 'uncertain' ORDER BY at`);
  const applyAll = db.transaction((results: StoredLabel[], now: number) => { for (const r of results) upd.run({ ...r, now }); });
  return {
    unlabelled: (limit) => unl.all(limit) as ReadToLabel[],
    countUnlabelled: () => (cnt.get() as { n: number }).n,
    oldestUnlabelledAt: () => (cnt.get() as { oldest: number | null }).oldest,
    applyLabels: (results, now) => applyAll(results, now),
    copyDupLabels: (now) => copy.run({ now }).changes,
    markPurged: (now) => purged.run(now).changes,
    lastLabelledAt: () => (last.get() as { t: number | null }).t,
    confidentForDay: (date) => day.all(date) as DayLabel[]
  };
}
