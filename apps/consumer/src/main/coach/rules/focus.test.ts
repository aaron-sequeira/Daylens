import { describe, it, expect } from 'vitest';
import { focusStart } from './focus';
import { snap } from '../fixtures';

const start = new Date(2026, 8, 25, 9, 30).getTime();
const blocks = [{ start, end: start + 90 * 60_000, label: '09:30', minutes: 90 }];
describe('focus_start', () => {
  it('fires in the first 5 minutes of a planned focus block', () => {
    expect(focusStart(snap({ now: start + 60_000, focusBlocks: blocks }))).toMatchObject({ ruleId: 'focus_start', kind: 'tip', key: 'focus_start:2026-09-25:09:30',
      title: 'Your focus block starts now', body: expect.stringContaining('90 min') });
    expect(focusStart(snap({ now: start + 6 * 60_000, focusBlocks: blocks }))).toBeNull();
    expect(focusStart(snap({ now: start - 60_000, focusBlocks: blocks }))).toBeNull();
  });
});
