# WorkSight Agent — Multi-Provider API Key (selector + secure storage)

**Date:** 2026-06-04
**Status:** Approved (design) — scope: selector + key storage only; real non-Claude calls deferred.

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

`AiDeps` gains `provider: AiProvider`. `generateAiSummary`:
1. no key → `{ error: 'no_key' }` (unchanged)
2. `provider !== 'anthropic'` → `{ error: 'provider_not_wired' }` — **no network call**
3. `provider === 'anthropic'` → existing Anthropic path

`AiSummaryError.error` union gains `'provider_not_wired'`. The IPC handler passes
`provider: settings.aiProvider`. `AiSummaryCard` renders `provider_not_wired` as
"AI summaries for {provider} aren't available yet — showing the stats below."

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

## Out of scope (this pass)

Real OpenAI/Gemini/OpenRouter/Custom request code (the `openai` SDK + routing). Clean
follow-up once a provider is chosen.
