import { createHash } from 'node:crypto';
import type { ForegroundSource } from '@worksight/core';
import { localDate } from '@worksight/core/date';
import type { DaylensSettings } from '../settings';
import type { OcrClient } from '../ocr/client';
import type { ScreenStore } from './store';
import { redact } from './redact';
import { isExcluded, parseExclusions } from './exclusions';

export type ReadOutcome = 'skipped-off' | 'skipped-idle' | 'skipped-backlog' | 'skipped-self' | 'skipped-excluded' | 'skipped-same' | 'no-capture' | 'discarded' | 'stored' | 'stored-dup';
export const SAME_WINDOW_MS = 120_000;
export interface ScreenReader { tick(): Promise<ReadOutcome>; }

export function createScreenReader(deps: {
  ocr: Pick<OcrClient, 'capture'>; foreground: ForegroundSource; settings: () => DaylensSettings;
  idleSec: () => number; store: ScreenStore; now: () => number; selfPid: number;
  backlogBlocked?: () => boolean;
}): ScreenReader {
  return {
    async tick() {
      const s = deps.settings();
      if (!s.screenReading || !s.consentGranted || s.trackingPaused) return 'skipped-off';
      if (deps.idleSec() >= s.idleThresholdSec) return 'skipped-idle';
      // Labelling can't keep up (model not ready or paused): stop growing the queue until it drains.
      if (deps.backlogBlocked?.()) return 'skipped-backlog';
      const fg = await deps.foreground.get();
      if (!fg) return 'no-capture';
      // Never OCR our own window: opening Settings -> Privacy would otherwise re-store Daylens's own UI
      // text on the next tick, restarting its retention clock, and the peek would show Daylens itself.
      if (fg.pid === deps.selfPid) return 'skipped-self';
      const patterns = parseExclusions(s.exclusions);
      if (isExcluded(patterns, fg.appName, fg.title)) return 'skipped-excluded';
      const now = deps.now();
      const title = s.captureWindowTitles ? fg.title : null;
      const last = deps.store.last();
      if (last && last.appName === fg.appName && last.windowTitle === title && now >= last.at && now - last.at < SAME_WINDOW_MS) return 'skipped-same';
      const cap = await deps.ocr.capture();
      if (!cap) return 'no-capture';
      // Settings may have changed during capture (up to 8 s): re-check before storing.
      const s2 = deps.settings();
      if (!s2.screenReading || !s2.consentGranted || s2.trackingPaused) return 'skipped-off';
      const patterns2 = parseExclusions(s2.exclusions);
      // The window may have changed between the check above and the capture: never keep text from another
      // process or from an excluded window (check both pre-capture and captured titles).
      if (cap.pid !== fg.pid || isExcluded(patterns2, fg.appName, fg.title) || isExcluded(patterns2, fg.appName, cap.title)) return 'discarded';
      const storedTitle = s2.captureWindowTitles ? cap.title : null;
      const text = redact(cap.text);
      const textHash = createHash('sha1').update(text).digest('hex');
      const dup = last?.textHash === textHash;
      deps.store.insert({ at: now, date: localDate(now), appName: fg.appName, windowTitle: storedTitle, text: dup ? null : text, textHash });
      return dup ? 'stored-dup' : 'stored';
    }
  };
}

/** Erase stored text older than `days` (rows are kept for time accounting). Returns rows purged. */
export function runRetention(store: ScreenStore, days: number, now: number): number {
  if (days <= 0) return 0;
  return store.purgeTextBefore(now - days * 86_400_000);
}
