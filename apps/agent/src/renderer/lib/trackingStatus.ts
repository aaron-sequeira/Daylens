import type { TrackingStatus } from '../../shared/types';

export interface TrackingDisplay {
  active: boolean;
  appName: string | null;
  elapsedSec: number | null;
}

/** Derive what the live badge should show from the tracker status at a given time. */
export function trackingDisplay(status: TrackingStatus, nowMs: number): TrackingDisplay {
  if (status.paused) return { active: false, appName: null, elapsedSec: null };
  const elapsedSec = status.sessionStartedAt != null
    ? Math.max(0, Math.floor((nowMs - status.sessionStartedAt) / 1000))
    : null;
  return { active: true, appName: status.currentApp, elapsedSec };
}
