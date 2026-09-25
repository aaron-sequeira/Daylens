import { describe, it, expect } from 'vitest';
import { queryNotificationState } from './notifState';

describe('queryNotificationState', () => {
  it('parses the state number', async () => { expect(await queryNotificationState(async () => '5\r\n')).toBe(5); });
  it('returns null on failure or garbage', async () => {
    expect(await queryNotificationState(async () => { throw new Error('timeout'); })).toBeNull();
    expect(await queryNotificationState(async () => 'nope')).toBeNull();
  });
});
