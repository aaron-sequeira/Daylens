import { describe, it, expect } from 'vitest';
import { active, emptyView, snap, T } from '../fixtures';
import { eyeBreak, goal, stretch, windDown } from './health';

describe('eye_break', () => {
  it('fires after breakIntervalMin of activity, once per interval of the stretch', () => {
    const s = snap({ samples: active(T(9), 55), now: T(9, 55) });
    const c = eyeBreak(s)!;
    expect(c).toMatchObject({ ruleId: 'eye_break', kind: 'health', primary: { action: 'break_eye' } });
    expect(c.key).toBe(`eye_break:${T(9)}:1`);
    expect(eyeBreak(snap({ samples: active(T(9), 40), now: T(9, 40) }))).toBeNull();
  });
  it('restarts counting after a completed break screen', () => {
    // 90 min active from 9:00 to 10:30, completed break at 10:00, now 10:55 (55 min active since break)
    // Add samples from 10:30 to 10:55 to keep the user "active" (within RECENT_MS)
    const s = snap({ samples: [...active(T(9), 90), ...active(T(10, 30), 25)], now: T(10, 55), lastBreakAt: T(10) });
    const c = eyeBreak(s)!;
    // Key should use the break time (T(10)) as the new stretch start, not T(9)
    expect(c.key).toBe(`eye_break:${T(10)}:1`);
  });
});

describe('stretch', () => {
  it('fires after 90 minutes without a 2-minute pause', () => {
    expect(stretch(snap({ samples: active(T(9), 95), now: T(10, 35) }))).toMatchObject({ ruleId: 'stretch', primary: { action: 'break_stretch' } });
    expect(stretch(snap({ samples: active(T(9), 80), now: T(10, 20) }))).toBeNull();
  });
});

describe('wind_down', () => {
  it('fires when active after the wind-down time, keyed by night', () => {
    const late = snap({ samples: active(T(23, 10), 10), now: T(23, 20) });
    expect(windDown(late)!.key).toBe('wind_down:2026-09-25');
    const afterMidnight = snap({ samples: active(T(0, 20, 26), 10), now: T(0, 30, 26), date: '2026-09-26' });
    expect(windDown(afterMidnight)!.key).toBe('wind_down:2026-09-25'); // same night, same key
    expect(windDown(snap({ samples: active(T(21), 10), now: T(21, 10) }))).toBeNull();
  });
});

describe('goal', () => {
  it('fires goal_80 then goal_100 with distinct keys', () => {
    const at80 = snap({ view: emptyView({ screenSec: 0.85 * 420 * 60 }) });
    expect(goal(at80)).toMatchObject({ ruleId: 'goal_80', key: 'goal_80:2026-09-25' });
    const at100 = snap({ view: emptyView({ screenSec: 420 * 60 }) });
    expect(goal(at100)).toMatchObject({ ruleId: 'goal_100', key: 'goal_100:2026-09-25' });
    expect(goal(snap({ view: emptyView({ screenSec: 60 }) }))).toBeNull();
  });
});
