export interface PdfQueue { schedule(date: string): void; }

/** Serialises calls to `run` (one hidden PDF render window at a time) and coalesces requests
 * that stack up while a run is in flight: only the most recently scheduled date is kept queued,
 * so a burst of schedule() calls (e.g. a report regenerated right after it first went ready)
 * never opens more than one extra render window once the current one finishes. `run` is expected
 * never to throw (autoSavePdf already turns failures into a returned string); a stray rejection
 * is swallowed so one bad run can't wedge the queue. */
export function createPdfQueue(run: (date: string) => Promise<void>): PdfQueue {
  let busy = false;
  let next: string | null = null;

  const drain = (): void => {
    if (next === null) { busy = false; return; }
    const date = next;
    next = null;
    busy = true;
    let job: Promise<void>;
    try { job = run(date); } catch { job = Promise.resolve(); } // run() is expected to be async and never throw synchronously; guarded anyway
    void job.catch(() => {}).then(drain);
  };

  return {
    schedule(date) {
      next = date; // replaces whatever was queued (same date or not); at most one job waits behind the running one
      if (!busy) drain();
    }
  };
}
