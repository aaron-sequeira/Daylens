# WorkSight Agent — Multi-Provider API Key (selector + secure storage)

**Date:** 2026-06-04
**Status:** Implemented — all providers now generate (Claude via native SDK; OpenAI / OpenRouter / Gemini / Custom via one OpenAI-compatible `fetch`). The original pass was selector + storage only; the real calls (below) were added as the follow-up.

## Goal

Replace the Anthropic-only API-key box in Settings with a **provider selector** so a user
can say *which* provider their key is for (Claude, OpenAI, Gemini, OpenRouter, or a Custom
OpenAI-compatible endpoint) and store that key securely **per provider**. Claude keeps
generating summaries end-to-end; the other providers are captured/labelled now and show a
graceful "not wired yet" message instead of mis-sending the key — actual calls land in a
later pass.

## Providers

| id          | label                       | default model                 | key page (helper line)            |
|-------------|-----------------------------|-------------------------------|-----------------------------------|
| `anthropic` | Claude (Anthropic)          | `claude-haiku-4-5`            | console.anthropic.com/settings/keys |
| `openai`    | OpenAI                      | `gpt-4o-mini`                | platform.openai.com/api-keys      |
| `gemini`    | Google Gemini               | `gemini-1.5-flash`           | aistudio.google.com/apikey        |
| `openrouter`| OpenRouter                  | `anthropic/claude-3.5-haiku` | openrouter.ai/keys                |
| `custom`    | Custom (OpenAI-compatible)  | *(blank)*                    | — (user supplies Base URL)        |

Provider metadata (label, default model, key-page URL, whether a Base URL field is shown)
lives in one renderer constant. The `AiProvider` string-union type is shared so main + renderer agree.

## Data model (`AppSettings`)

- Add `aiProvider: AiProvider` (default `'anthropic'`).
- Add `aiBaseUrl: string` (default `''`) — only meaningful for `custom`.
- Keep `aiModel: string`; the UI sets it to the provider default when the provider changes.
- `hasApiKey: boolean` now reflects **the currently-selected provider's** key.

## Key storage (per provider)

In `settings.ts`, the encrypted key is stored under `ai_key_<provider>_enc`:
- `setApiKey(key)` writes for the current `aiProvider`.
- `getApiKey()` reads the current `aiProvider`'s key.
- `hasApiKey` = current provider's key is present.

Switching provider therefore shows whether *that* provider has a saved key, and each
provider remembers its own. The raw key never leaves the main process (renderer sees only `hasApiKey`).

## Generation behaviour (`ai.ts` + `handlers.ts`)

`AiDeps` gains `provider: AiProvider` + `baseUrl?` + injectable `fetchFn`. `generateAiSummary`:
1. no key → `{ error: 'no_key' }`
2. `provider === 'anthropic'` → native Anthropic SDK path
3. otherwise → OpenAI-compatible `POST {base}/chat/completions` with `Authorization: Bearer <key>`,
   where `base` is `api.openai.com/v1` / `openrouter.ai/api/v1` / Gemini's `…/v1beta/openai`,
   or the user's Base URL for `custom`. Non-OK responses return `{ error: 'failed', message: 'HTTP …' }`.

The IPC handler passes `provider` + `baseUrl` from settings. `AiSummaryCard` shows the
`message` on failure so HTTP/model errors are visible.

## UI (`SettingsView.tsx`)

In the AI box: a provider `<select>`, the key field (provider-aware placeholder), an
**editable** model field, a Base-URL field shown only for `custom`, and a helper line
linking the provider's key page. Changing the provider patches `aiProvider` + sets
`aiModel` to that provider's default.

## Testing

- `settings.test.ts`: save a key under `openai`, read it back; switching to `gemini` makes
  `hasApiKey` false; switching back to `openai` still returns the key.
- `ai.test.ts`: `provider:'openai'` + key → `{ error: 'provider_not_wired' }` with no client
  call; `anthropic` + key still calls the injected client; no key → `no_key`.

## Follow-up — DONE

Real OpenAI/Gemini/OpenRouter/Custom request code is now implemented via a dependency-free
OpenAI-compatible `fetch` (no `openai` SDK needed). Tested with injected `fetchFn`
(routing/URL/auth/parse + HTTP-error + custom-without-base-URL).
