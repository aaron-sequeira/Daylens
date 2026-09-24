# Daylens Onboarding v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Daylens' single consent screen with the approved 6-step animated onboarding that asks skippable questions (name, roles, goals, rhythm, distractions), stores the answers as a local profile, applies log-off time → wind-down immediately, greets the user by name on Today, and lets them edit/redo it from Settings.

**Architecture:** A browser-safe option list (`src/shared/profileOptions.ts`) is shared by a main-process profile module (`src/main/profile.ts`: zod validation, KV mapping, tolerant reader) and pure renderer content helpers (`src/renderer/lib/onboardingContent.ts`: orbit cards, coach bubble, summaries). Two new IPC channels (`profile:get`, `profile:save`) carry the typed profile. The UI is split into a decorative `OnboardingArt` (orb, orbiting cards, blobs, sparkles, confetti) and the `Onboarding` flow; `App` shows it on first run and in "redo" mode.

**Tech Stack:** Electron 33, React 19, TypeScript 5.7, zod 3, Vitest 2, plain CSS (keyframes/transitions only).

**Spec:** `docs/superpowers/specs/2026-09-24-daylens-onboarding-v2-design.md` (visual source of truth: `docs/superpowers/specs/assets/daylens-mockups/onboarding-v2.html`).

## Global Constraints

- Branch `feat/daylens-onboarding-v2`. Every commit message ends with a blank line then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never stage `.codex/` or `apps/consumer/.models/`.
- Windows + Git Bash; run commands from the repo root unless a step says otherwise. Consumer tests: `pnpm --filter @worksight/consumer test` (the Laya parity test is opt-in and stays skipped). Typecheck: `pnpm --filter @worksight/consumer typecheck`. Build: `pnpm --filter @worksight/consumer exec electron-vite build`.
- Profile storage: existing settings KV (`createKvStore`); keys `profileName` (''), `profileRoles` ('[]'), `profileGoals` ('[]'), `profileStart` ('09:00'), `profileDays` ('[1,2,3,4,5]'), `profileDistractions` ('[]'). Log-off time is stored in the existing `windDownTime`.
- Allowed values: roles ⊂ `student, dev, design, office, create, game, browse`; goals ⊂ `less, focus, sleep, breaks, distract, better`; times `HH:MM` 24h; days unique ints 1–7 (1 = Monday); name trimmed/collapsed 0–40 chars, no control characters; distractions ≤ 12 unique (case-insensitive), each trimmed 1–40 chars, no control characters.
- Profile keys are NOT renderer-editable through `settings:set` (`settingsPatch` stays strict); only `profile:save`.
- Consent is granted only when the first-run onboarding finishes ("Start my day ✨"). Redo mode never touches consent.
- Design tokens (spec §4 of the main spec): background `#FBF8F4`, panel `#F2EBE6`, ink `#171717`, muted `#77716C`, line `#E7DFD8`; lavender `#D8D2FC`, mint `#BFEBD3`, pink `#F4C6C8`, peach `#F9DDB9`, sky `#CFE6FB`. Motion via CSS keyframes/transitions only; `prefers-reduced-motion` respected (global rule already in styles.css).
- Accessibility: every choice is a `<button aria-pressed>`; inputs labelled; decorative art `aria-hidden`; coach bubble `aria-live="polite"`.

## Review Focus

1. **Redo must not disturb anything else** — saving the profile writes only the six profile keys plus `windDownTime`; consent, pause, goal, break interval, window-title and login settings are untouched. → test in Task 1.
2. **Old or hand-edited databases** — missing keys, corrupt JSON, unknown role/goal values or impossible times must read back as sensible defaults, never crash. → test in Task 1.
3. **Messy human input** — whitespace, emoji, 41-character names/apps, duplicates differing only in case, a 13th distraction, control characters. → tests in Task 1.
4. **Maxed-out answers** — ticking every role/goal/distraction must never put more than 10 cards around the orb. → test in Task 2.
5. **Times around midnight** — log-off `00:30` must show "Wind down 12:00 am" / "Offline by 12:30 am", and start `23:30` must wrap the focus window correctly. → test in Task 2.

---

### Task 1: Profile model, validation and IPC

**Files:**
- Create: `apps/consumer/src/shared/profileOptions.ts`
- Create: `apps/consumer/src/main/profile.ts`
- Test: `apps/consumer/src/main/profile.test.ts`
- Modify: `apps/consumer/src/main/settings.ts` (DEFAULT_SETTINGS)
- Modify: `apps/consumer/src/main/settings.test.ts` (one new case)
- Modify: `apps/consumer/src/main/channels.ts`, `apps/consumer/src/main/ipc.ts`, `apps/consumer/src/preload/index.ts`

**Interfaces:**
- Produces (shared, browser-safe):
  ```ts
  export const ROLES: readonly ['student','dev','design','office','create','game','browse'];
  export const GOALS: readonly ['less','focus','sleep','breaks','distract','better'];
  export type Role = typeof ROLES[number]; export type Goal = typeof GOALS[number];
  export interface Profile { name: string; roles: Role[]; goals: Goal[]; start: string; bed: string; days: number[]; distractions: string[] }
  export const DEFAULT_PROFILE: Profile;  // { name:'', roles:[], goals:[], start:'09:00', bed:'23:00', days:[1,2,3,4,5], distractions:[] }
  export const MAX_DISTRACTIONS = 12; export const MAX_TEXT = 40;
  ```
- Produces (main): `profileInput` (zod, strict), `toSettingsPatch(p: Profile): Partial<DaylensSettings>`, `readProfile(s: DaylensSettings): Profile`.
- Produces (preload → `window.daylens`): `profile: { get(): Promise<Profile>; save(p: Profile): Promise<DaylensSettings> }`.

- [ ] **Step 1: Shared options**

`apps/consumer/src/shared/profileOptions.ts`:

```ts
// Browser-safe profile vocabulary shared by main (validation) and renderer (onboarding UI).
export const ROLES = ['student', 'dev', 'design', 'office', 'create', 'game', 'browse'] as const;
export const GOALS = ['less', 'focus', 'sleep', 'breaks', 'distract', 'better'] as const;
export type Role = typeof ROLES[number];
export type Goal = typeof GOALS[number];

export interface Profile {
  name: string;
  roles: Role[];
  goals: Goal[];
  start: string; // HH:MM
  bed: string; // HH:MM, stored as windDownTime
  days: number[]; // 1 = Monday … 7 = Sunday
  distractions: string[];
}

export const DEFAULT_PROFILE: Profile = { name: '', roles: [], goals: [], start: '09:00', bed: '23:00', days: [1, 2, 3, 4, 5], distractions: [] };
export const MAX_DISTRACTIONS = 12;
export const MAX_TEXT = 40;
```

In `apps/consumer/src/main/settings.ts` add the six keys to `DEFAULT_SETTINGS` (after `openAtLogin: true`):

```ts
  openAtLogin: true,
  profileName: '',
  profileRoles: '[]',
  profileGoals: '[]',
  profileStart: '09:00',
  profileDays: '[1,2,3,4,5]',
  profileDistractions: '[]'
```

(`settingsPatch` is NOT changed.)

- [ ] **Step 2: Write the failing tests**

`apps/consumer/src/main/profile.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, settingsPatch } from './settings';
import { profileInput, readProfile, toSettingsPatch } from './profile';
import type { Profile } from '../shared/profileOptions';

const valid: Profile = {
  name: '  Aaron   S ', roles: ['dev', 'design'], goals: ['focus', 'sleep'],
  start: '09:30', bed: '22:30', days: [5, 1, 3], distractions: ['Instagram', ' my  game 🎮 ']
};

describe('profileInput', () => {
  it('accepts valid input and cleans whitespace', () => {
    const p = profileInput.parse(valid);
    expect(p.name).toBe('Aaron S');
    expect(p.distractions).toEqual(['Instagram', 'my game 🎮']);
  });
  it('accepts an empty (all skipped) profile', () => {
    expect(profileInput.safeParse({ name: '', roles: [], goals: [], start: '09:00', bed: '23:00', days: [], distractions: [] }).success).toBe(true);
  });
  it.each([
    ['unknown role', { roles: ['pilot'] }],
    ['duplicate goal', { goals: ['focus', 'focus'] }],
    ['bad start time', { start: '25:00' }],
    ['bad bed time', { bed: '9pm' }],
    ['day 0', { days: [0] }],
    ['day 8', { days: [8] }],
    ['duplicate day', { days: [1, 1] }],
    ['41-char name', { name: 'x'.repeat(41) }],
    ['control char in name', { name: 'Aa\u0007ron' }],
    ['newline in name', { name: 'Aa\nron' }],
    ['13 distractions', { distractions: Array.from({ length: 13 }, (_, i) => `app${i}`) }],
    ['41-char distraction', { distractions: ['y'.repeat(41)] }],
    ['empty distraction', { distractions: ['   '] }],
    ['case-insensitive duplicate distraction', { distractions: ['YouTube', 'youtube'] }],
    ['extra key', { consentGranted: true }]
  ])('rejects %s', (_label, patch) => {
    expect(profileInput.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
});

describe('toSettingsPatch', () => {
  it('writes exactly the profile keys plus windDownTime', () => {
    const patch = toSettingsPatch(profileInput.parse(valid));
    expect(Object.keys(patch).sort()).toEqual(['profileDays', 'profileDistractions', 'profileGoals', 'profileName', 'profileRoles', 'profileStart', 'windDownTime']);
    expect(patch.windDownTime).toBe('22:30');
    expect(patch.profileDays).toBe('[1,3,5]');
    expect(JSON.parse(patch.profileRoles!)).toEqual(['dev', 'design']);
  });
});

describe('readProfile', () => {
  it('round-trips a saved profile', () => {
    const saved = { ...DEFAULT_SETTINGS, ...toSettingsPatch(profileInput.parse(valid)) };
    expect(readProfile(saved)).toEqual({ name: 'Aaron S', roles: ['dev', 'design'], goals: ['focus', 'sleep'], start: '09:30', bed: '22:30', days: [1, 3, 5], distractions: ['Instagram', 'my game 🎮'] });
  });
  it('gives defaults for a fresh install', () => {
    expect(readProfile(DEFAULT_SETTINGS)).toEqual({ name: '', roles: [], goals: [], start: '09:00', bed: '23:00', days: [1, 2, 3, 4, 5], distractions: [] });
  });
  it('tolerates corrupt or unknown stored values', () => {
    const p = readProfile({
      ...DEFAULT_SETTINGS, profileRoles: '{bad json', profileGoals: '["focus","nope",42]', profileDays: 'x',
      profileStart: '99:99', windDownTime: 'late', profileDistractions: '["ok", "", 7, "' + 'z'.repeat(60) + '"]', profileName: 'n'.repeat(80)
    });
    expect(p).toEqual({ name: 'n'.repeat(40), roles: [], goals: ['focus'], start: '09:00', bed: '23:00', days: [1, 2, 3, 4, 5], distractions: ['ok'] });
  });
});

describe('settingsPatch', () => {
  it('does not let the renderer write profile keys through settings:set', () => {
    expect(settingsPatch.safeParse({ profileName: 'x' }).success).toBe(false);
  });
});
```

