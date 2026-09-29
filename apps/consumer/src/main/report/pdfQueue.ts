export interface PdfQueue { schedule(date: string): void; }

/** Serialises calls to `run` (one hidden PDF render window at a time). Keeps an ordered,
 * deduplicated queue of pending dates: scheduling a date that's already waiting leaves it queued
 * once (same-date coalescing), but distinct dates are never dropped — e.g. if yesterday's and
 * today's reports both go ready while a render is in flight, both still get saved, in the order
 * they were scheduled. `run` is expected never to throw (autoSavePdf already turns failures into
 * a returned string); a stray rejection is swallowed so one bad run can't stop the rest of the queue. */
export function createPdfQueue(run: (date: string) => Promise<void>): PdfQueue {
  let busy = false;
  const pending: string[] = [];

  const drain = (): void => {
    const date = pending.shift();
    if (date === undefined) { busy = false; return; }
    busy = true;
    let job: Promise<void>;
    try { job = run(date); } catch { job = Promise.resolve(); } // run() is expected to be async and never throw synchronously; guarded anyway
    void job.catch(() => {}).then(drain);
  };

  return {
    schedule(date) {
      if (!pending.includes(date)) pending.push(date); // same date already waiting: leave it queued once
      if (!busy) drain();
    }
  };
}
