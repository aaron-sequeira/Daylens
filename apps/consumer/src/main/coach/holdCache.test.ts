import { describe, it, expect, vi } from 'vitest';
import { createHoldCache } from './holdCache';

describe('createHoldCache', () => {
  it('reuses a non-null hold answer within the ttl, then re-checks once it elapses', async () => {
    let now = 0;
    const check = vi.fn(async () => 'call');
    const cached = createHoldCache(check, () => now, 120_000);
    expect(await cached()).toBe('call');
    now = 60_000;
    expect(await cached()).toBe('call');
    expect(check).toHaveBeenCalledTimes(1);
    now = 120_001;
    expect(await cached()).toBe('call');
    expect(check).toHaveBeenCalledTimes(2);
  });
  it('never caches a null answer: every call re-checks', async () => {
    const check = vi.fn(async () => null);
    const cached = createHoldCache(check, () => 0);
    await cached(); await cached(); await cached();
    expect(check).toHaveBeenCalledTimes(3);
  });
});
