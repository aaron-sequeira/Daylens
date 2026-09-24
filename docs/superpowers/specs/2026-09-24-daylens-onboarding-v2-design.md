# Daylens — Onboarding v2 ("get to know you")

**Status:** Approved (design) · **Date:** 2026-09-24 · **Owner:** Aaron · **Extends:** `2026-09-23-daylens-consumer-app-design.md` (§10 Onboarding)

## 1. Goal

Replace the single consent screen with a lively, 6-step onboarding that (a) feels alive — morphing orb, orbiting information cards that react to answers, colour that shifts per step — and (b) asks the user a few skippable questions so Daylens (and later its AI) knows who they are, what they want help with, their daily rhythm and their known distractions.

**Visual source of truth:** `docs/superpowers/specs/assets/daylens-mockups/onboarding-v2.html` (approved, fully clickable). The Phase 4 model-download step from the main spec §10 is **not** part of this change; it is inserted later.

## 2. Flow

| # | Step | Content | Skippable |
|---|---|---|---|
| 1 | Welcome | Headline, privacy promises (local only · app/window recorded · activity counted, never keystrokes · starts with Windows, pause any time) | — |
| 2 | About you | "What should I call you?" (text) + "What do you mostly use this PC for?" (multi-select roles) | yes |
| 3 | Your goals | Multi-select goal cards | yes |
| 4 | Your rhythm | Start time, log-off time, usual days (Mon–Sun toggles) | yes |
| 5 | Honest moment | "What pulls you away the most?" multi-select apps + free-text add (Enter) | yes |
| 6 | All set | Summary of answers, "Start my day ✨" (confetti) | — |

- Every question step shows a "Skip this question" link and a "Why I ask" line (copy per mockup). Back/Continue on every step; Enter advances (except in the free-text distraction field, where Enter adds a chip).
- **Consent is granted on "Start my day"** (first run). Quitting mid-onboarding records nothing. Tracking starts only after that button.
- **Redo:** Settings → "About you" → "Redo the questions" opens the same flow pre-filled with saved answers; the welcome step's copy stays; finishing saves the profile only (consent is already granted) and returns to Settings.

## 3. Profile model

Stored in the existing settings KV store (`createKvStore`, SQLite `settings` table, local only). New keys added to `DEFAULT_SETTINGS`:

| Key | Type (stored) | Default | Allowed values |
|---|---|---|---|
| `profileName` | string | `''` | trimmed, collapsed whitespace, 0–40 chars, no control characters |
| `profileRoles` | JSON string of string[] | `'[]'` | subset of `student, dev, design, office, create, game, browse` |
| `profileGoals` | JSON string of string[] | `'[]'` | subset of `less, focus, sleep, breaks, distract, better` |
| `profileStart` | string `HH:MM` | `'09:00'` | 24h time |
| `profileDays` | JSON string of number[] | `'[1,2,3,4,5]'` | unique ints 1–7 (1 = Monday) |
| `profileDistractions` | JSON string of string[] | `'[]'` | ≤ 12 unique entries, each trimmed 1–40 chars, no control characters |

- **Log-off time** is not a new key: it is written to the existing `windDownTime`, so the health score uses it immediately.
- A pure module `profile.ts` (main) owns: the zod schema `profileInput` for the IPC payload `{ name, roles, goals, start, bed, days, distractions }`, `toSettingsPatch(input)` (→ KV keys incl. `windDownTime = bed`), and `readProfile(settings)` (→ typed `Profile` with parsed arrays; malformed JSON → defaults, unknown values dropped).
- Renderer receives `Profile` (typed, parsed) — never raw JSON strings.

## 4. IPC

| Channel | Payload | Behaviour |
|---|---|---|
| `profile:get` | — | returns `Profile` |
| `profile:save` | `ProfileInput` (strict zod) | validates, writes profile keys + `windDownTime`, returns updated `DaylensSettings` |
| `consent:grant` | — | unchanged; renderer calls it after `profile:save` on first-run finish |

