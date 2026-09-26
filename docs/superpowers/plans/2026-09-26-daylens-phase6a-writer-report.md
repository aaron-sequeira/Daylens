# Daylens Phase 6a — Writer, Daily Report, Plan, PDF — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every day Daylens writes an on-device report (headline, story, wins, habits, grounded "do it better", plan for tomorrow, advice) over stats computed in code, shows it on a new Reports screen, lets the user tick plan items that change tomorrow's coaching, and exports it as a PDF — with a cloud option whenever the local writer can't be used.

**Architecture:** Pure, unit-tested modules under `src/main/writer/` (config, availability, secrets, protocol, runner, writer facade) and `src/main/report/` (episodes, candidates, input + prompt, schema + grounding, store, scheduler, generate, view); a separate utilityProcess entry `writer.js` runs `node-llama-cpp` per job; `packages/core` gains a generic `complete()` for cloud providers (the agent's summary calls it). `main/index.ts` wires a second downloader, the report scheduler (serialised with the Laya label scheduler) and IPC; the renderer adds a Reports tab, a Settings Writer section with the cloud setup form, a Today's plan card, and a print mode used for PDF export.

**Tech Stack:** Electron 33 (utilityProcess, BrowserWindow.printToPDF, dialog, safeStorage, powerMonitor), electron-vite 2, node-llama-cpp 3.21 (GGUF, JSON-schema grammar), @anthropic-ai/sdk 0.39, React 19, TypeScript 5.7, zod 3, better-sqlite3, Vitest 2.

**Spec:** `docs/superpowers/specs/2026-09-26-daylens-phase6-reports-writer-design.md` (this plan = its §3, §4, §5 and the 6a rows of §7–§8). Parent: `docs/superpowers/specs/2026-09-23-daylens-consumer-app-design.md`.

**Deliberate deltas from the spec (plan rulings):**
- Spec §3.1 says the Brain gains `write` ops. This plan uses a **separate utilityProcess entry `writer.js`** with its own protocol, same per-job-process semantics, and a shared "one job at a time" rule enforced by the schedulers. Why: `node-llama-cpp` must never load in the Laya worker, and the two protocols stay independently testable.
- Episodes group by **app + final category** (spec §4.2 lists `apps[]`; with same-app grouping it is always one app, stored as `app`).
- A **failed** report is not retried automatically (only via Regenerate/retry card), so a broken setup can't loop.
- Qwen3 GGUF files carry no LICENSE file upstream; attribution ("Qwen3 by Alibaba Cloud, Apache-2.0") is shown under the Writer row in Settings.

## Global Constraints

- Branch `feat/daylens-phase6`. Commit messages end with a blank line then a `Co-Authored-By:` trailer naming the authoring model. Never stage `.codex/` or `apps/consumer/.models/`.
- Windows + Git Bash; commands from the repo root. Tests: `pnpm --filter @worksight/consumer test`; if its pretest fails with EPERM a Daylens instance is running — never kill it; use `cd apps/consumer && ELECTRON_RUN_AS_NODE=1 ../../node_modules/electron/dist/electron.exe ../../node_modules/vitest/vitest.mjs run [path]` (same pattern with `cd packages/core` / `cd apps/agent`). Typecheck `pnpm -r typecheck`; build `pnpm --filter @worksight/consumer exec electron-vite build`.
- Never print screen/OCR text or model output to logs. Never kill processes you did not start. Never load a real writer model in unit tests; the real-model test runs only when the file exists and free RAM ≥ writer need.
- Models (pinned): 4B = `unsloth/Qwen3-4B-Instruct-2507-GGUF` @ `a06e946bb6b655725eafa393f4a9745d460374c9`, file `Qwen3-4B-Instruct-2507-Q4_K_M.gguf`, 2 497 281 120 bytes, sha256 `3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597`. 1.7B = `unsloth/Qwen3-1.7B-GGUF` @ `d7f544eead698dbd1f15126ef60b45a1e1933222`, file `Qwen3-1.7B-Q4_K_M.gguf`, 1 107 409 472 bytes, sha256 `b139949c5bd74937ad8ed8c8cf3d9ffb1e99c866c823204dc42c0d91fa181897`. Tier: total RAM ≥ 12 GiB → 4B, else 1.7B. Thinking disabled (`budgets.thoughtTokens: 0`).
- Writer need = model file size + 1 GiB. Reports use `batchAllowed({ freeBytes, idleSec, locked, needBytes })` (Phase 5 rule). Cloud skips the gate. One job at a time across Laya labelling and writing; labelling goes first.
- Timeouts: local report 180 s; cloud 60 s; cloud gets one retry on invalid JSON.
- Local writer **unavailable** (→ cloud offer, never automatic switch) when: total RAM < 8 GiB; not installed and free disk < model size + 1 GiB; download failed twice or declined; model failed to load; ≥ 3 crashes within 10 min or 2 consecutive local timeouts.
- ReportJson limits: headline ≤ 80, story ≤ 900, wins ≤ 3, habits ≤ 3, doBetter ≤ 4 (dropped unless `candidateId` is in the candidate set), plan ≤ 4 (kinds `focus_block {start HH:MM, minutes 15–240}`, `app_cap {app 1–60, minutes 15–240}`, `break_interval {minutes 10–180}`, `wind_down {time HH:MM}`; invalid items dropped individually), advice ≤ 300. Over-long strings are truncated, not rejected.
- **No number shown in the UI comes from the model.** Deep work = work/learning episodes ≥ 25 min with avg distraction < 0.5. Episodes: same app + final category, gaps < 5 min; writer gets the 40 longest; samples ≤ 3 × 300 chars, only if screen reading is on and text still present.
- Schedule: today's report due when local time ≥ wind-down (plan override wins) and wind-down ≥ 05:00 and today has activity and no row; yesterday due when it has activity and no row; manual Generate/Regenerate always. Automatic runs wait on battery < 20 %. Checked every 60 s. 3 writer crashes in 10 min pause automatic runs until restart/"Try local again".
- UI per `docs/superpowers/specs/assets/daylens-mockups/daily-report.html`; reduced motion disables word reveal, count-ups and grow-ins. PDF: A4, backgrounds printed, no animation, no screen-text samples.
- "Delete my activity" clears `daily_reports` and `plan_items`; Export includes them.

## Review Focus

1. **A PC that can't run the local writer** (8 GB laptop, full disk, crashing GPU driver) must land on a working cloud offer with a one-line reason, not a spinner forever. → availability tests in Task 2; view/offer tests in Task 7.
2. **The model inventing things** (a tip about a problem that never happened, a plan item with a bad time) must never reach the screen or the coach. → grounding + per-item drop tests in Task 5.
3. **A busy user past wind-down** — the report waits ("Waiting for a quiet moment") instead of loading 3.4 GB mid-work, and is written once they step away. → scheduler gate tests in Task 6.
4. **Labelling and writing at the same time** would double peak memory. → scheduler mutual-exclusion tests in Task 6 (+ `canStart` wiring in Task 7).
5. **App restarted mid-write** leaves a `pending` row forever. → `clearPending` on startup test in Task 5.

---

### Task 1: Generic `complete()` in core; agent summary delegates

**Files:**
- Create: `packages/core/src/ai/complete.ts`, `packages/core/src/ai/complete.test.ts`
- Modify: `packages/core/package.json` (export `./ai`, dependency `@anthropic-ai/sdk`), `apps/agent/src/main/summary/ai.ts`

**Interfaces:**
- Produces:
  ```ts
  export type AiProvider = 'anthropic' | 'openai' | 'gemini' | 'openrouter' | 'custom';
  export interface CompleteRequest { system: string; user: string; maxTokens: number; json?: boolean; }
  export interface CompleteDeps { apiKey: string | null; model: string; provider?: AiProvider; baseUrl?: string; title?: string;
    createClient?: (apiKey: string) => Anthropic; fetchFn?: typeof fetch; signal?: AbortSignal; }
  export type CompleteResult = { ok: true; text: string } | { ok: false; error: 'no_key' | 'failed'; message?: string };
  export function complete(req: CompleteRequest, deps: CompleteDeps): Promise<CompleteResult>;
  ```
  imported as `@worksight/core/ai`.

- [ ] **Step 1: Failing test** — `packages/core/src/ai/complete.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { complete } from './complete';

const req = { system: 'sys', user: 'hello', maxTokens: 50 };

describe('complete', () => {
  it('returns no_key without a key', async () => {
    expect(await complete(req, { apiKey: null, model: 'm' })).toEqual({ ok: false, error: 'no_key' });
  });
  it('calls Anthropic with a cached system prompt', async () => {
    let args: any;
    const client = { messages: { create: async (a: unknown) => { args = a; return { content: [{ type: 'text', text: ' hi ' }] }; } } };
    const r = await complete(req, { apiKey: 'k', model: 'claude-haiku-4-5', createClient: () => client as never });
    expect(r).toEqual({ ok: true, text: 'hi' });
    expect(args).toMatchObject({ model: 'claude-haiku-4-5', max_tokens: 50, messages: [{ role: 'user', content: 'hello' }] });
    expect(args.system[0]).toMatchObject({ text: 'sys', cache_control: { type: 'ephemeral' } });
  });
  it('calls an OpenAI-compatible provider, asking for JSON when json is set', async () => {
    let url = '', body: any, headers: any;
    const fetchFn = (async (u: string, init: any) => { url = u; body = JSON.parse(init.body); headers = init.headers;
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"a":1}' } }] }) }; }) as unknown as typeof fetch;
    const r = await complete({ ...req, json: true }, { apiKey: 'sk', model: 'gpt', provider: 'openai', fetchFn, title: 'Daylens' });
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(headers['X-Title']).toBe('Daylens');
    expect(r).toEqual({ ok: true, text: '{"a":1}' });
  });
  it('omits response_format when json is not set', async () => {
    let body: any;
    const fetchFn = (async (_u: string, init: any) => { body = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'x' } }] }) }; }) as unknown as typeof fetch;
    await complete(req, { apiKey: 'sk', model: 'm', provider: 'openrouter', fetchFn });
    expect(body.response_format).toBeUndefined();
  });
  it('fails on HTTP errors, empty output and a custom provider without base URL', async () => {
    const bad = (async () => ({ ok: false, status: 429, text: async () => 'slow down' })) as unknown as typeof fetch;
    expect(await complete(req, { apiKey: 'sk', model: 'm', provider: 'openai', fetchFn: bad })).toMatchObject({ ok: false, error: 'failed', message: expect.stringContaining('429') });
    const empty = (async () => ({ ok: true, status: 200, json: async () => ({ choices: [] }) })) as unknown as typeof fetch;
    expect(await complete(req, { apiKey: 'sk', model: 'm', provider: 'openai', fetchFn: empty })).toMatchObject({ ok: false, error: 'failed' });
    expect(await complete(req, { apiKey: 'sk', model: 'm', provider: 'custom' })).toMatchObject({ ok: false, error: 'failed' });
  });
});
```

- [ ] **Step 2: Run to confirm failure** — `cd packages/core && ELECTRON_RUN_AS_NODE=1 ../../node_modules/electron/dist/electron.exe ../../node_modules/vitest/vitest.mjs run src/ai/complete.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** — `packages/core/src/ai/complete.ts`:

```ts
import Anthropic from '@anthropic-ai/sdk';

export type AiProvider = 'anthropic' | 'openai' | 'gemini' | 'openrouter' | 'custom';
export interface CompleteRequest { system: string; user: string; maxTokens: number; json?: boolean; }
export interface CompleteDeps {
  apiKey: string | null; model: string; provider?: AiProvider; baseUrl?: string; title?: string;
  createClient?: (apiKey: string) => Anthropic; fetchFn?: typeof fetch; signal?: AbortSignal;
}
export type CompleteResult = { ok: true; text: string } | { ok: false; error: 'no_key' | 'failed'; message?: string };

// OpenAI-compatible chat-completions bases (no trailing slash).
const OPENAI_COMPAT_BASE: Partial<Record<AiProvider, string>> = {
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai'
};

export async function complete(req: CompleteRequest, deps: CompleteDeps): Promise<CompleteResult> {
  if (!deps.apiKey) return { ok: false, error: 'no_key' };
  const provider = deps.provider ?? 'anthropic';
  if (provider === 'anthropic') return anthropic(req, deps, deps.apiKey);
  const base = provider === 'custom'
    ? (deps.baseUrl?.trim() ? deps.baseUrl.trim().replace(/\/+$/, '') : null)
    : (OPENAI_COMPAT_BASE[provider] ?? null);
  if (!base) return { ok: false, error: 'failed', message: 'Set a Base URL for the custom provider in Settings.' };
  return openAiCompatible(req, deps, deps.apiKey, base);
}

async function anthropic(req: CompleteRequest, deps: CompleteDeps, apiKey: string): Promise<CompleteResult> {
  const client = (deps.createClient ?? ((k) => new Anthropic({ apiKey: k })))(apiKey);
  try {
    const msg = await client.messages.create({
      model: deps.model, max_tokens: req.maxTokens,
      system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: req.user }]
    }, deps.signal ? { signal: deps.signal } : undefined);
    const text = (msg.content as { type: string; text?: string }[]).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim();
    return text ? { ok: true, text } : { ok: false, error: 'failed', message: 'The provider returned an empty response.' };
  } catch (e) {
    return { ok: false, error: 'failed', message: String(e) };
  }
}

async function openAiCompatible(req: CompleteRequest, deps: CompleteDeps, apiKey: string, base: string): Promise<CompleteResult> {
  const doFetch = deps.fetchFn ?? fetch;
  try {
    const res = await doFetch(`${base}/chat/completions`, {
      method: 'POST', signal: deps.signal,
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': deps.title ?? 'WorkSight' },
      body: JSON.stringify({
        model: deps.model, max_tokens: req.maxTokens,
        messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }],
        ...(req.json ? { response_format: { type: 'json_object' } } : {})
      })
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: 'failed', message: `HTTP ${res.status} ${body.slice(0, 300)}`.trim() };
    }
    const data = await res.json() as { choices?: { message?: { content?: string } }[] };
    const text = (data.choices?.[0]?.message?.content ?? '').trim();
    return text ? { ok: true, text } : { ok: false, error: 'failed', message: 'The provider returned an empty response.' };
  } catch (e) {
    return { ok: false, error: 'failed', message: String(e) };
  }
}
```

`packages/core/package.json`: add `"./ai": "./src/ai/complete.ts"` to `exports` and `"@anthropic-ai/sdk": "^0.39.0"` to `dependencies`; run `pnpm install` from the repo root.

- [ ] **Step 4: Agent delegates** — replace `generateAiSummary`, `generateAnthropic`, `generateOpenAiCompatible` and `OPENAI_COMPAT_BASE` in `apps/agent/src/main/summary/ai.ts` with:

```ts
import type Anthropic from '@anthropic-ai/sdk';
import { complete } from '@worksight/core/ai';
// (keep buildSummaryPrompt and AiDeps exactly as they are)

export async function generateAiSummary(summary: DaySummary, deps: AiDeps): Promise<AiSummaryResult | AiSummaryError> {
  const { system, user } = buildSummaryPrompt(summary);
  const r = await complete({ system, user, maxTokens: 400 }, { ...deps, title: 'WorkSight Agent' });
  if (!r.ok) return r.error === 'no_key' ? { error: 'no_key' } : { error: 'failed', message: r.message };
  return { text: r.text, model: deps.model, generatedAt: Date.now() };
}
```
(`AiDeps.createClient` type stays `(apiKey: string) => Anthropic`, now a type-only import.)

- [ ] **Step 5: Verify** — core test passes; `cd apps/agent && ELECTRON_RUN_AS_NODE=1 ../../node_modules/electron/dist/electron.exe ../../node_modules/vitest/vitest.mjs run` → all agent tests pass **unchanged**; `pnpm -r typecheck` clean.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/ai packages/core/package.json pnpm-lock.yaml apps/agent/src/main/summary/ai.ts
git commit -m "feat(core): generic complete() for cloud providers; agent summary delegates"
```

---

### Task 2: Writer config, availability and API-key storage

**Files:**
- Create: `apps/consumer/src/main/writer/config.ts`, `config.test.ts`, `availability.ts`, `availability.test.ts`, `secrets.ts`, `secrets.test.ts`
- Modify: `apps/consumer/src/main/settings.ts` (new keys), `apps/consumer/src/main/settings.test.ts`

**Interfaces:**
- Consumes: `Manifest` from `../models/downloader`; `GB` from `../brain/resources`.
- Produces:
  ```ts
  // config.ts
  export type WriterTier = '4b' | '1.7b';
  export interface WriterModel { tier: WriterTier; repo: string; revision: string; file: string; size: number; sha256: string; label: string; }
  export const WRITER_MODELS: Record<WriterTier, WriterModel>;
  export const WRITER_ATTRIBUTION: string;
  export function tierFor(totalRam: number): WriterTier;
  export function resolveTier(setting: string, totalRam: number): WriterTier;   // '' → tierFor
  export function writerManifest(tier: WriterTier): Manifest;
  export function writerNeedBytes(tier: WriterTier): number;                     // size + GB
  // availability.ts
  export type Unavailable = 'low_ram' | 'low_disk' | 'download_failed' | 'declined' | 'load_failed' | 'crashes' | 'timeouts';
  export interface AvailabilityInput { totalRam: number; freeDisk: number | null; model: WriterModel; installed: boolean;
    downloadFailures: number; declined: boolean; loadFailed: boolean; crashes: number[]; consecutiveTimeouts: number; now: number; }
  export function localUnavailable(i: AvailabilityInput): Unavailable | null;
  export const UNAVAILABLE_TEXT: Record<Unavailable, string>;
  // secrets.ts
  export interface Encryptor { encrypt(s: string): Buffer; decrypt(b: Buffer): string; }
  export interface SecretStore { has(provider: string): boolean; get(provider: string): string | null; set(provider: string, key: string): void; clear(provider: string): void; }
  export function createSecretStore(db: Database.Database, enc: Encryptor): SecretStore;
  ```
- Settings keys (in `DEFAULT_SETTINGS`, **not** in `settingsPatch`): `writerMode: 'local'`, `writerModelTier: ''`, `writerDeclined: false`, `aiProvider: 'anthropic'`, `aiModel: 'claude-haiku-4-5'`, `aiBaseUrl: ''`.

- [ ] **Step 1: Failing tests**

`config.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { WRITER_MODELS, resolveTier, tierFor, writerManifest, writerNeedBytes } from './config';

const GiB = 1024 ** 3;
describe('writer config', () => {
  it('picks 4B at 12 GiB or more, 1.7B below', () => {
    expect(tierFor(16 * GiB)).toBe('4b');
    expect(tierFor(12 * GiB)).toBe('4b');
    expect(tierFor(11.9 * GiB)).toBe('1.7b');
    expect(resolveTier('', 16 * GiB)).toBe('4b');
    expect(resolveTier('1.7b', 16 * GiB)).toBe('1.7b');
    expect(resolveTier('junk', 8 * GiB)).toBe('1.7b');
  });
  it('pins a revision and hash per tier', () => {
    const m = writerManifest('4b');
    expect(m.baseUrl).toBe('https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/a06e946bb6b655725eafa393f4a9745d460374c9');
    expect(m.files).toEqual([{ name: 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf', size: 2_497_281_120, sha256: '3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597' }]);
    expect(writerManifest('1.7b').files[0]).toMatchObject({ name: 'Qwen3-1.7B-Q4_K_M.gguf', size: 1_107_409_472 });
    expect(writerNeedBytes('4b')).toBe(WRITER_MODELS['4b'].size + GiB);
  });
});
```

