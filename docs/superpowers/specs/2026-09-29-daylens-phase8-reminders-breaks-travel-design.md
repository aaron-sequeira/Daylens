# Daylens Phase 8 — Reminders, animated break screens, travel mode

**Date:** 2026-09-29 · **Status:** approved in brainstorming, pending written-spec review
**Builds on:** Phase 5 coach (`2026-09-25-daylens-phase5-coach-popups-design.md`: rules → gate → pill pop-up → break overlay),
Phase 7 (logo style, installer — whose `dist` build and install checklist were deferred until this phase lands).

## 1. Intent

The user wants Daylens to look after the basics of a working day beyond eye breaks: drinking water, taking lunch and a
tea break, and any personal reminder they add (vitamins, a call) — each with a break screen whose animation matches the
reminder and plays for the break's length. When they travel, Daylens should follow the new local time automatically and
help them through jet lag.

**User decisions (brainstorming, 2026-09-29):**
- Build this **before** the first installer (option B); Phase 7's `dist` + install checklist run after this merges.
- Reminders appear **pop-up first** (like the eye break); **Start** opens the full-screen break (option A).
- Built-ins and defaults as in §3.2; **all times editable** and **local to the current time zone**.
- Custom reminders as described (name, message, time+days or every N min, break length or none, animation gallery);
  no sounds or repeat-until-done.
- Break-screen style approved from the prototypes: hand-drawn, ink outlines + app pastels, scene inside the countdown
  ring, looping for the whole break.
- Jet lag: **follow the time zone + a short travel plan** (option A), incl. travel pop-ups; wind-down follows local
  time from day one.

**Constraint of reality:** Daylens cannot see the user drink. "Haven't had water in a while" = screen time since the
last "I had some" / completed water break.

**Out of scope:** sounds, repeat-until-done, reminders on other devices/phone, calendar integration, per-reminder
full-screen-vs-pop-up choice, AI-written travel advice, changing the pill or eye/stretch visuals.

## 2. Architecture

Reminders are a new coach rule family in the existing engine (rules → `decide` gate → hold check → pill → break
overlay). They inherit call/fullscreen holds, snooze, focus-block silencing, "show fewer", history. A separate
scheduler was considered and rejected (duplicates gating; could fire over a call).

New units (main process unless noted):
- `main/reminders/store.ts` — SQLite `reminders` table + `reminder_state` (per-reminder last fired / last done), CRUD,
  validation (zod), seeding of built-ins.
