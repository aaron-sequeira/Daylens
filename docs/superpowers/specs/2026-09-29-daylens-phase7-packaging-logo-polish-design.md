# Daylens Phase 7 — Installer, Sunrise logo, polish

**Date:** 2026-09-29 · **Status:** approved in brainstorming, pending written-spec review
**Parent spec:** `2026-09-23-daylens-consumer-app-design.md` §13 row 7 ("Packaging (NSIS, reuse agent's winCodeSign workaround), auto-start, polish, reduced-motion — Installable build").
**Exit criterion:** an installable Windows build that passes the automated checks and the user's install checklist (§5.3).

## 1. Intent

The user wants Daylens v1 to be something they (and later others) can install and run like any consumer app, with its own
identity: a hand-drawn **Sunrise** logo in the app's warm pastel style, drawing itself in when the app opens. Phase 7 also
clears the backlog of small issues parked in earlier phases so v1 ships clean.

**User decisions (brainstorming, 2026-09-29):**
- Writer runtime ships **CPU + Vulkan only** (no CUDA, no ARM) — option A.
- Uninstall **asks** whether to delete data + models, default **No** — option A.
- Logo concept **D "Sunrise"**: a warm sun rising over a wavy cream horizon on the black rounded tile.
- The small (tray) mark "kinda holds up" → make it bolder (§3.1).
- Draw-in plays **when the app opens and on the onboarding welcome**.
- Installer is **one-click, per-user** — option A.
- Polish: **all** items listed in §4, including the internal tidy-ups.

**Assumptions (stated, not objected to):** Windows x64 only; **unsigned** (SmartScreen "Windows protected your PC" on
first install); **no auto-update** in v1; version **1.0.0**.

**Out of scope:** code signing, auto-update, macOS/Linux builds, ARM64, bundling models in the installer, any change to
pop-up (pill) or break-overlay visuals, and everything in `daylens-deferred-scope` (sync, vision model, mobile…).

## 2. Installer

### 2.1 Tooling
electron-builder + NSIS, as `apps/agent` already uses (`apps/agent/electron-builder.yml` is the template). New file
`apps/consumer/electron-builder.yml`. Known Windows issue: winCodeSign's macOS `.dylib` symlinks fail to extract without
Developer Mode — reuse the documented one-time workaround (extract `winCodeSign-2.6.0` into the electron-builder cache
excluding `*.dylib`). Electron Forge/Squirrel was considered and rejected (new toolchain, less control over uninstall).

### 2.2 Identity
- `appId: ai.worksight.daylens`, `productName: Daylens`, `apps/consumer/package.json` `version: 1.0.0`.
- Installer artifact: `Daylens-Setup-1.0.0.exe` (`artifactName: Daylens-Setup-${version}.${ext}`), output `apps/consumer/release/`.
- userData stays `%APPDATA%\Daylens` (index.ts already calls `app.setName('Daylens')`), so a dev instance and the installed
  app share history. Models live under userData, so one folder holds everything.
- `electronVersion` pinned to the installed Electron (pnpm hoists `electron` to the root; same reason as the agent).

### 2.3 Install / start / uninstall
- `nsis: { oneClick: true, perMachine: false, runAfterFinish: true, createDesktopShortcut: true, createStartMenuShortcut: true, shortcutName: Daylens }`.
  No admin prompt; installs to `%LOCALAPPDATA%\Programs\Daylens`.
- Start with Windows: unchanged — index.ts already calls `app.setLoginItemSettings({ openAtLogin, args: ['--hidden'] })`
  when packaged. Verify only.
- Single instance: unchanged (`requestSingleInstanceLock` exists). Verify a second launch focuses the first window.
- Uninstall: `nsis.include: build/installer.nsh` with a `customUnInstall` macro:
  - if `${isUpdated}` (uninstall run by an upgrade) → do nothing;
  - else `MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also delete your Daylens history, reports and downloaded AI models?"`
    → on Yes, `RMDir /r "$APPDATA\Daylens"`; on No (default) keep everything.

