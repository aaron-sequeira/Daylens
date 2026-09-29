/** Wraps a hold check (a PowerShell spawn) so a non-null answer (call/fullscreen/focus-assist) is reused for
 * `ttlMs`: a reminder stuck behind the same call doesn't re-spawn PowerShell on every 30s tick. A null answer is
 * never cached, so a call or fullscreen starting is noticed on the very next check. */
export function createHoldCache(check: () => Promise<string | null>, now: () => number, ttlMs = 120_000): () => Promise<string | null> {
  let cached: { value: string; until: number } | null = null;
  return async (): Promise<string | null> => {
    if (cached && now() < cached.until) return cached.value;
    const value = await check();
    cached = value === null ? null : { value, until: now() + ttlMs };
    return value;
  };
}
