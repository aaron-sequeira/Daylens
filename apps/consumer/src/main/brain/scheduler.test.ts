import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SCREEN_SCHEMA, createScreenStore } from '../screen/store';
import { createLabelStore, type LabelStore } from '../screen/labels';
import type { BrainRequest } from './protocol';
import { createLabelScheduler, type BrainChild } from './scheduler';

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
const make = () => createLabelScheduler({ store, fork: () => { const b = new FakeBrain(); brains.push(b); return b; }, modelReady: () => ready, modelDir: 'M', now: () => now });
const labelsFor = (b: FakeBrain) => ({ op: 'labels', results: b.sent[0].reads.map((r) => ({ id: r.id, category: 'work', categoryConf: 0.9, activity: null, activityConf: null, stuck: null, distraction: null })) });

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
  it('reports waiting when the model is missing', () => {
    ready = false; add(25); const s = make(); s.tick();
    expect(brains).toHaveLength(0);
    expect(s.status()).toMatchObject({ state: 'waiting', pending: 25 });
  });
  it('sends at most 50 reads and stores the labels', () => {
    add(60); const s = make(); s.tick();
    expect(brains[0].sent[0].reads).toHaveLength(50);
    brains[0].reply(labelsFor(brains[0]));
    expect(brains[0].killed).toBe(true);
    brains[0].die(0);
    expect(s.status()).toMatchObject({ state: 'idle', pending: 10, lastLabelledAt: now });
  });
  it('does not count a successful batch as a crash when exit arrives before the message', () => {
    add(20); const s = make(); s.tick();
    brains[0].die(0);
    brains[0].reply(labelsFor(brains[0])); // late message within the grace period
    vi.advanceTimersByTime(2000);
    expect(s.status().pending).toBe(0);
    add(20); s.tick(); expect(brains).toHaveLength(2); // no backoff was applied
  });
  it('rejects invalid Brain output and backs off 1 s, 5 s, 30 s, then pauses', () => {
    add(20); const s = make();
    const failOnce = () => { s.tick(); const b = brains[brains.length - 1]; b.reply({ op: 'labels', results: [{ id: 'bad' }] }); return b; };
    const b0 = failOnce(); expect(s.status().pending).toBe(20);
    expect(b0.killed).toBe(true);
    now += 999; s.tick(); expect(brains).toHaveLength(1);
    now += 1; failOnce(); expect(brains).toHaveLength(2);
    now += 5000; failOnce(); expect(brains).toHaveLength(3);
    now += 30_000; failOnce(); expect(brains).toHaveLength(4);
  });
  it('pauses after more than 3 failures within 10 minutes and resumes on retry', () => {
    add(20); const s = make();
    for (let i = 0; i < 4; i++) { s.tick(); brains[brains.length - 1].die(1); now += 31_000; }
    expect(s.status().state).toBe('paused');
    s.tick(); expect(brains).toHaveLength(4);
    s.retry(); s.tick(); expect(brains).toHaveLength(5);
  });
  it('kills a batch that runs longer than 120 s', () => {
    add(20); const s = make(); s.tick();
    vi.advanceTimersByTime(120_000);
    expect(brains[0].killed).toBe(true);
    expect(s.status().state).toBe('idle');
  });
  it('blocks new captures only while labelling cannot run and more than 20 reads wait', () => {
    ready = false; add(20); const s = make();
    expect(s.backlogBlocked()).toBe(false);
    add(1, now + 1); expect(s.backlogBlocked()).toBe(true);
    ready = true; expect(s.backlogBlocked()).toBe(false);
  });
});
