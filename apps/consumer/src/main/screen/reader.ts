import { createHash } from 'node:crypto';
import type { ForegroundSource } from '@worksight/core';
import { localDate } from '@worksight/core/date';
import type { DaylensSettings } from '../settings';
import type { OcrClient } from '../ocr/client';
import type { ScreenStore } from './store';
import { redact } from './redact';
import { isExcluded, parseExclusions } from './exclusions';

export type ReadOutcome = 'skipped-off' | 'skipped-idle' | 'skipped-excluded' | 'skipped-same' | 'no-capture' | 'discarded' | 'stored' | 'stored-dup';
export const SAME_WINDOW_MS = 120_000;
export interface ScreenReader { tick(): Promise<ReadOutcome>; }

export function createScreenReader(deps: {
  ocr: Pick<OcrClient, 'capture'>; foreground: ForegroundSource; settings: () => DaylensSettings;
  idleSec: () => number; store: ScreenStore; now: () => number;
}): ScreenReader {
  return {
    async tick() {
      const s = deps.settings();
      if (!s.screenReading || !s.consentGranted || s.trackingPaused) return 'skipped-off';
      if (deps.idleSec() >= s.idleThresholdSec) return 'skipped-idle';
      const fg = await deps.foreground.get();
      if (!fg) return 'no-capture';
      const patterns = parseExclusions(s.exclusions);
      if (isExcluded(patterns, fg.appName, fg.title)) return 'skipped-excluded';
      const now = deps.now();
      const title = s.captureWindowTitles ? fg.title : null;
      const last = deps.store.last();
      if (last && last.appName === fg.appName && last.windowTitle === title && now - last.at < SAME_WINDOW_MS) return 'skipped-same';
      const cap = await deps.ocr.capture();
      if (!cap) return 'no-capture';
      // The window may have changed between the check above and the capture: never keep text from another
      // process or from an excluded window.
      if (cap.pid !== fg.pid || isExcluded(patterns, fg.appName, cap.title)) return 'discarded';
      const text = redact(cap.text);
      const textHash = createHash('sha1').update(text).digest('hex');
      const dup = last?.textHash === textHash;
      deps.store.insert({ at: now, date: localDate(now), appName: fg.appName, windowTitle: title, text: dup ? null : text, textHash });
      return dup ? 'stored-dup' : 'stored';
    }
  };
}

/** Erase stored text older than `days` (rows are kept for time accounting). Returns rows purged. */
export function runRetention(store: ScreenStore, days: number, now: number): number {
  return store.purgeTextBefore(now - days * 86_400_000);
}