- [ ] **Step 3: Run to confirm failure**

Run: `pnpm --filter @worksight/consumer test`
Expected: FAIL — cannot resolve `./profile`.

- [ ] **Step 4: Implement `profile.ts`**

`apps/consumer/src/main/profile.ts`:

```ts
import { z } from 'zod';
import type { DaylensSettings } from './settings';
import { DEFAULT_PROFILE, GOALS, MAX_DISTRACTIONS, MAX_TEXT, ROLES, type Goal, type Profile, type Role } from '../shared/profileOptions';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const clean = (s: string): string => s.trim().replace(/\s+/g, ' ');
const text = (min: number) =>
  z.string().refine((s) => !CONTROL.test(s), 'control characters').transform(clean).pipe(z.string().min(min).max(MAX_TEXT));
const unique = <T>(a: T[]): boolean => new Set(a).size === a.length;

/** IPC trust boundary for profile:save. */
export const profileInput = z.object({
  name: text(0),
  roles: z.array(z.enum(ROLES)).refine(unique, 'duplicate role'),
  goals: z.array(z.enum(GOALS)).refine(unique, 'duplicate goal'),
  start: z.string().regex(TIME),
  bed: z.string().regex(TIME),
  days: z.array(z.number().int().min(1).max(7)).refine(unique, 'duplicate day'),
  distractions: z.array(text(1)).max(MAX_DISTRACTIONS).refine((a) => unique(a.map((s) => s.toLowerCase())), 'duplicate distraction')
}).strict();

export function toSettingsPatch(p: Profile): Partial<DaylensSettings> {
  return {
    profileName: p.name,
    profileRoles: JSON.stringify(p.roles),
    profileGoals: JSON.stringify(p.goals),
    profileStart: p.start,
    profileDays: JSON.stringify([...p.days].sort((a, b) => a - b)),
    profileDistractions: JSON.stringify(p.distractions),
    windDownTime: p.bed
  };
}

function parseList<T>(raw: string, keep: (v: unknown) => v is T, fallback: T[]): T[] {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? [...new Set(v.filter(keep))] : fallback;
  } catch {
    return fallback;
  }
}

/** Typed profile from stored settings; anything corrupt or unknown falls back to defaults (never throws). */
export function readProfile(s: DaylensSettings): Profile {
  const isRole = (v: unknown): v is Role => (ROLES as readonly unknown[]).includes(v);
  const isGoal = (v: unknown): v is Goal => (GOALS as readonly unknown[]).includes(v);
  const isDay = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 7;
  const isApp = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= MAX_TEXT && !CONTROL.test(v);
  return {
    name: clean(s.profileName).slice(0, MAX_TEXT),
    roles: parseList(s.profileRoles, isRole, []),
    goals: parseList(s.profileGoals, isGoal, []),
    start: TIME.test(s.profileStart) ? s.profileStart : DEFAULT_PROFILE.start,
    bed: TIME.test(s.windDownTime) ? s.windDownTime : DEFAULT_PROFILE.bed,
    days: parseList(s.profileDays, isDay, DEFAULT_PROFILE.days).sort((a, b) => a - b),
    distractions: parseList(s.profileDistractions, isApp, []).slice(0, MAX_DISTRACTIONS)
  };
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @worksight/consumer test`
Expected: PASS (all profile + settings tests).

- [ ] **Step 6: Wire IPC and preload**

`apps/consumer/src/main/channels.ts` — add two entries:

```ts
  profileGet: 'profile:get',
  profileSave: 'profile:save',
```

`apps/consumer/src/main/ipc.ts` — add the import and two handlers inside `registerIpc` (after `consentGrant`):

```ts
import { profileInput, readProfile, toSettingsPatch } from './profile';
```

```ts
  ipcMain.handle(CH.profileGet, () => readProfile(d.settings.get()));
  ipcMain.handle(CH.profileSave, (_e, raw) => {
    const next = d.settings.set(toSettingsPatch(profileInput.parse(raw)));
    d.onSettingsChanged();
    return next;
  });
```

`apps/consumer/src/preload/index.ts` — add the type import and a `profile` member to `api`:

```ts
import type { Profile } from '../shared/profileOptions';
```

```ts
  profile: {
    get: (): Promise<Profile> => ipcRenderer.invoke(CH.profileGet),
    save: (p: Profile): Promise<DaylensSettings> => ipcRenderer.invoke(CH.profileSave, p)
  },
```

- [ ] **Step 7: Typecheck, test, commit**

```bash
pnpm --filter @worksight/consumer typecheck && pnpm --filter @worksight/consumer test
git add apps/consumer/src/shared/profileOptions.ts apps/consumer/src/main/profile.ts apps/consumer/src/main/profile.test.ts apps/consumer/src/main/settings.ts apps/consumer/src/main/channels.ts apps/consumer/src/main/ipc.ts apps/consumer/src/preload/index.ts
git commit -m "feat(consumer): user profile model, validation and IPC

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: typecheck exit 0; all tests pass.

### Task 2: Onboarding content helpers + greeting

**Files:**
- Create: `apps/consumer/src/renderer/lib/onboardingContent.ts`
- Test: `apps/consumer/src/renderer/lib/onboardingContent.test.ts`
- Modify: `apps/consumer/src/renderer/lib/format.ts`, `apps/consumer/src/renderer/lib/format.test.ts`

**Interfaces:**
- Consumes: `Profile`, `Role`, `Goal` from `src/shared/profileOptions.ts` (Task 1).
- Produces:
  ```ts
  export interface OrbitCard { icon: string; title: string; sub: string; color: string }
  export interface SummaryRow { icon: string; color: string; text: string; strong: string }
  export const STEP_COUNT = 6; export const MAX_ORBIT_CARDS = 10;
  export const ROLE_INFO: Record<Role, { emoji: string; label: string; color: string; cards: OrbitCard[] }>;
  export const GOAL_INFO: Record<Goal, { emoji: string; title: string; sub: string; color: string; card: OrbitCard }>;
  export const DISTRACTION_CHOICES: { emoji: string; label: string }[];
  export function clock(t: string): string;               // '22:30' → '10:30 pm'
  export function addMinutes(t: string, mins: number): string; // wraps around midnight
  export function cardsFor(step: number, p: Profile): OrbitCard[];  // 1..10 cards
  export function bubbleFor(step: number, p: Profile): string;
  export function summaryFor(p: Profile): SummaryRow[];
  export function profileSummary(p: Profile | null): string;
  // format.ts
  export function greeting(hour: number, name: string): string; // '' when name blank
  ```

- [ ] **Step 1: Write the failing tests**

`apps/consumer/src/renderer/lib/onboardingContent.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_PROFILE, GOALS, ROLES, type Profile } from '../../shared/profileOptions';
import { addMinutes, bubbleFor, cardsFor, clock, MAX_ORBIT_CARDS, profileSummary, STEP_COUNT, summaryFor } from './onboardingContent';

const p = (patch: Partial<Profile> = {}): Profile => ({ ...DEFAULT_PROFILE, ...patch });
const titles = (step: number, prof: Profile): string[] => cardsFor(step, prof).map((c) => c.title);

describe('time helpers', () => {
  it('formats 12-hour clocks', () => {
    expect(['00:05', '09:00', '12:00', '22:30'].map(clock)).toEqual(['12:05 am', '9:00 am', '12:00 pm', '10:30 pm']);
  });
  it('adds minutes and wraps midnight', () => {
    expect(addMinutes('23:30', 60)).toBe('00:30');
    expect(addMinutes('00:10', -30)).toBe('23:40');
    expect(addMinutes('09:00', 180)).toBe('12:00');
  });
});