### 2.4 Contents
- `files`: `out/**/*`, `package.json`. `asar: false` (same active-win / node-pre-gyp reason as the agent; also keeps
  node-llama-cpp's ESM + native binaries and onnxruntime's `.node` on plain disk paths). Production dependencies come from
  the hoisted root `node_modules`; `--config.npmRebuild=false` so the prebuilt Electron-ABI binaries are bundled as-is.
- Exclusions (`files` negations):
  - `@node-llama-cpp/win-x64-cuda`, `@node-llama-cpp/win-x64-cuda-ext`, `@node-llama-cpp/win-arm64`, and any `linux-*` / `mac-*` package;
  - `onnxruntime-node/bin/napi-v3/{darwin,linux}/**` and `onnxruntime-node/bin/napi-v3/win32/arm64/**`.
- `extraResources`: `resources/ocr-helper.ps1 → ocr-helper.ps1`, `resources/tray.png → tray.png`,
  `resources/tray@2x.png → tray@2x.png` (index.ts already loads `ocr-helper.ps1` and `tray.png` from `process.resourcesPath`;
  Electron picks `@2x` automatically).
- `win: { target: nsis, icon: resources/icon.ico }`.
- Models are **not** bundled (downloaded on first use, as today).
- Expected installer size ≈ 250–300 MB.

### 2.5 Build + build check
- Script `"dist": "node ../../scripts/rebuild-native.cjs && electron-vite build && electron-builder --config.npmRebuild=false"`.
- `apps/consumer/scripts/check-build.mjs` runs after `dist` (also runnable alone) against `release/win-unpacked`:
  - required present: `Daylens.exe`, `resources/ocr-helper.ps1`, `resources/tray.png`, `resources/tray@2x.png`,
    better-sqlite3's `.node`, active-win's `.node`, onnxruntime-node `win32/x64` binding, `@node-llama-cpp/win-x64` and
    `@node-llama-cpp/win-x64-vulkan`, `out/main/brain.js`, `out/main/writer.js`;
  - required absent: any `cuda`, `arm64`, `darwin`, `linux` native package dirs listed in §2.4;
  - total unpacked size under **900 MB** (fails loudly with the top 10 largest dirs so a regression is obvious).
  Exit non-zero on any failure. (better-sqlite3's Electron ABI is guaranteed by `dist` always running `rebuild-native`
  first; it is not re-checked here.)
- Building the installer does not launch Daylens; running/installing it is the user's step (§5.3).

## 3. Sunrise logo

