import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SCREEN_SCHEMA, createScreenStore } from '../screen/store';
import { createLabelStore, type LabelStore } from '../screen/labels';
import type { BrainRequest } from './protocol';
import { createLabelScheduler, LOAD_ALLOWANCE_MS, RESULT_GAP_MS, type BrainChild } from './scheduler';

const MIN = 60_000;
class FakeBrain implements BrainChild {
  sent: BrainRequest[] = []; killed = false;
  private msg: ((m: unknown) => void) | null = null; private exit: ((c: number | null) => void) | null = null;
  post(m: BrainRequest) { this.sent.push(m); }
  onMessage(cb: (m: unknown) => void) { this.msg = cb; }
  onExit(cb: (c: number | null) => void) { this.exit = cb; }
  kill() { this.killed = true; }
  reply(m: unknown) { this.msg?.(m); }
  die(code: number | null) { this.exit?.(code); }
}

let now: number; let store: LabelStore; let brains: FakeBrain[]; let ready: boolean; let db: Database.Database;
const add = (n: number, at = now) => { const s = createScreenStore(db); for (let i = 0; i < n; i++) s.insert({ at, date: '2026-09-25', appName: 'Code', windowTitle: 't', text: `x${i}`, textHash: `h${i}-${at}` }); };
const make = (over: Partial<Parameters<typeof createLabelScheduler>[0]> = {}) =>
  createLabelScheduler({ store, fork: () => { const b = new FakeBrain(); brains.push(b); return b; }, modelReady: () => ready, modelDir: 'M', now: () => now, ...over });
const labelOf = (id: number) => ({ id, category: 'work', categoryConf: 0.9, activity: null, activityConf: null, stuck: null, distraction: null });
const result = (id: number) => ({ op: 'label', result: labelOf(id) });
const ids = (b: FakeBrain) => b.sent[0].reads.map((r) => r.id);
/** The Brain streams one message per read, then 'done'. */
const finishBatch = (b: FakeBrain) => { for (const id of ids(b)) b.reply(result(id)); b.reply({ op: 'done' }); };
const labeledAt = (id: number) => (db.prepare('SELECT labeled_at AS t FROM screen_reads WHERE id = ?').get(id) as { t: number | null }).t;
const last = () => brains[brains.length - 1];

beforeEach(() => { vi.useFakeTimers(); now = 10 * MIN; db = new Database(':memory:'); db.exec(SCREEN_SCHEMA); store = createLabelStore(db); brains = []; ready = true; });
afterEach(() => vi.useRealTimers());