describe('cardsFor', () => {
  it('welcome shows the 8 preview cards', () => {
    expect(cardsFor(0, p())).toHaveLength(8);
  });
  it('about-you greets by name and reacts to roles', () => {
    expect(titles(1, p({ name: ' Aaron ', roles: ['dev'] }))).toEqual(['Hi Aaron!', 'VS Code', 'Stack Overflow']);
    expect(titles(1, p())).toEqual(['Hi there!', 'Pick what you do']);
  });
  it('goals show one card per goal', () => {
    expect(titles(2, p({ goals: ['sleep', 'focus'] }))).toEqual(['Wind-down', 'Focus streaks']);
    expect(titles(2, p())).toEqual(['Choose a goal']);
  });
  it('rhythm derives focus window and wind-down', () => {
    expect(titles(3, p({ start: '09:00', bed: '22:30' }))).toEqual(['Day starts 9:00 am', 'Focus 10:00 am–12:00 pm', 'Wind down 10:00 pm', 'Offline by 10:30 pm', '5 days a week']);
  });
  it('handles times around midnight', () => {
    expect(titles(3, p({ start: '23:30', bed: '00:30', days: [6] }))).toEqual(['Day starts 11:30 pm', 'Focus 12:30 am–2:30 am', 'Wind down 12:00 am', 'Offline by 12:30 am', '1 day a week']);
  });
  it('distractions become cards', () => {
    expect(titles(4, p({ distractions: ['Instagram'] }))).toEqual(['Instagram']);
    expect(titles(4, p())).toEqual(['Nothing? Lucky you']);
  });
  it('summary step leads with the name and ends with privacy', () => {
    const t = titles(5, p({ name: 'Aaron', goals: ['focus'] }));
    expect(t[0]).toBe('Aaron');
    expect(t[t.length - 1]).toBe('All on this PC');
  });
  it('never puts more than 10 cards around the orb, even with every answer ticked', () => {
    const maxed = p({ name: 'A', roles: [...ROLES], goals: [...GOALS], distractions: Array.from({ length: 12 }, (_, i) => `app${i}`) });
    for (let s = 0; s < STEP_COUNT; s++) {
      const n = cardsFor(s, maxed).length;
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(MAX_ORBIT_CARDS);
    }
  });
});

describe('bubbleFor', () => {
  it('uses the name and summarises distractions', () => {
    expect(bubbleFor(1, p({ name: 'Aaron' }))).toContain('Aaron');
    expect(bubbleFor(4, p({ distractions: ['Instagram', 'YouTube', 'Reddit'] }))).toBe("Noted. I'll keep a gentle eye on Instagram & YouTube and more.");
    for (let s = 0; s < STEP_COUNT; s++) expect(bubbleFor(s, p()).length).toBeGreaterThan(0);
  });
});