### 3.1 Source of truth
`apps/consumer/scripts/logo/sunrise.mjs` — the seeded generator used in brainstorming (pen circle, bent rays, wavy
horizon; same seeds, so the chosen drawing is reproduced exactly). It exports two marks as SVG strings:
- **Full mark** — app icon ≥ 64 px, installer, onboarding. Sun `#F6B35E`, horizon `#FBF8F4`, tile `#171717`, rx 24/100.
- **Small mark** — ≤ 48 px (tray, title bar, rail, small icon sizes). **Bolder than the brainstorm version:** 5 visible
  rays, stroke 11/100, horizon stroke 11/100, sun radius 21/100, gentler wave. Tuned by eye at real 16 px on dark
  (#202020) and light (#EEF0F3) taskbars during implementation.
It also writes `apps/consumer/resources/logo-full.svg` and `logo-small.svg` (committed; the renderer imports path data
from a generated `src/renderer/components/logoPaths.ts` so the in-app logo and the icon files never drift).

### 3.2 Raster + ICO
`apps/consumer/scripts/logo/render.cjs`, run with Electron (`electron scripts/logo/render.cjs`) — offscreen
`BrowserWindow` per size, transparent background, `capturePage()` → PNG. No new dependencies.
- `resources/icon.ico`: sizes 16, 24, 32, 48 (small mark) + 64, 128, 256 (full mark), PNG-compressed entries
  (valid since Windows Vista), written by `scripts/logo/ico.mjs` (pure function `buildIco(pngs: {size, data}[]): Buffer`).
- `resources/icon.png` 256 (full mark), `resources/tray.png` 16 + `resources/tray@2x.png` 32 (small mark).
- Outputs are committed; re-run only when the logo changes (`pnpm --filter @worksight/consumer logo`).

### 3.3 In the app
- `src/renderer/components/Logo.tsx`: `<Logo variant="small" | "full" size={n} animate={boolean} />`, inline SVG from
  `logoPaths.ts`, `aria-label="Daylens"` (decorative uses pass `aria-hidden`).
- Replaces `<Icon name="sun" />` in `TitleBar.tsx` (18 px, small, no animation) and the rail's `.logo` tile in `Rail.tsx`
  (40 px small mark, which carries its own black tile — the old `.logo` background style is removed).
- Onboarding welcome (`Onboarding.tsx`, the "Welcome" step): full mark ~120 px with `animate`.
- `sun` stays in `Icon.tsx` only if still used elsewhere; otherwise removed.

### 3.4 Draw-in animation
- Sequence (~2 s): horizon draws (0.2 s delay, 0.5 s) → sun traces itself while rising 10/100 from below the horizon
  (starts 0.5 s, 0.7–0.9 s) → rays sketch out left to right (starts 1.1 s, 0.8 s). CSS only: `pathLength="1"` +
  `stroke-dashoffset` for the pen strokes, `transform` for the rise; the sun group is clipped at the horizon.
- **App open:** the rail logo plays once per window lifetime, starting the first time the document is visible
  (`document.visibilityState === 'visible'`, else wait for the first `visibilitychange` to visible). An app started with
  `--hidden` therefore plays it when the user first opens the window, never unseen in the background.
- **Onboarding welcome:** plays on mount of the welcome step.
- **Reduced motion:** the existing global rule (`animation-duration: .01ms !important`) makes it snap to the finished
  logo; add an explicit `@media (prefers-reduced-motion: reduce)` rule setting the final state (no dash, no offset) so
  it never shows a half-drawn frame.
- The small title-bar logo does not animate.

## 4. Polish

Visible:
1. **Week label year** — `weekLabel` adds the year when the week's Sunday is not in the current year
   ("29 Dec 2025 – 4 Jan 2026" style; "This week"/"Last week" unchanged).
2. **Past-week copy** — `notEnough` card reads "Not enough tracked days that week" for past weeks; "…yet this week" for the current one.
3. **Search clear** — clearing the box bumps `searchSeq`, so an in-flight reply for the old query can't reopen the dropdown.
4. **"No reports match" announced** — rendered as a polite live region (`role="status"`), still not an option.
5. **Durations** — `formatHm` drops a zero minute part ("3h", not "3h 0m"); "0m" still shows for zero.
6. **Settings → About** — "Daylens 1.0.0" (`app.getVersion()` via the existing settings/privacy view IPC), plus the
   existing model attribution line; nothing else.

Safety / robustness:

7. **Delete vs in-flight PDF** — the auto-save re-checks `reportEpoch` after rendering and before the temp→final rename;
   a changed epoch discards the temp file.
8. **Unreachable folders** — `shareGet`'s folder check becomes async (`fs.promises.stat`) with a 1.5 s timeout; timeout
   is treated as "can't check", not "missing" (no warning, no block).
9. **Metres ≠ minutes** — grounding's bare minute unit is a lowercase `m` only (so "3M views" doesn't match) and not
   followed by `²`/`³` ("100 m²" doesn't match). A standalone "100 m" stays ambiguous and is still read as minutes
   (screen-time prose); documented in a comment.
10. **Hung windows** — the OCR helper calls `IsHungAppWindow(h)` before `PrintWindow`; a hung window is skipped as a
    normal "no capture" result (not an error), so OCR status doesn't flip to failed.
11. **Settings fixes (Phase 3)** — (a) after `deleteActivity` succeeds, a failing `checkpoint(db)` is logged and the
    call still returns `{ deleted: true }` (today it reports a failure for a delete that happened); (b) "Restore defaults"
    with a full list (40 patterns) shows "Your list is full — remove some patterns to restore the defaults." instead of
    silently doing nothing (the user's own patterns are never dropped).
12. **Past-day load** — `pastDay` reads `readsForDay` once and passes it to the view, detail and episode builders.

Internal tidy-ups (group 13):

13a. One `cut`/`str` helper set (schema.ts) used by week.ts. 13b. `canGenerateWeek` moves to `src/shared/` and both main
and renderer (`weekReady`) use it. 13c. topApps merges app names case-insensitively (keeps the most frequent spelling).
13d. `insights:generate` refuses weeks that end before the first tracked day. 13e. One `writerState()` builder replaces the
three repeated literals. 13f. Tip allowed-minutes = episode minutes + numbers from the template **body** only (not
user search text). 13g. A slow tip fallback (template returned after ≥ 2 s) re-checks hold/snooze like a real rewrite.
13h. Episode-run matching in `tipInput` uses the same normalised app key as read selection.

## 5. Testing & verification

### 5.1 Automated (vitest, fallback runner while the dev instance runs)
- `ico.test`: `buildIco` header (reserved 0, type 1, count), directory entries (256 encoded as 0), offsets/sizes, and
  embedded PNG bytes round-trip.
- `sunrise.test`: generator is deterministic (same output twice), both marks are valid SVG path data, small mark has 5
  visible rays.
- `electron-builder.test`: parses `electron-builder.yml` — CUDA/ARM/darwin/linux exclusions present, extraResources
  include `ocr-helper.ps1`/`tray.png`/`tray@2x.png`, `oneClick: true`, `perMachine: false`, NSIS include path exists and
  contains the `${isUpdated}` guard and default-No prompt.
- Unit tests for §4 items 1, 2, 5, 7, 8, 9, 11b, 12, 13b–13h (and 3/4 via extracted helpers where logic exists).
- `check-build.mjs` itself tested against a fixture directory tree (present/absent/size cases).

### 5.2 Headless screenshots (controller, stubbed `window.daylens`, deleted afterwards)
Title bar + rail with the new logo (draw-in at start / middle / end via pinned Web Animations time), onboarding welcome,
Settings → About, Insights with a Dec/Jan week, reduced-motion end state.

### 5.3 Human checklist (installed build)
1. Installer runs: SmartScreen → More info → Run anyway; Daylens opens by itself with the draw-in; desktop + Start menu shortcuts exist.
2. Tray icon looks right on the user's taskbar (and at their display scaling).
3. From the installed copy: tracking works, a report generates, a Laya labelling batch runs; existing history is present.
4. Restart Windows: Daylens starts hidden in the tray; the draw-in plays when the window is first opened.
5. Uninstall → **No**: `%APPDATA%\Daylens` remains; reinstall → history is back. (Optionally uninstall → Yes on a test account.)

**Done:** full suites green, `pnpm -r typecheck` clean, `dist` builds, `check-build` passes, checklist clean.

## 6. Risks
- **Hoisted pnpm + electron-builder dependency collection** may miss or over-include packages → `check-build` catches both
  directions; fix with explicit `files` globs.
- **node-llama-cpp picking a missing backend at runtime** after CUDA removal → it falls back to Vulkan/CPU by design; the
  existing GPU→CPU retry covers a failing Vulkan driver.
- **SmartScreen friction** for unsigned builds → accepted for v1; signing is post-v1.
- **Offscreen rendering differences** in icon rasterisation → outputs are committed and reviewed as images before commit.
