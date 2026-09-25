# Daylens — Phase 5: Coach, pop-ups, break screen, memory-friendly labelling

**Status:** Approved (design) · **Date:** 2026-09-25 · **Owner:** Aaron · **Extends:** `2026-09-23-daylens-consumer-app-design.md` §9.1–9.4 and `2026-09-25-daylens-phase4-laya-labelling-design.md` (this document wins where they differ)

## 1. Goal

Make Daylens coach in real time with the approved animated top-right pop-ups (health, behaviour, tip, win) and a full-screen break screen, while never getting in the user's way — and make Laya labelling (Phase 4) memory-friendly so the user can run their other apps freely.

## 2. Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Pop-up technology | **Custom windows** (frameless transparent always-on-top pill + per-display break overlay), per the approved `pill-v2.html` (C's animation, B's look). Not Windows toasts. |
| Tips | **Templates now**; Phase 6's writer later replaces the template text behind the same interface. |
| App limits | **Simple limits in Settings** (onboarding distractions suggested first); Phase 6 may add suggestions to the same list. |
| Memory | **All four:** idle/away-or-plenty-of-RAM batch scheduling, wait-never-fail free-RAM gate, ORT arena off, and a weight-only 8-bit model kept only if accuracy holds. |

## 3. Memory-friendly labelling (first part of the phase)

