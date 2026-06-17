import { describe, it, expect } from 'vitest';
import { generateInviteToken } from './invites';

describe('generateInviteToken', () => {
  it('is 32 url-safe chars and unique across calls', () => {
    const a = generateInviteToken();
    const b = generateInviteToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(a).not.toBe(b);
  });
});