describe('label scheduler', () => {
  it('waits for 20 reads or a 10-minute-old read, and never runs without the model', () => {
    const s = make();
    add(19); s.tick(); expect(brains).toHaveLength(0);
    now += 10 * MIN; s.tick(); expect(brains).toHaveLength(1);
    expect(brains[0].sent[0]).toMatchObject({ op: 'label', modelDir: 'M' });
    expect(brains[0].sent[0].reads).toHaveLength(19);
  });
  it('queries the pending count and oldest read once per tick', () => {
    add(20);
    const counting = { ...store, countUnlabelled: vi.fn(store.countUnlabelled), unlabelledSummary: vi.fn(store.unlabelledSummary) };
    make({ store: counting }).tick();
    expect(brains).toHaveLength(1);
    expect(counting.unlabelledSummary).toHaveBeenCalledTimes(1);
    expect(counting.countUnlabelled).not.toHaveBeenCalled();
  });
  it('reports waiting when the model is missing', () => {
    ready = false; add(25); const s = make(); s.tick();
    expect(brains).toHaveLength(0);
    expect(s.status()).toMatchObject({ state: 'waiting', pending: 25 });
  });
  it('sends at most 50 reads and stores the labels', () => {
    add(60); const s = make(); s.tick();
    expect(brains[0].sent[0].reads).toHaveLength(50);
    finishBatch(brains[0]);
    expect(brains[0].killed).toBe(true);
    brains[0].die(0);
    expect(s.status()).toMatchObject({ state: 'idle', pending: 10, lastLabelledAt: now });
  });
  it('stores each result as soon as it arrives, before the batch is done', () => {
    add(20); const s = make(); s.tick();
    const [first, second] = ids(brains[0]);
    brains[0].reply(result(first));
    expect(labeledAt(first)).toBe(now);
    expect(s.status()).toMatchObject({ state: 'running', pending: 19 });
    now += 5_000;
    brains[0].reply(result(second));
    expect(labeledAt(second)).toBe(now);
    expect(s.status().pending).toBe(18);
    expect(brains[0].killed).toBe(false);
  });
  it('on done: kills the child, copies labels onto duplicates, and goes idle', () => {
    add(20); const s = make(); s.tick();
    const dup = createScreenStore(db).insert({ at: now + 1, date: '2026-09-25', appName: 'Code', windowTitle: 't', text: null, textHash: `h0-${now}` });
    for (const id of ids(brains[0])) brains[0].reply(result(id));
    expect(labeledAt(dup)).toBeNull(); // duplicates are copied once the batch is done
    expect(brains[0].killed).toBe(false);
    brains[0].reply({ op: 'done' });
    expect(brains[0].killed).toBe(true);
    expect(labeledAt(dup)).toBe(now);
    expect(s.status()).toMatchObject({ state: 'idle', pending: 0 });
  });
  it('does not count a successful batch as a crash when exit arrives before the messages', () => {
    add(20); const s = make(); s.tick();
    brains[0].die(0);
    finishBatch(brains[0]); // late messages within the grace period
    vi.advanceTimersByTime(2000);
    expect(s.status().pending).toBe(0);
    add(20); s.tick(); expect(brains).toHaveLength(2); // no backoff was applied
  });
  it('rejects invalid Brain output and backs off 1 s, 5 s, 30 s, then pauses', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    add(40); const s = make();
    const failOnce = () => { s.tick(); const b = last(); b.reply({ op: 'label', result: { id: 'bad' } }); return b; };
    const b0 = failOnce(); expect(s.status().pending).toBe(40);
    expect(b0.killed).toBe(true);
    now += 999; s.tick(); expect(brains).toHaveLength(1);
    now += 1; failOnce(); expect(brains).toHaveLength(2);
    now += 4_999; s.tick(); expect(brains).toHaveLength(2);
    now += 1; failOnce(); expect(brains).toHaveLength(3);
    now += 29_999; s.tick(); expect(brains).toHaveLength(3);
    now += 1; failOnce(); expect(brains).toHaveLength(4);
    expect(s.status().state).toBe('paused');
    warn.mockRestore();
  });
  it('treats an error message as a failure', () => {
    add(20); const s = make(); s.tick();
    brains[0].reply({ op: 'error', message: 'model load failed' });
    expect(brains[0].killed).toBe(true);
    expect(s.status().state).toBe('idle');
    s.tick(); expect(brains).toHaveLength(1); // backoff applies
  });
  it('recovers when storing labels throws (SQLITE_BUSY, disk full, ...): idle, killed, backs off', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    add(20);
    const s = make({ store: { ...store, applyLabels: () => { throw new Error('boom'); } } });
    s.tick();
    brains[0].reply(result(ids(brains[0])[0]));
    expect(brains[0].killed).toBe(true);
    expect(errSpy).toHaveBeenCalledWith('[brain] storing labels failed:', expect.any(Error));
    expect(s.status().state).toBe('idle');
    now += 999; s.tick(); expect(brains).toHaveLength(1); // backoff applies, no new batch within 1 s
    errSpy.mockRestore();
  });
  it('recovers immediately when child.post() throws synchronously (no watchdog stall)', () => {
    add(20);
    const s = make({ fork: () => { const b = new FakeBrain(); b.post = () => { throw new Error('IPC channel closed'); }; brains.push(b); return b; } });
    s.tick();
    expect(s.status().state).toBe('idle');
    expect(brains[0].killed).toBe(true);
    now += 999; s.tick(); expect(brains).toHaveLength(1); // backoff applies, no new batch within 1 s
    now += 1; s.tick(); expect(brains).toHaveLength(2);
    expect(s.status().pending).toBe(20); // an IPC failure is not the read's fault: nothing is skipped
  });
  it('recovers when fork() throws (idle, backs off, then succeeds once the backoff elapses)', () => {
    add(20);
    let calls = 0;
    const s = make({ fork: () => { calls++; if (calls === 1) throw new Error('spawn failed'); const b = new FakeBrain(); brains.push(b); return b; } });
    s.tick();
    expect(brains).toHaveLength(0);
    expect(s.status().state).toBe('idle');
    now += 999; s.tick(); expect(brains).toHaveLength(0); // still within backoff
    now += 1; s.tick(); expect(brains).toHaveLength(1); // backoff elapsed
  });
  it('ignores a label result whose id was not in the batch sent', () => {
    add(20); const s = make(); s.tick();
    add(1, now + 1); // a fresh read arrives after this batch was already fetched
    const strayId = store.unlabelled(21).at(-1)!.id;
    brains[0].reply(result(strayId));
    finishBatch(brains[0]);
    expect(s.status().pending).toBe(1); // only the stray row (outside the batch) is still unlabelled
  });
  it('pauses after more than 3 failures within 10 minutes and resumes on retry', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    add(40); const s = make();
    for (let i = 0; i < 4; i++) { s.tick(); last().die(1); now += 31_000; }
    expect(s.status().state).toBe('paused');
    s.tick(); expect(brains).toHaveLength(4);
    s.retry(); s.tick(); expect(brains).toHaveLength(5);
    warn.mockRestore();
  });
  it('watchdog: kills a batch that sends no result within the load allowance (90 s) and counts a failure', () => {
    add(20); const s = make(); s.tick();
    vi.advanceTimersByTime(LOAD_ALLOWANCE_MS - 1);
    expect(brains[0].killed).toBe(false);
    vi.advanceTimersByTime(1);
    expect(brains[0].killed).toBe(true);
    expect(s.status().state).toBe('idle');
    s.tick(); expect(brains).toHaveLength(1); // still within the 1 s backoff (now unchanged)
    now += 1000; s.tick(); expect(brains).toHaveLength(2);
  });
  it('watchdog: kills a batch when the gap after a result exceeds 60 s, keeping what was stored', () => {
    add(20); const s = make(); s.tick();
    vi.advanceTimersByTime(80_000);
    brains[0].reply(result(ids(brains[0])[0]));
    vi.advanceTimersByTime(RESULT_GAP_MS - 1);
    expect(brains[0].killed).toBe(false);
    vi.advanceTimersByTime(1);
    expect(brains[0].killed).toBe(true);
    expect(s.status()).toMatchObject({ state: 'idle', pending: 19 });
  });
  it('watchdog: steady results keep a slow batch alive well past 120 s', () => {
    add(20); const s = make(); s.tick();
    const all = ids(brains[0]);
    for (const id of all.slice(0, 5)) { vi.advanceTimersByTime(50_000); brains[0].reply(result(id)); } // 250 s in
    expect(brains[0].killed).toBe(false);
    expect(s.status()).toMatchObject({ state: 'running', pending: 15 });
    for (const id of all.slice(5)) { vi.advanceTimersByTime(50_000); brains[0].reply(result(id)); }
    brains[0].reply({ op: 'done' });
    expect(brains[0].killed).toBe(true);
    expect(s.status()).toMatchObject({ state: 'idle', pending: 0 });
  });
  it('ignores a late result after the watchdog killed the batch (writes no labels)', () => {
    add(20); const s = make(); s.tick();
    vi.advanceTimersByTime(LOAD_ALLOWANCE_MS);
    brains[0].reply(result(ids(brains[0])[0])); // arrives after the child was already killed off
    expect(s.status().pending).toBe(20);
  });
  it('a failed batch that stored at least one result does not count toward backoff or pause', () => {
    add(40); const s = make();
    for (let i = 0; i < 6; i++) {
      s.tick();
      expect(brains).toHaveLength(i + 1); // runs again straight away: no backoff
      last().reply(result(ids(last())[0]));
      last().die(1);
    }
    expect(s.status()).toMatchObject({ state: 'idle', pending: 34 });
  });
  it('skips a poison read (marks it done with no labels) after it was first in line for 2 failed batches', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    add(40); const s = make(); s.tick();
    const [poison] = ids(brains[0]);
    brains[0].die(1);
    now += 1_000; s.tick();
    expect(ids(brains[1])[0]).toBe(poison);
    brains[1].die(1);
    expect(labeledAt(poison)).toBe(now);
    expect(db.prepare('SELECT category FROM screen_reads WHERE id = ?').get(poison)).toEqual({ category: null });
    expect(warn).toHaveBeenCalledWith('[brain] skipping read after 2 failed batches:', poison); // id only, never text
    now += 5_000; s.tick();
    expect(ids(brains[2])).not.toContain(poison);
    expect(s.status().pending).toBe(39);
    warn.mockRestore();
  });
  it('counts the read after the last stored result as the one a partial batch failed on', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    add(40); const s = make(); s.tick();
    const [first, stuck] = ids(brains[0]);
    brains[0].reply(result(first));
    vi.advanceTimersByTime(RESULT_GAP_MS); // hangs on the second read
    s.tick();
    expect(ids(brains[1])[0]).toBe(stuck);
    brains[1].die(1);
    expect(labeledAt(stuck)).toBe(now);
    warn.mockRestore();
  });
  it('blocks new captures only while labelling cannot run and more than 20 reads wait', () => {
    ready = false; add(20); const s = make();
    expect(s.backlogBlocked()).toBe(false);
    add(1, now + 1); expect(s.backlogBlocked()).toBe(true);
    ready = true; expect(s.backlogBlocked()).toBe(false);
  });
});
