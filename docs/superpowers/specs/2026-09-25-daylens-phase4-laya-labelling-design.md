# Daylens — Phase 4: Laya labelling, model download, screen-reading opt-in

**Status:** Approved (design) · **Date:** 2026-09-25 · **Owner:** Aaron · **Extends:** `2026-09-23-daylens-consumer-app-design.md` §5, §8.1, §10, §11 and `2026-09-24-daylens-phase3-screen-reader-design.md` (this document wins where they differ)

## 1. Goal

Turn stored screen reads into activity labels with the local Laya model, and make the timeline categories come from those labels. Deliver the model to users by download, and ask users to opt in to screen reading during onboarding (new users) or once on Today (existing users). Nothing is sent off the PC.

## 2. Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Model hosting | Public Hugging Face repo owned by the user: **`aaronalexS/daylens-laya-onnx`** (fp32 ONNX + tokenizer + meta + model card + Apache-2.0 LICENSE, credit to `convaiinnovations/laya`). URLs pinned to a commit. Pinned commit `6e5dbfec69ce2aac4e1f0c2768ab017099393652` (verified: all four files match the manifest sizes and SHA-256). |
| Accuracy (77 % < 80 % target) | First task: reword the `category` question, tuned on the 48 existing samples and checked on ~24 new held-out samples; plus the app-name rules as a tie-breaker when Laya is unsure. |
| Memory (~2 GB while loaded) | **Batch, then unload:** a Brain `utilityProcess` is started per batch, labels, and exits. |
| Opt-in / download | New onboarding step (off by default); the model downloads **in the background** after onboarding; existing users get a one-time Today card. |
| Brain shape | **Approach A:** a fresh utilityProcess per batch (process exit is the only reliable way to return ONNX Runtime memory). |
| Unsure labels | Keep Laya's guess; the app-name list overrides only for known apps (user decision after Task 2 measurements). |

## 3. Brain & labelling

### 3.1 Flow

```
ScreenReader (Phase 3) → screen_reads (labeled_at NULL)
LabelScheduler (main): tick every 60 s; runs a batch when model = ready AND
   (≥ 20 unlabelled reads OR oldest unlabelled read ≥ 10 min old)
   → fork Brain (utilityProcess), send ≤ 50 reads { id, app, title, text }
Brain: loadLaya(modelDir) → for each read: layaState(app, title, text) → ask(QUESTIONS)
   → post { id, category, categoryConf, activity, activityConf, stuck, distraction } per read → exit(0)
Main: write labels (one transaction), set labeled_at; post events:update
```

- **Dedup rows** (`text IS NULL`, not purged) are not sent to the Brain: they copy the labels of the most recent earlier labelled read with the same `text_hash` (or stay unlabelled until that read is labelled). **Purged rows** (`text IS NULL AND text_hash = ''`) that were never labelled are marked `labeled_at = now` with all labels NULL (nothing left to label).
- **Stored values:** `category` = Laya's choice, **always**, with its confidence in `category_conf` (no more `uncertain`; consumers decide what to do with a low-confidence label using the stored confidence). Same for `activity`. `stuck` / `distraction` = the score's expected value (0..2). Phase 5 rules that act on `category`/`activity` should only fire when confidence ≥ 0.5 (`CONFIDENT`).
- **Brain protocol** (MessagePort / `process.parentPort`, typed, zod-validated on the main side): main → `{ op: 'label', reads }`; Brain → `{ op: 'labels', results }` then exits, or `{ op: 'error', message }` then exits 1. Brain never touches the database.
- **Timeouts & crashes:** a batch has a 120 s timeout (kill). Crash/timeout → backoff 1 s → 5 s → 30 s (per-batch retry); > 3 failures within 10 min → labelling `paused` until the app restarts or the user presses "Retry" in Settings. Tracking and reading are unaffected.
- **Backlog guard:** while labelling cannot run (model not ready, paused) and > 20 reads are unlabelled, the ScreenReader skips new captures (outcome `skipped-backlog`).
- **Model directory:** `userData/models/laya`; env `DAYLENS_MODEL_DIR` overrides it (dev: `apps/consumer/.models/laya`) and marks the model `ready` if the files verify.