describe('summaries', () => {
  it('summaryFor has four rows and handles skipped answers', () => {
    const rows = summaryFor(p());
    expect(rows).toHaveLength(4);
    expect(rows[0].strong).toBe('a bit of everything');
    expect(rows[3].strong).toBe('');
  });
  it('profileSummary lists what Daylens knows', () => {
    expect(profileSummary(null)).toBe('');
    expect(profileSummary(p())).toBe('Nothing yet. Answer a few questions to personalise Daylens.');
    expect(profileSummary(p({ roles: ['dev'], goals: ['focus'], distractions: ['Instagram'] }))).toBe('Coding · Deeper focus · watching Instagram');
  });
});
```

Append to `apps/consumer/src/renderer/lib/format.test.ts` (and add `greeting` to its import from `./format`):

```ts
describe('greeting', () => {
  it('greets by time of day', () => {
    expect([5, 11, 12, 17, 18, 23, 0, 4].map((h) => greeting(h, 'Aaron'))).toEqual([
      'Good morning, Aaron', 'Good morning, Aaron', 'Good afternoon, Aaron', 'Good afternoon, Aaron',
      'Good evening, Aaron', 'Good evening, Aaron', 'Good evening, Aaron', 'Good evening, Aaron'
    ]);
  });
  it('is empty without a name', () => {
    expect(greeting(9, '')).toBe('');
    expect(greeting(9, '   ')).toBe('');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @worksight/consumer test`
Expected: FAIL — cannot resolve `./onboardingContent`; `greeting` is not a function.

- [ ] **Step 3: Implement**

`apps/consumer/src/renderer/lib/onboardingContent.ts`:

```ts
import type { Goal, Profile, Role } from '../../shared/profileOptions';

export interface OrbitCard { icon: string; title: string; sub: string; color: string }
export interface SummaryRow { icon: string; color: string; text: string; strong: string }
export const STEP_COUNT = 6;
export const MAX_ORBIT_CARDS = 10;

function c(icon: string, title: string, sub: string, color: string): OrbitCard {
  return { icon, title, sub, color };
}

export const ROLE_INFO: Record<Role, { emoji: string; label: string; color: string; cards: OrbitCard[] }> = {
  student: { emoji: '🎓', label: 'Studying', color: 'var(--mint)', cards: [c('🎓', 'YouTube lectures', 'counts as Learning', 'var(--mint)'), c('📓', 'Notion', 'counts as Study', 'var(--mint)')] },
  dev: { emoji: '💻', label: 'Coding', color: 'var(--lav)', cards: [c('💻', 'VS Code', 'counts as Work', 'var(--lav)'), c('🧩', 'Stack Overflow', 'counts as Learning', 'var(--mint)')] },
  design: { emoji: '🎨', label: 'Design', color: 'var(--pink)', cards: [c('🎨', 'Figma', 'counts as Work', 'var(--pink)'), c('✨', 'Dribbble', 'counts as Inspiration', 'var(--peach)')] },
  office: { emoji: '📊', label: 'Office work', color: 'var(--sky)', cards: [c('📊', 'Excel', 'counts as Work', 'var(--sky)'), c('📧', 'Outlook', 'counts as Comms', 'var(--sky)')] },
  create: { emoji: '🎬', label: 'Creating content', color: 'var(--peach)', cards: [c('🎬', 'Premiere Pro', 'counts as Creating', 'var(--peach)'), c('📺', 'YouTube Studio', 'counts as Work', 'var(--peach)')] },
  game: { emoji: '🎮', label: 'Gaming', color: 'var(--pink)', cards: [c('🎮', 'Steam', 'counts as Play', 'var(--pink)'), c('💬', 'Discord', 'counts as Social', 'var(--lav)')] },
  browse: { emoji: '🌐', label: 'Browsing & chilling', color: 'var(--mint)', cards: [c('🌐', 'Chrome', 'sorted by what you read', 'var(--mint)')] }
};

export const GOAL_INFO: Record<Goal, { emoji: string; title: string; sub: string; color: string; card: OrbitCard }> = {
  less: { emoji: '⏳', title: 'Less screen time', sub: 'Stay under a daily goal', color: 'var(--mint)', card: c('⏳', 'Daily goal', 'gentle reminders', 'var(--mint)') },
  focus: { emoji: '🧠', title: 'Deeper focus', sub: 'Longer stretches, fewer switches', color: 'var(--lav)', card: c('🧠', 'Focus streaks', 'I celebrate 60+ min', 'var(--lav)') },
  sleep: { emoji: '🌙', title: 'Better sleep', sub: 'Log off on time', color: 'var(--sky)', card: c('🌙', 'Wind-down', 'nudge before bedtime', 'var(--sky)') },
  breaks: { emoji: '👀', title: 'Healthier breaks', sub: 'Eyes, posture, movement', color: 'var(--peach)', card: c('👀', '20-20-20', 'eye breaks every 50 min', 'var(--peach)') },
  distract: { emoji: '📵', title: 'Fewer distractions', sub: 'Catch doomscrolling early', color: 'var(--pink)', card: c('📵', 'Scroll alerts', 'after 20 min of feeds', 'var(--pink)') },
  better: { emoji: '🛠', title: 'Work smarter', sub: "Tips when I'm stuck", color: 'var(--mint)', card: c('🛠', 'Stuck tips', 'when errors repeat', 'var(--mint)') }
};

export const DISTRACTION_CHOICES: { emoji: string; label: string }[] = [
  { emoji: '📸', label: 'Instagram' }, { emoji: '▶️', label: 'YouTube' }, { emoji: '🎵', label: 'TikTok' },
  { emoji: '👽', label: 'Reddit' }, { emoji: '✖️', label: 'X / Twitter' }, { emoji: '💬', label: 'Discord' },
  { emoji: '🍿', label: 'Netflix' }, { emoji: '🎮', label: 'Games' }, { emoji: '📰', label: 'News' }
];

const WELCOME: OrbitCard[] = [
  c('⏱', '6h 12m', 'on screen today', 'var(--lav)'), c('✦', '90-min focus', 'streak', 'var(--mint)'),
  c('📊', 'Your week', 'at a glance', 'var(--peach)'), c('💚', 'Health 72', 'pretty healthy', 'var(--pink)'),
  c('👀', 'Eye break', 'in 12 min', 'var(--sky)'), c('🎧', 'Spotify', '39m · background', 'var(--lav)'),
  c('📚', 'Learning', '48m today', 'var(--mint)'), c('🌙', 'Wind-down', '11:00 pm', 'var(--peach)')
];

export function clock(t: string): string {
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

export function addMinutes(t: string, mins: number): string {
  const [h, m] = t.split(':').map(Number);
  const total = (((h * 60 + m + mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

const cap = (cards: OrbitCard[]): OrbitCard[] => cards.slice(0, MAX_ORBIT_CARDS);
const focusWindow = (p: Profile): string => `${clock(addMinutes(p.start, 60))}–${clock(addMinutes(p.start, 180))}`;

export function cardsFor(step: number, p: Profile): OrbitCard[] {
  const name = p.name.trim();
  switch (step) {
    case 0:
      return WELCOME;
    case 1: {
      const roles = p.roles.flatMap((r) => ROLE_INFO[r].cards);
      return cap([c('👋', name ? `Hi ${name}!` : 'Hi there!', 'nice to meet you', 'var(--lav)'), ...(roles.length ? roles : [c('🤔', 'Pick what you do', 'I learn from it', 'var(--panel)')])]);
    }
    case 2:
      return p.goals.length ? cap(p.goals.map((g) => GOAL_INFO[g].card)) : [c('🎯', 'Choose a goal', 'or two, or all', 'var(--panel)')];
    case 3:
      return [
        c('☀️', `Day starts ${clock(p.start)}`, 'deep work 1–3h after', 'var(--peach)'),
        c('🧠', `Focus ${focusWindow(p)}`, 'your best hours', 'var(--lav)'),
        c('🌙', `Wind down ${clock(addMinutes(p.bed, -30))}`, 'soft nudge', 'var(--sky)'),
        c('🛌', `Offline by ${clock(p.bed)}`, 'sleep protected', 'var(--lav)'),
        c('📅', `${p.days.length} day${p.days.length === 1 ? '' : 's'} a week`, 'weekends stay gentle', 'var(--mint)')
      ];
    case 4:
      return p.distractions.length ? cap(p.distractions.map((d) => c('👀', d, 'gentle eye on it', 'var(--pink)'))) : [c('🧲', 'Nothing? Lucky you', 'or pick a few', 'var(--panel)')];
    default:
      return cap([
        c('👋', name || 'Friend', p.roles.length ? `${p.roles.length} kind${p.roles.length === 1 ? '' : 's'} of work` : 'all-rounder', 'var(--lav)'),
        ...p.goals.slice(0, 3).map((g) => GOAL_INFO[g].card),
        c('🌙', `Offline by ${clock(p.bed)}`, 'wind-down on', 'var(--sky)'),
        ...p.distractions.slice(0, 3).map((d) => c('👀', d, 'watching gently', 'var(--pink)')),
        c('🔒', 'All on this PC', 'always private', 'var(--mint)')
      ]);
  }
}

export function bubbleFor(step: number, p: Profile): string {
  const name = p.name.trim();
  switch (step) {
    case 0: return "Hi! I'm Daylens. Let's get to know each other.";
    case 1: return name ? `Lovely to meet you, ${name}. What do you do here?` : 'What should I call you?';
    case 2: return p.goals.length ? `Got it: ${p.goals.length} goal${p.goals.length > 1 ? 's' : ''}. I'll focus on those.` : "Pick what you want help with. I won't nag about the rest.";
    case 3: return `I'll protect ${focusWindow(p)} for deep work and nudge you before ${clock(p.bed)}.`;
    case 4:
      return p.distractions.length
        ? `Noted. I'll keep a gentle eye on ${p.distractions.slice(0, 2).join(' & ')}${p.distractions.length > 2 ? ' and more' : ''}.`
        : 'Anything that steals your time? Totally optional.';
    default: return `Ready when you are${name ? `, ${name}` : ''}! Your dashboard fills in as you use your PC.`;
  }
}

export function summaryFor(p: Profile): SummaryRow[] {
  return [
    p.roles.length
      ? { icon: '🧑‍💻', color: 'var(--lav)', text: 'You use this PC for', strong: p.roles.map((r) => ROLE_INFO[r].label).join(', ') }
      : { icon: '🧑‍💻', color: 'var(--lav)', text: 'You do', strong: 'a bit of everything' },
    p.goals.length
      ? { icon: '🎯', color: 'var(--peach)', text: "I'll help with", strong: p.goals.map((g) => GOAL_INFO[g].title).join(', ') }
      : { icon: '🎯', color: 'var(--peach)', text: "I'll give", strong: 'balanced nudges' },
    { icon: '🌙', color: 'var(--sky)', text: 'Deep work', strong: `${focusWindow(p)}, wind-down before ${clock(p.bed)}` },
    p.distractions.length
      ? { icon: '👀', color: 'var(--pink)', text: 'Gentle eye on', strong: p.distractions.join(', ') }
      : { icon: '👀', color: 'var(--pink)', text: 'No distraction watch-list (you can add one later)', strong: '' }
  ];
}

export function profileSummary(p: Profile | null): string {
  if (!p) return '';
  const parts = [
    p.roles.map((r) => ROLE_INFO[r].label).join(', '),
    p.goals.map((g) => GOAL_INFO[g].title).join(', '),
    p.distractions.length ? `watching ${p.distractions.join(', ')}` : ''
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Nothing yet. Answer a few questions to personalise Daylens.';
}
```

Append to `apps/consumer/src/renderer/lib/format.ts`:

```ts
export function greeting(hour: number, name: string): string {
  const n = name.trim();
  if (!n) return '';
  const part = hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 18 ? 'afternoon' : 'evening';
  return `Good ${part}, ${n}`;
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @worksight/consumer test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/consumer/src/renderer/lib/onboardingContent.ts apps/consumer/src/renderer/lib/onboardingContent.test.ts apps/consumer/src/renderer/lib/format.ts apps/consumer/src/renderer/lib/format.test.ts
git commit -m "feat(consumer): onboarding content helpers and greeting

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: Living art component + onboarding styles

**Files:**
- Create: `apps/consumer/src/renderer/components/OnboardingArt.tsx`
- Modify: `apps/consumer/src/renderer/styles.css` (append onboarding block; nothing removed yet)

**Interfaces:**
- Consumes: `OrbitCard` (Task 2).
- Produces: `OnboardingArt({ step: number; cards: OrbitCard[]; bubble: string; celebrate: boolean }): JSX.Element` — renders `.ob-art`. CSS classes `.ob*` used by Task 4.

- [ ] **Step 1: Component**

`apps/consumer/src/renderer/components/OnboardingArt.tsx`:

```tsx
import { useMemo } from 'react';
import type { OrbitCard } from '../lib/onboardingContent';

// Per-step background, orb hue shift and face (mockup onboarding-v2.html).
const LOOK = [
  { bg: 'var(--mint)', hue: '0deg', face: '☀️' },
  { bg: 'var(--lav)', hue: '40deg', face: '👋' },
  { bg: 'var(--peach)', hue: '-30deg', face: '🎯' },
  { bg: 'var(--sky)', hue: '80deg', face: '🗓️' },
  { bg: 'var(--pink)', hue: '-60deg', face: '🧲' },
  { bg: 'linear-gradient(135deg, #BFEBD3, #D8D2FC 50%, #F9DDB9)', hue: '0deg', face: '✨' }
];
const CONFETTI = ['#C9BEFF', '#9FE3C0', '#FFD19A', '#FFB4BA', '#A9D3FA', '#171717'];

export function OnboardingArt({ step, cards, bubble, celebrate }: { step: number; cards: OrbitCard[]; bubble: string; celebrate: boolean }) {
  const look = LOOK[Math.min(Math.max(step, 0), LOOK.length - 1)];
  const sparks = useMemo(() => Array.from({ length: 16 }, () => ({
    left: 10 + Math.random() * 80, top: 40 + Math.random() * 55, t: 4 + Math.random() * 5, d: Math.random() * 6
  })), []);
  const confetti = useMemo(() => Array.from({ length: 70 }, (_, i) => ({
    left: Math.random() * 100, delay: Math.random() * 0.6, dur: 2 + Math.random() * 1.6, color: CONFETTI[i % CONFETTI.length]
  })), []);
  const n = cards.length;

  return (
    <div className="ob-art" style={{ ['--bg' as string]: look.bg }}>
      <div className="ob-deco" aria-hidden="true">
        <div className="ob-blob b1" /><div className="ob-blob b2" /><div className="ob-blob b3" /><div className="ob-blob b4" />
        <div className="ob-ring r1" /><div className="ob-ring r2" />
        <div className="ob-orbwrap" style={{ ['--hue' as string]: look.hue }}>
          <div className="ob-glow" /><div className="ob-orb" />
          <div className="ob-face"><span key={look.face}>{look.face}</span></div>
        </div>
        <div className="ob-center">
          {cards.map((card, k) => {
            const r = n > 6 && k % 2 ? 250 : 185; // two orbits when crowded
            return (
              <div key={`${step}-${k}-${card.title}`} className="ob-orbit"
                style={{ ['--a' as string]: `${(k * 360) / n - 90}deg`, ['--r' as string]: `${r}px`, ['--d' as string]: `${r > 200 ? 110 : 80}s` }}>
                <div className={`ob-fcard${k % 3 === 0 ? ' tint' : ''}`}
                  style={{ ['--c' as string]: card.color, ['--in' as string]: `${0.15 + k * 0.07}s`, ['--fl' as string]: `${-k * 0.6}s` }}>
                  <i>{card.icon}</i><div><b>{card.title}</b><small>{card.sub}</small></div>
                </div>
              </div>
            );
          })}
        </div>
        {sparks.map((s, i) => (
          <span key={i} className="ob-spark" style={{ left: `${s.left}%`, top: `${s.top}%`, ['--t' as string]: `${s.t}s`, ['--dl' as string]: `${s.d}s` }} />
        ))}
        {celebrate && confetti.map((cf, i) => (
          <span key={i} className="ob-confetti" style={{ left: `${cf.left}%`, background: cf.color, animationDelay: `${cf.delay}s`, animationDuration: `${cf.dur}s` }} />
        ))}
      </div>
      <p className="ob-bubble" aria-live="polite"><span key={bubble}>{bubble}</span></p>
    </div>
  );
}
```

- [ ] **Step 2: Styles**

Append to `apps/consumer/src/renderer/styles.css` **before** the `@media (prefers-reduced-motion: reduce)` block:

```css
/* ---------- onboarding v2 (mockup: onboarding-v2.html) ---------- */
.ob { display: grid; grid-template-columns: 1.02fr 1fr; height: calc(100vh - 40px); }
.ob-left { padding: 36px 52px 30px; display: flex; flex-direction: column; overflow-y: auto; min-height: 0; }
.ob-progress { display: flex; align-items: center; gap: 10px; margin-bottom: 26px; }
.ob-track { flex: 1; max-width: 260px; height: 6px; border-radius: 6px; background: var(--line); overflow: hidden; }
.ob-track div { height: 100%; border-radius: 6px; background: linear-gradient(90deg, #9ADBB9, #B6A8FA, #F4A9AE, #F7C98F); background-size: 300% 100%; animation: ob-shine 6s linear infinite; transition: width .7s var(--spring); }
.ob-stepno { font-size: 12px; color: var(--muted); font-weight: 500; }
.ob-link { margin-left: auto; border: 0; background: none; font: inherit; font-size: 13px; color: var(--muted); cursor: pointer; }
.ob-link + .ob-link { margin-left: 14px; }
.ob-link:hover { color: var(--ink); }
.ob-step { display: flex; flex-direction: column; flex: 1; }
.ob-step > * { animation: rise .6s var(--ease) both; }
.ob-step > *:nth-child(2) { animation-delay: .07s; }
.ob-step > *:nth-child(3) { animation-delay: .14s; }
.ob-step > *:nth-child(4) { animation-delay: .21s; }
.ob-step > *:nth-child(5) { animation-delay: .28s; }
.ob-step > *:nth-child(6) { animation-delay: .35s; }
.ob-step > *:nth-child(7) { animation-delay: .42s; }
.ob-kicker { font-size: 12px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; color: var(--muted); margin-bottom: 10px; display: flex; align-items: center; gap: 8px; }
.ob-kicker i { font-style: normal; width: 22px; height: 22px; border-radius: 7px; display: grid; place-items: center; font-size: 12px; }
.ob-step h1 { font-weight: 400; font-size: 46px; letter-spacing: -.025em; line-height: 1.06; margin-bottom: 12px; outline: none; }
.ob-step h1 b { font-weight: 600; }
.ob-wave { display: inline-block; animation: ob-wave 2.2s ease-in-out infinite; transform-origin: 70% 70%; }
.ob-why { font-size: 12.5px; color: var(--muted); display: flex; gap: 8px; align-items: flex-start; margin-top: auto; padding-top: 14px; max-width: 470px; line-height: 1.45; }
.ob-why b { color: var(--ink); font-weight: 600; }
.ob .promise i { transition: transform .35s var(--spring); }
.ob .promise div:hover i { transform: rotate(-8deg) scale(1.12); }
.ob-field { margin-bottom: 18px; max-width: 420px; }
.ob-field input { width: 100%; font: 500 20px 'DM Sans Variable', system-ui, sans-serif; padding: 16px 18px; border-radius: 18px; border: 2px solid var(--line); background: #fff; outline: none; transition: border-color .25s, box-shadow .25s; }
.ob-field input:focus { border-color: #B6A8FA; box-shadow: 0 0 0 6px rgba(182, 168, 250, .25); }
.ob-field.small input { font-size: 15px; padding: 12px 16px; }
.ob-label { font-size: 13px; font-weight: 600; margin: 4px 0 10px; }
.ob-label span { color: var(--muted); font-weight: 400; }
.ob-chips { display: flex; flex-wrap: wrap; gap: 9px; margin-bottom: 16px; max-width: 520px; }
.ob-chip { display: flex; align-items: center; gap: 8px; border: 2px solid var(--line); background: #fff; border-radius: 999px; padding: 9px 16px 9px 12px; font: 500 14px 'DM Sans Variable', system-ui, sans-serif; cursor: pointer; transition: transform .35s var(--spring), background .25s, border-color .25s, box-shadow .25s; }
.ob-chip:hover { transform: translateY(-2px); }
.ob-chip .e { font-size: 16px; transition: transform .4s var(--spring); }
.ob-chip[aria-pressed="true"] { background: var(--c, var(--lav)); border-color: transparent; box-shadow: 0 10px 20px -12px rgba(0, 0, 0, .35); animation: ob-pop .45s var(--spring); }
.ob-chip[aria-pressed="true"] .e { transform: scale(1.25) rotate(-8deg); }
.ob-goals { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; max-width: 520px; margin-bottom: 10px; }
.ob-goal { border: 2px solid var(--line); background: #fff; border-radius: 20px; padding: 14px 14px 13px; cursor: pointer; text-align: left; font: inherit; color: inherit; transition: transform .35s var(--spring), background .3s, border-color .3s, box-shadow .3s; position: relative; }
.ob-goal:hover { transform: translateY(-3px); }
.ob-goal .e { font-size: 22px; display: block; margin-bottom: 6px; transition: transform .45s var(--spring); }
.ob-goal b { display: block; font-size: 14.5px; font-weight: 600; }
.ob-goal small { font-size: 12px; color: var(--muted); line-height: 1.35; display: block; margin-top: 2px; }
.ob-goal[aria-pressed="true"] { background: var(--c); border-color: transparent; box-shadow: 0 14px 26px -16px rgba(0, 0, 0, .4); }
.ob-goal[aria-pressed="true"] .e { transform: scale(1.2) rotate(-10deg); }
.ob-goal[aria-pressed="true"]::after { content: "✓"; position: absolute; top: 10px; right: 12px; width: 22px; height: 22px; border-radius: 50%; background: var(--ink); color: #fff; font-size: 12px; display: grid; place-items: center; animation: ob-pop .45s var(--spring); }
.ob-arc { max-width: 520px; height: 74px; margin: 2px 0 8px; }
.ob-arc svg { width: 100%; height: 100%; overflow: visible; }
.ob-sun { animation: ob-sun 6s ease-in-out infinite alternate; }
.ob-sched { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; max-width: 520px; margin-bottom: 14px; }
.ob-tcard { border-radius: 22px; padding: 16px 18px; }
.ob-tcard .e { font-size: 22px; }
.ob-tcard label { display: block; font-size: 13px; font-weight: 600; margin: 8px 0; }
.ob-tcard input[type=time] { font: 600 22px 'DM Sans Variable', system-ui, sans-serif; border: 0; background: rgba(255, 255, 255, .7); border-radius: 12px; padding: 8px 10px; width: 100%; color: var(--ink); }
.ob-days { display: flex; gap: 6px; margin-bottom: 6px; }
.ob-day { width: 40px; height: 40px; border-radius: 12px; border: 2px solid var(--line); background: #fff; font: 600 13px 'DM Sans Variable', system-ui, sans-serif; cursor: pointer; transition: all .3s var(--spring); }
.ob-day[aria-pressed="true"] { background: var(--ink); color: #fff; border-color: var(--ink); transform: translateY(-2px); }
.ob-nav { display: flex; gap: 10px; align-items: center; margin-top: 18px; }
.ob .btn { position: relative; overflow: hidden; padding: 13px 24px; }
.ob .btn:hover { box-shadow: 0 12px 24px -12px rgba(0, 0, 0, .5); }
.ob .btn:not(.s)::after { content: ""; position: absolute; inset: 0; background: linear-gradient(110deg, transparent 30%, rgba(255, 255, 255, .35) 50%, transparent 70%); transform: translateX(-100%); animation: ob-sheen 3.2s ease-in-out infinite; }
.ob-summary { display: flex; flex-direction: column; gap: 9px; max-width: 500px; margin-bottom: 6px; }
.ob-sum { display: flex; gap: 12px; align-items: center; background: #fff; border-radius: 16px; padding: 11px 14px; font-size: 13.5px; line-height: 1.4; box-shadow: 0 8px 18px -14px rgba(0, 0, 0, .3); }
.ob-sum i { flex: none; width: 32px; height: 32px; border-radius: 11px; display: grid; place-items: center; font-style: normal; }
.ob-sum b { font-weight: 600; }
.ob-error { color: #B42318; font-size: 13px; margin-top: 10px; }

.ob-art { margin: 14px; border-radius: 24px; position: relative; overflow: hidden; background: var(--bg, var(--mint)); transition: background 1s var(--ease); }
.ob-deco { position: absolute; inset: 0; }
.ob-blob { position: absolute; border-radius: 50%; filter: blur(40px); opacity: .75; animation: ob-drift 14s ease-in-out infinite alternate; }
.ob-blob.b1 { width: 260px; height: 260px; left: -60px; top: -40px; background: var(--lav); }
.ob-blob.b2 { width: 300px; height: 300px; right: -80px; bottom: -60px; background: var(--peach); animation-duration: 17s; }
.ob-blob.b3 { width: 200px; height: 200px; right: 40px; top: 30px; background: var(--pink); animation-duration: 12s; }
.ob-blob.b4 { width: 220px; height: 220px; left: 30px; bottom: 10px; background: var(--sky); animation-duration: 19s; }
.ob-ring { position: absolute; left: 50%; top: 50%; border-radius: 50%; border: 1.5px dashed rgba(23, 23, 23, .12); animation: ob-ringspin 80s linear infinite; }
.ob-ring.r1 { width: 380px; height: 380px; }
.ob-ring.r2 { width: 560px; height: 560px; animation-direction: reverse; animation-duration: 120s; }
.ob-orbwrap { position: absolute; left: 50%; top: 50%; width: 230px; height: 230px; transform: translate(-50%, -50%); filter: hue-rotate(var(--hue, 0deg)); transition: filter 1.2s var(--ease); }
.ob-glow { position: absolute; inset: -28px; border-radius: 50%; background: radial-gradient(circle, rgba(255, 255, 255, .85), rgba(255, 255, 255, 0) 65%); animation: ob-breathe 5s ease-in-out infinite; }
.ob-orb { position: absolute; inset: 0; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #fff 0, rgba(255, 255, 255, 0) 45%), conic-gradient(from 0deg, #C9BEFF, #9FE3C0, #FFD19A, #FFB4BA, #A9D3FA, #C9BEFF); box-shadow: inset -18px -24px 50px rgba(0, 0, 0, .08), 0 30px 60px -20px rgba(80, 60, 160, .35); animation: ob-orbspin 16s linear infinite, ob-morph 9s ease-in-out infinite; }
.ob-face { position: absolute; inset: 0; display: grid; place-items: center; font-size: 44px; animation: ob-bob 4s ease-in-out infinite; }
.ob-face span { display: inline-block; animation: ob-facein .5s var(--spring) both; }
.ob-center { position: absolute; left: 50%; top: 50%; width: 0; height: 0; }
.ob-orbit { position: absolute; left: 0; top: 0; animation: ob-orbit var(--d, 80s) linear infinite; }
.ob-fcard { position: absolute; transform: translate(-50%, -50%); white-space: nowrap; background: #fff; border-radius: 16px; padding: 9px 13px; font-size: 12.5px; box-shadow: 0 16px 30px -18px rgba(0, 0, 0, .35); display: flex; align-items: center; gap: 8px; animation: ob-cardin .7s var(--spring) both, ob-float 5s ease-in-out infinite; animation-delay: var(--in, 0s), var(--fl, 0s); }
.ob-fcard i { font-style: normal; width: 26px; height: 26px; border-radius: 9px; display: grid; place-items: center; background: var(--c, var(--panel)); font-size: 13px; }
.ob-fcard.tint { background: var(--c); }
.ob-fcard.tint i { background: rgba(255, 255, 255, .75); }
.ob-fcard b { display: block; font-size: 13.5px; line-height: 1.1; }
.ob-fcard small { display: block; color: var(--muted); font-size: 11px; }
.ob-spark { position: absolute; width: 6px; height: 6px; border-radius: 50%; background: #fff; opacity: 0; box-shadow: 0 0 10px 2px rgba(255, 255, 255, .8); animation: ob-sparkle var(--t, 6s) ease-in infinite; animation-delay: var(--dl, 0s); }
.ob-bubble { position: absolute; left: 50%; bottom: 34px; transform: translateX(-50%); background: rgba(23, 23, 23, .88); color: #fff; border-radius: 18px; padding: 11px 16px; font-size: 13px; max-width: 80%; text-align: center; line-height: 1.4; box-shadow: 0 18px 30px -16px rgba(0, 0, 0, .5); }
.ob-bubble::before { content: "✦ "; color: #C9BEFF; }
.ob-bubble span { display: inline; animation: ob-swap .55s var(--spring); }
.ob-confetti { position: absolute; top: -20px; width: 9px; height: 14px; border-radius: 3px; animation: ob-fall 2.8s ease-in forwards; }

@keyframes ob-shine { to { background-position: 300% 0; } }
@keyframes ob-wave { 0%, 60%, 100% { transform: rotate(0); } 10%, 30% { transform: rotate(14deg); } 20% { transform: rotate(-8deg); } 40% { transform: rotate(-4deg); } }
@keyframes ob-pop { 40% { transform: scale(1.12); } }
@keyframes ob-sun { from { offset-distance: 8%; } to { offset-distance: 92%; } }
@keyframes ob-sheen { 60%, 100% { transform: translateX(100%); } }
@keyframes ob-drift { to { transform: translate(40px, 30px) scale(1.15); } }
@keyframes ob-ringspin { from { transform: translate(-50%, -50%) rotate(0); } to { transform: translate(-50%, -50%) rotate(360deg); } }
@keyframes ob-orbspin { to { rotate: 360deg; } }
@keyframes ob-morph { 0%, 100% { border-radius: 50%; } 25% { border-radius: 58% 42% 55% 45% / 45% 55% 45% 55%; } 50% { border-radius: 45% 55% 42% 58% / 55% 45% 58% 42%; } 75% { border-radius: 53% 47% 60% 40% / 40% 60% 47% 53%; } }
@keyframes ob-breathe { 50% { transform: scale(1.12); opacity: .6; } }
@keyframes ob-bob { 50% { transform: translateY(-8px); } }
@keyframes ob-facein { from { transform: scale(0) rotate(-40deg); } }
@keyframes ob-orbit { from { transform: rotate(var(--a)) translateX(var(--r)) rotate(calc(-1 * var(--a))); } to { transform: rotate(calc(var(--a) + 360deg)) translateX(var(--r)) rotate(calc(-1 * var(--a) - 360deg)); } }
@keyframes ob-cardin { from { opacity: 0; transform: translate(-50%, -50%) scale(.4); } }
@keyframes ob-float { 50% { margin-top: -8px; } }
@keyframes ob-sparkle { 0% { opacity: 0; transform: translateY(0) scale(.4); } 15% { opacity: 1; } 100% { opacity: 0; transform: translateY(-220px) scale(1.2); } }
@keyframes ob-swap { from { opacity: .2; } }
@keyframes ob-fall { to { transform: translateY(780px) rotate(720deg); opacity: .2; } }
```

- [ ] **Step 3: Typecheck, build, commit**

```bash
pnpm --filter @worksight/consumer typecheck && pnpm --filter @worksight/consumer exec electron-vite build
git add apps/consumer/src/renderer/components/OnboardingArt.tsx apps/consumer/src/renderer/styles.css
git commit -m "feat(consumer): onboarding living art (orb, orbiting cards, sparkles, confetti)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: typecheck exit 0; build succeeds (the component is not mounted yet — Task 4 does that).

### Task 4: Onboarding flow + App wiring (replaces Consent)

**Files:**
- Create: `apps/consumer/src/renderer/components/Onboarding.tsx`
- Modify: `apps/consumer/src/renderer/App.tsx`
- Delete: `apps/consumer/src/renderer/components/Consent.tsx`
- Modify: `apps/consumer/src/renderer/styles.css` (remove the old consent block)
- Modify: `apps/consumer/src/renderer/components/SettingsScreen.tsx` (props type only: accept `onRedo`)

**Interfaces:**
- Consumes: `api.profile.get/save`, `api.consent.grant` (Task 1); `DEFAULT_PROFILE`, `MAX_DISTRACTIONS`, `MAX_TEXT`, `ROLES`, `GOALS`, `Profile` (Task 1); `STEP_COUNT`, `ROLE_INFO`, `GOAL_INFO`, `DISTRACTION_CHOICES`, `cardsFor`, `bubbleFor`, `summaryFor` (Task 2); `OnboardingArt` (Task 3).
- Produces: `Onboarding({ mode: 'first' | 'redo'; initial: Profile; onDone(s: DaylensSettings): void; onCancel?: () => void })`. App passes `onRedo` to `SettingsScreen` (Task 5 adds the prop).

- [ ] **Step 1: Onboarding flow**

`apps/consumer/src/renderer/components/Onboarding.tsx`:

```tsx
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { DaylensSettings } from '../../main/settings';
import { GOALS, MAX_DISTRACTIONS, MAX_TEXT, ROLES, type Profile } from '../../shared/profileOptions';
import { api } from '../lib/api';
import { bubbleFor, cardsFor, DISTRACTION_CHOICES, GOAL_INFO, ROLE_INFO, STEP_COUNT, summaryFor } from '../lib/onboardingContent';
import { OnboardingArt } from './OnboardingArt';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

export function Onboarding({ mode, initial, onDone, onCancel }: {
  mode: 'first' | 'redo'; initial: Profile; onDone: (s: DaylensSettings) => void; onCancel?: () => void;
}) {
  const [step, setStep] = useState(0);
  const [a, setA] = useState<Profile>(initial);
  const [other, setOther] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const stepRef = useRef<HTMLElement>(null);
  const last = STEP_COUNT - 1;
  const isQuestion = step >= 1 && step < last;
  const shown = { ...a, name: a.name.trim() };

  const go = (n: number): void => { setError(null); setStep(Math.max(0, Math.min(last, n))); };

  useEffect(() => { // move focus into the new step (first input, else its heading)
    const el = stepRef.current;
    if (!el) return;
    const target = el.querySelector<HTMLElement>('input') ?? el.querySelector<HTMLElement>('h1');
    const t = setTimeout(() => target?.focus(), 350);
    return () => clearTimeout(t);
  }, [step]);

  const addOther = (): void => {
    const v = other.trim().replace(/\s+/g, ' ');
    setOther('');
    if (!v || a.distractions.length >= MAX_DISTRACTIONS || a.distractions.some((d) => d.toLowerCase() === v.toLowerCase())) return;
    setA({ ...a, distractions: [...a.distractions, v] });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const t = e.target as HTMLElement;
    if (e.key !== 'Enter' || step === last || t instanceof HTMLButtonElement || t.id === 'ob-other') return;
    e.preventDefault();
    go(step + 1);
  };

  const finish = async (): Promise<void> => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      let s = await api.profile.save(a);
      if (mode === 'first') s = await api.consent.grant(); // consent only when onboarding is finished
      setCelebrate(true);
      setTimeout(() => onDone(s), 1600);
    } catch (e) {
      console.error('[renderer] onboarding save failed:', e);
      setError("Couldn't save that. Check your answers and try again.");
      setSaving(false);
    }
  };

  const nav = (next: string, onNext: () => void = () => go(step + 1)) => (
    <div className="ob-nav">
      {step > 0 && <button className="btn s" onClick={() => go(step - 1)}>Back</button>}
      <button className="btn" onClick={onNext} disabled={saving}>{next}</button>
    </div>
  );

  const body = (): JSX.Element => {
    switch (step) {
      case 0:
        return (<>
          <p className="ob-kicker"><i style={{ background: 'var(--mint)' }}>☀</i>Welcome</p>
          <h1 tabIndex={-1}>See your day<br /><b>clearly.</b></h1>
          <p className="lead">Daylens quietly notices how you use your PC and nudges you toward healthier habits. First, a few quick questions so it can get to know you.</p>
          <div className="promise">
            <div><i style={{ background: 'var(--mint)' }}>🔒</i><span><b>Everything stays on this PC.</b> No account, no cloud, no uploads.</span></div>
            <div><i style={{ background: 'var(--lav)' }}>🪟</i><span>Records <b>which app and window</b> is in front, and for how long.</span></div>
            <div><i style={{ background: 'var(--pink)' }}>⌨️</i><span>Counts activity, <b>never what you type</b>.</span></div>
            <div><i style={{ background: 'var(--peach)' }}>🚀</i><span>Starts with Windows. Pause or turn it off any time in Settings.</span></div>
          </div>
          {nav(mode === 'redo' ? "Let's update your answers →" : "Let's get started →")}
        </>);
      case 1:
        return (<>
          <p className="ob-kicker"><i style={{ background: 'var(--lav)' }}>👋</i>About you</p>
          <h1 tabIndex={-1}>{shown.name ? <>Nice to meet you,<br /><b>{shown.name}</b> <span className="ob-wave">👋</span></> : <>What should I<br /><b>call you?</b></>}</h1>
          <div className="ob-field"><input aria-label="Your name" placeholder="Your first name" maxLength={MAX_TEXT} autoComplete="off" value={a.name} onChange={(e) => setA({ ...a, name: e.target.value })} /></div>
          <p className="ob-label">What do you mostly use this PC for? <span>Pick any</span></p>
          <div className="ob-chips">
            {ROLES.map((r) => (
              <button key={r} className="ob-chip" style={{ ['--c' as string]: ROLE_INFO[r].color }} aria-pressed={a.roles.includes(r)} onClick={() => setA({ ...a, roles: toggle(a.roles, r) })}>
                <span className="e">{ROLE_INFO[r].emoji}</span>{ROLE_INFO[r].label}
              </button>
            ))}
          </div>
          <p className="ob-why">💡 <span><b>Why I ask:</b> the same app means different things for different people. YouTube is <i>learning</i> for a student and <i>a break</i> for a developer.</span></p>
          {nav('Continue →')}
        </>);
      case 2:
        return (<>
          <p className="ob-kicker"><i style={{ background: 'var(--peach)' }}>🎯</i>Your goals</p>
          <h1 tabIndex={-1}>What should I<br /><b>help you with?</b></h1>
          <div className="ob-goals">
            {GOALS.map((g) => (
              <button key={g} className="ob-goal" style={{ ['--c' as string]: GOAL_INFO[g].color }} aria-pressed={a.goals.includes(g)} onClick={() => setA({ ...a, goals: toggle(a.goals, g) })}>
                <span className="e">{GOAL_INFO[g].emoji}</span><b>{GOAL_INFO[g].title}</b><small>{GOAL_INFO[g].sub}</small>
              </button>
            ))}
          </div>
          <p className="ob-why">💡 <span><b>Why I ask:</b> I'll nudge you most about what matters to you, and stay quiet about the rest.</span></p>
          {nav('Continue →')}
        </>);
      case 3:
        return (<>
          <p className="ob-kicker"><i style={{ background: 'var(--sky)' }}>🗓</i>Your rhythm</p>
          <h1 tabIndex={-1}>When are you<br /><b>at your desk?</b></h1>
          <div className="ob-arc" aria-hidden="true">
            <svg viewBox="0 0 520 74" preserveAspectRatio="none">
              <path d="M10 70 Q260 -40 510 70" fill="none" stroke="rgba(23,23,23,.15)" strokeWidth="2" strokeDasharray="5 6" />
              <g className="ob-sun" style={{ offsetPath: "path('M10 70 Q260 -40 510 70')" }}><circle r="17" fill="rgba(255,209,154,.35)" /><circle r="11" fill="#FFD19A" /></g>
            </svg>
          </div>
          <div className="ob-sched">
            <div className="ob-tcard" style={{ background: 'var(--peach)' }}><span className="e">☀️</span><label htmlFor="ob-start">I usually start at</label>
              <input id="ob-start" type="time" value={a.start} onChange={(e) => { if (e.target.value) setA({ ...a, start: e.target.value }); }} /></div>
            <div className="ob-tcard" style={{ background: 'var(--lav)' }}><span className="e">🌙</span><label htmlFor="ob-bed">I'd like to log off by</label>
              <input id="ob-bed" type="time" value={a.bed} onChange={(e) => { if (e.target.value) setA({ ...a, bed: e.target.value }); }} /></div>
          </div>
          <p className="ob-label">Days I'm usually on</p>
          <div className="ob-days">
            {DAYS.map((d, i) => (
              <button key={d} className="ob-day" aria-label={d} aria-pressed={a.days.includes(i + 1)} onClick={() => setA({ ...a, days: toggle(a.days, i + 1).sort((x, y) => x - y) })}>{d[0]}</button>
            ))}
          </div>
          <p className="ob-why">💡 <span><b>Why I ask:</b> sets your wind-down reminder and tells me when focus matters most.</span></p>
          {nav('Continue →')}
        </>);
      case 4:
        return (<>
          <p className="ob-kicker"><i style={{ background: 'var(--pink)' }}>🧲</i>Honest moment</p>
          <h1 tabIndex={-1}>What pulls you<br /><b>away the most?</b></h1>
          <p className="lead" style={{ marginBottom: 14 }}>No judgement. I'll just keep a gentle eye on these for you.</p>
          <div className="ob-chips">
            {DISTRACTION_CHOICES.map((d) => (
              <button key={d.label} className="ob-chip" style={{ ['--c' as string]: 'var(--pink)' }} aria-pressed={a.distractions.includes(d.label)}
                disabled={!a.distractions.includes(d.label) && a.distractions.length >= MAX_DISTRACTIONS}
                onClick={() => setA({ ...a, distractions: toggle(a.distractions, d.label) })}>
                <span className="e">{d.emoji}</span>{d.label}
              </button>
            ))}
            {a.distractions.filter((d) => !DISTRACTION_CHOICES.some((c) => c.label === d)).map((d) => (
              <button key={d} className="ob-chip" style={{ ['--c' as string]: 'var(--pink)' }} aria-pressed onClick={() => setA({ ...a, distractions: a.distractions.filter((x) => x !== d) })}>
                <span className="e">✳️</span>{d}
              </button>
            ))}
          </div>
          <div className="ob-field small" style={{ maxWidth: 360 }}>
            <input id="ob-other" aria-label="Add another distraction" placeholder="Something else? Type and press Enter" maxLength={MAX_TEXT}
              disabled={a.distractions.length >= MAX_DISTRACTIONS} value={other} onChange={(e) => setOther(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addOther(); } }} />
          </div>
          <p className="ob-why">💡 <span><b>Why I ask:</b> I'll flag long scrolls on these and can set soft limits later.</span></p>
          {nav('Continue →')}
        </>);
      default:
        return (<>
          <p className="ob-kicker"><i style={{ background: 'var(--mint)' }}>✨</i>All set</p>
          <h1 tabIndex={-1}>You're all set,<br /><b>{shown.name || 'friend'}.</b></h1>
          <p className="lead" style={{ marginBottom: 14 }}>Here's what I learned about you. You can change any of this in Settings.</p>
          <div className="ob-summary">
            {summaryFor(a).map((r) => (
              <div key={r.icon} className="ob-sum"><i style={{ background: r.color }}>{r.icon}</i><span>{r.text}{r.strong && <> <b>{r.strong}</b></>}</span></div>
            ))}
          </div>
          {error && <p className="ob-error" role="alert">{error}</p>}
          {nav(mode === 'redo' ? 'Save my answers ✨' : 'Start my day ✨', () => { void finish(); })}
        </>);
    }
  };

  return (
    <div className="ob" onKeyDown={onKeyDown}>
      <div className="ob-left">
        <div className="ob-progress">
          <div className="ob-track"><div style={{ width: `${((step + 1) / STEP_COUNT) * 100}%` }} /></div>
          <span className="ob-stepno">{step + 1} of {STEP_COUNT}</span>
          {isQuestion && <button className="ob-link" onClick={() => go(step + 1)}>Skip this question</button>}
          {mode === 'redo' && onCancel && <button className="ob-link" onClick={onCancel}>Cancel</button>}
        </div>
        <section className="ob-step" key={step} ref={stepRef}>{body()}</section>
      </div>
      <OnboardingArt step={step} cards={cardsFor(step, shown)} bubble={bubbleFor(step, shown)} celebrate={celebrate} />
    </div>
  );
}
```

Note: if TypeScript reports `Cannot find namespace 'JSX'` (React 19 types), add `import type { JSX } from 'react';` as Icon.tsx does.

- [ ] **Step 2: App wiring**

Replace `apps/consumer/src/renderer/App.tsx` with:

```tsx
import { useEffect, useState } from 'react';
import type { DaylensSettings } from '../main/settings';
import { DEFAULT_PROFILE, type Profile } from '../shared/profileOptions';
import { api } from './lib/api';
import { TitleBar } from './components/TitleBar';
import { Rail, type Route } from './components/Rail';
import { Onboarding } from './components/Onboarding';
import { TodayScreen } from './components/TodayScreen';
import { SettingsScreen } from './components/SettingsScreen';

type OnboardingState = { mode: 'first' | 'redo'; initial: Profile };

export default function App() {
  const [settings, setSettings] = useState<DaylensSettings | null>(null);
  const [route, setRoute] = useState<Route>('today');
  const [onboarding, setOnboarding] = useState<OnboardingState | null>(null);

  useEffect(() => {
    const load = (): void => { api.settings.get().then(setSettings).catch((e) => console.error('[renderer] settings.get failed:', e)); };
    load();
    return api.onUpdate(load); // tray pause/resume
  }, []);

  const needsFirstRun = settings !== null && !settings.consentGranted;
  useEffect(() => {
    if (!needsFirstRun || onboarding) return;
    api.profile.get()
      .then((p) => setOnboarding({ mode: 'first', initial: p }))
      .catch((e) => { console.error('[renderer] profile.get failed:', e); setOnboarding({ mode: 'first', initial: DEFAULT_PROFILE }); });
  }, [needsFirstRun, onboarding]);

  const redo = (): void => {
    api.profile.get()
      .then((p) => setOnboarding({ mode: 'redo', initial: p }))
      .catch((e) => console.error('[renderer] profile.get failed:', e));
  };

  if (!settings) return <TitleBar tracking={null} />;
  if (onboarding) {
    const { mode, initial } = onboarding;
    return (
      <>
        <TitleBar tracking={settings.consentGranted ? !settings.trackingPaused : null} />
        <Onboarding mode={mode} initial={initial}
          onDone={(s) => { setSettings(s); setRoute(mode === 'redo' ? 'settings' : 'today'); setOnboarding(null); }}
          onCancel={mode === 'redo' ? () => setOnboarding(null) : undefined} />
      </>
    );
  }
  if (!settings.consentGranted) return <TitleBar tracking={null} />;
  return (
    <>
      <TitleBar tracking={!settings.trackingPaused} />
      <div className={`shell${route === 'settings' ? ' wide' : ''}`}>
        <Rail route={route} onNavigate={setRoute} />
        {route === 'today' ? <TodayScreen settings={settings} /> : <SettingsScreen settings={settings} onChange={setSettings} onRedo={redo} />}
      </div>
    </>
  );
}
```

In `apps/consumer/src/renderer/components/SettingsScreen.tsx` change only the signature line to

```tsx
export function SettingsScreen({ settings, onChange }: { settings: DaylensSettings; onChange: (s: DaylensSettings) => void; onRedo: () => void }) {
```

so App typechecks; Task 5 destructures and uses `onRedo`.

- [ ] **Step 3: Remove the old consent screen**

```bash
git rm apps/consumer/src/renderer/components/Consent.tsx
```

In `apps/consumer/src/renderer/styles.css` delete the old consent block: the comment `/* consent (onboarding step 1 look) */` and the rules `.consent`, `.consent-l`, `.consent-l > *`, `.consent-l h1`, `.consent-l h1 b`, `.consent-r`, `.orb`, `.float`, `.float b`. Keep `.lead`, `.promise*` and `.btn*` (used by onboarding/settings). Then delete any `@keyframes` no longer referenced — check with:

```bash
for k in $(grep -oE "@keyframes [a-z-]+" apps/consumer/src/renderer/styles.css | awk '{print $2}'); do n=$(grep -cE "animation[^;]*\b$k\b" apps/consumer/src/renderer/styles.css); echo "$k $n"; done
```

Remove every keyframe whose count is 0 (expected: `spin` and `bob`, formerly used by `.orb`/`.float`). Re-run the loop; every keyframe must show ≥ 1.

- [ ] **Step 4: Verify**

```bash
pnpm --filter @worksight/consumer typecheck && pnpm --filter @worksight/consumer test && pnpm --filter @worksight/consumer exec electron-vite build
```

Then start `pnpm --filter @worksight/consumer dev` in the background, wait ~40 s, confirm the log shows a clean start (no errors, no CSP violations), and kill the whole process tree (Git Bash: find the WINPID with `ps -W`, then `taskkill //F //T //PID <winpid>`); confirm no electron.exe from this run remains. Do not delete `%APPDATA%/Daylens` data.

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add -A apps/consumer/src/renderer
git commit -m "feat(consumer): 6-step animated onboarding with profile questions (replaces consent screen)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: Today greeting + Settings "About you"

**Files:**
- Modify: `apps/consumer/src/renderer/components/TodayScreen.tsx`
- Modify: `apps/consumer/src/renderer/components/SettingsScreen.tsx`
- Modify: `apps/consumer/src/renderer/styles.css`

**Interfaces:**
- Consumes: `greeting` (Task 2), `profileSummary` (Task 2), `api.profile.get/save` (Task 1), `MAX_TEXT`, `Profile` (Task 1); `onRedo` passed by App (Task 4).
- Produces: `SettingsScreen({ settings, onChange, onRedo })`.

- [ ] **Step 1: Greeting on Today**

In `apps/consumer/src/renderer/components/TodayScreen.tsx` add `greeting` to the `../lib/format` import, and replace:

```tsx
        <p className="date">{dateLabel}{view.firstSeenAt !== null && ` · first on screen at ${formatClock(view.firstSeenAt)}`}</p>
```

with:

```tsx
        <p className="date">
          {greeting(new Date(view.now).getHours(), settings.profileName) && `${greeting(new Date(view.now).getHours(), settings.profileName)} · `}
          {dateLabel}{view.firstSeenAt !== null && ` · first on screen at ${formatClock(view.firstSeenAt)}`}
        </p>
```

- [ ] **Step 2: "About you" in Settings**

In `apps/consumer/src/renderer/components/SettingsScreen.tsx`:

1. Imports — add:

```tsx
import { MAX_TEXT, type Profile } from '../../shared/profileOptions';
import { profileSummary } from '../lib/onboardingContent';
```

2. Change the signature to:

```tsx
export function SettingsScreen({ settings, onChange, onRedo }: { settings: DaylensSettings; onChange: (s: DaylensSettings) => void; onRedo: () => void }) {
```

3. Add this state/logic right after the `toggleTracking` function:

```tsx
  const [profile, setProfile] = useState<Profile | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api.profile.get()
      .then((p) => { if (alive) { setProfile(p); setNameDraft(p.name); } })
      .catch((e) => console.error('[renderer] profile.get failed:', e));
    return () => { alive = false; };
  }, [settings.profileName, settings.profileRoles, settings.profileGoals, settings.profileDistractions, settings.windDownTime]);

  const saveName = async (): Promise<void> => {
    if (!profile || nameDraft.trim().replace(/\s+/g, ' ') === profile.name) return;
    try {
      onChange(await api.profile.save({ ...profile, name: nameDraft }));
      setNameError(null);
    } catch (err) {
      console.error(err);
      setNameError('Names can be up to 40 characters, without special control characters.');
      setNameDraft(profile.name);
    }
  };
```

4. Insert this group as the FIRST child after `<h1>Settings</h1>`:

```tsx
      <div className="grp">
        <h4>About you</h4>
        <div className="srow">
          <p>Your name<small>Used to greet you on the Today screen.</small></p>
          <input type="text" aria-label="Your name" placeholder="Your first name" maxLength={MAX_TEXT} value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)} onBlur={() => { void saveName(); }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        </div>
        {nameError && <p className="srow-error" role="alert">{nameError}</p>}
        <div className="srow">
          <p>What Daylens knows about you<small>{profileSummary(profile)}</small></p>
          <button className="btn s" onClick={onRedo}>Redo the questions</button>
        </div>
      </div>
```

In `apps/consumer/src/renderer/styles.css` change the selector `.srow input[type=time], .srow select` to `.srow input[type=time], .srow input[type=text], .srow select`, and add below it:

```css
.srow input[type=text] { width: 220px; }
.srow-error { color: #B42318; font-size: 12.5px; padding: 0 0 10px; }
```

- [ ] **Step 3: Verify**

```bash
pnpm --filter @worksight/consumer typecheck && pnpm --filter @worksight/consumer test && pnpm --filter @worksight/consumer exec electron-vite build
```

Then the same ~40 s background dev launch + clean-log check + process-tree kill as Task 4.

- [ ] **Step 4: Commit**

```bash
git add apps/consumer/src/renderer
git commit -m "feat(consumer): greet by name on Today; About you + redo in Settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: Verification and visual check

**Files:** none committed (a temporary preview harness is created and deleted).

- [ ] **Step 1: Everything green**

```bash
pnpm test && pnpm --filter @worksight/consumer typecheck && pnpm --filter @worksight/consumer exec electron-vite build
```

Expected: core, agent and consumer tests pass; typecheck exit 0; build succeeds.

- [ ] **Step 2: Screenshots against the mockup**

Create a temporary `apps/consumer/preview.html` + `apps/consumer/vite.preview.config.mjs` (the same approach as the Phase 2 visual check: a fake `window.daylens` with `settings.consentGranted: false`, `profile.get` → defaults, `profile.save` → echo, `consent.grant` → settings with consent), serve with `npx vite --config vite.preview.config.mjs` (port 5199), and capture headless Edge screenshots (1280×860, `--virtual-time-budget=5000`) of: the welcome step; step 2 after scripted input (the harness script clicks "Let's get started", types a name, clicks two role chips); and the summary step. Compare with `docs/superpowers/specs/assets/daylens-mockups/onboarding-v2.html`. Delete both temporary files and stop the server afterwards; `git status` must show nothing new.

- [ ] **Step 3: Manual checks (human)**

On a fresh profile (delete `%APPDATA%\Daylens\daylens.sqlite*` only if the human agrees): quitting mid-onboarding leaves consent off and records nothing; finishing starts tracking and shows "Good …, {name}" on Today; Settings → Redo the questions opens pre-filled, Cancel returns without changes, and saving keeps tracking/consent untouched; a log-off time of 00:30 changes Settings → Wind down after to 00:30.