`availability.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { localUnavailable, type AvailabilityInput } from './availability';
import { WRITER_MODELS } from './config';

const GiB = 1024 ** 3;
const base = (o: Partial<AvailabilityInput> = {}): AvailabilityInput => ({
  totalRam: 16 * GiB, freeDisk: 100 * GiB, model: WRITER_MODELS['4b'], installed: false, downloadFailures: 0,
  declined: false, loadFailed: false, crashes: [], consecutiveTimeouts: 0, now: 1_000_000_000, ...o
});
describe('local writer availability', () => {
  it('is available on a normal PC', () => { expect(localUnavailable(base())).toBeNull(); });
  it('flags each condition', () => {
    expect(localUnavailable(base({ totalRam: 7.9 * GiB }))).toBe('low_ram');
    expect(localUnavailable(base({ freeDisk: 3 * GiB }))).toBe('low_disk');
    expect(localUnavailable(base({ freeDisk: 3 * GiB, installed: true }))).toBeNull(); // already downloaded: disk no longer matters
    expect(localUnavailable(base({ downloadFailures: 2 }))).toBe('download_failed');
    expect(localUnavailable(base({ declined: true }))).toBe('declined');
    expect(localUnavailable(base({ loadFailed: true }))).toBe('load_failed');
    const now = 1_000_000_000;
    expect(localUnavailable(base({ crashes: [now - 1000, now - 2000, now - 3000] }))).toBe('crashes');
    expect(localUnavailable(base({ crashes: [now - 11 * 60_000, now - 2000, now - 3000] }))).toBeNull(); // oldest is outside 10 min
    expect(localUnavailable(base({ consecutiveTimeouts: 2 }))).toBe('timeouts');
    expect(localUnavailable(base({ freeDisk: null }))).toBeNull(); // unknown disk never blocks
  });
});
```

`secrets.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { createSecretStore } from './secrets';

const enc = { encrypt: (s: string) => Buffer.from(`x${s}`), decrypt: (b: Buffer) => b.toString().slice(1) };
describe('secret store', () => {
  it('stores keys per provider, encrypted', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    const s = createSecretStore(db, enc);
    expect(s.has('openai')).toBe(false);
    s.set('openai', 'sk-1');
    expect(s.get('openai')).toBe('sk-1');
    expect(s.get('anthropic')).toBeNull();
    const raw = db.prepare("SELECT value FROM settings WHERE key = 'ai_key_openai_enc'").get() as { value: string };
    expect(raw.value).not.toContain('sk-1');
    s.clear('openai');
    expect(s.has('openai')).toBe(false);
  });
});
```

In `settings.test.ts` add: `expect(DEFAULT_SETTINGS).toMatchObject({ writerMode: 'local', writerModelTier: '', aiProvider: 'anthropic' });` and `expect(() => settingsPatch.parse({ writerMode: 'cloud' })).toThrow();`.

- [ ] **Step 2: Run to confirm failure.**

- [ ] **Step 3: Implement**

`config.ts`:
```ts
import type { Manifest } from '../models/downloader';

const GiB = 1024 ** 3;
export type WriterTier = '4b' | '1.7b';
export interface WriterModel { tier: WriterTier; repo: string; revision: string; file: string; size: number; sha256: string; label: string; }

// Pinned commits so a later push to the repo can't swap the model under users.
export const WRITER_MODELS: Record<WriterTier, WriterModel> = {
  '4b': { tier: '4b', repo: 'unsloth/Qwen3-4B-Instruct-2507-GGUF', revision: 'a06e946bb6b655725eafa393f4a9745d460374c9',
    file: 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf', size: 2_497_281_120, sha256: '3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597', label: 'Qwen3 4B' },
  '1.7b': { tier: '1.7b', repo: 'unsloth/Qwen3-1.7B-GGUF', revision: 'd7f544eead698dbd1f15126ef60b45a1e1933222',
    file: 'Qwen3-1.7B-Q4_K_M.gguf', size: 1_107_409_472, sha256: 'b139949c5bd74937ad8ed8c8cf3d9ffb1e99c866c823204dc42c0d91fa181897', label: 'Qwen3 1.7B' }
};
export const WRITER_ATTRIBUTION = 'Qwen3 by Alibaba Cloud (Apache-2.0), GGUF by Unsloth.';

export const tierFor = (totalRam: number): WriterTier => (totalRam >= 12 * GiB ? '4b' : '1.7b');
export const resolveTier = (setting: string, totalRam: number): WriterTier =>
  setting === '4b' || setting === '1.7b' ? setting : tierFor(totalRam);
export function writerManifest(tier: WriterTier): Manifest {
  const m = WRITER_MODELS[tier];
  return { baseUrl: `https://huggingface.co/${m.repo}/resolve/${m.revision}`, files: [{ name: m.file, size: m.size, sha256: m.sha256 }] };
}
export const writerNeedBytes = (tier: WriterTier): number => WRITER_MODELS[tier].size + GiB;
```

`availability.ts`:
```ts
import type { WriterModel } from './config';

const GiB = 1024 ** 3;
const CRASH_WINDOW_MS = 10 * 60_000;
export type Unavailable = 'low_ram' | 'low_disk' | 'download_failed' | 'declined' | 'load_failed' | 'crashes' | 'timeouts';
export interface AvailabilityInput {
  totalRam: number; freeDisk: number | null; model: WriterModel; installed: boolean; downloadFailures: number;
  declined: boolean; loadFailed: boolean; crashes: number[]; consecutiveTimeouts: number; now: number;
}

/** Why this PC can't use the local writer right now (→ offer cloud), or null. Order = most fundamental first. */
export function localUnavailable(i: AvailabilityInput): Unavailable | null {
  if (i.totalRam < 8 * GiB) return 'low_ram';
  if (!i.installed && i.freeDisk !== null && i.freeDisk < i.model.size + GiB) return 'low_disk';
  if (i.declined) return 'declined';
  if (i.downloadFailures >= 2) return 'download_failed';
  if (i.loadFailed) return 'load_failed';
  if (i.crashes.filter((t) => i.now - t < CRASH_WINDOW_MS).length >= 3) return 'crashes';
  if (i.consecutiveTimeouts >= 2) return 'timeouts';
  return null;
}

export const UNAVAILABLE_TEXT: Record<Unavailable, string> = {
  low_ram: 'This PC has less than 8 GB of memory, too little to run the writer.',
  low_disk: 'Not enough free disk space for the writer model.',
  download_failed: "The writer model couldn't be downloaded.",
  declined: "You chose not to download the writer model.",
  load_failed: "The writer model couldn't start on this PC.",
  crashes: 'The writer kept crashing on this PC.',
  timeouts: 'The writer was too slow on this PC.'
};
```

`secrets.ts`:
```ts
import type Database from 'better-sqlite3';

export interface Encryptor { encrypt(s: string): Buffer; decrypt(b: Buffer): string; }
export interface SecretStore { has(provider: string): boolean; get(provider: string): string | null; set(provider: string, key: string): void; clear(provider: string): void; }

// Same key naming as the WorkSight agent: one encrypted key per provider in the settings table.
const keyName = (provider: string): string => `ai_key_${provider}_enc`;

export function createSecretStore(db: Database.Database, enc: Encryptor): SecretStore {
  const read = db.prepare('SELECT value FROM settings WHERE key = ?');
  const write = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const del = db.prepare('DELETE FROM settings WHERE key = ?');
  const raw = (p: string): string | null => (read.get(keyName(p)) as { value: string } | undefined)?.value ?? null;
  return {
    has: (p) => raw(p) !== null,
    get: (p) => { const r = raw(p); if (r === null) return null; try { return enc.decrypt(Buffer.from(r, 'base64')); } catch { return null; } },
    set: (p, key) => { write.run(keyName(p), enc.encrypt(key).toString('base64')); },
    clear: (p) => { del.run(keyName(p)); }
  };
}
```

`settings.ts` `DEFAULT_SETTINGS` gains `writerMode: 'local' as 'local' | 'cloud'`, `writerModelTier: ''`, `writerDeclined: false`, `aiProvider: 'anthropic'`, `aiModel: 'claude-haiku-4-5'`, `aiBaseUrl: ''` (leave `settingsPatch` unchanged; writer settings get dedicated channels in Task 7).

- [ ] **Step 4: Run tests → pass; typecheck.**

- [ ] **Step 5: Commit**

```bash
git add apps/consumer/src/main/writer apps/consumer/src/main/settings.ts apps/consumer/src/main/settings.test.ts
git commit -m "feat(consumer): writer model config, availability rules and encrypted API keys"
```

---

### Task 3: Writer process, runner and local/cloud facade

**Files:**
- Create: `apps/consumer/src/main/writer/protocol.ts`, `worker.ts`, `run.ts`, `run.test.ts`, `writer.ts`, `writer.test.ts`
- Modify: `apps/consumer/package.json` (dependency `"node-llama-cpp": "^3.21.1"`), `apps/consumer/electron.vite.config.ts` (main input `writer`)

**Interfaces:**
- Consumes: `complete`, `CompleteRequest`, `CompleteResult` from `@worksight/core/ai`.
- Produces:
  ```ts
  // protocol.ts
  export const writerRequest: z.ZodType<WriterRequest>; export const writerResponse;
  export interface WriterRequest { op: 'write'; modelPath: string; gpu: 'auto' | 'off'; schema: Record<string, unknown>; system: string; user: string; maxTokens: number; contextSize: number; }
  // run.ts
  export interface WriterChild { post(m: WriterRequest): void; onMessage(cb: (m: unknown) => void): void; onExit(cb: (code: number | null) => void): void; kill(): void; }
  export type LocalResult = { ok: true; json: unknown } | { ok: false; reason: 'timeout' | 'crash' | 'load' | 'error'; message: string };
  export function runLocal(req: WriterRequest, deps: { fork(): WriterChild; timeoutMs: number }): Promise<LocalResult>;
  // writer.ts
  export type WriteKind = 'report' | 'week' | 'tip';
  export interface WriteJob<T> { kind: WriteKind; system: string; user: string; schema: Record<string, unknown>; maxTokens: number; parse(v: unknown): T | null; }
  export type WriteResult<T> = { ok: true; value: T; model: string } | { ok: false; reason: string; local?: 'timeout' | 'crash' | 'load' | 'error' | 'invalid' };
  export const LOCAL_TIMEOUT_MS: Record<WriteKind, number>; export const CLOUD_TIMEOUT_MS: Record<WriteKind, number>;
  export interface Writer { write<T>(job: WriteJob<T>): Promise<WriteResult<T>>; }
  export function createWriter(deps: {
    mode(): 'local' | 'cloud';
    local(): { modelPath: string; model: string } | null;        // null = not installed
    runLocal(req: WriterRequest, timeoutMs: number): Promise<LocalResult>;
    cloud(req: CompleteRequest, timeoutMs: number): Promise<CompleteResult>;
    cloudModel(): string;
  }): Writer;
  export function parseJsonText(text: string): unknown | null;   // strips ```json fences
  ```

- [ ] **Step 1: Failing tests**

`run.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { runLocal, type WriterChild } from './run';

const req = { op: 'write' as const, modelPath: 'm.gguf', gpu: 'auto' as const, schema: {}, system: 's', user: 'u', maxTokens: 100, contextSize: 8192 };
function fake() {
  let msg: (m: unknown) => void = () => {}; let exit: (c: number | null) => void = () => {};
  const child: WriterChild & { killed: boolean; sent: unknown[] } = {
    killed: false, sent: [], post(m) { this.sent.push(m); }, onMessage(cb) { msg = cb; }, onExit(cb) { exit = cb; }, kill() { this.killed = true; }
  };
  return { child, msg: (m: unknown) => msg(m), exit: (c: number | null) => exit(c) };
}
afterEach(() => vi.useRealTimers());

describe('runLocal', () => {
  it('resolves with the written json and kills the child', async () => {
    const f = fake();
    const p = runLocal(req, { fork: () => f.child, timeoutMs: 1000 });
    f.msg({ op: 'written', json: { a: 1 } });
    expect(await p).toEqual({ ok: true, json: { a: 1 } });
    expect(f.child.killed).toBe(true);
    expect(f.child.sent).toEqual([req]);
  });
  it('maps load errors, other errors, crashes and timeouts', async () => {
    let f = fake(); let p = runLocal(req, { fork: () => f.child, timeoutMs: 1000 });
    f.msg({ op: 'error', message: 'load: bad file' });
    expect(await p).toMatchObject({ ok: false, reason: 'load' });
    f = fake(); p = runLocal(req, { fork: () => f.child, timeoutMs: 1000 });
    f.msg({ op: 'error', message: 'boom' });
    expect(await p).toMatchObject({ ok: false, reason: 'error' });
    f = fake(); p = runLocal(req, { fork: () => f.child, timeoutMs: 1000 });
    f.exit(3221225477);
    expect(await p).toMatchObject({ ok: false, reason: 'crash' });
    vi.useFakeTimers();
    f = fake(); p = runLocal(req, { fork: () => f.child, timeoutMs: 1000 });
    vi.advanceTimersByTime(1001);
    expect(await p).toMatchObject({ ok: false, reason: 'timeout' });
    expect(f.child.killed).toBe(true);
  });
  it('rejects malformed messages as errors and treats a throwing fork as a crash', async () => {
    const f = fake(); const p = runLocal(req, { fork: () => f.child, timeoutMs: 1000 });
    f.msg({ op: 'nope' });
    expect(await p).toMatchObject({ ok: false, reason: 'error' });
    expect(await runLocal(req, { fork: () => { throw new Error('x'); }, timeoutMs: 1000 })).toMatchObject({ ok: false, reason: 'crash' });
  });
});
```

`writer.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createWriter, parseJsonText, type WriteJob } from './writer';

const job: WriteJob<{ h: string }> = { kind: 'report', system: 's', user: 'u', schema: { type: 'object' }, maxTokens: 900,
  parse: (v) => (v && typeof (v as any).h === 'string' ? { h: (v as any).h } : null) };
const deps = (o: Partial<Parameters<typeof createWriter>[0]> = {}) => ({
  mode: () => 'local' as const, local: () => ({ modelPath: 'C:/m.gguf', model: 'Qwen3 4B' }),
  runLocal: async () => ({ ok: true as const, json: { h: 'hi' } }),
  cloud: async () => ({ ok: true as const, text: '{"h":"cloud"}' }), cloudModel: () => 'claude-haiku-4-5', ...o
});