- `main/reminders/schedule.ts` — pure: which reminder is due now, given reminders, state, local now, activity.
- `main/coach/rules/reminders.ts` — the rule that turns a due reminder into a `Candidate` (kind `reminder`).
- `main/time/zone.ts` — time-zone watcher (read Windows zone, detect change, reset the JS clock's zone cache).
- `main/time/travel.ts` — pure: home zone, travel-mode window, direction, plan text, travel pop-up schedule.
- Break overlay: kinds extended to all animations (§4); renderer `src/break/` gains the scenes.
- Renderer: `RemindersSection.tsx` (+ editor), `TravelCard.tsx` on Today, `PopupsSection` gets a Reminders switch.

## 3. Reminders

### 3.1 Model
`reminders(id INTEGER PK, builtin TEXT NULL UNIQUE /* 'water'|'lunch'|'tea'|'dinner' */, name TEXT, message TEXT,
animation TEXT, schedule_type TEXT /* 'time'|'interval' */, time TEXT NULL /* 'HH:MM' local */, days TEXT NULL /* JSON [0..6], 0=Sun */,
interval_min INTEGER NULL, break_sec INTEGER /* 0 = no break */, enabled INTEGER, sort INTEGER, created_at INTEGER)`.
`reminder_state(reminder_id PK, last_fired_date TEXT NULL /* local YYYY-MM-DD for 'time' */, last_done_at INTEGER NULL,
last_fired_at INTEGER NULL)`. Deleting activity data ("Delete my activity") clears `reminder_state`, not `reminders`.

Validation: name 1–40 chars; message 0–120; animation ∈ gallery (§4.1); `time` matches `HH:MM` 00:00–23:59 with ≥ 1
day; `interval_min` 15–240; `break_sec` ∈ {0} ∪ [15, 3600]; ≤ 20 non-built-in reminders. Built-ins cannot be deleted,
only disabled or reset to defaults.

### 3.2 Built-ins (seeded once; editable)
| builtin | name | schedule | break | animation | enabled |
|---|---|---|---|---|---|
| water | Water | every 60 min of screen time | 30 s | water | yes |
| lunch | Lunch | 13:00 on profile workdays (default Mon–Fri) | 30 min | meal | yes |
| tea | Tea break | 16:00 on profile workdays | 15 min | tea | yes |
| dinner | Dinner | 19:30 every day | 30 min | dinner | no |
Messages: water "A few big sips. Your focus will thank you."; lunch "Step away from the screen and enjoy it."; tea
"Put the kettle on, stretch your legs, look out of a window."; dinner "Time to eat. Screens can wait."

### 3.3 Scheduling rules (`schedule.ts`)
- **Clock time:** due when the current **local** time is within [time, time + 15 min), today's local weekday ∈ days,
  and `last_fired_date ≠ today`. If the user is idle/locked at that moment (no activity in the last 5 min or screen
  locked), mark `last_fired_date = today` without showing (skipped: they're away). Once per local day.
- **Interval:** screen time (active, non-idle focus time) since `max(last_done_at, last_fired_at, last idle gap ≥ 10 min end)`
  ≥ `interval_min`. Snoozed/dismissed → `last_fired_at` set, so it re-arms after another interval.
- At most one reminder candidate per tick (earliest-due first; clock-time before interval on ties).
- Travel mode (§5) temporarily uses 45 min for the water interval and adds travel reminders.

### 3.4 Pop-up and actions
Candidate: kind `reminder`, `ruleId: 'reminder'`, `key: reminder:<id>:<localDate or firedAt>`, mini = emoji + name,
title = name (+ emoji), body = message. Buttons: **Start** (primary, only if `break_sec > 0`) → break overlay with that
reminder's animation and length; **I had some** / **Done** (ack: sets `last_done_at`, no overlay); **Snooze**, **Dismiss**
as today. A completed reminder break sets `last_done_at` and counts as a break for the eye-break rule and health score.
New `Kind` value `'reminder'` with its own switch in Settings → Pop-ups (default on); existing kinds unchanged.

## 4. Break screens

### 4.1 Gallery
`water, meal, tea, dinner, stretch, walk, eyes, medicine, call, breathe` — one hand-drawn SVG scene each (ink #171717
strokes, app pastels), CSS-animated loops, no new dependencies. The approved prototypes (water: bottle fills with wave
and bubbles; meal: steam rises, chopsticks bob; tea: steam, swaying tea-bag tag) are the reference style; the others:
dinner (plate, fork & knife, steam), stretch (figure reaching up/side), walk (figure strolling a wavy line), eyes (eye
glancing toward a distant sunrise), medicine (capsule dropping into a hand, glass), call (phone with ringing waves),
breathe (the current expanding circle).

### 4.2 Layout and behaviour
Scene (~170 px) inside the countdown ring (~230 px); time left under the ring (`m:ss`); title, message, buttons.
Short breaks (< 5 min): **Skip**, **+1 min** (existing), and for water **I had some** replacing Skip-as-done. Long
breaks (≥ 5 min): **I'm back** ends early (counts as completed if ≥ 50 % elapsed). Existing multi-monitor behaviour
kept. Reduced motion: static scene, countdown still updates. The existing eye/stretch breaks keep working (eye →
`eyes` scene, stretch → `stretch` scene).

`BREAK_SECONDS` becomes a per-start length (the reminder's `break_sec`; eye 20 s, stretch 120 s unchanged).
`break:start` payload: `{ kind: Animation; seconds: number; title: string; text: string; long: boolean }`.

## 5. Time zones and travel mode

### 5.1 Following the zone
- `zone.ts` reads the Windows time zone (registry `TimeZoneKeyName` via `reg query`, falling back to `tzutil /g`)
  every 5 min and on `resume`/`unlock-screen`. On a change: reset the JS time-zone cache in main
  (`process.env.TZ` reassignment triggers V8's re-detection), record `tz_changes(at, from_name, to_name,
  from_offset_min, to_offset_min)`, and push an update so the renderer refreshes. **Risk / spike first:** verify in
  Electron main that the reset changes `getTimezoneOffset()`; verify renderer windows follow (Chromium monitors the
  system zone). Fallback if main doesn't follow: an IANA mapping of the Windows zone name assigned to `process.env.TZ`.
- History is not rewritten: every row keeps the local date it was recorded with; a travel day can be short or long.
- Clock-time reminders, wind-down, day boundaries all use the new local time immediately.

### 5.2 Travel mode (`travel.ts`)
- **Home zone:** the zone (offset) in effect for the most tracked time over the last 14 days.
- **Trigger:** a zone change with |offset difference| ≥ 180 min. **Length:** `clamp(round(|hours| / 3), 2, 5)` days.
  A return trip starts its own travel mode ("adjusting back home").
- **Direction:** east = local offset > previous offset (clock ahead); west = behind.
- **Today card:** "You're 8 hours ahead of home · Day 1 of 3", a short plan — east: morning daylight 8–10 am, caffeine
  cut-off 2 pm, early night; west: afternoon daylight, stay up to local bedtime, caffeine cut-off 3 pm; both: naps ≤ 20
  min before 3 pm, extra water; plus "Your wind-down reminder already follows local time." Button **Turn off travel mode**.
- **Travel pop-ups** (kind `reminder`, only in travel mode): "Get some daylight ☀️" (09:00 east / 16:00 west),
  "Last coffee for today ☕" (14:00 east / 15:00 west), and the water interval at 45 min.

## 6. Settings and Today
- **Settings → Reminders:** list (switch, emoji + name, summary like "every 60 min of screen time" / "1:00 pm · Mon–Fri"),
  **Edit**, **Delete** (custom only), **Reset to default** (built-ins); **Add reminder** → editor (name, message, time +
  day chips or every N min, break length select incl. "No break — just remind me", animation gallery with live
  preview on hover/focus). Validation messages inline.
- **Settings → Pop-ups:** new Reminders switch.
- **Today:** travel card only while travel mode is active.

## 7. Testing
- Unit: schedule (window, once per local day, weekday filter, skip when away, interval counting incl. "I had some" and
  ≥ 10 min idle reset, tie-breaking, travel water interval); store (validation limits, built-in seeding idempotent,
  delete rules, reset to defaults); reminder rule → candidate shape; zone watcher with an injected reader (change
  detection, tz_changes row, no-op when unchanged); travel (home zone, trigger threshold, length clamp, direction,
  pop-up times, return trip).
- Headless screenshots (stubbed API, deleted afterwards): reminders list, editor + gallery, a still frame of each of the
  ten scenes, travel card.
- Human checklist: a water reminder appears and "I had some" resets it; lunch fires at an edited time; a custom
  no-break reminder; change the Windows time zone (Settings → Time) → times and travel card follow → change it back.
- Then the deferred Phase 7 steps: `dist`, check-build, install checklist.

## 8. Risks
- **Main-process time zone not refreshing** after a Windows change → spike first; fallback IANA mapping; renderer
  verified separately.
- **Pop-up fatigue** with many reminders → one reminder candidate per tick, existing snooze/"show fewer", global switch.
- **Idle detection edge cases** (watching a video = no input but present) → a clock-time reminder during fullscreen
  video is held by the existing gate, not skipped; "away" = locked or idle ≥ 5 min *and* not fullscreen.