### 3.1 When a batch may run
Let `need` = measured Brain peak + 1 GB (fp32: 3.2 GB → need 4.2 GB; replaced by the 8-bit model's measured peak if §3.3 passes; stored as a constant next to the manifest). A batch may **start** only if
- available RAM (`os.freemem()`) ≥ `need`, **and**
- the user is idle ≥ 3 min (`powerMonitor.getSystemIdleTime()`), or the screen is locked (`powerMonitor.getSystemIdleState(60) === 'locked'`), **or** available RAM ≥ `need` + 2 GB.

Otherwise the scheduler state is `deferred` (new `LabellingState`), it retries on the next 60 s tick, and nothing counts as a failure. A started batch runs to completion (streaming + watchdog from Phase 4 unchanged). Existing batch-trigger rules (≥ 20 pending or oldest ≥ 10 min, not while tracking is paused) still apply on top.

### 3.2 Backlog guard
`BACKLOG_LIMIT` rises from 20 to **500** reads (~4 h of reading), and the reader's backlog guard applies only when labelling is `paused` or the model is not ready — never merely because batches are `deferred`.

### 3.3 Weight-only 8-bit model (experiment, gated)
- Using the Phase 0 Python tools (`tools/laya/`), produce `laya.q8w.onnx` with weight-only 8-bit quantization of the MatMul weights (activations stay fp32; e.g. ORT `MatMulNBitsQuantizer` with `bits=8`, or the closest weight-only recipe available for this ORT version).
- Evaluate with the existing harness (TS runtime): **pass** = all-final ≥ **0.88** on the 72 samples AND hold-out within the 10-point rule AND ms/read no more than 1.5× the fp32 figure (~545 ms). Also measure peak working set of the Brain process alone.
- On pass: upload to `aaronalexS/daylens-laya-onnx`, pin the new revision in the manifest (file name, size, SHA-256), switch `loadLaya`'s default file, update `need`. On fail: keep fp32 and record the numbers in `tools/laya/SPIKE-RESULTS.md`.

### 3.4 Engine memory
`sessionOptions()` adds `enableCpuMemArena: false` and `enableMemPattern: false` (keeps half-the-cores and below-normal priority).

### 3.5 UI
Settings → AI model labelling status gains **"Waiting for a quiet moment (N reads queued)"** for `deferred`.

## 4. Coach

### 4.1 Engine
Main process, every 30 s: `coach.tick(now)` builds a snapshot (today's activity samples, focus sessions, labelled reads of the last 2 h, settings, profile, app limits, nudge history) and runs each rule — a pure function `(snapshot) → Candidate | null` where `Candidate = { ruleId, kind, title, body, actions }`. Candidates go through MannersGate; shown ones go to the PillWindow; every decision is recorded in `nudges`.

### 4.2 Rules (defaults)

| rule_id | kind | trigger | actions |
|---|---|---|---|
| `eye_break` | health | active ≥ `breakIntervalMin` (50) min with no idle gap ≥ 2 min | Start break (20 s eye break) |
| `stretch` | health | ≥ 90 min with no idle gap ≥ 2 min | Done |
| `wind_down` | health | active after `windDownTime` (and before 05:00), once per night | Snooze 1 h |
| `goal_80` / `goal_100` | health | today's screen time crosses 80 % / 100 % of `dailyGoalMin`, once per day each | OK |
| `doomscroll` | behaviour | same app, reads with `distraction ≥ 1.5` spanning ≥ 20 min (15 min if the app is in `profileDistractions`) | Take a break |
| `scattered` | behaviour | ≥ 40 foreground switches in 15 min | OK |
| `stuck_escape` | behaviour | a social/entertainment read (category conf ≥ 0.5) within 2 min after a read with `stuck ≥ 1.5`, ≥ 3× today | OK |
| `app_cap` | behaviour | an app's screen time today ≥ its limit in `appLimits`, once per day per app | OK |
| `stuck_tip` | tip | `stuck ≥ 1.5` on ≥ 3 reads within 10 min in the same app → template "Stuck in {app}?" / "Try explaining it out loud, or take a 5-min walk." | Got it |
| `repeat_search` | tip | same normalised query from window titles `… - Google Search` / `… - Bing` / `… at DuckDuckGo` ≥ 3× in 7 days → "Searched "{q}" 3× this week" / "Save the answer as a note or bookmark." | Got it |
| `deep_work` | win | 60 / 90 min of work+learning (Today's piece categories), average distraction < 0.5 over those reads (if any), ≤ 10 switches | 🎉 |
| `below_avg` | win | at 18:00, today's screen time < 7-day average by ≥ 10 % | 🎉 |

Every pop-up also has ✕ (dismiss) and Snooze 1 h. Rules using reads ignore reads older than 30 min for "right now" triggers; categories count only at conf ≥ 0.5 (Phase 4 §3.1); stuck/distraction scores are used as-is.

### 4.3 Profile weighting
- Goal → rules: less → goal_80/100, below_avg · focus → scattered, deep_work · sleep → wind_down · breaks → eye_break, stretch · distract → doomscroll, stuck_escape, app_cap · better → none extra.
- If the user picked ≥ 1 goal: rules mapped to picked goals use the normal per-rule cooldown; all others use **2×**. No goals picked → all normal. Tips follow their triggering rule family (stuck_tip with distract, repeat_search normal).
- On days not in `profileDays`, behaviour rules use 2× cooldown.

### 4.4 MannersGate (pure)
- Global: ≤ 1 pop-up per 20 min (`eye_break` and `stretch` exempt; they have their own triggers); per rule ≤ 1 per 2 h (× profile/back-off multipliers).
- **Hold** (status `held`) when: foreground window bounds equal its display bounds (fullscreen/games); video calls — app `Zoom.exe`/`Zoom`, `ms-teams.exe`/`Microsoft Teams` in a call window, titles containing `Meet -`, `Zoom Meeting`, or `Discord` with `Voice Connected`; Windows notification state ∈ {busy, D3D full screen, presentation mode, quiet time} (queried **only when a candidate is about to show**, via a short PowerShell call to `SHQueryUserNotificationState`, 2 s timeout, failure = not silenced); snooze active; kind disabled.
- **Back-off:** 3 dismissals of the same kind within 7 days → that kind's cooldown ×2 and its next pop-up offers "Show fewer like this?" (choosing it ×2 again). Stored per kind.

### 4.5 Data
```sql
CREATE TABLE IF NOT EXISTS nudges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL, date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('health','behaviour','tip','win')),
  rule_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('shown','held','dismissed','acted','snoozed','expired'))
);
CREATE INDEX IF NOT EXISTS idx_nudges_date ON nudges(date, at);
CREATE TABLE IF NOT EXISTS breaks (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, date TEXT NOT NULL, kind TEXT NOT NULL, seconds INTEGER NOT NULL, completed INTEGER NOT NULL);
```
New settings: `nudgeKinds` (JSON `{health,behaviour,tip,win}` all true), `snoozeUntil` (0), `appLimits` (JSON `[{app, minutes}]`, ≤ 20, minutes 15–240), `nudgeBackoff` (JSON per-kind multiplier + recent dismissals). `nudges` and `breaks` are included in Export and cleared by "Delete my activity". Completed breaks count toward the health score's breaks component.

## 5. Windows & UI

- **PillWindow:** `BrowserWindow({ frame:false, transparent:true, focusable:false, skipTaskbar:true, resizable:false, hasShadow:false, width:400, height:260 })`, `setAlwaysOnTop(true,'screen-saver')`, `showInactive()`, top-right of the display nearest the cursor (16 px margin), `setIgnoreMouseEvents(true,{forward:true})` except while the pointer is over a pill. Created on demand, destroyed when the stack empties. Stack ≤ 3 (older scaled behind, fan out on hover), auto-hide 8 s paused on hover, per-kind colour/emoji, animation per `pill-v2.html`; reduced motion → fade only. Global shortcut **Ctrl+Alt+D** dismisses all. Separate renderer entry (`pill.html`) with its own preload exposing only pill IPC.
- **BreakOverlay:** one fullscreen window per display, `backgroundMaterial:'acrylic'` on Windows 11 22H2+, else `#FBF8F4E6`; breathing circle + countdown ring per `popups.html` §2; 20 s eye break / 2 min stretch; Skip, +1 min, Esc; completed → `breaks` row.
- **Settings → Pop-ups:** kind switches, Snooze (1 h / until tomorrow / off), Daily limits (add app with distractions suggested first; 15 min–4 h; remove), "Test a pop-up".
- **Today:** "While you were busy" card (today's `held` nudges, dismissible); breaks feed the health panel.
- **Tray:** "Snooze pop-ups 1 h" / "Resume pop-ups".

## 6. IPC (new)
`coach:get` (kinds, snooze, limits, held today) · `coach:setKinds` · `coach:snooze` (`'1h' | 'tomorrow' | 'off'`) · `coach:setLimits` (zod: ≤ 20, app 1–60 chars, minutes 15–240) · `coach:dismissHeld` · `coach:test` · pill channels (`pill:show` main→pill, `pill:action` pill→main with `{ nudgeId, action }` zod-validated, `pill:hover` for mouse passthrough) · break channels (`break:start`, `break:done`).

## 7. Error handling
Rule throws → logged, rule skipped this tick. Notification-state query fails/times out → treated as not silenced. Pill/overlay window creation fails → nudge recorded `held`. Global shortcut registration fails → logged (pill ✕ still works).

## 8. Testing
Unit (Vitest, fake clock + fixture rows): each rule (trigger / non-trigger / once-per-day), profile weighting, MannersGate (cooldowns, hold conditions, back-off), batch scheduling (idle/locked/RAM thresholds, deferred never counts as failure, backlog limit), template tips, search-query normalisation, zod schemas. Manual/screenshot: pill animation and stacking vs `pill-v2.html`, break overlay on multi-monitor, Ctrl+Alt+D, no focus stealing while typing, silence in fullscreen/Zoom, reduced motion. Model experiment per §3.3.

## 9. Out of scope
AI-written tips and daily report (Phase 6), report-suggested plan items, installer (Phase 7).
