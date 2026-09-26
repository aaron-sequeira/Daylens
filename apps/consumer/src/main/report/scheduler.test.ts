import { describe, it, expect } from 'vitest';
import { createReportScheduler, type ReportSchedulerDeps } from './scheduler';

const at = (d: number, h: number, m = 0) => new Date(2026, 8, d, h, m).getTime();
function mk(o: Partial<ReportSchedulerDeps> = {}) {
  const rows = new Map<string, string>(); const ran: string[] = [];
  let now = at(26, 23, 5);
  const d: ReportSchedulerDeps = {
    now: () => now, windDown: () => '23:00', row: (date) => (rows.has(date) ? { status: rows.get(date)! } : null), hasActivity: () => true,
    canWrite: () => true, gateOk: () => true, otherJobRunning: () => false, lowBattery: async () => false,
    generate: async (date) => { ran.push(date); rows.set(date, 'ready'); return 'ok'; }, ...o
  };
  return { s: createReportScheduler(d), rows, ran, setNow: (t: number) => { now = t; } };
}

describe('report scheduler', () => {
  it("writes yesterday's missing report first, then today's after wind-down", async () => {
    const { s, ran } = mk();
    await s.tick(); await s.tick(); await s.tick();
    expect(ran).toEqual(['2026-09-25', '2026-09-26']);
  });
  it('waits before wind-down, and ignores days with no activity or an existing row', async () => {
    const { s, ran, rows, setNow } = mk({ hasActivity: (date) => date === '2026-09-26' });
    setNow(at(26, 22, 0)); await s.tick();
    expect(ran).toEqual([]);
    rows.set('2026-09-26', 'failed'); setNow(at(26, 23, 30)); await s.tick();
    expect(ran).toEqual([]); // failed reports are only retried by hand
  });
  it('treats a wind-down before 05:00 as covered by the next-day "yesterday" rule', async () => {
    const { s, ran, setNow } = mk({ windDown: () => '01:00', hasActivity: (d) => d === '2026-09-26' });
    setNow(at(26, 23, 0)); await s.tick();
    expect(ran).toEqual([]);
    setNow(at(27, 0, 10)); await s.tick();
    expect(ran).toEqual(['2026-09-26']);
  });
  it('waits for the memory gate, for labelling to finish, and for a usable writer', async () => {
    let gate = false, busy = true, can = false;
    const { s, ran } = mk({ gateOk: () => gate, otherJobRunning: () => busy, canWrite: () => can, hasActivity: (d) => d === '2026-09-26' });
    await s.tick(); expect(ran).toEqual([]);
    can = true; await s.tick(); expect(ran).toEqual([]); expect(s.waiting()).toBe('2026-09-26');
    gate = true; await s.tick(); expect(ran).toEqual([]);
    busy = false; await s.tick(); expect(ran).toEqual(['2026-09-26']); expect(s.waiting()).toBeNull();
  });
  it('holds automatic runs on low battery but not manual ones', async () => {
    const { s, ran } = mk({ lowBattery: async () => true, hasActivity: (d) => d === '2026-09-26' });
    await s.tick(); expect(ran).toEqual([]);
    s.request('2026-09-20'); await s.tick(); expect(ran).toEqual(['2026-09-20']);
  });
  it('regenerates on request even when a report exists, and never runs two at once', async () => {
    let release!: () => void;
    const { s, ran, rows } = mk({ hasActivity: () => false, generate: (date) => new Promise((r) => { ran.push(date); rows.set(date, 'ready'); release = () => r('ok'); }) });
    rows.set('2026-09-24', 'ready');
    s.request('2026-09-24');
    const first = s.tick(); await Promise.resolve();
    expect(s.running()).toBe('2026-09-24');
    s.request('2026-09-23'); await s.tick();
    expect(ran).toEqual(['2026-09-24']);
    release(); await first; await s.tick();
    expect(ran).toEqual(['2026-09-24', '2026-09-23']);
  });
  it('pauses automatic runs after 3 crashes in 10 minutes until resumed', async () => {
    const { s, ran, rows } = mk({ hasActivity: () => false, generate: async (date) => { ran.push(date); rows.set(date, 'failed'); return 'crash'; } });
    for (const d of ['2026-09-21', '2026-09-22', '2026-09-23']) { s.request(d); await s.tick(); }
    expect(s.autoPaused()).toBe(true);
    s.resume();
    expect(s.autoPaused()).toBe(false);
  });
});
