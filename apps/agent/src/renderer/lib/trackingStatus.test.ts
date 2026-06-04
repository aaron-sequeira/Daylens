import { describe, it, expect } from 'vitest';
import { trackingDisplay } from './trackingStatus';

describe('trackingDisplay', () => {
  it('reports paused (inactive) when tracking is paused', () => {
    expect(trackingDisplay({ paused: true, currentApp: 'Chrome', sessionStartedAt: 1000 }, 5000))
      .toEqual({ active: false, appName: null, elapsedSec: null });
  });

  it('reports the current app and elapsed seconds when active', () => {
    expect(trackingDisplay({ paused: false, currentApp: 'Chrome', sessionStartedAt: 1000 }, 6000))
      .toEqual({ active: true, appName: 'Chrome', elapsedSec: 5 });
  });

  it('is active but app-less before the first foreground is detected', () => {
    expect(trackingDisplay({ paused: false, currentApp: null, sessionStartedAt: null }, 6000))
      .toEqual({ active: true, appName: null, elapsedSec: null });
  });

  it('never reports negative elapsed if the clock skews', () => {
    expect(trackingDisplay({ paused: false, currentApp: 'Code', sessionStartedAt: 9000 }, 5000).elapsedSec)
      .toBe(0);
  });
});