Profile keys are **not** added to the renderer-editable `settingsPatch` (dedicated channel only). Invalid payloads reject; the renderer shows a small inline error and stays on the summary step.

## 5. Where the profile is used

| Answer | Used in this change | Used later (spec phase) |
|---|---|---|
| Name | Today date line: "Good morning/afternoon/evening, {name} · Thursday, 24 September · first on screen at 8:12 am" (no name → no greeting) | Daily report voice (Phase 6) |
| Roles | stored | Laya state/context and category hints (Phase 4) |
| Goals | stored | Coach rule weighting / enabled kinds (Phase 5) |
| Start + days | stored | Focus window, weekday-aware nudges (Phase 5) |
| Log-off | → `windDownTime` immediately | Wind-down pop-up (Phase 5) |
| Distractions | stored | Behaviour callouts, app caps (Phase 5) |

Greeting: `greeting(hour)` → morning 05–11, afternoon 12–17, evening 18–04 (pure, tested).

## 6. UI & motion (per mockup)

- **Left:** kicker with emoji tile, large headline, springy chips/goal cards (`aria-pressed`), time inputs with a sun travelling an arc, day toggles, summary list, shimmering gradient progress bar, button sheen.
- **Right "living art":** drifting blurred colour blobs; dashed rings; morphing, breathing, hue-shifting orb with a per-step face emoji (☀️ 👋 🎯 🗓️ 🧲 ✨); 5–10 information cards orbiting the orb on two radii, re-generated from the current answers with pop-in/out; rising sparkles; a dark "coach" speech bubble whose text reacts to answers; per-step background colour; confetti on finish.
- Card and bubble content are produced by a pure renderer module `onboardingContent.ts` (`cardsFor(step, answers)`, `bubbleFor(step, answers)`) so they are unit-testable.
- All motion is CSS keyframes/transitions (JS only toggles classes, sets custom properties, and spawns sparkle/confetti elements). `prefers-reduced-motion`: orbit, morph, drift, sparkles and confetti are disabled; fades remain.
- Accessibility: all choices are `<button aria-pressed>`; inputs have labels; step changes move focus to the step's first input or heading; the orbiting cards are decorative (`aria-hidden`), the bubble is `aria-live="polite"`.
- Name input: `maxlength=40`; custom distraction input: `maxlength=40`, ignored when empty/duplicate, max 12 total.

## 7. Settings

New first group **"About you"** in the Settings screen: name (text field, saves via `profile:save` on blur/Enter with the other answers unchanged), a one-line summary of roles/goals/distractions, and a **"Redo the questions"** button (opens onboarding in redo mode, pre-filled).

## 8. Error handling

- `profile:save` validation failure → inline error on the summary step / Settings field; nothing written.
- Corrupt stored JSON (hand-edited DB) → `readProfile` returns defaults for that field.
- Renderer IPC promises all have `.catch` (log + keep UI usable).

## 9. Testing

- `profile.test.ts`: schema accepts valid input; rejects unknown roles/goals, bad times, days out of range/duplicate, >12 or >40-char distractions, control characters; `toSettingsPatch` maps bed → `windDownTime` and serializes arrays; `readProfile` round-trips and tolerates corrupt JSON / unknown values.
- `onboardingContent.test.ts`: cards/bubble per step for empty and filled answers (e.g. roles `dev` → VS Code card; bed `22:30` → "Wind down 10:00 pm"; distractions shown; summary step includes name).
- `greeting` tests (hour boundaries, no name → empty).
- UI: typecheck, electron-vite build, dev launch clean, and a headless screenshot of steps 1, 2 (filled) and 6 compared with the mockup.

## 10. Out of scope

Model download step (Phase 4); any AI consumption of the profile (Phases 4–6); editing each answer individually in Settings (Redo covers it).