describe('writer', () => {
  it('writes locally with the model path, schema and 180 s report timeout', async () => {
    let seen: any; let t = 0;
    const w = createWriter(deps({ runLocal: async (r, ms) => { seen = r; t = ms; return { ok: true, json: { h: 'hi' } }; } }));
    expect(await w.write(job)).toEqual({ ok: true, value: { h: 'hi' }, model: 'Qwen3 4B' });
    expect(seen).toMatchObject({ op: 'write', modelPath: 'C:/m.gguf', schema: { type: 'object' }, system: 's', user: 'u', maxTokens: 900 });
    expect(t).toBe(180_000);
  });
  it('fails when the local model is missing, and passes local failure reasons through', async () => {
    expect(await createWriter(deps({ local: () => null })).write(job)).toMatchObject({ ok: false, reason: 'no_model' });
    expect(await createWriter(deps({ runLocal: async () => ({ ok: false, reason: 'timeout', message: 't' }) })).write(job)).toMatchObject({ ok: false, local: 'timeout' });
    expect(await createWriter(deps({ runLocal: async () => ({ ok: true, json: { nope: 1 } }) })).write(job)).toMatchObject({ ok: false, local: 'invalid' });
  });
  it('uses the cloud in cloud mode, retrying once on invalid JSON', async () => {
    let calls = 0;
    const w = createWriter(deps({ mode: () => 'cloud', cloud: async () => (++calls === 1 ? { ok: true, text: 'not json' } : { ok: true, text: '```json\n{"h":"ok"}\n```' }) }));
    expect(await w.write(job)).toEqual({ ok: true, value: { h: 'ok' }, model: 'claude-haiku-4-5' });
    expect(calls).toBe(2);
  });
  it('reports cloud errors without retrying them', async () => {
    let calls = 0;
    const w = createWriter(deps({ mode: () => 'cloud', cloud: async () => { calls++; return { ok: false, error: 'failed', message: 'HTTP 401' }; } }));
    expect(await w.write(job)).toMatchObject({ ok: false, reason: 'HTTP 401' });
    expect(calls).toBe(1);
  });
  it('parses fenced and bare JSON', () => {
    expect(parseJsonText('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonText('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonText('nope')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm failure.**

- [ ] **Step 3: Implement**

`protocol.ts`:
```ts
import { z } from 'zod';

export const writerRequest = z.object({
  op: z.literal('write'), modelPath: z.string().min(1), gpu: z.enum(['auto', 'off']),
  schema: z.record(z.unknown()), system: z.string(), user: z.string(),
  maxTokens: z.number().int().min(16).max(4096), contextSize: z.number().int().min(1024).max(32768)
}).strict();
// Main process trust boundary: anything the writer sends is validated before use.
export const writerResponse = z.discriminatedUnion('op', [
  z.object({ op: z.literal('written'), json: z.unknown() }).strict(),
  z.object({ op: z.literal('error'), message: z.string() }).strict()
]);
export type WriterRequest = z.infer<typeof writerRequest>;
```

`run.ts`:
```ts
import { writerResponse, type WriterRequest } from './protocol';

export interface WriterChild { post(m: WriterRequest): void; onMessage(cb: (m: unknown) => void): void; onExit(cb: (code: number | null) => void): void; kill(): void; }
export type LocalResult = { ok: true; json: unknown } | { ok: false; reason: 'timeout' | 'crash' | 'load' | 'error'; message: string };
const EXIT_GRACE_MS = 1_000; // a clean exit may overtake the last message

/** One job = one process: start it, wait for one answer (or a crash / the deadline), always kill it. */
export function runLocal(req: WriterRequest, deps: { fork(): WriterChild; timeoutMs: number }): Promise<LocalResult> {
  return new Promise((resolve) => {
    let child: WriterChild;
    try { child = deps.fork(); } catch (e) { resolve({ ok: false, reason: 'crash', message: String(e) }); return; }
    let settled = false;
    const finish = (r: LocalResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill(); } catch { /* already exited */ }
      resolve(r);
    };
    const timer = setTimeout(() => finish({ ok: false, reason: 'timeout', message: `no answer in ${deps.timeoutMs} ms` }), deps.timeoutMs);
    child.onMessage((m) => {
      const r = writerResponse.safeParse(m);
      if (!r.success) { finish({ ok: false, reason: 'error', message: 'malformed message' }); return; }
      if (r.data.op === 'written') finish({ ok: true, json: r.data.json });
      else finish({ ok: false, reason: r.data.message.startsWith('load:') ? 'load' : 'error', message: r.data.message });
    });
    child.onExit((code) => {
      if (code === 0) setTimeout(() => finish({ ok: false, reason: 'crash', message: 'exited without an answer' }), EXIT_GRACE_MS);
      else finish({ ok: false, reason: 'crash', message: `exit ${code}` });
    });
    try { child.post(req); } catch (e) { finish({ ok: false, reason: 'crash', message: String(e) }); }
  });
}
```

`writer.ts`:
```ts
import type { CompleteRequest, CompleteResult } from '@worksight/core/ai';
import type { WriterRequest } from './protocol';
import type { LocalResult } from './run';

export type WriteKind = 'report' | 'week' | 'tip';
export interface WriteJob<T> { kind: WriteKind; system: string; user: string; schema: Record<string, unknown>; maxTokens: number; parse(v: unknown): T | null; }
export type WriteResult<T> = { ok: true; value: T; model: string } | { ok: false; reason: string; local?: 'timeout' | 'crash' | 'load' | 'error' | 'invalid' };
export interface Writer { write<T>(job: WriteJob<T>): Promise<WriteResult<T>>; }

export const LOCAL_TIMEOUT_MS: Record<WriteKind, number> = { report: 180_000, week: 180_000, tip: 20_000 };
export const CLOUD_TIMEOUT_MS: Record<WriteKind, number> = { report: 60_000, week: 60_000, tip: 20_000 };
const CONTEXT_SIZE = 8192;

export function parseJsonText(text: string): unknown | null {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(t); } catch { return null; }
}

export function createWriter(deps: {
  mode(): 'local' | 'cloud';
  local(): { modelPath: string; model: string } | null;
  runLocal(req: WriterRequest, timeoutMs: number): Promise<LocalResult>;
  cloud(req: CompleteRequest, timeoutMs: number): Promise<CompleteResult>;
  cloudModel(): string;
}): Writer {
  return {
    async write<T>(job: WriteJob<T>): Promise<WriteResult<T>> {
      if (deps.mode() === 'cloud') {
        for (let attempt = 0; attempt < 2; attempt++) {
          const r = await deps.cloud({ system: job.system, user: job.user, maxTokens: job.maxTokens, json: true }, CLOUD_TIMEOUT_MS[job.kind]);
          if (!r.ok) return { ok: false, reason: r.message ?? r.error };
          const parsed = parseJsonText(r.text);
          const value = parsed === null ? null : job.parse(parsed);
          if (value !== null) return { ok: true, value, model: deps.cloudModel() };
        }
        return { ok: false, reason: 'The AI returned an answer Daylens could not read.' };
      }
      const m = deps.local();
      if (!m) return { ok: false, reason: 'no_model' };
      const r = await deps.runLocal({ op: 'write', modelPath: m.modelPath, gpu: 'auto', schema: job.schema, system: job.system,
        user: job.user, maxTokens: job.maxTokens, contextSize: CONTEXT_SIZE }, LOCAL_TIMEOUT_MS[job.kind]);
      if (!r.ok) return { ok: false, reason: r.message, local: r.reason };
      const value = job.parse(r.json);
      return value === null ? { ok: false, reason: 'The writer returned an answer Daylens could not read.', local: 'invalid' } : { ok: true, value, model: m.model };
    }
  };
}
```

`worker.ts` (no unit test — never loaded under vitest):
```ts
/// <reference types="electron" />
import { constants, setPriority } from 'node:os';
import { writerRequest } from './protocol';

// Writing is background work: never compete with what the user is doing in the foreground.
try { setPriority(constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* not permitted */ }

process.parentPort.once('message', async (e) => {
  const fail = (message: string, code: number): void => {
    process.parentPort.postMessage({ op: 'error', message });
    setTimeout(() => process.exit(code), 2000); // main kills us first; this only stops a linger
  };
  let req;
  try { req = writerRequest.parse(e.data); } catch (err) { fail(`bad request: ${String(err)}`, 1); return; }
  let llama, model, context;
  try {
    const { getLlama } = await import('node-llama-cpp'); // ESM-only package: dynamic import from the CJS bundle
    llama = await getLlama({ gpu: req.gpu === 'off' ? false : 'auto' });
    model = await llama.loadModel({ modelPath: req.modelPath });
    context = await model.createContext({ contextSize: req.contextSize });
  } catch (err) { fail(`load: ${err instanceof Error ? err.message : String(err)}`, 1); return; }
  try {
    const { LlamaChatSession } = await import('node-llama-cpp');
    const session = new LlamaChatSession({ contextSequence: context.getSequence(), systemPrompt: req.system });
    const grammar = await llama.createGrammarForJsonSchema(req.schema as never);
    const text = await session.prompt(req.user, { grammar, maxTokens: req.maxTokens, budgets: { thoughtTokens: 0 } });
    process.parentPort.postMessage({ op: 'written', json: grammar.parse(text) });
    setTimeout(() => process.exit(0), 2000);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err), 1);
  }
});
```
Check the installed node-llama-cpp's typings for `budgets` / `createGrammarForJsonSchema` / `getLlama({ gpu })`; adapt names if they differ and list them in your report.

`electron.vite.config.ts`: main `input` gains `writer: resolve(__dirname, 'src/main/writer/worker.ts')`, and update the comment (`brain.js` = Laya, `writer.js` = report writer). `package.json` dependencies gain `"node-llama-cpp": "^3.21.1"` (a dependency, so `externalizeDepsPlugin` keeps it external); run `pnpm install`.

- [ ] **Step 4: Verify** — tests pass; typecheck; build emits `out/main/writer.js` and it contains `import("node-llama-cpp")` (not a bundled copy).

- [ ] **Step 5: Commit**

```bash
git add apps/consumer/src/main/writer apps/consumer/package.json apps/consumer/electron.vite.config.ts pnpm-lock.yaml
git commit -m "feat(consumer): writer utility process (node-llama-cpp) with local/cloud facade"
```

---

### Task 4: Report data — episodes, deep work, candidates, writer input

**Files:**
- Create: `apps/consumer/src/main/report/episodes.ts`, `episodes.test.ts`, `candidates.ts`, `candidates.test.ts`, `input.ts`, `input.test.ts`
- Modify: `apps/consumer/src/main/screen/labels.ts` (`readsForDay`), `apps/consumer/src/main/coach/activity.ts` (`repeatedSearches`), `apps/consumer/src/main/coach/rules/tips.ts` (use it), `apps/consumer/src/main/coach/rules/behaviour.ts` (export `limitUsage`, `appCap` uses it)

**Interfaces:**
- Consumes: `finalCategory` (`../brain/finalCategory`), `categoryForApp`, `displayAppName` (`../../shared/categories`), `TodayView` (`../day/today`), `switchesBetween`, `normaliseSearch` (`../coach/activity`), `sessionInterval`, `dayBounds` (`../day/time`).
- Produces:
  ```ts
  // labels.ts
  export interface EpisodeRead { id: number; at: number; appName: string; windowTitle: string | null; text: string | null;
    category: string | null; conf: number | null; activity: string | null; stuck: number | null; distraction: number | null; }
  LabelStore.readsForDay(date: string): EpisodeRead[];            // ORDER BY at, id
  // activity.ts
  export function repeatedSearches(titles: { at: number; title: string }[], min?: number): { query: string; count: number }[];
  // behaviour.ts
  export function limitUsage(limits: AppLimit[], sessions: FocusSessionRow[], now: number): { app: string; minutes: number; usedMin: number }[];
  // episodes.ts
  export interface Episode { id: string; start: number; end: number; app: string; category: string; activity: string | null;
    titles: string[]; samples: string[]; avgStuck: number; avgDistraction: number; stuckReads: number; reads: number; }
  export function buildEpisodes(reads: EpisodeRead[], withText: boolean): Episode[];
  export function deepWorkSec(episodes: Episode[]): number;
  // candidates.ts
  export interface ReportCandidate { id: string; kind: 'stuck' | 'search' | 'nudge' | 'cap'; text: string; sample?: string; }
  export function buildCandidates(i: { episodes: Episode[]; searches: { query: string; count: number }[];
    nudges: { id: number; ruleId: string; title: string; status: string }[]; caps: { app: string; minutes: number; usedMin: number }[] }): ReportCandidate[];
  // input.ts
  export interface ReportStats { date: string; screenSec: number; activeSec: number; goalSec: number; deepWorkSec: number; switches: number;
    health: Health; topApps: { appName: string; seconds: number }[]; categories: { category: string; seconds: number }[]; weekAvgSec: number; }
  export interface ReportInput { date: string; stats: ReportStats; episodes: WriterEpisode[]; candidates: ReportCandidate[];
    goals: { dailyGoalMin: number; windDownTime: string; breakIntervalMin: number }; }
  export function buildStats(view: TodayView, episodes: Episode[], switches: number): ReportStats;
  export function buildReportInput(i: { stats: ReportStats; episodes: Episode[]; candidates: ReportCandidate[]; goals: ReportInput['goals'] }): ReportInput;
  export function reportPrompt(input: ReportInput): { system: string; user: string };
  export const INPUT_EPISODES = 40;
  ```

- [ ] **Step 1: Failing tests**

`episodes.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildEpisodes, deepWorkSec } from './episodes';
import type { EpisodeRead } from '../screen/labels';

const MIN = 60_000, T0 = new Date(2026, 8, 26, 9, 0).getTime();
const r = (i: number, min: number, o: Partial<EpisodeRead> = {}): EpisodeRead => ({ id: i, at: T0 + min * MIN, appName: 'Code', windowTitle: 'index.ts - app',
  text: `text ${i}`, category: 'work', conf: 0.9, activity: 'coding', stuck: 0, distraction: 0, ...o });

describe('episodes', () => {
  it('groups consecutive reads of the same app and category with gaps under 5 min', () => {
    const eps = buildEpisodes([r(1, 0), r(2, 2), r(3, 4), r(4, 12), r(5, 13, { appName: 'chrome', category: 'social' })], true);
    expect(eps.map((e) => [e.app, e.reads])).toEqual([['Code', 3], ['Code', 1], ['chrome', 1]]);
    expect(eps[0]).toMatchObject({ id: 'e1', start: T0, end: T0 + 4 * MIN + 30_000, category: 'work', activity: 'coding', titles: ['index.ts - app'] });
  });
  it('uses the final category (unsure Laya on a known app falls back to the app category)', () => {
    const eps = buildEpisodes([r(1, 0, { appName: 'Discord', category: 'work', conf: 0.3 }), r(2, 1, { appName: 'Discord', category: null, conf: null })], false);
    expect(eps).toHaveLength(1);
    expect(eps[0].category).toBe('social');
  });
  it('keeps samples only when allowed and present, max 3 × 300 chars, stuck reads first', () => {
    const long = 'x'.repeat(400);
    const eps = buildEpisodes([r(1, 0, { text: 'a' }), r(2, 1, { text: long, stuck: 2 }), r(3, 2, { text: null }), r(4, 3, { text: 'b' }), r(5, 4, { text: 'c' })], true);
    expect(eps[0].samples).toEqual(['x'.repeat(300), 'a', 'b']);
    expect(buildEpisodes([r(1, 0)], false)[0].samples).toEqual([]);
  });
  it('averages stuck/distraction and counts stuck reads', () => {
    const [e] = buildEpisodes([r(1, 0, { stuck: 2 }), r(2, 1, { stuck: 1 }), r(3, 2, { stuck: null, distraction: 2 })], false);
    expect(e.avgStuck).toBe(1.5);
    expect(e.avgDistraction).toBeCloseTo(2 / 3);
    expect(e.stuckReads).toBe(1);
  });
  it('counts deep work: work/learning ≥ 25 min with low distraction', () => {
    const long = Array.from({ length: 27 }, (_, i) => r(i + 1, i));                       // 26.5 min of work
    const noisy = Array.from({ length: 27 }, (_, i) => r(100 + i, 60 + i, { distraction: 1 }));
    const short = Array.from({ length: 10 }, (_, i) => r(200 + i, 120 + i));
    expect(deepWorkSec(buildEpisodes([...long, ...noisy, ...short], false))).toBe(26.5 * 60);
  });
});
```

`candidates.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildCandidates } from './candidates';
import type { Episode } from './episodes';

const ep = (o: Partial<Episode>): Episode => ({ id: 'e1', start: 0, end: 12 * 60_000, app: 'Code', category: 'work', activity: 'coding',
  titles: ['build.ts'], samples: ['TypeError: x is undefined'], avgStuck: 0, avgDistraction: 0, stuckReads: 0, reads: 20, ...o });

describe('report candidates', () => {
  it('lists stuck episodes, repeated searches, nudges and passed limits with stable ids', () => {
    const c = buildCandidates({
      episodes: [ep({ id: 'e1', avgStuck: 1.6 }), ep({ id: 'e2', stuckReads: 3 }), ep({ id: 'e3' })],
      searches: [{ query: 'css grid', count: 3 }],
      nudges: [{ id: 7, ruleId: 'doomscroll', title: "You've been scrolling Reddit 20 min", status: 'dismissed' }],
      caps: [{ app: 'YouTube', minutes: 30, usedMin: 52 }]
    });
    expect(c.map((x) => x.id)).toEqual(['stuck:e1', 'stuck:e2', 'search:0', 'nudge:7', 'cap:YouTube']);
    expect(c[0]).toMatchObject({ kind: 'stuck', text: 'Stuck for 12 min in Code (build.ts)', sample: 'TypeError: x is undefined' });
    expect(c[2].text).toBe('Searched "css grid" 3 times this week');
    expect(c[3].text).toBe('Pop-up "You\'ve been scrolling Reddit 20 min" (dismissed)');
    expect(c[4].text).toBe('YouTube: 52 min used, limit 30 min');
  });
  it('caps error samples at 200 chars and omits them when absent', () => {
    const c = buildCandidates({ episodes: [ep({ avgStuck: 2, samples: ['e'.repeat(250)] }), ep({ id: 'e9', avgStuck: 2, samples: [] })], searches: [], nudges: [], caps: [] });
    expect(c[0].sample).toHaveLength(200);
    expect(c[1].sample).toBeUndefined();
  });
});
```

`input.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildReportInput, buildStats, INPUT_EPISODES, reportPrompt } from './input';
import type { Episode } from './episodes';
import type { TodayView } from '../day/today';

const view = { date: '2026-09-26', now: 0, screenSec: 6 * 3600, activeSec: 5 * 3600, goalSec: 7 * 3600, firstSeenAt: 0,
  cards: [{ category: 'work', seconds: 4 * 3600, apps: [] }, { category: 'social', seconds: 3600, apps: [] }], timeline: [],
  health: { score: 80, breaks: 3, expectedBreaks: 6, longestStretchSec: 5400, lateNight: false },
  week: [0, 1, 2, 3, 4, 5].map((i) => ({ date: `d${i}`, seconds: i === 5 ? 6 * 3600 : 4 * 3600, byCategory: {} })).concat([{ date: '2026-09-26', seconds: 6 * 3600, byCategory: {} }]),
  apps: Array.from({ length: 8 }, (_, i) => ({ appName: `app${i}`, seconds: 1000 - i }))
} as unknown as TodayView;
const ep = (i: number, minutes: number): Episode => ({ id: `e${i}`, start: new Date(2026, 8, 26, 9, i).getTime(), end: new Date(2026, 8, 26, 9, i).getTime() + minutes * 60_000,
  app: 'Code', category: 'work', activity: 'coding', titles: ['t'], samples: ['s'], avgStuck: 0.25, avgDistraction: 0.1, stuckReads: 0, reads: 5 });

describe('report input', () => {
  it('builds stats from the day view (numbers never from the model)', () => {
    const s = buildStats(view, [ep(1, 30)], 42);
    expect(s).toMatchObject({ date: '2026-09-26', screenSec: 21600, deepWorkSec: 1800, switches: 42, health: { score: 80 } });
    expect(s.topApps).toHaveLength(5);
    expect(s.weekAvgSec).toBe((5 * 4 * 3600 + 6 * 3600) / 6); // the 6 days before, excluding the report date
  });
  it('passes the 40 longest episodes in time order, compacted', () => {
    const eps = Array.from({ length: 50 }, (_, i) => ep(i, i + 1));
    const input = buildReportInput({ stats: buildStats(view, eps, 0), episodes: eps, candidates: [], goals: { dailyGoalMin: 420, windDownTime: '23:00', breakIntervalMin: 50 } });
    expect(input.episodes).toHaveLength(INPUT_EPISODES);
    expect(input.episodes[0]).toMatchObject({ id: 'e10', start: '09:10', minutes: 11, stuck: 0.3, distraction: 0.1 });
  });
  it('builds a prompt that names candidate ids and forbids invented numbers', () => {
    const input = buildReportInput({ stats: buildStats(view, [], 0), episodes: [], candidates: [{ id: 'stuck:e1', kind: 'stuck', text: 'Stuck' }], goals: { dailyGoalMin: 420, windDownTime: '23:00', breakIntervalMin: 50 } });
    const p = reportPrompt(input);
    expect(p.system).toMatch(/candidateId/);
    expect(p.system).toMatch(/do not invent/i);
    expect(p.user).toContain('"stuck:e1"');
  });
});
```

Also add to `labels.test.ts` (existing file) a `readsForDay` test: two reads on the date, one on another date → returns the two in time order with the fields above.

- [ ] **Step 2: Run to confirm failure.**

- [ ] **Step 3: Implement**

`labels.ts`: add `EpisodeRead`, and to `LabelStore` + `createLabelStore`:
```ts
const dayReads = db.prepare(`SELECT id, at, app_name AS appName, window_title AS windowTitle, text, category, category_conf AS conf,
  activity, stuck, distraction FROM screen_reads WHERE date = ? ORDER BY at, id`);
// ...
readsForDay: (date) => dayReads.all(date) as EpisodeRead[]
```

`activity.ts`: move the counting loop out of `repeatSearch` into
```ts
const DISTINCT_MS = 30 * 60_000; // re-focusing the same search tab within this counts once
export function repeatedSearches(titles: { at: number; title: string }[], min = 3): { query: string; count: number }[] {
  const counts = new Map<string, { n: number; last: number }>();
  for (const t of [...titles].sort((a, b) => a.at - b.at)) {
    const q = normaliseSearch(t.title);
    if (!q) continue;
    const c = counts.get(q);
    if (!c) counts.set(q, { n: 1, last: t.at });
    else if (t.at - c.last >= DISTINCT_MS) { c.n++; c.last = t.at; }
  }
  return [...counts.entries()].filter(([, c]) => c.n >= min).map(([query, c]) => ({ query, count: c.n }));
}
```
and make `repeatSearch` use `repeatedSearches(s.searchTitles)[0]` (behaviour unchanged; existing tips tests must pass).

`behaviour.ts`: extract from `appCap`
```ts
export function limitUsage(limits: AppLimit[], sessions: FocusSessionRow[], now: number): { app: string; minutes: number; usedMin: number }[] {
  const latest = sessions.reduce<FocusSessionRow | undefined>((a, x) => (!a || x.startedAt > a.startedAt ? x : a), undefined);
  return limits.map((l) => {
    const ms = sessions.filter((x) => matchDistraction(x, [l.app])).reduce((a, x) => { const iv = sessionInterval(x, x === latest, now); return a + (iv.end - iv.start); }, 0);
    return { app: l.app, minutes: l.minutes, usedMin: Math.round(ms / MIN) };
  });
}
```
and rewrite `appCap` to `const hit = limitUsage(s.limits, s.sessions, s.now).find((u) => u.usedMin * MIN >= u.minutes * MIN)` — keep the exact candidate it returns today (existing tests must pass; note `usedMin` is rounded, so compare the unrounded ms if a test at the boundary fails — keep `ms` internally and add `usedMs` if needed).

`episodes.ts`:
```ts
import { finalCategory } from '../brain/finalCategory';
import { categoryForApp } from '../../shared/categories';
import type { EpisodeRead } from '../screen/labels';

const GAP_MS = 5 * 60_000;
const READ_MS = 30_000;     // one read stands for ~30 s of screen time
const SAMPLE_CHARS = 300;
const DEEP_MS = 25 * 60_000;

export interface Episode { id: string; start: number; end: number; app: string; category: string; activity: string | null;
  titles: string[]; samples: string[]; avgStuck: number; avgDistraction: number; stuckReads: number; reads: number; }

const catOf = (r: EpisodeRead): string => (r.category ? finalCategory(r.category, r.conf ?? 0, r.appName) : categoryForApp(r.appName));
const mean = (xs: (number | null)[]): number => { const v = xs.filter((x): x is number => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; };
function mode(xs: (string | null)[]): string | null {
  const m = new Map<string, number>();
  for (const x of xs) if (x) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function toEpisode(g: EpisodeRead[], category: string, withText: boolean): Episode {
  const titles = [...new Set(g.map((r) => r.windowTitle).filter((t): t is string => !!t))].slice(0, 3);
  const samples = withText
    ? [...g].filter((r) => r.text).sort((a, b) => (b.stuck ?? 0) - (a.stuck ?? 0) || a.at - b.at)
        .map((r) => (r.text as string).slice(0, SAMPLE_CHARS)).filter((t, i, a) => a.indexOf(t) === i).slice(0, 3)
    : [];
  return { id: `e${g[0].id}`, start: g[0].at, end: g[g.length - 1].at + READ_MS, app: g[0].appName, category, activity: mode(g.map((r) => r.activity)),
    titles, samples, avgStuck: mean(g.map((r) => r.stuck)), avgDistraction: mean(g.map((r) => r.distraction)),
    stuckReads: g.filter((r) => (r.stuck ?? 0) >= 2).length, reads: g.length };
}

/** Consecutive reads of the same app and final category, gaps under 5 min. `withText` = screen reading on. */
export function buildEpisodes(reads: EpisodeRead[], withText: boolean): Episode[] {
  const out: Episode[] = [];
  let g: EpisodeRead[] = [], cat = '';
  for (const r of [...reads].sort((a, b) => a.at - b.at || a.id - b.id)) {
    const c = catOf(r);
    const last = g[g.length - 1];
    if (last && (r.appName !== last.appName || c !== cat || r.at - last.at >= GAP_MS)) { out.push(toEpisode(g, cat, withText)); g = []; }
    if (!g.length) cat = c;
    g.push(r);
  }
  if (g.length) out.push(toEpisode(g, cat, withText));
  return out;
}

export const deepWorkSec = (episodes: Episode[]): number =>
  episodes.filter((e) => (e.category === 'work' || e.category === 'learning') && e.end - e.start >= DEEP_MS && e.avgDistraction < 0.5)
    .reduce((a, e) => a + (e.end - e.start) / 1000, 0);
```

`candidates.ts`:
```ts
import { displayAppName } from '../../shared/categories';
import type { Episode } from './episodes';

export interface ReportCandidate { id: string; kind: 'stuck' | 'search' | 'nudge' | 'cap'; text: string; sample?: string; }

export function buildCandidates(i: { episodes: Episode[]; searches: { query: string; count: number }[];
  nudges: { id: number; ruleId: string; title: string; status: string }[]; caps: { app: string; minutes: number; usedMin: number }[] }): ReportCandidate[] {
  const out: ReportCandidate[] = [];
  for (const e of i.episodes) {
    if (e.avgStuck < 1.5 && e.stuckReads < 3) continue;
    const min = Math.round((e.end - e.start) / 60_000);
    out.push({ id: `stuck:${e.id}`, kind: 'stuck', text: `Stuck for ${min} min in ${displayAppName(e.app)}${e.titles[0] ? ` (${e.titles[0]})` : ''}`,
      ...(e.samples[0] ? { sample: e.samples[0].slice(0, 200) } : {}) });
  }
  i.searches.forEach((s, n) => out.push({ id: `search:${n}`, kind: 'search', text: `Searched "${s.query}" ${s.count} times this week` }));
  for (const n of i.nudges) out.push({ id: `nudge:${n.id}`, kind: 'nudge', text: `Pop-up "${n.title}" (${n.status})` });
  for (const c of i.caps) if (c.usedMin >= c.minutes) out.push({ id: `cap:${c.app}`, kind: 'cap', text: `${c.app}: ${c.usedMin} min used, limit ${c.minutes} min` });
  return out;
}
```

`input.ts`:
```ts
import type { Health } from '../day/health';
import type { TodayView } from '../day/today';
import { deepWorkSec, type Episode } from './episodes';
import type { ReportCandidate } from './candidates';

export const INPUT_EPISODES = 40;
export interface ReportStats { date: string; screenSec: number; activeSec: number; goalSec: number; deepWorkSec: number; switches: number;
  health: Health; topApps: { appName: string; seconds: number }[]; categories: { category: string; seconds: number }[]; weekAvgSec: number; }
export interface WriterEpisode { id: string; start: string; end: string; minutes: number; app: string; category: string; activity: string | null;
  titles: string[]; samples: string[]; stuck: number; distraction: number; }
export interface ReportInput { date: string; stats: ReportStats; episodes: WriterEpisode[]; candidates: ReportCandidate[];
  goals: { dailyGoalMin: number; windDownTime: string; breakIntervalMin: number }; }

const hhmm = (ms: number): string => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const r1 = (x: number): number => Math.round(x * 10) / 10;

export function buildStats(view: TodayView, episodes: Episode[], switches: number): ReportStats {
  const prior = view.week.filter((d) => d.date !== view.date);
  return {
    date: view.date, screenSec: view.screenSec, activeSec: view.activeSec, goalSec: view.goalSec, deepWorkSec: deepWorkSec(episodes), switches,
    health: view.health, topApps: view.apps.slice(0, 5), categories: view.cards.map((c) => ({ category: c.category, seconds: c.seconds })),
    weekAvgSec: prior.length ? prior.reduce((a, d) => a + d.seconds, 0) / prior.length : 0
  };
}

export function buildReportInput(i: { stats: ReportStats; episodes: Episode[]; candidates: ReportCandidate[]; goals: ReportInput['goals'] }): ReportInput {
  const longest = [...i.episodes].sort((a, b) => (b.end - b.start) - (a.end - a.start)).slice(0, INPUT_EPISODES).sort((a, b) => a.start - b.start);
  return {
    date: i.stats.date, stats: i.stats, candidates: i.candidates, goals: i.goals,
    episodes: longest.map((e) => ({ id: e.id, start: hhmm(e.start), end: hhmm(e.end), minutes: Math.round((e.end - e.start) / 60_000), app: e.app,
      category: e.category, activity: e.activity, titles: e.titles, samples: e.samples, stuck: r1(e.avgStuck), distraction: r1(e.avgDistraction) }))
  };
}

const SYSTEM = [
  "You are Daylens, a warm, concise coach writing a person's end-of-day report about their computer use.",
  'Write in second person ("you"), plain friendly English, no emoji, no markdown.',
  'Use only the facts in the input. Do not invent apps, events, problems or numbers; if you mention a number, copy it from the input.',
  'headline: one short line capturing the day. story: 3-5 sentences on how the day went, in time order.',
  'wins: up to 3 genuine positives. habits: up to 3 patterns worth watching, kind not judgmental.',
  'doBetter: up to 4 items; each MUST set candidateId to one of the ids in "candidates" and give what happened and a concrete better approach.',
  'plan: up to 4 suggestions for tomorrow, each with kind focus_block {start "HH:MM", minutes}, app_cap {app, minutes}, break_interval {minutes} or wind_down {time "HH:MM"}.',
  'advice: one short paragraph of the single most useful advice.'
].join('\n');

export function reportPrompt(input: ReportInput): { system: string; user: string } {
  return { system: SYSTEM, user: JSON.stringify(input) };
}
```

- [ ] **Step 4: Run tests** (new files + `labels.test.ts`, `tips.test.ts`, `behaviour.test.ts`) → pass; typecheck.

- [ ] **Step 5: Commit**

```bash
git add apps/consumer/src/main/report apps/consumer/src/main/screen/labels.ts apps/consumer/src/main/screen/labels.test.ts apps/consumer/src/main/coach/activity.ts apps/consumer/src/main/coach/rules/tips.ts apps/consumer/src/main/coach/rules/behaviour.ts
git commit -m "feat(consumer): report episodes, deep work, grounded candidates and writer input"
```

---

### Task 5: Report schema, grounding and storage

**Files:**
- Create: `apps/consumer/src/main/report/schema.ts`, `schema.test.ts`, `store.ts`, `store.test.ts`
- Modify: `apps/consumer/src/main/screen/store.ts` (delete + export), `apps/consumer/src/main/screen/store.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // schema.ts
  export type PlanKind = 'focus_block' | 'app_cap' | 'break_interval' | 'wind_down';
  export type PlanItem =
    | { kind: 'focus_block'; text: string; payload: { start: string; minutes: number } }
    | { kind: 'app_cap'; text: string; payload: { app: string; minutes: number } }
    | { kind: 'break_interval'; text: string; payload: { minutes: number } }
    | { kind: 'wind_down'; text: string; payload: { time: string } };
  export interface ReportJson { headline: string; story: string; wins: string[]; habits: string[];
    doBetter: { candidateId: string; what: string; better: string }[]; plan: PlanItem[]; advice: string; }
  export const REPORT_JSON_SCHEMA: Record<string, unknown>;
  export function parseReport(raw: unknown, candidateIds: ReadonlySet<string>): ReportJson | null;
  export function parsePlanItem(raw: unknown): PlanItem | null;
  // store.ts
  export const REPORT_SQL: string;
  export interface ReportRow { date: string; status: 'pending' | 'ready' | 'failed'; report: ReportJson | null; model: string | null; generatedAt: number | null; error: string | null; }
  export interface PlanItemRow { id: number; forDate: string; sourceDate: string; item: PlanItem; enabled: boolean; }
  export interface ReportStore {
    get(date: string): ReportRow | null; dates(): string[];
    setPending(date: string, now: number): void; setReady(date: string, report: ReportJson, model: string, now: number): void; setFailed(date: string, error: string, now: number): void;
    clearPending(now: number): void;
    plan(forDate: string): PlanItemRow[]; tickedTexts(sourceDate: string): string[];
    tick(sourceDate: string, item: PlanItem, on: boolean): void; setEnabled(id: number, on: boolean): void;
  }
  export function createReportStore(db: Database.Database): ReportStore;
  ```

- [ ] **Step 1: Failing tests**

`schema.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parsePlanItem, parseReport, REPORT_JSON_SCHEMA } from './schema';

const ids = new Set(['stuck:e1', 'nudge:7']);
const good = { headline: 'A focused morning', story: 'You coded.', wins: ['a'], habits: ['b'],
  doBetter: [{ candidateId: 'stuck:e1', what: 'w', better: 'b' }], plan: [{ text: 'Block 9:30', kind: 'focus_block', payload: { start: '09:30', minutes: 90 } }], advice: 'Rest.' };

describe('report schema', () => {
  it('accepts a good report', () => { expect(parseReport(good, ids)).toEqual(good); });
  it('drops doBetter items whose candidateId is not a real candidate (grounding guard)', () => {
    const r = parseReport({ ...good, doBetter: [...good.doBetter, { candidateId: 'made:up', what: 'x', better: 'y' }] }, ids);
    expect(r?.doBetter.map((d) => d.candidateId)).toEqual(['stuck:e1']);
  });
  it('drops invalid plan items one by one', () => {
    const plan = [good.plan[0], { text: 'x', kind: 'focus_block', payload: { start: '25:00', minutes: 90 } }, { text: 'x', kind: 'app_cap', payload: { app: 'YouTube', minutes: 5 } },
      { text: 'Breaks every 40', kind: 'break_interval', payload: { minutes: 40 } }, { text: 'x', kind: 'nap', payload: {} }, { text: 'Bed by 23:00', kind: 'wind_down', payload: { time: '23:00' } }];
    expect(parseReport({ ...good, plan }, ids)?.plan.map((p) => p.kind)).toEqual(['focus_block', 'break_interval', 'wind_down']);
  });
  it('truncates long strings and extra list items instead of rejecting', () => {
    const r = parseReport({ ...good, headline: 'h'.repeat(200), wins: ['1', '2', '3', '4', '5'], advice: 'a'.repeat(400) }, ids)!;
    expect(r.headline).toHaveLength(80);
    expect(r.wins).toHaveLength(3);
    expect(r.advice).toHaveLength(300);
  });
  it('rejects a report without a headline or that is not an object', () => {
    expect(parseReport({ ...good, headline: '' }, ids)).toBeNull();
    expect(parseReport('nope', ids)).toBeNull();
    expect(parseReport(null, ids)).toBeNull();
  });
  it('tolerates missing optional lists', () => {
    expect(parseReport({ headline: 'H', story: 'S', advice: 'A' }, ids)).toMatchObject({ wins: [], habits: [], doBetter: [], plan: [] });
  });
  it('validates a lone plan item', () => {
    expect(parsePlanItem({ text: 'Cap', kind: 'app_cap', payload: { app: 'Discord', minutes: 60 } })).toMatchObject({ kind: 'app_cap' });
    expect(parsePlanItem({ text: 'x', kind: 'wind_down', payload: { time: '9pm' } })).toBeNull();
  });
  it('exposes a JSON schema for the grammar', () => {
    expect(REPORT_JSON_SCHEMA).toMatchObject({ type: 'object', required: expect.arrayContaining(['headline', 'story', 'advice']) });
  });
});
```

`store.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { createReportStore, REPORT_SQL } from './store';
import type { ReportJson } from './schema';

const rep: ReportJson = { headline: 'H', story: 'S', wins: [], habits: [], doBetter: [], plan: [], advice: 'A' };
const mk = () => { const db = new Database(':memory:'); db.exec(REPORT_SQL); return { db, s: createReportStore(db) }; };

describe('report store', () => {
  it('moves a report through pending → ready and replaces it on regenerate', () => {
    const { s } = mk();
    expect(s.get('2026-09-26')).toBeNull();
    s.setPending('2026-09-26', 1);
    expect(s.get('2026-09-26')).toMatchObject({ status: 'pending', report: null });
    s.setReady('2026-09-26', rep, 'Qwen3 4B', 2);
    expect(s.get('2026-09-26')).toMatchObject({ status: 'ready', report: rep, model: 'Qwen3 4B', generatedAt: 2, error: null });
    s.setFailed('2026-09-26', 'timeout', 3);
    expect(s.get('2026-09-26')).toMatchObject({ status: 'failed', error: 'timeout', report: null });
  });
  it('lists dates newest first and fails rows left pending by a restart', () => {
    const { s } = mk();
    s.setReady('2026-09-24', rep, 'm', 1); s.setPending('2026-09-26', 1); s.setReady('2026-09-25', rep, 'm', 1);
    expect(s.dates()).toEqual(['2026-09-26', '2026-09-25', '2026-09-24']);
    s.clearPending(9);
    expect(s.get('2026-09-26')).toMatchObject({ status: 'failed', error: 'interrupted' });
  });
  it('ticks plan items for the next day and unticks them', () => {
    const { s } = mk();
    const item = { kind: 'break_interval' as const, text: 'Breaks every 40 min', payload: { minutes: 40 } };
    s.tick('2026-09-26', item, true);
    s.tick('2026-09-26', item, true); // idempotent
    expect(s.plan('2026-09-27')).toEqual([{ id: expect.any(Number), forDate: '2026-09-27', sourceDate: '2026-09-26', item, enabled: true }]);
    expect(s.tickedTexts('2026-09-26')).toEqual(['Breaks every 40 min']);
    s.setEnabled(s.plan('2026-09-27')[0].id, false);
    expect(s.plan('2026-09-27')[0].enabled).toBe(false);
    s.tick('2026-09-26', item, false);
    expect(s.plan('2026-09-27')).toEqual([]);
  });
});
```

`screen/store.test.ts`: extend the delete test to create `REPORT_SQL`, insert a report + plan item, and assert both tables are empty after `deleteActivity`; extend the export test to assert `dailyReports` and `planItems` arrays are present (empty when tables missing).

- [ ] **Step 2: Run to confirm failure.**

- [ ] **Step 3: Implement**

`schema.ts`:
```ts
import { z } from 'zod';

export type PlanKind = 'focus_block' | 'app_cap' | 'break_interval' | 'wind_down';
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const text = z.string().trim().min(1).transform((s) => s.slice(0, 160));
const planItem = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('focus_block'), text, payload: z.object({ start: z.string().regex(HHMM), minutes: z.number().int().min(15).max(240) }).strip() }).strip(),
  z.object({ kind: z.literal('app_cap'), text, payload: z.object({ app: z.string().trim().min(1).max(60), minutes: z.number().int().min(15).max(240) }).strip() }).strip(),
  z.object({ kind: z.literal('break_interval'), text, payload: z.object({ minutes: z.number().int().min(10).max(180) }).strip() }).strip(),
  z.object({ kind: z.literal('wind_down'), text, payload: z.object({ time: z.string().regex(HHMM) }).strip() }).strip()
]);
export type PlanItem = z.infer<typeof planItem>;
export interface ReportJson { headline: string; story: string; wins: string[]; habits: string[];
  doBetter: { candidateId: string; what: string; better: string }[]; plan: PlanItem[]; advice: string; }

const cut = (n: number) => (v: unknown): string => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strings = (v: unknown, max: number, len: number): string[] => list(v).map(cut(len)).filter(Boolean).slice(0, max);

export function parsePlanItem(raw: unknown): PlanItem | null {
  const r = planItem.safeParse(raw);
  return r.success ? r.data : null;
}

/** Validates the writer's answer item by item: bad items are dropped, over-long text is cut, only a missing headline fails. */
export function parseReport(raw: unknown, candidateIds: ReadonlySet<string>): ReportJson | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const headline = cut(80)(o.headline);
  if (!headline) return null;
  const doBetter = list(o.doBetter).flatMap((d) => {
    const x = (d ?? {}) as Record<string, unknown>;
    const id = typeof x.candidateId === 'string' ? x.candidateId : '';
    const what = cut(240)(x.what), better = cut(240)(x.better);
    return candidateIds.has(id) && what && better ? [{ candidateId: id, what, better }] : [];
  }).slice(0, 4);
  return {
    headline, story: cut(900)(o.story), wins: strings(o.wins, 3, 200), habits: strings(o.habits, 3, 200), doBetter,
    plan: list(o.plan).map(parsePlanItem).filter((p): p is PlanItem => p !== null).slice(0, 4), advice: cut(300)(o.advice)
  };
}

// Grammar for the local writer (node-llama-cpp createGrammarForJsonSchema). Lengths are enforced by parseReport.
const str = { type: 'string' } as const;
export const REPORT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    headline: str, story: str,
    wins: { type: 'array', items: str, maxItems: 3 },
    habits: { type: 'array', items: str, maxItems: 3 },
    doBetter: { type: 'array', maxItems: 4, items: { type: 'object', properties: { candidateId: str, what: str, better: str }, required: ['candidateId', 'what', 'better'] } },
    plan: { type: 'array', maxItems: 4, items: { type: 'object', properties: {
      text: str, kind: { enum: ['focus_block', 'app_cap', 'break_interval', 'wind_down'] },
      payload: { type: 'object', properties: { start: str, minutes: { type: 'integer' }, app: str, time: str } } }, required: ['text', 'kind', 'payload'] } },
    advice: str
  },
  required: ['headline', 'story', 'wins', 'habits', 'doBetter', 'plan', 'advice']
};
```
(If node-llama-cpp's JSON-schema grammar rejects `maxItems` or optional `payload` properties, simplify the schema — `parseReport` already enforces the limits — and note it.)

`store.ts`:
```ts
import type Database from 'better-sqlite3';
import { shiftDate } from '../day/time';
import { parsePlanItem, type PlanItem, type ReportJson } from './schema';

export const REPORT_SQL = `
CREATE TABLE IF NOT EXISTS daily_reports (
  date TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('pending','ready','failed')),
  report_json TEXT, model TEXT, generated_at INTEGER, error TEXT
);
CREATE TABLE IF NOT EXISTS plan_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  for_date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('focus_block','app_cap','break_interval','wind_down')),
  payload_json TEXT NOT NULL, text TEXT NOT NULL, source_date TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_plan_for ON plan_items(for_date);
`;

export interface ReportRow { date: string; status: 'pending' | 'ready' | 'failed'; report: ReportJson | null; model: string | null; generatedAt: number | null; error: string | null; }
export interface PlanItemRow { id: number; forDate: string; sourceDate: string; item: PlanItem; enabled: boolean; }
export interface ReportStore {
  get(date: string): ReportRow | null; dates(): string[];
  setPending(date: string, now: number): void; setReady(date: string, report: ReportJson, model: string, now: number): void; setFailed(date: string, error: string, now: number): void;
  clearPending(now: number): void;
  plan(forDate: string): PlanItemRow[]; tickedTexts(sourceDate: string): string[];
  tick(sourceDate: string, item: PlanItem, on: boolean): void; setEnabled(id: number, on: boolean): void;
}

type RawReport = { date: string; status: ReportRow['status']; report_json: string | null; model: string | null; generated_at: number | null; error: string | null };
type RawPlan = { id: number; for_date: string; source_date: string; kind: string; text: string; payload_json: string; enabled: number };

export function createReportStore(db: Database.Database): ReportStore {
  const upsert = db.prepare(`INSERT INTO daily_reports (date, status, report_json, model, generated_at, error) VALUES (@date, @status, @report, @model, @at, @error)
    ON CONFLICT(date) DO UPDATE SET status = excluded.status, report_json = excluded.report_json, model = excluded.model, generated_at = excluded.generated_at, error = excluded.error`);
  const one = db.prepare('SELECT * FROM daily_reports WHERE date = ?');
  const all = db.prepare('SELECT date FROM daily_reports ORDER BY date DESC');
  const stale = db.prepare("UPDATE daily_reports SET status = 'failed', error = 'interrupted', generated_at = ? WHERE status = 'pending'");
  const planFor = db.prepare('SELECT * FROM plan_items WHERE for_date = ? ORDER BY id');
  const bySource = db.prepare('SELECT text FROM plan_items WHERE source_date = ? ORDER BY id');
  const find = db.prepare('SELECT id FROM plan_items WHERE source_date = ? AND kind = ? AND text = ?');
  const ins = db.prepare('INSERT INTO plan_items (for_date, kind, payload_json, text, source_date) VALUES (?, ?, ?, ?, ?)');
  const del = db.prepare('DELETE FROM plan_items WHERE source_date = ? AND kind = ? AND text = ?');
  const en = db.prepare('UPDATE plan_items SET enabled = ? WHERE id = ?');
  const put = (date: string, status: ReportRow['status'], report: ReportJson | null, model: string | null, at: number, error: string | null): void => {
    upsert.run({ date, status, report: report ? JSON.stringify(report) : null, model, at, error });
  };
  const toPlan = (r: RawPlan): PlanItemRow | null => {
    const item = parsePlanItem({ kind: r.kind, text: r.text, payload: JSON.parse(r.payload_json) });
    return item ? { id: r.id, forDate: r.for_date, sourceDate: r.source_date, item, enabled: r.enabled === 1 } : null;
  };
  return {
    get(date) {
      const r = one.get(date) as RawReport | undefined;
      if (!r) return null;
      let report: ReportJson | null = null;
      try { report = r.report_json ? JSON.parse(r.report_json) as ReportJson : null; } catch { report = null; }
      return { date: r.date, status: r.status, report, model: r.model, generatedAt: r.generated_at, error: r.error };
    },
    dates: () => (all.all() as { date: string }[]).map((r) => r.date),
    setPending: (date, now) => put(date, 'pending', null, null, now, null),
    setReady: (date, report, model, now) => put(date, 'ready', report, model, now, null),
    setFailed: (date, error, now) => put(date, 'failed', null, null, now, error),
    clearPending: (now) => { stale.run(now); },
    plan: (forDate) => (planFor.all(forDate) as RawPlan[]).map(toPlan).filter((p): p is PlanItemRow => p !== null),
    tickedTexts: (sourceDate) => (bySource.all(sourceDate) as { text: string }[]).map((r) => r.text),
    tick(sourceDate, item, on) {
      if (!on) { del.run(sourceDate, item.kind, item.text); return; }
      if (!find.get(sourceDate, item.kind, item.text)) ins.run(shiftDate(sourceDate, 1), item.kind, JSON.stringify(item.payload), item.text, sourceDate);
    },
    setEnabled: (id, on) => { en.run(on ? 1 : 0, id); }
  };
}
```

`screen/store.ts`: in `deleteActivity` add `if (hasTable(db, 'daily_reports')) db.exec('DELETE FROM daily_reports; DELETE FROM plan_items;');`; `ExportData` gains `dailyReports: unknown[]; planItems: unknown[]` filled with `hasTable(db,'daily_reports') ? db.prepare('SELECT * FROM daily_reports ORDER BY date').all() : []` and `hasTable(db,'plan_items') ? all('plan_items') : []`.

- [ ] **Step 4: Run tests → pass; typecheck.**

- [ ] **Step 5: Commit**

```bash
git add apps/consumer/src/main/report/schema.ts apps/consumer/src/main/report/schema.test.ts apps/consumer/src/main/report/store.ts apps/consumer/src/main/report/store.test.ts apps/consumer/src/main/screen/store.ts apps/consumer/src/main/screen/store.test.ts
git commit -m "feat(consumer): report schema with grounding guard, report + plan storage"
```

---

### Task 6: Report scheduler and generate step

**Files:**
- Create: `apps/consumer/src/main/report/scheduler.ts`, `scheduler.test.ts`, `generate.ts`, `generate.test.ts`, `battery.ts`

**Interfaces:**
- Consumes: `ReportStore`, `ReportRow` (Task 5); `Writer`, `WriteResult` (Task 3); `REPORT_JSON_SCHEMA`, `parseReport` (Task 5); `ReportInput`, `reportPrompt` (Task 4); `shiftDate`, `EARLY_MORNING_MIN` (`../day/time`).
- Produces:
  ```ts
  // generate.ts
  export type GenerateOutcome = 'ok' | 'failed' | 'crash' | 'timeout' | 'load';
  export async function generateReport(date: string, deps: { build(date: string): { input: ReportInput; candidateIds: Set<string> };
    writer: Writer; store: ReportStore; now(): number }): Promise<GenerateOutcome>;
  // scheduler.ts
  export interface ReportSchedulerDeps {
    now(): number; windDown(date: string): string; row(date: string): { status: string } | null; hasActivity(date: string): boolean;
    canWrite(): boolean; gateOk(): boolean; otherJobRunning(): boolean; lowBattery(): Promise<boolean>;
    generate(date: string): Promise<GenerateOutcome>; onChange?(): void;
  }
  export interface ReportScheduler { tick(): Promise<void>; request(date: string): void; running(): string | null; waiting(): string | null; autoPaused(): boolean; resume(): void; }
  export function createReportScheduler(d: ReportSchedulerDeps): ReportScheduler;
  // battery.ts
  export function batteryPercent(run?: (cmd: string, args: string[], ms: number) => Promise<string>): Promise<number | null>;
  ```

- [ ] **Step 1: Failing tests**

`generate.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { generateReport } from './generate';
import type { ReportStore } from './store';

function store() {
  const log: string[] = [];
  const s = { setPending: (d: string) => log.push(`pending ${d}`), setReady: (d: string, r: any, m: string) => log.push(`ready ${d} ${r.headline} ${m}`),
    setFailed: (d: string, e: string) => log.push(`failed ${d} ${e}`) } as unknown as ReportStore;
  return { s, log };
}
const build = () => ({ input: { date: '2026-09-26' } as never, candidateIds: new Set(['stuck:e1']) });

describe('generateReport', () => {
  it('marks pending, writes, and stores the grounded report', async () => {
    const { s, log } = store();
    const writer = { write: async (job: any) => ({ ok: true, value: job.parse({ headline: 'Good day', story: 's', advice: 'a',
      doBetter: [{ candidateId: 'made:up', what: 'x', better: 'y' }] }), model: 'Qwen3 4B' }) } as never;
    expect(await generateReport('2026-09-26', { build, writer, store: s, now: () => 1 })).toBe('ok');
    expect(log).toEqual(['pending 2026-09-26', 'ready 2026-09-26 Good day Qwen3 4B']);
  });
  it('stores the failure reason and maps local failure kinds', async () => {
    for (const [local, outcome] of [['timeout', 'timeout'], ['crash', 'crash'], ['load', 'load'], ['invalid', 'failed'], [undefined, 'failed']] as const) {
      const { s, log } = store();
      const writer = { write: async () => ({ ok: false, reason: 'why', local }) } as never;
      expect(await generateReport('2026-09-26', { build, writer, store: s, now: () => 1 })).toBe(outcome);
      expect(log[1]).toBe('failed 2026-09-26 why');
    }
  });
  it('fails cleanly when building the input throws', async () => {
    const { s, log } = store();
    const writer = { write: async () => { throw new Error('never'); } } as never;
    expect(await generateReport('2026-09-26', { build: () => { throw new Error('db'); }, writer, store: s, now: () => 1 })).toBe('failed');
    expect(log).toEqual(['failed 2026-09-26 Could not gather the day: Error: db']);
  });
});
```

`scheduler.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createReportScheduler, type ReportSchedulerDeps } from './scheduler';

const at = (d: number, h: number, m = 0) => new Date(2026, 8, d, h, m).getTime();
function mk(o: Partial<ReportSchedulerDeps> = {}) {
  const rows = new Map<string, string>(); const ran: string[] = [];
  let now = at(26, 23, 5);
  const d: ReportSchedulerDeps = {
    now: () => now, windDown: () => '23:00', row: (date) => (rows.has(date) ? { status: rows.get(date)! } : null), hasActivity: () => true,
    canWrite: () => true, gateOk: () => true, otherJobRunning: () => false, lowBattery: async () => false,
    generate: async (date) => { ran.push(date); rows.set(date, 'ready'); return 'ok'; }, ...o
  };
  return { s: createReportScheduler(d), rows, ran, setNow: (t: number) => { now = t; } };
}

describe('report scheduler', () => {
  it("writes yesterday's missing report first, then today's after wind-down", async () => {
    const { s, ran } = mk();
    await s.tick(); await s.tick(); await s.tick();
    expect(ran).toEqual(['2026-09-25', '2026-09-26']);
  });
  it('waits before wind-down, and ignores days with no activity or an existing row', async () => {
    const { s, ran, rows, setNow } = mk({ hasActivity: (date) => date === '2026-09-26' });
    setNow(at(26, 22, 0)); await s.tick();
    expect(ran).toEqual([]);
    rows.set('2026-09-26', 'failed'); setNow(at(26, 23, 30)); await s.tick();
    expect(ran).toEqual([]); // failed reports are only retried by hand
  });
  it('treats a wind-down before 05:00 as covered by the next-day "yesterday" rule', async () => {
    const { s, ran, setNow } = mk({ windDown: () => '01:00', hasActivity: (d) => d === '2026-09-26' });
    setNow(at(26, 23, 0)); await s.tick();
    expect(ran).toEqual([]);
    setNow(at(27, 0, 10)); await s.tick();
    expect(ran).toEqual(['2026-09-26']);
  });
  it('waits for the memory gate, for labelling to finish, and for a usable writer', async () => {
    let gate = false, busy = true, can = false;
    const { s, ran } = mk({ gateOk: () => gate, otherJobRunning: () => busy, canWrite: () => can, hasActivity: (d) => d === '2026-09-26' });
    await s.tick(); expect(ran).toEqual([]);
    can = true; await s.tick(); expect(ran).toEqual([]); expect(s.waiting()).toBe('2026-09-26');
    gate = true; await s.tick(); expect(ran).toEqual([]);
    busy = false; await s.tick(); expect(ran).toEqual(['2026-09-26']); expect(s.waiting()).toBeNull();
  });
  it('holds automatic runs on low battery but not manual ones', async () => {
    const { s, ran } = mk({ lowBattery: async () => true, hasActivity: (d) => d === '2026-09-26' });
    await s.tick(); expect(ran).toEqual([]);
    s.request('2026-09-20'); await s.tick(); expect(ran).toEqual(['2026-09-20']);
  });
  it('regenerates on request even when a report exists, and never runs two at once', async () => {
    let release!: () => void;
    const { s, ran, rows } = mk({ hasActivity: () => false, generate: (date) => new Promise((r) => { ran.push(date); rows.set(date, 'ready'); release = () => r('ok'); }) });
    rows.set('2026-09-24', 'ready');
    s.request('2026-09-24');
    const first = s.tick(); await Promise.resolve();
    expect(s.running()).toBe('2026-09-24');
    s.request('2026-09-23'); await s.tick();
    expect(ran).toEqual(['2026-09-24']);
    release(); await first; await s.tick();
    expect(ran).toEqual(['2026-09-24', '2026-09-23']);
  });
  it('pauses automatic runs after 3 crashes in 10 minutes until resumed', async () => {
    const { s, ran, rows } = mk({ hasActivity: () => false, generate: async (date) => { ran.push(date); rows.set(date, 'failed'); return 'crash'; } });
    for (const d of ['2026-09-21', '2026-09-22', '2026-09-23']) { s.request(d); await s.tick(); }
    expect(s.autoPaused()).toBe(true);
    s.resume();
    expect(s.autoPaused()).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm failure.**

- [ ] **Step 3: Implement**

`generate.ts`:
```ts
import type { ReportInput } from './input';
import { reportPrompt } from './input';
import { parseReport, REPORT_JSON_SCHEMA, type ReportJson } from './schema';
import type { ReportStore } from './store';
import type { Writer } from '../writer/writer';

export type GenerateOutcome = 'ok' | 'failed' | 'crash' | 'timeout' | 'load';
const MAX_TOKENS = 1400;

export async function generateReport(date: string, deps: { build(date: string): { input: ReportInput; candidateIds: Set<string> };
  writer: Writer; store: ReportStore; now(): number }): Promise<GenerateOutcome> {
  let built;
  try { built = deps.build(date); } catch (e) { deps.store.setFailed(date, `Could not gather the day: ${String(e)}`, deps.now()); return 'failed'; }
  deps.store.setPending(date, deps.now());
  const { system, user } = reportPrompt(built.input);
  const r = await deps.writer.write<ReportJson>({ kind: 'report', system, user, schema: REPORT_JSON_SCHEMA, maxTokens: MAX_TOKENS,
    parse: (v) => parseReport(v, built.candidateIds) });
  if (r.ok) { deps.store.setReady(date, r.value, r.model, deps.now()); return 'ok'; }
  deps.store.setFailed(date, r.reason, deps.now());
  return r.local === 'timeout' || r.local === 'crash' || r.local === 'load' ? r.local : 'failed';
}
```

`scheduler.ts`:
```ts
import { localDate } from '@worksight/core/date';
import { EARLY_MORNING_MIN, shiftDate } from '../day/time';
import type { GenerateOutcome } from './generate';

export interface ReportSchedulerDeps {
  now(): number; windDown(date: string): string; row(date: string): { status: string } | null; hasActivity(date: string): boolean;
  canWrite(): boolean; gateOk(): boolean; otherJobRunning(): boolean; lowBattery(): Promise<boolean>;
  generate(date: string): Promise<GenerateOutcome>; onChange?(): void;
}
export interface ReportScheduler { tick(): Promise<void>; request(date: string): void; running(): string | null; waiting(): string | null; autoPaused(): boolean; resume(): void; }

const CRASH_WINDOW_MS = 10 * 60_000;
const minutesOf = (hhmm: string): number => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

export function createReportScheduler(d: ReportSchedulerDeps): ReportScheduler {
  let running: string | null = null, waiting: string | null = null, paused = false;
  let crashes: number[] = [];
  const manual: string[] = [];
  const change = (): void => d.onChange?.();

  const autoDue = (): string | null => {
    const now = d.now();
    const today = localDate(now), yesterday = shiftDate(today, -1);
    if (d.hasActivity(yesterday) && !d.row(yesterday)) return yesterday;
    const wd = minutesOf(d.windDown(today));
    const nowMin = new Date(now).getHours() * 60 + new Date(now).getMinutes();
    if (wd >= EARLY_MORNING_MIN && nowMin >= wd && d.hasActivity(today) && !d.row(today)) return today;
    return null;
  };

  return {
    async tick() {
      if (running) return;
      const isManual = manual.length > 0;
      const date = isManual ? manual[0] : paused ? null : autoDue();
      const wait = (w: string | null): void => { if (w !== waiting) { waiting = w; change(); } };
      if (!date || !d.canWrite()) { wait(date && isManual ? date : null); return; }
      if (!isManual && await d.lowBattery()) { wait(null); return; }
      if (!d.gateOk() || d.otherJobRunning()) { wait(date); return; }
      if (isManual) manual.shift();
      running = date; wait(null); change();
      try {
        const outcome = await d.generate(date);
        if (outcome === 'crash') {
          const now = d.now();
          crashes = [...crashes.filter((t) => now - t < CRASH_WINDOW_MS), now];
          if (crashes.length >= 3) paused = true;
        }
      } finally { running = null; change(); }
    },
    request(date) { if (!manual.includes(date)) manual.push(date); change(); },
    running: () => running,
    waiting: () => waiting,
    autoPaused: () => paused,
    resume() { paused = false; crashes = []; change(); }
  };
}
```

`battery.ts`:
```ts
import { execFile } from 'node:child_process';

const defaultRun = (cmd: string, args: string[], ms: number): Promise<string> => new Promise((resolve, reject) => {
  execFile(cmd, args, { timeout: ms, windowsHide: true }, (err, out) => (err ? reject(err) : resolve(out)));
});
/** Battery charge 0–100, or null when unknown / no battery. Only called while on battery power. */
export async function batteryPercent(run = defaultRun): Promise<number | null> {
  try {
    const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_Battery | Select-Object -First 1).EstimatedChargeRemaining'], 5000);
    const n = Number(out.trim());
    return Number.isFinite(n) && out.trim() !== '' ? n : null;
  } catch { return null; }
}
```
(Add a 3-case `battery.test.ts`: `'57\r\n'` → 57, `''` → null, throw → null.)

- [ ] **Step 4: Run tests → pass; typecheck.**

- [ ] **Step 5: Commit**

```bash
git add apps/consumer/src/main/report/scheduler.ts apps/consumer/src/main/report/scheduler.test.ts apps/consumer/src/main/report/generate.ts apps/consumer/src/main/report/generate.test.ts apps/consumer/src/main/report/battery.ts apps/consumer/src/main/report/battery.test.ts
git commit -m "feat(consumer): report scheduler (wind-down, yesterday, gate, battery, crash pause) and generate step"
```

---

### Task 7: Main wiring, report view and IPC

**Files:**
- Create: `apps/consumer/src/main/report/view.ts`, `view.test.ts`
- Modify: `apps/consumer/src/main/index.ts`, `apps/consumer/src/main/ipc.ts`, `apps/consumer/src/main/channels.ts`, `apps/consumer/src/preload/index.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–6; `createDownloader`, `ModelStatus`; `batchAllowed`; `loadTodayView`; `computeHealth` via the view; `coachStore.since`; `limitUsage`, `repeatedSearches`, `searchTitlesFrom`, `switchesBetween`; `parseExclusions`, `parseLimits`.
- Produces:
  ```ts
  // view.ts
  export type WriterState =
    | { state: 'ready'; mode: 'local' | 'cloud'; model: string }
    | { state: 'missing'; tier: WriterTier; sizeBytes: number }
    | { state: 'downloading'; received: number; total: number }
    | { state: 'verifying' }
    | { state: 'unavailable'; reason: Unavailable; text: string }
    | { state: 'cloud_setup' };                      // cloud mode chosen but no key yet
  export function writerState(i: { mode: 'local' | 'cloud'; hasKey: boolean; cloudModel: string; tier: WriterTier; model: ModelStatus; unavailable: Unavailable | null }): WriterState;
  export interface ReportView {
    date: string; prevDate: string | null; nextDate: string | null; today: string;
    status: 'none' | 'pending' | 'ready' | 'failed'; report: ReportJson | null; error: string | null; model: string | null;
    stats: ReportStats | null; timeline: TimelineSegment[]; candidates: ReportCandidate[];
    ticked: string[]; writer: WriterState; waiting: boolean; running: boolean; autoPaused: boolean;
  }
  export function navDates(date: string, today: string, reportDates: string[]): { prevDate: string | null; nextDate: string | null };
  ```
  Channels: `reportsGet: 'reports:get'` (arg date | null → newest report date, else today), `reportsGenerate: 'reports:generate'` (date), `reportsTickPlan: 'reports:tickPlan'` ({ date, index, on }), `writerGet: 'writer:get'`, `writerDownload: 'writer:download'`, `writerDelete: 'writer:delete'`, `writerDecline: 'writer:decline'`, `writerSetMode: 'writer:setMode'` ('local'|'cloud'), `writerSetTier: 'writer:setTier'` (''|'4b'|'1.7b'), `writerSetCloud: 'writer:setCloud'` ({ provider, model, baseUrl, key? }), `writerRetryLocal: 'writer:retryLocal'`.
  Preload `api.reports = { get(date?), generate(date), tickPlan(date, index, on) }`, `api.writer = { get(), download(), remove(), decline(), setMode(m), setTier(t), setCloud(c), retryLocal() }` where `writer.get()` returns `WriterView = { state: WriterState; mode; tier: ''|'4b'|'1.7b'; autoTier: WriterTier; provider; model; baseUrl; hasKey; attribution: string }`.

- [ ] **Step 1: Failing test** — `view.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { navDates, writerState } from './view';

describe('report view helpers', () => {
  it('navigates between report days and today', () => {
    expect(navDates('2026-09-25', '2026-09-26', ['2026-09-26', '2026-09-25', '2026-09-20'])).toEqual({ prevDate: '2026-09-20', nextDate: '2026-09-26' });
    expect(navDates('2026-09-26', '2026-09-26', ['2026-09-25'])).toEqual({ prevDate: '2026-09-25', nextDate: null });
    expect(navDates('2026-09-20', '2026-09-26', ['2026-09-20'])).toEqual({ prevDate: null, nextDate: '2026-09-26' });
  });
  it('derives the writer state, preferring an unavailable reason over "missing" in local mode', () => {
    const base = { mode: 'local' as const, hasKey: false, cloudModel: 'claude-haiku-4-5', tier: '4b' as const, unavailable: null };
    expect(writerState({ ...base, model: { state: 'missing' } })).toMatchObject({ state: 'missing', tier: '4b', sizeBytes: 2_497_281_120 });
    expect(writerState({ ...base, model: { state: 'missing' }, unavailable: 'low_ram' })).toMatchObject({ state: 'unavailable', reason: 'low_ram', text: expect.stringContaining('8 GB') });
    expect(writerState({ ...base, model: { state: 'ready' } })).toEqual({ state: 'ready', mode: 'local', model: 'Qwen3 4B' });
    expect(writerState({ ...base, model: { state: 'downloading', received: 5, total: 10, retrying: false } })).toEqual({ state: 'downloading', received: 5, total: 10 });
    expect(writerState({ ...base, mode: 'cloud', model: { state: 'missing' }, unavailable: 'low_ram' })).toEqual({ state: 'cloud_setup' });
    expect(writerState({ ...base, mode: 'cloud', hasKey: true, model: { state: 'missing' } })).toEqual({ state: 'ready', mode: 'cloud', model: 'claude-haiku-4-5' });
  });
});
```

- [ ] **Step 2: Run to confirm failure.**

- [ ] **Step 3: Implement `view.ts`**
```ts
import type { ModelStatus } from '../models/downloader';
import { UNAVAILABLE_TEXT, type Unavailable } from '../writer/availability';
import { WRITER_MODELS, type WriterTier } from '../writer/config';
import type { TimelineSegment } from '../day/today';
import type { ReportCandidate } from './candidates';
import type { ReportStats } from './input';
import type { ReportJson } from './schema';

export type WriterState =
  | { state: 'ready'; mode: 'local' | 'cloud'; model: string }
  | { state: 'missing'; tier: WriterTier; sizeBytes: number }
  | { state: 'downloading'; received: number; total: number }
  | { state: 'verifying' }
  | { state: 'unavailable'; reason: Unavailable; text: string }
  | { state: 'cloud_setup' };
export interface ReportView {
  date: string; prevDate: string | null; nextDate: string | null; today: string;
  status: 'none' | 'pending' | 'ready' | 'failed'; report: ReportJson | null; error: string | null; model: string | null;
  stats: ReportStats | null; timeline: TimelineSegment[]; candidates: ReportCandidate[];
  ticked: string[]; writer: WriterState; waiting: boolean; running: boolean; autoPaused: boolean;
}

export function writerState(i: { mode: 'local' | 'cloud'; hasKey: boolean; cloudModel: string; tier: WriterTier; model: ModelStatus; unavailable: Unavailable | null }): WriterState {
  if (i.mode === 'cloud') return i.hasKey ? { state: 'ready', mode: 'cloud', model: i.cloudModel } : { state: 'cloud_setup' };
  if (i.model.state === 'ready' && !i.unavailable) return { state: 'ready', mode: 'local', model: WRITER_MODELS[i.tier].label };
  if (i.unavailable) return { state: 'unavailable', reason: i.unavailable, text: UNAVAILABLE_TEXT[i.unavailable] };
  if (i.model.state === 'downloading') return { state: 'downloading', received: i.model.received, total: i.model.total };
  if (i.model.state === 'verifying') return { state: 'verifying' };
  return { state: 'missing', tier: i.tier, sizeBytes: WRITER_MODELS[i.tier].size };
}

/** Prev = the newest report day before `date`; next = the oldest report day after it, else today (if `date` isn't today). */
export function navDates(date: string, today: string, reportDates: string[]): { prevDate: string | null; nextDate: string | null } {
  const before = reportDates.filter((d) => d < date).sort().reverse();
  const after = reportDates.filter((d) => d > date && d <= today).sort();
  return { prevDate: before[0] ?? null, nextDate: after[0] ?? (date < today ? today : null) };
}
```

- [ ] **Step 4: Wire `index.ts`** (inside `whenReady`, after the coach wiring). Key pieces:

```ts
db.exec(REPORT_SQL);
const reportStore = createReportStore(db);
reportStore.clearPending(Date.now());
const secrets = createSecretStore(db, {
  encrypt: (s) => safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(s) : Buffer.from(s, 'utf8'),
  decrypt: (b) => safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(b) : b.toString('utf8')
});
const writerHealth = { downloadFailures: 0, loadFailed: false, crashes: [] as number[], consecutiveTimeouts: 0 }; // declared before any downloader callback can use it
const writerTier = (): WriterTier => resolveTier(settings.get().writerModelTier, totalmem());
const writerDirFor = (t: WriterTier): string => join(app.getPath('userData'), 'models', 'writer', t);
const makeWriterDownloader = (t: WriterTier) => createDownloader({
  dir: writerDirFor(t), manifest: writerManifest(t), fetch: globalThis.fetch,
  freeBytes: async (d) => { const s = await statfs(d); return s.bavail * s.bsize; },
  onStatus: (st) => { if (st.state === 'error') writerHealth.downloadFailures++; win?.webContents.send(CH.eventsUpdate); }
});
let writerDl = makeWriterDownloader(writerTier());
void writerDl.init();                                  // verifies an existing file; never starts a download by itself
let freeDiskCache: number | null = null;
void statfs(app.getPath('userData')).then((s) => { freeDiskCache = s.bavail * s.bsize; }).catch(() => {});
const unavailable = (): Unavailable | null => localUnavailable({
  totalRam: totalmem(), freeDisk: freeDiskCache, model: WRITER_MODELS[writerTier()], installed: writerDl.status().state === 'ready',
  downloadFailures: writerHealth.downloadFailures, declined: settings.get().writerDeclined, loadFailed: writerHealth.loadFailed,
  crashes: writerHealth.crashes, consecutiveTimeouts: writerHealth.consecutiveTimeouts, now: Date.now()
});
const forkWriter = (): WriterChild => {
  const child = utilityProcess.fork(join(__dirname, 'writer.js'), [], { serviceName: 'Daylens Writer', stdio: 'ignore' });
  child.on('error', (type) => console.error('[writer] utility process error:', type));
  return { post: (m) => child.postMessage(m), onMessage: (cb) => { child.on('message', cb); }, onExit: (cb) => { child.on('exit', cb); }, kill: () => { child.kill(); } };
};
const writer = createWriter({
  mode: () => settings.get().writerMode,
  local: () => writerDl.status().state === 'ready' ? { modelPath: join(writerDirFor(writerTier()), WRITER_MODELS[writerTier()].file), model: WRITER_MODELS[writerTier()].label } : null,
  runLocal: (req, ms) => runLocal(req, { fork: forkWriter, timeoutMs: ms }),
  cloud: (req, ms) => {
    const s = settings.get();
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), ms);
    return complete(req, { apiKey: secrets.get(s.aiProvider), model: s.aiModel, provider: s.aiProvider as AiProvider, baseUrl: s.aiBaseUrl, title: 'Daylens', signal: ctrl.signal })
      .finally(() => clearTimeout(t));
  },
  cloudModel: () => settings.get().aiModel
});
const buildReportFor = (date: string) => {
  const s = settings.get();
  const { end } = dayBounds(date);
  const now = Math.min(Date.now(), end);
  const view = loadTodayView(repo, s, date, now, (d) => labelStore.labelsForDay(d), (d) => coachStore.completedBreaksForDay(d));
  const episodes = buildEpisodes(labelStore.readsForDay(date), s.screenReading);
  const sessions = repo.getFocusSessions(date);
  const titles = searchTitlesFrom(Array.from({ length: 7 }, (_, i) => repo.getFocusSessions(shiftDate(date, -i))).flat(), parseExclusions(s.exclusions));
  const candidates = buildCandidates({
    episodes, searches: repeatedSearches(titles),
    nudges: coachStore.since(dayBounds(date).start).filter((n) => n.date === date).map((n) => ({ id: n.id, ruleId: n.ruleId, title: n.title, status: n.status })),
    caps: limitUsage([...parseLimits(s.appLimits)], sessions, now)
  });
  const stats = buildStats(view, episodes, switchesBetween(sessions, dayBounds(date).start, now));
  return { input: buildReportInput({ stats, episodes, candidates, goals: { dailyGoalMin: s.dailyGoalMin, windDownTime: s.windDownTime, breakIntervalMin: s.breakIntervalMin } }),
    candidateIds: new Set(candidates.map((c) => c.id)), view, candidates, stats };
};
const reportScheduler = createReportScheduler({
  now: () => Date.now(),
  windDown: () => settings.get().windDownTime,           // Task 8 swaps in the plan override
  row: (d) => reportStore.get(d),
  hasActivity: (d) => repo.getFocusSessions(d).length > 0,
  canWrite: () => settings.get().writerMode === 'cloud' ? secrets.has(settings.get().aiProvider) : writerDl.status().state === 'ready' && unavailable() === null,
  gateOk: () => settings.get().writerMode === 'cloud' || batchAllowed({ freeBytes: freemem(), idleSec: powerMonitor.getSystemIdleTime(),
    locked: powerMonitor.getSystemIdleState(60) === 'locked', needBytes: writerNeedBytes(writerTier()) }),
  otherJobRunning: () => scheduler.status().state === 'running',
  lowBattery: async () => powerMonitor.isOnBatteryPower() && ((await batteryPercent()) ?? 100) < 20,
  generate: async (date) => {
    const outcome = await generateReport(date, { build: buildReportFor, writer, store: reportStore, now: () => Date.now() });
    if (outcome === 'crash') writerHealth.crashes.push(Date.now());
    if (outcome === 'load') writerHealth.loadFailed = true;
    writerHealth.consecutiveTimeouts = outcome === 'timeout' ? writerHealth.consecutiveTimeouts + 1 : outcome === 'ok' ? 0 : writerHealth.consecutiveTimeouts;
    return outcome;
  },
  onChange: () => win?.webContents.send(CH.eventsUpdate)
});
setInterval(() => { void reportScheduler.tick().catch((e) => console.error('[report] tick failed:', e)); }, 60_000);
```
and extend the label scheduler's `canStart` with `&& reportScheduler.running() === null` (declare `reportScheduler` before first use via a `let` holder if ordering requires; the label scheduler must never start while a report is being written).

`ipc.ts`: add `ReportsDeps { view(date: string | null): ReportView; generate(date: string): ReportView; tickPlan(date: string, index: number, on: boolean): ReportView }` and `WriterDeps { view(): WriterView; download(): WriterView; remove(): Promise<WriterView>; decline(): WriterView; setMode(m): WriterView; setTier(t): Promise<WriterView>; setCloud(c): WriterView; retryLocal(): WriterView }` to `IpcDeps`, with zod-validated handlers:
```ts
const dateArg = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
ipcMain.handle(CH.reportsGet, (_e, raw) => d.reports.view(raw === null || raw === undefined ? null : dateArg.parse(raw)));
ipcMain.handle(CH.reportsGenerate, (_e, raw) => d.reports.generate(dateArg.parse(raw)));
ipcMain.handle(CH.reportsTickPlan, (_e, raw) => { const v = z.object({ date: dateArg, index: z.number().int().min(0).max(3), on: z.boolean() }).strict().parse(raw); return d.reports.tickPlan(v.date, v.index, v.on); });
ipcMain.handle(CH.writerGet, () => d.writer.view());
ipcMain.handle(CH.writerDownload, () => d.writer.download());
ipcMain.handle(CH.writerDelete, () => d.writer.remove());
ipcMain.handle(CH.writerDecline, () => d.writer.decline());
ipcMain.handle(CH.writerSetMode, (_e, raw) => d.writer.setMode(z.enum(['local', 'cloud']).parse(raw)));
ipcMain.handle(CH.writerSetTier, (_e, raw) => d.writer.setTier(z.enum(['', '4b', '1.7b']).parse(raw)));
ipcMain.handle(CH.writerSetCloud, (_e, raw) => d.writer.setCloud(z.object({
  provider: z.enum(['anthropic', 'openai', 'gemini', 'openrouter', 'custom']), model: z.string().trim().min(1).max(120),
  baseUrl: z.string().trim().max(300).refine((u) => u === '' || /^https:\/\//.test(u), 'https only'), key: z.string().trim().min(1).max(400).optional()
}).strict().parse(raw)));
ipcMain.handle(CH.writerRetryLocal, () => d.writer.retryLocal());
```
In `index.ts`, implement the deps:
- `reports.view(date)`: `date ?? reportStore.dates()[0] ?? localDate(Date.now())`; row = `reportStore.get(date)`; `stats/timeline/candidates` from `buildReportFor(date)` (wrap in try → nulls/[] on failure); `ticked = reportStore.tickedTexts(date)`; `writer = writerState(...)`; `waiting = reportScheduler.waiting() === date`; `running = reportScheduler.running() === date`; nav via `navDates`.
- `reports.generate(date)`: `reportScheduler.request(date); void reportScheduler.tick();` → view.
- `reports.tickPlan(date, index, on)`: item = `reportStore.get(date)?.report?.plan[index]`; if present `reportStore.tick(date, item, on)` → view.
- `writer.download()`: `settings.set({ writerDeclined: false }); writerHealth.downloadFailures = 0; writerDl.start()`.
- `writer.remove()`: `writerDl.stop(); await writerDl.remove()`.
- `writer.decline()`: `settings.set({ writerDeclined: true })`.
- `writer.setMode(m)`: `settings.set({ writerMode: m })`.
- `writer.setTier(t)`: stop + keep the old file; `settings.set({ writerModelTier: t })`; `writerDl = makeWriterDownloader(writerTier()); await writerDl.init()`.
- `writer.setCloud(c)`: `settings.set({ aiProvider: c.provider, aiModel: c.model, aiBaseUrl: c.baseUrl }); if (c.key) secrets.set(c.provider, c.key); settings.set({ writerMode: 'cloud' })`.
- `writer.retryLocal()`: reset `writerHealth` (`loadFailed=false, crashes=[], consecutiveTimeouts=0, downloadFailures=0`), `settings.set({ writerDeclined: false })`, `reportScheduler.resume()`.
- `WriterView.attribution = WRITER_ATTRIBUTION`; `hasKey = secrets.has(settings.get().aiProvider)`; `autoTier = tierFor(totalmem())`.

`channels.ts` + `preload/index.ts`: add the channels and `api.reports` / `api.writer` exactly as listed in Interfaces (types imported from `../main/ipc` / `../main/report/view`).

- [ ] **Step 5: Verify** — `view.test.ts` passes; full suite; typecheck; build. Do not launch the app.

- [ ] **Step 6: Commit**

```bash
git add apps/consumer/src/main apps/consumer/src/preload/index.ts
git commit -m "feat(consumer): wire writer, report scheduler and reports/writer IPC"
```

---

### Task 8: Plan items → coach, Today's plan card

**Files:**
- Create: `apps/consumer/src/main/coach/plan.ts`, `plan.test.ts`, `apps/consumer/src/main/coach/rules/focus.ts`, `focus.test.ts`, `apps/consumer/src/renderer/components/PlanCard.tsx`
- Modify: `apps/consumer/src/main/coach/snapshot.ts` (`focusBlocks`), `apps/consumer/src/main/coach/fixtures.ts`, `apps/consumer/src/main/coach/rules/index.ts`, `apps/consumer/src/main/coach/engine.ts`, `engine.test.ts`, `apps/consumer/src/main/index.ts`, `apps/consumer/src/main/ipc.ts`, `channels.ts`, `apps/consumer/src/preload/index.ts`, `apps/consumer/src/renderer/components/TodayScreen.tsx`, `apps/consumer/src/renderer/styles.css`

**Interfaces:**
- Consumes: `PlanItemRow` (Task 5), `AppLimit`.
- Produces:
  ```ts
  // plan.ts
  export interface FocusBlock { start: number; end: number; label: string; minutes: number; }
  export interface PlanOverrides { breakIntervalMin?: number; windDownTime?: string; limits: AppLimit[]; focus: FocusBlock[]; }
  export function planOverrides(items: PlanItemRow[], date: string): PlanOverrides;   // enabled items only
  export const inFocus = (blocks: FocusBlock[], now: number): boolean;
  // Snapshot gains: focusBlocks: FocusBlock[]
  // rules/focus.ts
  export const focusStart: Rule;            // ruleId 'focus_start', kind 'tip', fires in [start, start + 5 min), key `focus_start:<date>:<label>`
  ```
  IPC `planToday: 'plan:today'` → `{ id: number; text: string; enabled: boolean }[]` for today; `planSetEnabled: 'plan:setEnabled'` ({ id, on }) → same list. Preload `api.plan = { today(), setEnabled(id, on) }`.

- [ ] **Step 1: Failing tests**

`plan.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { inFocus, planOverrides } from './plan';
import type { PlanItemRow } from '../report/store';

const row = (id: number, item: PlanItemRow['item'], enabled = true): PlanItemRow => ({ id, forDate: '2026-09-27', sourceDate: '2026-09-26', item, enabled });
describe('plan overrides', () => {
  it('turns enabled plan items into coach overrides for the day', () => {
    const o = planOverrides([
      row(1, { kind: 'focus_block', text: 'Focus 9:30', payload: { start: '09:30', minutes: 90 } }),
      row(2, { kind: 'app_cap', text: 'YouTube 30', payload: { app: 'YouTube', minutes: 30 } }),
      row(3, { kind: 'break_interval', text: 'Breaks 40', payload: { minutes: 40 } }),
      row(4, { kind: 'wind_down', text: 'Bed 22:30', payload: { time: '22:30' } }),
      row(5, { kind: 'break_interval', text: 'off', payload: { minutes: 20 } }, false)
    ], '2026-09-27');
    const start = new Date(2026, 8, 27, 9, 30).getTime();
    expect(o).toEqual({ breakIntervalMin: 40, windDownTime: '22:30', limits: [{ app: 'YouTube', minutes: 30 }],
      focus: [{ start, end: start + 90 * 60_000, label: '09:30', minutes: 90 }] });
    expect(inFocus(o.focus, start + 10 * 60_000)).toBe(true);
    expect(inFocus(o.focus, start + 91 * 60_000)).toBe(false);
  });
  it('is empty with no items', () => { expect(planOverrides([], '2026-09-27')).toEqual({ limits: [], focus: [] }); });
});
```

`focus.test.ts`:
```ts
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
```
(Adjust the date in the test to the fixtures' `snap()` default date if it is not 2026-09-25.)

`engine.test.ts` add:
```ts
it('drops behaviour and tip candidates during a focus block, but not health or focus_start', async () => {
  const now = T(12);
  const blocks = [{ start: now - 60_000, end: now + 60 * 60_000, label: '11:59', minutes: 60 }];
  const { d, shown } = deps({ snapshot: () => snap({ now, focusBlocks: blocks }),
    rules: [() => c({ kind: 'behaviour', ruleId: 'scattered', key: 'b' }), () => c({ kind: 'tip', ruleId: 'stuck_tip', key: 't' }), () => c({ kind: 'health', ruleId: 'goal_80', key: 'h' })] });
  await createCoach(d).tick();
  expect(shown.map((n) => n.kind)).toEqual(['health']);
});
```

- [ ] **Step 2: Run to confirm failure.**

- [ ] **Step 3: Implement**

`plan.ts`:
```ts
import type { PlanItemRow } from '../report/store';
import type { AppLimit } from './types';

export interface FocusBlock { start: number; end: number; label: string; minutes: number; }
export interface PlanOverrides { breakIntervalMin?: number; windDownTime?: string; limits: AppLimit[]; focus: FocusBlock[]; }

const atTime = (date: string, hhmm: string): number => {
  const [y, m, d] = date.split('-').map(Number); const [h, mi] = hhmm.split(':').map(Number);
  return new Date(y, m - 1, d, h, mi).getTime();
};

/** Enabled plan items for `date` → what the coach should do differently that day. Later items win. */
export function planOverrides(items: PlanItemRow[], date: string): PlanOverrides {
  const o: PlanOverrides = { limits: [], focus: [] };
  for (const { item, enabled } of items) {
    if (!enabled) continue;
    if (item.kind === 'break_interval') o.breakIntervalMin = item.payload.minutes;
    else if (item.kind === 'wind_down') o.windDownTime = item.payload.time;
    else if (item.kind === 'app_cap') o.limits.push({ app: item.payload.app, minutes: item.payload.minutes });
    else { const start = atTime(date, item.payload.start); o.focus.push({ start, end: start + item.payload.minutes * 60_000, label: item.payload.start, minutes: item.payload.minutes }); }
  }
  return o;
}
export const inFocus = (blocks: FocusBlock[], now: number): boolean => blocks.some((b) => now >= b.start && now < b.end);
```

`rules/focus.ts`:
```ts
import type { Rule } from '../snapshot';

const WINDOW_MS = 5 * 60_000;
export const focusStart: Rule = (s) => {
  const b = s.focusBlocks.find((x) => s.now >= x.start && s.now < x.start + WINDOW_MS);
  if (!b) return null;
  return { ruleId: 'focus_start', kind: 'tip', key: `focus_start:${s.date}:${b.label}`, mini: 'Focus block', stat: `${b.minutes} min`,
    title: 'Your focus block starts now', body: `You planned ${b.minutes} min of focus. Close what you don't need; pop-ups stay quiet until it ends.`,
    primary: { label: 'Start', action: 'ack' } };
};
```
Add `focusStart` first in `RULES` (`rules/index.ts`). `snapshot.ts`: `focusBlocks: FocusBlock[]` on `Snapshot`; `fixtures.ts` `snap()` default `focusBlocks: []`.

`engine.ts` — inside the rule loop, right after `if (!c) continue;`:
```ts
// A planned focus block silences behaviour and tip pop-ups (the block's own start reminder still shows).
if (inFocus(snap.focusBlocks, now) && (c.kind === 'behaviour' || c.kind === 'tip') && c.ruleId !== 'focus_start') continue;
```

`index.ts`:
- In `buildSnapshot`: `const o = planOverrides(reportStore.plan(date), date);` then `settings: { ...s, breakIntervalMin: o.breakIntervalMin ?? s.breakIntervalMin, windDownTime: o.windDownTime ?? s.windDownTime }`, `limits: [...parseLimits(s.appLimits), ...o.limits]`, `focusBlocks: o.focus`. (Move the `reportStore` creation above the coach wiring if needed.)
- Report scheduler `windDown: (d) => planOverrides(reportStore.plan(d), d).windDownTime ?? settings.get().windDownTime`.
- IPC `plan.today()` → `reportStore.plan(localDate(Date.now())).map((p) => ({ id: p.id, text: p.item.text, enabled: p.enabled }))`; `plan.setEnabled(id, on)` → `reportStore.setEnabled(id, on)` then the list + `win?.webContents.send(CH.eventsUpdate)`. Validate `{ id: int ≥ 1, on: boolean }` with zod.

`PlanCard.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export function PlanCard() {
  const [items, setItems] = useState<{ id: number; text: string; enabled: boolean }[]>([]);
  useEffect(() => {
    const load = (): void => { api.plan.today().then(setItems).catch(() => {}); };
    load();
    return api.onUpdate(load);
  }, []);
  if (!items.length) return null;
  return (
    <div className="plan-card" role="region" aria-label="Today's plan">
      <p className="sec">Today's plan</p>
      {items.map((p) => (
        <div className="srow" key={p.id}>
          <p>{p.text}</p>
          <button className={`sw${p.enabled ? ' on' : ''}`} aria-label={p.text} aria-pressed={p.enabled}
            onClick={() => { api.plan.setEnabled(p.id, !p.enabled).then(setItems).catch(() => {}); }} />
        </div>
      ))}
    </div>
  );
}
```
Mount `<PlanCard />` in `TodayScreen.tsx` right after `<HeldCard />`. `styles.css` (before the reduced-motion block): `.plan-card { background: #fff; border-radius: 16px; padding: 10px 14px; margin-bottom: 16px; }`.

- [ ] **Step 4: Run tests (plan, focus, engine, all coach rules) → pass; typecheck.**

- [ ] **Step 5: Commit**

```bash
git add apps/consumer/src/main/coach apps/consumer/src/main/index.ts apps/consumer/src/main/ipc.ts apps/consumer/src/main/channels.ts apps/consumer/src/preload/index.ts apps/consumer/src/renderer/components/PlanCard.tsx apps/consumer/src/renderer/components/TodayScreen.tsx apps/consumer/src/renderer/styles.css
git commit -m "feat(consumer): ticked plan items drive tomorrow's coaching; Today's plan card"
```

---

### Task 9: Settings → Writer section and the cloud setup form

**Files:**
- Create: `apps/consumer/src/renderer/components/WriterSection.tsx`, `apps/consumer/src/renderer/components/CloudSetup.tsx`, `apps/consumer/src/renderer/lib/writer.ts`, `apps/consumer/src/renderer/lib/writer.test.ts`
- Modify: `apps/consumer/src/renderer/components/SettingsScreen.tsx`, `apps/consumer/src/renderer/styles.css`

**Interfaces:**
- Consumes: `api.writer.*`, `WriterView`, `WriterState` (Task 7).
- Produces: `writerStatusText(s: WriterState): string`; `PROVIDERS: { id; label; defaultModel; needsBaseUrl }[]`; `<CloudSetup view={WriterView} onSaved={(v) => void} />` (reused by the Reports screen in Task 10).

- [ ] **Step 1: Failing test** — `writer.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { PROVIDERS, writerStatusText } from './writer';

describe('writer UI helpers', () => {
  it('describes each writer state', () => {
    expect(writerStatusText({ state: 'ready', mode: 'local', model: 'Qwen3 4B' })).toBe('Ready · Qwen3 4B on this PC');
    expect(writerStatusText({ state: 'ready', mode: 'cloud', model: 'claude-haiku-4-5' })).toBe('Ready · cloud (claude-haiku-4-5)');
    expect(writerStatusText({ state: 'missing', tier: '4b', sizeBytes: 2_497_281_120 })).toBe('Not downloaded (2.5 GB)');
    expect(writerStatusText({ state: 'downloading', received: 1_248_640_560, total: 2_497_281_120 })).toBe('Downloading… 50%');
    expect(writerStatusText({ state: 'verifying' })).toBe('Checking the download…');
    expect(writerStatusText({ state: 'unavailable', reason: 'low_ram', text: 'Too little memory.' })).toBe("Can't run on this PC: Too little memory.");
    expect(writerStatusText({ state: 'cloud_setup' })).toBe('Cloud chosen · add your API key');
  });
  it('lists providers with default models', () => {
    expect(PROVIDERS.map((p) => p.id)).toEqual(['anthropic', 'openai', 'gemini', 'openrouter', 'custom']);
    expect(PROVIDERS.find((p) => p.id === 'custom')?.needsBaseUrl).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm failure.**

- [ ] **Step 3: Implement**

`lib/writer.ts`:
```ts
import type { WriterState } from '../../main/report/view';

const gb = (b: number): string => `${(b / 1e9).toFixed(1)} GB`;
export function writerStatusText(s: WriterState): string {
  switch (s.state) {
    case 'ready': return s.mode === 'local' ? `Ready · ${s.model} on this PC` : `Ready · cloud (${s.model})`;
    case 'missing': return `Not downloaded (${gb(s.sizeBytes)})`;
    case 'downloading': return `Downloading… ${Math.floor((s.received / Math.max(1, s.total)) * 100)}%`;
    case 'verifying': return 'Checking the download…';
    case 'unavailable': return `Can't run on this PC: ${s.text}`;
    case 'cloud_setup': return 'Cloud chosen · add your API key';
  }
}
export const PROVIDERS = [
  { id: 'anthropic', label: 'Anthropic', defaultModel: 'claude-haiku-4-5', needsBaseUrl: false },
  { id: 'openai', label: 'OpenAI', defaultModel: 'gpt-4.1-mini', needsBaseUrl: false },
  { id: 'gemini', label: 'Google Gemini', defaultModel: 'gemini-2.5-flash', needsBaseUrl: false },
  { id: 'openrouter', label: 'OpenRouter', defaultModel: 'openai/gpt-oss-120b:free', needsBaseUrl: false },
  { id: 'custom', label: 'Custom (OpenAI-compatible)', defaultModel: '', needsBaseUrl: true }
] as const;
```

`CloudSetup.tsx`:
```tsx
import { useState } from 'react';
import type { WriterView } from '../../main/ipc';
import { api } from '../lib/api';
import { PROVIDERS } from '../lib/writer';

export function CloudSetup({ view, onSaved }: { view: WriterView; onSaved: (v: WriterView) => void }) {
  const [provider, setProvider] = useState(view.provider);
  const [model, setModel] = useState(view.model);
  const [baseUrl, setBaseUrl] = useState(view.baseUrl);
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const p = PROVIDERS.find((x) => x.id === provider) ?? PROVIDERS[0];
  const save = (): void => {
    setError('');
    api.writer.setCloud({ provider, model: model.trim() || p.defaultModel, baseUrl: p.needsBaseUrl ? baseUrl.trim() : '', ...(key.trim() ? { key: key.trim() } : {}) })
      .then((v) => { setKey(''); onSaved(v); })
      .catch(() => setError('Check the model name, the base URL (https) and the key.'));
  };
  return (
    <div className="cloud-setup">
      <p className="cloud-note">Only a short summary of your day (numbers, app names, a few window titles) is sent to the provider. Screenshots never leave your PC.</p>
      <label>Provider
        <select value={provider} onChange={(e) => { setProvider(e.target.value); setModel(PROVIDERS.find((x) => x.id === e.target.value)?.defaultModel ?? ''); }}>
          {PROVIDERS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
      </label>
      <label>Model<input type="text" value={model} placeholder={p.defaultModel} onChange={(e) => setModel(e.target.value)} /></label>
      {p.needsBaseUrl && <label>Base URL<input type="url" value={baseUrl} placeholder="https://…/v1" onChange={(e) => setBaseUrl(e.target.value)} /></label>}
      <label>API key<input type="password" value={key} autoComplete="off" placeholder={view.hasKey && provider === view.provider ? 'Saved (leave empty to keep)' : 'Paste your key'} onChange={(e) => setKey(e.target.value)} /></label>
      {error && <p className="cloud-error" role="alert">{error}</p>}
      <button className="btn" disabled={!key.trim() && !(view.hasKey && provider === view.provider)} onClick={save}>Use cloud</button>
    </div>
  );
}
```

`WriterSection.tsx`:
```tsx
import { useEffect, useState } from 'react';
import type { WriterView } from '../../main/ipc';
import { api } from '../lib/api';
import { writerStatusText } from '../lib/writer';
import { CloudSetup } from './CloudSetup';

export function WriterSection() {
  const [view, setView] = useState<WriterView | null>(null);
  const load = (): void => { api.writer.get().then(setView).catch((e) => console.error('[renderer] writer.get failed:', e)); };
  useEffect(() => { load(); const off = api.onUpdate(load); return off; }, []);
  if (!view) return null;
  const act = (p: Promise<WriterView>): void => { p.then(setView).catch((e) => { console.error(e); load(); }); };
  const s = view.state;
  return (
    <div className="grp">
      <h4>Report writer</h4>
      <div className="srow">
        <p>Writer<small role="status">{writerStatusText(s)}</small><small>{view.attribution}</small></p>
        <div className="srow-btns">
          <button className={`btn s${view.mode === 'local' ? ' on' : ''}`} aria-pressed={view.mode === 'local'} onClick={() => act(api.writer.setMode('local'))}>On this PC</button>
          <button className={`btn s${view.mode === 'cloud' ? ' on' : ''}`} aria-pressed={view.mode === 'cloud'} onClick={() => act(api.writer.setMode('cloud'))}>Cloud</button>
        </div>
      </div>
      {view.mode === 'local' && (
        <div className="srow">
          <p>Model size<small>Recommended for this PC: {view.autoTier === '4b' ? 'Qwen3 4B' : 'Qwen3 1.7B'}</small></p>
          <div className="srow-btns">
            <select aria-label="Writer model size" value={view.tier} onChange={(e) => act(api.writer.setTier(e.target.value as '' | '4b' | '1.7b'))}>
              <option value="">Automatic</option><option value="4b">Qwen3 4B (better, 2.5 GB)</option><option value="1.7b">Qwen3 1.7B (lighter, 1.1 GB)</option>
            </select>
            {s.state === 'missing' && <button className="btn s" onClick={() => act(api.writer.download())}>Download</button>}
            {s.state === 'unavailable' && <button className="btn s" onClick={() => act(api.writer.retryLocal())}>Try local again</button>}
            {(s.state === 'ready' && s.mode === 'local') && <button className="btn s danger" onClick={() => act(api.writer.remove())}>Delete model</button>}
          </div>
        </div>
      )}
      {(view.mode === 'cloud' || s.state === 'unavailable') && <CloudSetup view={view} onSaved={setView} />}
    </div>
  );
}
```
Mount `<WriterSection />` in `SettingsScreen.tsx` right after `<ModelSection … />`. Add minimal styles for `.cloud-setup` (grid of labels, 8 px gap, inputs styled like `.xadd input`), `.cloud-note` (muted 12.5 px), `.cloud-error` (pink `#F4C6C8` background, 8 px radius), `.btn.s.on` (ink background, white text), matching neighbouring rules.

- [ ] **Step 4: Tests pass; typecheck; build.**

- [ ] **Step 5: Commit**

```bash
git add apps/consumer/src/renderer
git commit -m "feat(consumer): Settings writer section with local/cloud choice and cloud setup"
```

---

### Task 10: Reports screen

**Files:**
- Create: `apps/consumer/src/renderer/components/ReportsScreen.tsx`, `apps/consumer/src/renderer/lib/report.ts`, `apps/consumer/src/renderer/lib/report.test.ts`
- Modify: `apps/consumer/src/renderer/components/Rail.tsx`, `apps/consumer/src/renderer/components/Icon.tsx` (icon `report`), `apps/consumer/src/renderer/App.tsx`, `apps/consumer/src/renderer/styles.css`

**Interfaces:**
- Consumes: `api.reports.*`, `api.writer.*`, `ReportView`, `WriterView`, `CloudSetup` (Task 9), `formatHm`, `CATEGORY_LABEL`.
- Produces: `Route = 'today' | 'reports' | 'settings'`; `<ReportsScreen print?: boolean date?: string />`; helpers `reportDateLabel(date, today)`, `words(text)`, `useCountUp(target, enabled)`, `goalPercent(stats)`, `reportCardKind(view)`.

- [ ] **Step 1: Failing test** — `report.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { goalPercent, reportCardKind, reportDateLabel, words } from './report';

describe('report UI helpers', () => {
  it('labels dates relative to today', () => {
    expect(reportDateLabel('2026-09-26', '2026-09-26')).toBe('Today');
    expect(reportDateLabel('2026-09-25', '2026-09-26')).toBe('Yesterday');
    expect(reportDateLabel('2026-09-20', '2026-09-26')).toMatch(/Sun(day)?,? 20 Sep/);
  });
  it('splits the story into words for the reveal', () => { expect(words(' You  coded all morning. ')).toEqual(['You', 'coded', 'all', 'morning.']); });
  it('computes goal usage', () => { expect(goalPercent({ screenSec: 3600, goalSec: 7200 } as never)).toBe(50); expect(goalPercent({ screenSec: 1, goalSec: 0 } as never)).toBe(0); });
  it('picks the card to show above the stats', () => {
    const v = (o: object) => ({ status: 'none', writer: { state: 'ready', mode: 'local', model: 'm' }, waiting: false, running: false, stats: { screenSec: 100 }, ...o }) as never;
    expect(reportCardKind(v({ status: 'ready' }))).toBe('report');
    expect(reportCardKind(v({ running: true }))).toBe('writing');
    expect(reportCardKind(v({ waiting: true }))).toBe('waiting');
    expect(reportCardKind(v({ status: 'failed' }))).toBe('failed');
    expect(reportCardKind(v({ writer: { state: 'missing', tier: '4b', sizeBytes: 1 } }))).toBe('download');
    expect(reportCardKind(v({ writer: { state: 'unavailable', reason: 'low_ram', text: 't' } }))).toBe('cloud_offer');
    expect(reportCardKind(v({ writer: { state: 'cloud_setup' } }))).toBe('cloud_offer');
    expect(reportCardKind(v({ stats: { screenSec: 0 } }))).toBe('empty');
    expect(reportCardKind(v({}))).toBe('generate');
  });
});
```

- [ ] **Step 2: Run to confirm failure.**

- [ ] **Step 3: Implement `lib/report.ts`**
```ts
import { useEffect, useState } from 'react';
import type { ReportView } from '../../main/report/view';
import type { ReportStats } from '../../main/report/input';

export function reportDateLabel(date: string, today: string): string {
  if (date === today) return 'Today';
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(y, m - 1, d);
  const [ty, tm, td] = today.split('-').map(Number);
  if ((new Date(ty, tm - 1, td).getTime() - t.getTime()) / 86_400_000 === 1) return 'Yesterday';
  return t.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}
export const words = (text: string): string[] => text.trim().split(/\s+/).filter(Boolean);
export const goalPercent = (s: Pick<ReportStats, 'screenSec' | 'goalSec'>): number => (s.goalSec > 0 ? Math.round((s.screenSec / s.goalSec) * 100) : 0);

export type CardKind = 'report' | 'writing' | 'waiting' | 'failed' | 'download' | 'cloud_offer' | 'empty' | 'generate';
export function reportCardKind(v: ReportView): CardKind {
  if (v.status === 'ready') return 'report';
  if (v.running || v.status === 'pending') return 'writing';
  if (v.waiting) return 'waiting';
  if (v.writer.state === 'unavailable' || v.writer.state === 'cloud_setup') return 'cloud_offer';
  if (v.status === 'failed') return 'failed';
  if (v.writer.state === 'missing' || v.writer.state === 'downloading' || v.writer.state === 'verifying') return 'download';
  if (!v.stats || v.stats.screenSec === 0) return 'empty';
  return 'generate';
}

const reduced = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Animated count from 0 to `target` over ~900 ms; returns the target straight away when motion is reduced or disabled. */
export function useCountUp(target: number, enabled: boolean): number {
  const [v, setV] = useState(enabled && !reduced() ? 0 : target);
  useEffect(() => {
    if (!enabled || reduced()) { setV(target); return; }
    const t0 = performance.now(); let raf = 0;
    const step = (t: number): void => { const p = Math.min(1, (t - t0) / 900); setV(Math.round(target * (1 - (1 - p) ** 3))); if (p < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, enabled]);
  return v;
}
```
(Note: the `failed` check comes after `cloud_offer` on purpose — when the local writer became unavailable because of the failure, the user needs the cloud offer, not a retry that will fail again. Adjust the test order if you reorder.)

- [ ] **Step 4: Implement `ReportsScreen.tsx`** — structure and class names per `docs/superpowers/specs/assets/daylens-mockups/daily-report.html`; **port its report CSS verbatim** into `styles.css` (scoped under `.report`), replacing the mockup's Google-font family with `'DM Sans Variable', system-ui, sans-serif`, and add `@media (prefers-reduced-motion: reduce)` rules that disable its word reveal, count-up and grow-in animations. Behaviour:

```tsx
import { useEffect, useState } from 'react';
import type { ReportView } from '../../main/report/view';
import type { WriterView } from '../../main/ipc';
import { api } from '../lib/api';
import { formatHm } from '../lib/format';
import { goalPercent, reportCardKind, reportDateLabel, useCountUp, words } from '../lib/report';
import { writerStatusText } from '../lib/writer';
import { CloudSetup } from './CloudSetup';

export function ReportsScreen({ print = false, date: fixedDate }: { print?: boolean; date?: string }) {
  const [date, setDate] = useState<string | null>(fixedDate ?? null);
  const [view, setView] = useState<ReportView | null>(null);
  const [writer, setWriter] = useState<WriterView | null>(null);
  const load = (): void => {
    api.reports.get(date).then(setView).catch((e) => console.error('[renderer] reports.get failed:', e)); // Task 11 adds the print-ready signal
    api.writer.get().then(setWriter).catch(() => {});
  };
  useEffect(() => { load(); if (print) return; return api.onUpdate(load); }, [date]);
  if (!view) return null;
  const kind = reportCardKind(view);
  const animate = !print;
  // … render:
  // header: ← (view.prevDate) · reportDateLabel(view.date, view.today) · → (view.nextDate) · Regenerate (api.reports.generate(view.date).then(setView)) · Export PDF (Task 11)
  //   hide buttons when `print`.
  // kind === 'report': headline (h1), "How your day went" story — words(story) each in <span style={{ animationDelay: `${i*30}ms` }}> (no spans when print),
  //   stat tiles from view.stats ONLY (Daily goal: formatHm(screenSec) of formatHm(goalSec) + goalPercent bar; Top apps list; Health check: score via useCountUp(score, animate),
  //   breaks x/expected, longest stretch formatHm, late night yes/no), sections Wins / Habits / Do it better ("what → better", resolve candidate text via view.candidates) /
  //   Plan for tomorrow (checkbox per item: checked = view.ticked.includes(item.text); onChange → api.reports.tickPlan(view.date, i, on).then(setView); disabled when print or
  //   view.date !== view.today && view.date < yesterday-of-today is fine to allow) / Coach's advice; footer "Written by {view.model}".
  // kind !== 'report': stat tiles still render when view.stats has screenSec > 0, with one card above them:
  //   'writing' → "Writing your report…"; 'waiting' → "Waiting for a quiet moment to write your report (it needs about 3.5 GB of free memory)."
  //   'failed' → "Couldn't write this report: {view.error}" + Retry (generate);
  //   'download' → "Download the writer ({writerStatusText(view.writer)}) for written reports" + Download (api.writer.download()) + "Use cloud instead" (reveals <CloudSetup>);
  //   'cloud_offer' → "Can't write reports on this PC? Use your own AI key" + one line reason (view.writer.state === 'unavailable' ? view.writer.text : '') + <CloudSetup view={writer} onSaved={() => load()} />;
  //   'generate' → "No report yet for this day" + Generate; 'empty' → "Nothing tracked on this day."
  // never render candidate samples (screen text) in print mode; on screen show a candidate sample only inside a collapsed <details>.
}
```
Write the component in full following those rules (it is ~200 lines).

`Icon.tsx`: add `report: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h4" /></>` and extend `IconName`. `Rail.tsx`: `Route = 'today' | 'reports' | 'settings'`, a Reports button (icon `report`, label "Reports") after Today. `App.tsx`: render `<ReportsScreen />` for `route === 'reports'` (not `wide`).

- [ ] **Step 5: Tests pass; typecheck; build. Harness screenshot is done in Task 12.**

- [ ] **Step 6: Commit**

```bash
git add apps/consumer/src/renderer
git commit -m "feat(consumer): Reports screen with story, stats, grounded tips, plan ticks and writer cards"
```

---

### Task 11: PDF export

**Files:**
- Create: `apps/consumer/src/main/windows/reportPdf.ts`, `reportPdf.test.ts`, `apps/consumer/src/main/windows/reportPdfElectron.ts`
- Modify: `apps/consumer/src/main/index.ts`, `ipc.ts`, `channels.ts`, `apps/consumer/src/preload/index.ts`, `apps/consumer/src/renderer/App.tsx` (print mode), `apps/consumer/src/renderer/components/ReportsScreen.tsx` (Export button), `apps/consumer/src/renderer/styles.css` (`@media print`)

**Interfaces:**
- Produces:
  ```ts
  // reportPdf.ts (pure)
  export const pdfFileName = (date: string): string;                  // `Daylens-${date}.pdf`
  export const PDF_OPTIONS: { pageSize: 'A4'; printBackground: true; margins: { marginType: 'custom'; top: number; bottom: number; left: number; right: number } };
  export function printUrl(base: { devUrl?: string; file: string }, date: string): { kind: 'url' | 'file'; target: string; query: { print: string } };
  export function exportPdf(date: string, deps: { render(date: string): Promise<Buffer>; write(path: string, data: Buffer): Promise<void> }, path: string): Promise<'ok' | string>;
  // reportPdfElectron.ts
  export function renderReportPdf(date: string, deps: { preload: string; devUrl?: string; indexFile: string; timeoutMs?: number }): Promise<Buffer>;
  ```
  Channel `reportsExportPdf: 'reports:exportPdf'` (date) → `{ ok: true; path: string } | { ok: false; reason: string } | { ok: false; cancelled: true }`; preload `api.reports.exportPdf(date)`; preload also exposes `printReady(): void` (renderer → main: `ipcRenderer.send('report:printReady')`).

- [ ] **Step 1: Failing test** — `reportPdf.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { exportPdf, pdfFileName, PDF_OPTIONS, printUrl } from './reportPdf';

describe('report pdf', () => {
  it('names files and prints A4 with backgrounds', () => {
    expect(pdfFileName('2026-09-26')).toBe('Daylens-2026-09-26.pdf');
    expect(PDF_OPTIONS).toMatchObject({ pageSize: 'A4', printBackground: true });
  });
  it('builds the print target for dev and packaged builds', () => {
    expect(printUrl({ devUrl: 'http://localhost:5173', file: 'C:/app/index.html' }, '2026-09-26')).toEqual({ kind: 'url', target: 'http://localhost:5173', query: { print: '2026-09-26' } });
    expect(printUrl({ file: 'C:/app/index.html' }, '2026-09-26')).toEqual({ kind: 'file', target: 'C:/app/index.html', query: { print: '2026-09-26' } });
  });
  it('writes the rendered PDF and reports failures as text', async () => {
    const written: string[] = [];
    expect(await exportPdf('2026-09-26', { render: async () => Buffer.from('%PDF'), write: async (p) => { written.push(p); } }, 'C:/out.pdf')).toBe('ok');
    expect(written).toEqual(['C:/out.pdf']);
    expect(await exportPdf('2026-09-26', { render: async () => { throw new Error('render timeout'); }, write: async () => {} }, 'C:/out.pdf')).toMatch(/render timeout/);
  });
});
```

- [ ] **Step 2: Run to confirm failure.**

- [ ] **Step 3: Implement**

`reportPdf.ts`:
```ts
export const pdfFileName = (date: string): string => `Daylens-${date}.pdf`;
export const PDF_OPTIONS = { pageSize: 'A4', printBackground: true, margins: { marginType: 'custom', top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 } } as const;
export function printUrl(base: { devUrl?: string; file: string }, date: string): { kind: 'url' | 'file'; target: string; query: { print: string } } {
  return base.devUrl ? { kind: 'url', target: base.devUrl, query: { print: date } } : { kind: 'file', target: base.file, query: { print: date } };
}
export async function exportPdf(date: string, deps: { render(date: string): Promise<Buffer>; write(path: string, data: Buffer): Promise<void> }, path: string): Promise<'ok' | string> {
  try { await deps.write(path, await deps.render(date)); return 'ok'; } catch (e) { return e instanceof Error ? e.message : String(e); }
}
```

`reportPdfElectron.ts` (no unit test — Electron adapter, per the ledger rule that Electron adapters live in separate files):
```ts
import { BrowserWindow, ipcMain } from 'electron';
import { PDF_OPTIONS, printUrl } from './reportPdf';

/** Renders the report route in a hidden window with ?print=<date> and returns the PDF bytes. */
export function renderReportPdf(date: string, deps: { preload: string; devUrl?: string; indexFile: string; timeoutMs?: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const w = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { preload: deps.preload, contextIsolation: true, nodeIntegration: false } });
    const done = (err: Error | null, pdf?: Buffer): void => {
      clearTimeout(timer); ipcMain.off('report:printReady', onReady);
      if (!w.isDestroyed()) w.destroy();
      if (err) reject(err); else resolve(pdf as Buffer);
    };
    const onReady = (e: Electron.IpcMainEvent): void => {
      if (e.sender !== w.webContents) return;
      w.webContents.printToPDF(PDF_OPTIONS).then((pdf) => done(null, pdf), (err) => done(err instanceof Error ? err : new Error(String(err))));
    };
    const timer = setTimeout(() => done(new Error('The report took too long to render.')), deps.timeoutMs ?? 20_000);
    ipcMain.on('report:printReady', onReady);
    w.webContents.once('did-fail-load', () => done(new Error('The report page failed to load.')));
    const t = printUrl({ devUrl: deps.devUrl, file: deps.indexFile }, date);
    if (t.kind === 'url') void w.loadURL(`${t.target}?print=${encodeURIComponent(date)}`);
    else void w.loadFile(t.target, { query: t.query });
  });
}
```

`index.ts` — `reports.exportPdf(date)`:
```ts
const { canceled, filePath } = await dialog.showSaveDialog(win!, { title: 'Export report as PDF', defaultPath: pdfFileName(date), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
if (canceled || !filePath) return { ok: false, cancelled: true };
const r = await exportPdf(date, { render: (d) => renderReportPdf(d, { preload: join(__dirname, '../preload/index.js'), devUrl: process.env['ELECTRON_RENDERER_URL'], indexFile: join(__dirname, '../renderer/index.html') }), write: (p, b) => writeFile(p, b) }, filePath);
return r === 'ok' ? { ok: true, path: filePath } : { ok: false, reason: r };
```

Preload: `printReady: (): void => ipcRenderer.send('report:printReady')` on `api`; `ReportsScreen` calls `api.printReady()` after its data loaded **only when `print` is true** (in the `load` callback: after `setView(v)`, if `print`, `requestAnimationFrame(() => api.printReady())` so the DOM is painted first).

`App.tsx`: at the top of `App()`, `const printDate = new URLSearchParams(location.search).get('print');` — if set and a valid `YYYY-MM-DD`, return `<div className="print-root"><ReportsScreen print date={printDate} /></div>` (no title bar, rail or onboarding; skip the consent gate since the file is only loaded by main for a user-requested export).

`styles.css`: `.print-root .report *` disables animations/transitions; `@media print { body { background: #FBF8F4; } .report details, .report .rep-actions { display: none; } }`.

`ReportsScreen.tsx`: Export PDF button → `api.reports.exportPdf(view.date)`; show "Saved to …" / the reason in a small status line; ignore `cancelled`.

- [ ] **Step 4: Tests pass; typecheck; build.**

- [ ] **Step 5: Commit**

```bash
git add apps/consumer/src/main/windows/reportPdf.ts apps/consumer/src/main/windows/reportPdf.test.ts apps/consumer/src/main/windows/reportPdfElectron.ts apps/consumer/src/main apps/consumer/src/preload/index.ts apps/consumer/src/renderer
git commit -m "feat(consumer): export the daily report as an A4 PDF"
```

---

### Task 12: Verification

- [ ] **Step 1:** Full test suites (consumer, core, agent — fallback runner if EPERM), `pnpm -r typecheck`, build; confirm `out/main/writer.js`, `out/renderer/index.html`.
- [ ] **Step 2 (controller):** headless harness screenshots of the Reports screen (ready report with all sections; download card; cloud offer card; waiting card) and the print route, against `daily-report.html`; delete the harness.
- [ ] **Step 3 (controller, only if free RAM ≥ 3.4 GiB and the 4B file is downloaded):** a gated test `apps/consumer/src/main/writer/writer.real.test.ts` (skipped unless `DAYLENS_WRITER_MODEL` points at a GGUF and `freemem() ≥ writerNeedBytes`) that runs `generateReport` on a fixture day through the real `writer.js` via `ELECTRON_RUN_AS_NODE` and asserts: status `ready`, `parseReport` non-null, every `doBetter.candidateId` ∈ fixture candidates, wall time < 180 s. Commit the test (it stays skipped in normal runs).
- [ ] **Step 4 (human + controller, real app):** Settings → Report writer → Download (4B) → Reports → Generate: a report appears in < 3 min on the owner's PC and reads sensibly; tick a plan item → tomorrow's Today shows it in "Today's plan" (or set the PC date forward in a test profile); Regenerate replaces the report; Export PDF produces a readable A4 file; switch to Cloud with a real key → Regenerate works; on a simulated "unavailable" state (delete the model and set `writerDeclined`) the Reports screen shows the cloud offer.