### 3.2 Timeline categories

`loadTodayView` gains the day's labelled reads. For each read, its counted category is `finalCategory(choice, confidence, app)`: `confidence >= CONFIDENT ? choice : (categoryForApp(app) !== 'other' ? categoryForApp(app) : choice)` — Laya's choice when confident, otherwise the app-name rule only when it recognizes the app, otherwise Laya's own (unsure) guess is kept (user decision after Task 2 measurements — see §2 and `tools/laya/SPIKE-RESULTS.md`). For each focus-session piece, the category is the **most frequent `finalCategory`** among reads whose `at` falls inside the piece and whose `app_name` matches; if none, `categoryForApp(app)` (existing rules — the unchanged no-labels fallback). Category cards and the timeline use the result.

### 3.3 Questions & accuracy work

- Questions live in `src/main/brain/questions.ts` (single source; `tools/laya/questions.json` is regenerated from it for the Python tools or left as history).
- `scripts/eval-laya.mjs` (Node, runs ONNX via `loadLaya`; manual only, needs ~2 GB free RAM) scores a question set on `tools/laya/samples.jsonl` (48, tuning) and `tools/laya/samples.holdout.jsonl` (~24 new hand-written samples weighted to social/communication/entertainment/learning and browser tabs). Prints accuracy (Laya alone, and Laya + app tie-breaker), a confusion table, and per-sample confidence.
- **Gate:** ≥ 80 % on all samples combined, scored through `finalCategory` (§3.2's keep-Laya rule), with hold-out accuracy no more than 10 points below tuning. If not reached after 5 wording rounds, ship the best wording and record the numbers as an accepted risk in `tools/laya/SPIKE-RESULTS.md`. (Task 2 measured "final" under an earlier rule that always applied the app-name tie-breaker below 0.5 confidence, capping it at 58–61 %; Task 2b re-measured under the keep-Laya rule and reached 91.7 %, meeting the gate — see `tools/laya/SPIKE-RESULTS.md`.)
- Only `category` wording is tuned; `activity`, `stuck`, `distraction` keep their wording.

## 4. Model download

- **Manifest** (`src/main/models/manifest.ts`, bundled): repo, pinned commit, and for each file: name, size, SHA-256. URL = `https://huggingface.co/aaronalexS/daylens-laya-onnx/resolve/<commit>/<file>`.

| File | Size (bytes) | SHA-256 |
|---|---|---|
| `laya.onnx` | 1 686 012 251 | `bbd684549c90cab727e43fd1d6c9458cf6e791a6af5913110746c98ba4253ad8` |
| `tokenizer.json` | 3 583 228 | `6c8aaa9a542084f2457eab775d4eeb51f92a70c0fd9de28d5edb0ddec3c08d30` |
| `tokenizer_config.json` | 337 | `08d4cf3ac4dca381759441b85b91a6d40e688471dcd33d15d6649eb0a9a854d1` |
| `laya-meta.json` | 519 | `429b6917f0f855257f18500f163b6a01860fa6d53a0747f4e0f4ebad103a34e9` |

- **Downloader** (`src/main/models/downloader.ts`, deps-injected `fetch`/fs/clock):
  - Runs while `screenReading` is on and the model is not `ready`; stops (keeping `.part` files) when it is turned off.
  - Checks free disk space first (`fs.statfs`): needs remaining bytes + 500 MB, else `error: no_space`.
  - Per file: download to `<file>.part` with HTTP `Range` from the current `.part` size (restart from 0 if the server ignores Range); stream-hash; on completion verify size + SHA-256, then rename. Bad hash → delete and retry the file once, then `error: bad_hash`.
  - Network errors → retry after 5 s → 30 s → 2 min, then every 10 min (status `downloading` with `retrying: true`).
  - On startup, a model directory whose files all match the manifest (size + SHA-256, hashed once and cached by mtime) is `ready`.
  - Status: `missing | downloading { received, total, retrying } | verifying | ready | error { reason }`, pushed via `events:update` (throttled to 1/s).
- **Delete model** removes the directory and sets `missing` (the download restarts if screen reading is still on).

## 5. Onboarding, Today card, Settings

- **Onboarding:** new step before "All set": "Let Daylens understand your screen?" — plain-language privacy copy (every 30 s, text only, screenshot never saved, password/banking/private windows skipped, stays on this PC), the default "Never look at" list, the one-time 1.7 GB download; a switch (`aria-pressed`) **off by default**; skippable. Orb face 👀; orbit cards illustrate labels ("Coding in VS Code", "Watching YouTube", "Reading docs"). On "Start my day" the answer is saved with the profile (`screenReading`, `screenReadingAsked = true`). Redo mode shows the step with the current value.
- **Existing users:** new setting `screenReadingAsked` (default `false`). When `consentGranted && !screenReadingAsked`, Today shows a one-time card with the same copy and **Turn on** / **Not now**; either sets `screenReadingAsked = true` (Turn on also sets `screenReading = true`). Turning screen reading on in Settings also sets `screenReadingAsked = true`.
- **Settings → Privacy → new "AI model" rows:** model status (Not downloaded · Downloading 43 % — 0.7 of 1.7 GB · Checking… · Ready · error text), **Download again**, **Delete model**; labelling status (Waiting for model · Last labelled 10:42 · Paused after errors + **Retry**).
- **Today:** a slim banner while the model downloads (with %), hidden when ready or when screen reading is off.

## 6. IPC & settings

| Channel | Payload / returns |
|---|---|
| `models:get` | → `{ model: ModelStatus, labelling: { state: 'waiting' \| 'idle' \| 'running' \| 'paused', lastLabelledAt: number \| null, pending: number } }` |
| `models:redownload` | → same shape (deletes and restarts) |
| `models:delete` | native confirm → `{ deleted: boolean }` |
| `models:retryLabelling` | → same shape as `models:get` |
| `settings:set` | also accepts `screenReadingAsked` (boolean) |
| `profile:save` | onboarding passes `screenReading` via `settings:set` after save (no profile schema change) |

New settings: `screenReadingAsked` (false). No schema change to `screen_reads` (Phase 3 columns are used).

## 7. Error handling

| Failure | Behaviour |
|---|---|
| Brain crash / OOM / timeout | Backoff retry; > 3 in 10 min → labelling paused + Retry; tracking/reading continue |
| Model files missing/corrupt at start | Status `missing` (re-download if screen reading on) |
| Download: no space / bad hash twice | `error` status with reason; Download again button |
| Download: offline | Keeps retrying (5 s → 30 s → 2 min → every 10 min) |
| Invalid Brain message | Treated as a crash (zod on the main side) |

## 8. Testing

Unit (Vitest): downloader (resume from `.part`, server ignoring Range, bad hash → retry → error, no space, network error backoff, stop mid-file, ready detection) with a local `http` test server; LabelScheduler (batch trigger rules, backlog guard, dedup-row label copy, purged-row marking, crash backoff/pause, timeout) with a fake Brain; label storage (choice + confidence always stored, scores; legacy 'uncertain' rows ignored); Today category from labels vs app fallback; onboarding step and Today card state logic (pure helpers); IPC zod schemas. Brain entry tested through a fake `LayaRunner`. Manual: eval script numbers; real download from the HF repo; real batch labelling in the app with memory returning after the batch.

## 9. Out of scope

Writer model / reports / tips (Phase 6), coach & pop-ups (Phase 5), per-app category overrides, surfacing activity/stuck/distraction in the UI (stored for Phase 5), int8/fp16 model shrinking.
