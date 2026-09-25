# Daylens Phase 4 — Laya Labelling, Model Download, Screen-Reading Opt-in — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Label stored screen reads with the local Laya model in short-lived batch processes, drive Today's categories from those labels, download the model from Hugging Face, and ask users to opt in to screen reading.

**Architecture:** Pure/tested modules: `brain/questions.ts` (question wording), `screen/labels.ts` (label storage), `brain/protocol.ts` + `brain/label.ts` (Brain messages and per-read labelling), `brain/scheduler.ts` (when to run a batch, retries), `models/downloader.ts` (resumable, hash-checked download), and a Today-view change. `brain/worker.ts` is a thin `utilityProcess` entry; `main/index.ts` wires everything; renderer adds an onboarding step, a Today prompt/banner and an "AI model" Settings group.

**Tech Stack:** Electron 33 (`utilityProcess`), electron-vite 2, React 19, TypeScript 5.7, zod 3, better-sqlite3, onnxruntime-node 1.21, @huggingface/transformers 3, Vitest 2, Node `fetch`/`http`/`crypto`.

**Spec:** `docs/superpowers/specs/2026-09-25-daylens-phase4-laya-labelling-design.md` (extends `2026-09-23-daylens-consumer-app-design.md` and `2026-09-24-daylens-phase3-screen-reader-design.md`).

## Global Constraints

- Branch `feat/daylens-phase4`. Every commit message ends with a blank line then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (subagents may use their own model name). Never stage `.codex/` or `apps/consumer/.models/`.
- Windows + Git Bash; run commands from the repo root. Tests: `pnpm --filter @worksight/consumer test`. If its `pretest` fails with EPERM, a Daylens dev window is open: never kill it. Run instead `cd apps/consumer && ELECTRON_RUN_AS_NODE=1 ../../node_modules/electron/dist/electron.exe ../../node_modules/vitest/vitest.mjs run [path]`. Typecheck: `pnpm --filter @worksight/consumer typecheck`. Build: `pnpm --filter @worksight/consumer exec electron-vite build`.
- Never print OCR/screen text in tooling output. Never kill processes you did not start.
- Anything that loads the real model (~2 GB RAM) runs only by hand, and only when free RAM > 3 GB (check: `powershell -NoProfile -Command "[math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB,1)"`).
- Labels: `category`/`activity` = Laya choice, or `uncertain` when confidence < **0.5** (`CONFIDENT`); confidence stored in `category_conf`/`activity_conf`; `stuck`/`distraction` = expected score 0..2.
- Batching: tick every **60 s**; run when model ready AND (≥ **20** unlabelled OR oldest unlabelled ≥ **10 min**); ≤ **50** reads per batch; batch timeout **120 s**; failure backoff **1 s → 5 s → 30 s**; **> 3 failures in 10 min → paused** until Retry/restart. Backlog guard: while labelling can't run and > **20** unlabelled → reader skips captures (`skipped-backlog`).
- Dedup rows (`text IS NULL`, `text_hash <> ''`) copy labels from the latest earlier labelled read with the same hash; purged rows (`text IS NULL AND text_hash = ''`) get `labeled_at` with NULL labels.
- Today: a focus-session piece's category = most frequent confident Laya category among that app's reads inside the piece, else `categoryForApp` (never shows `uncertain`).
- Model: HF repo `aaronalexS/daylens-laya-onnx`, 4 files with exact sizes/SHA-256 (Task 6); download to `<file>.part` with Range, verify size + SHA-256, rename; bad hash → retry once → `error bad_hash`; free space must be ≥ remaining + 500 MB else `error no_space`; network retry 5 s → 30 s → 2 min → every 10 min; stop keeps `.part`. Dir `userData/models/laya`, env `DAYLENS_MODEL_DIR` overrides.
- Opt-in: onboarding step "Let Daylens understand your screen?" off by default, skippable; `screenReadingAsked` (default false); existing users see a one-time Today card (Turn on / Not now); turning screen reading on anywhere sets `screenReadingAsked = true`.
- Accuracy gate: ≥ **80 %** (Laya + app tie-breaker) on all samples combined, hold-out ≤ **10 points** below tuning; at most **5** wording rounds, then ship best and record as accepted risk.

## Review Focus

1. **Brain posts results then exits quickly** (race between `message` and `exit`) — a successful batch must not be counted as a crash. → test in Task 5.
2. **Screen reading turned off mid-download, then on again** — download resumes from the `.part` file (Range), no restart from zero. → test in Task 6.
3. **A duplicate read whose original is still unlabelled** — stays unlabelled (no NULL-label copy), then gets labels once the original is labelled. → test in Task 3.
4. **Model not downloaded yet while reading is on** — reads pile up to 20, then the reader stops capturing instead of growing an unbounded queue; labelling resumes when the model is ready. → tests in Tasks 5 and 3.
5. **Existing user who already enabled screen reading in Phase 3** — must not be nagged by the Today card. → test in Task 10 (`shouldAskScreenReading`) + wiring in Task 8 (settings:set with `screenReading: true` sets `screenReadingAsked`), and a migration rule: `screenReadingAsked` is treated as true when `screenReading` is already true.

---

### Task 1: Question module and accuracy harness

**Files:**
- Create: `apps/consumer/src/main/brain/questions.ts`, `apps/consumer/src/main/brain/questions.test.ts`
- Create: `apps/consumer/src/main/brain/evalScore.ts`, `apps/consumer/src/main/brain/evalScore.test.ts`
- Create: `apps/consumer/src/main/brain/laya.eval.test.ts`
- Create: `tools/laya/samples.holdout.jsonl`
- Modify: `apps/consumer/package.json` (script `test:eval`)

**Interfaces:**
- Consumes: `LayaQuestion`, `loadLaya`, `layaState` (`src/main/brain/laya.ts`); `CATEGORIES`, `categoryForApp` (`src/shared/categories.ts`).
- Produces: `QUESTIONS: Record<'category'|'activity'|'stuck'|'distraction', LayaQuestion>`, `CONFIDENT = 0.5`; `finalCategory(choice: string, confidence: number, app: string): string`, `scoreRun(rows: EvalRow[]): EvalScore`, types `EvalRow { id: number; expected: string; choice: string; confidence: number; app: string }`, `EvalScore { n: number; layaAcc: number; finalAcc: number; confusion: Record<string, Record<string, number>> }`.

- [ ] **Step 1: Failing tests**

`apps/consumer/src/main/brain/questions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CATEGORIES } from '../../shared/categories';
import { CONFIDENT, QUESTIONS } from './questions';

describe('QUESTIONS', () => {
  it('asks the four spec questions', () => {
    expect(Object.keys(QUESTIONS).sort()).toEqual(['activity', 'category', 'distraction', 'stuck']);
    expect(CONFIDENT).toBe(0.5);
  });
  it('category options are exactly the app categories, each with criteria text', () => {
    const q = QUESTIONS.category;
    expect(q.type).toBe('choice');
    const crit = q.criteria as Record<string, string>;
    expect(Object.keys(crit).sort()).toEqual([...CATEGORIES].sort());
    for (const c of CATEGORIES) expect(crit[c].length).toBeGreaterThan(10);
  });
  it('scores have three levels', () => {
    expect(QUESTIONS.stuck.criteria).toHaveLength(3);
    expect(QUESTIONS.distraction.criteria).toHaveLength(3);
  });
});
```

`apps/consumer/src/main/brain/evalScore.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { finalCategory, scoreRun, type EvalRow } from './evalScore';

describe('finalCategory', () => {
  it('keeps confident Laya choices and falls back to the app rule when unsure', () => {
    expect(finalCategory('social', 0.8, 'Google Chrome')).toBe('social');
    expect(finalCategory('entertainment', 0.2, 'Microsoft Teams')).toBe('communication');
    expect(finalCategory('entertainment', 0.2, 'Google Chrome')).toBe('other');
  });
});

describe('scoreRun', () => {
  it('computes Laya-only and final accuracy plus a confusion table', () => {
    const rows: EvalRow[] = [
      { id: 1, expected: 'work', choice: 'work', confidence: 0.9, app: 'Visual Studio Code' },
      { id: 2, expected: 'communication', choice: 'entertainment', confidence: 0.1, app: 'Microsoft Teams' },
      { id: 3, expected: 'social', choice: 'entertainment', confidence: 0.7, app: 'Google Chrome' },
      { id: 4, expected: 'learning', choice: 'learning', confidence: 0.3, app: 'Google Chrome' }
    ];
    const s = scoreRun(rows);
    expect(s.n).toBe(4);
    expect(s.layaAcc).toBeCloseTo(0.5);
    expect(s.finalAcc).toBeCloseTo(0.5); // row 2 fixed by the app rule, row 4 lost to it
    expect(s.confusion.social.entertainment).toBe(1);
    expect(s.confusion.work.work).toBe(1);
  });
  it('handles an empty run', () => {
    expect(scoreRun([])).toEqual({ n: 0, layaAcc: 0, finalAcc: 0, confusion: {} });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @worksight/consumer test`
Expected: FAIL — cannot resolve `./questions`, `./evalScore`.

- [ ] **Step 3: Implement**

`apps/consumer/src/main/brain/questions.ts` (baseline = current `tools/laya/questions.json` wording; Task 2 tunes `category`):

```ts
import type { LayaQuestion } from './laya';

/** Choices below this confidence are stored as 'uncertain' and never drive the UI or rules. */
export const CONFIDENT = 0.5;

// Single source of truth for what the Brain asks. Only `category` wording is tuned (Task 2 of Phase 4).
export const QUESTIONS: Record<'category' | 'activity' | 'stuck' | 'distraction', LayaQuestion> = {
  category: {
    type: 'choice',
    instructions: 'Which kind of activity is the user doing on this screen?',
    criteria: {
      work: 'job or study tasks: coding, documents, spreadsheets, design, admin',
      learning: 'tutorials, documentation, courses, educational videos',
      social: 'social media feeds, personal messaging, forums',
      entertainment: 'videos, streaming, games, memes, music for fun',
      communication: 'email, work chat, calendars, meetings',
      other: 'system settings, file management, shopping, anything else'
    }
  },
  activity: {
    type: 'choice',
    instructions: 'What is the user doing right now?',
    criteria: ['coding', 'writing', 'reading', 'watching', 'scrolling', 'chatting', 'designing', 'gaming', 'browsing', 'other']
  },
  stuck: {
    type: 'score',
    instructions: 'How stuck or blocked does the user appear on their current task?',
    criteria: ['working smoothly', 'minor friction, searching for answers', 'visible errors, failures or repeated attempts']
  },
  distraction: {
    type: 'score',
    instructions: 'How distracting is this screen compared with focused work?',
    criteria: ['on-task', 'mild detour', 'infinite feed, autoplay, clickbait or unrelated to work']
  }
};
```

`apps/consumer/src/main/brain/evalScore.ts`:

```ts
import { categoryForApp } from '../../shared/categories';
import { CONFIDENT } from './questions';

export interface EvalRow { id: number; expected: string; choice: string; confidence: number; app: string; }
export interface EvalScore { n: number; layaAcc: number; finalAcc: number; confusion: Record<string, Record<string, number>>; }

/** What Today would show: a confident Laya choice, else the app-name rule (same logic as the Today view). */
export function finalCategory(choice: string, confidence: number, app: string): string {
  return confidence >= CONFIDENT ? choice : categoryForApp(app);
}

export function scoreRun(rows: EvalRow[]): EvalScore {
  const confusion: Record<string, Record<string, number>> = {};
  let laya = 0, fin = 0;
  for (const r of rows) {
    if (r.choice === r.expected) laya++;
    if (finalCategory(r.choice, r.confidence, r.app) === r.expected) fin++;
    const row = (confusion[r.expected] ??= {});
    row[r.choice] = (row[r.choice] ?? 0) + 1;
  }
  const n = rows.length;
  return { n, layaAcc: n ? laya / n : 0, finalAcc: n ? fin / n : 0, confusion };
}
```

`tools/laya/samples.holdout.jsonl` (24 new hand-written samples, never used for tuning):

```jsonl
{"id":101,"app":"Discord","title":"#general | Weekend Raid - Discord","text":"mike: anyone on tonight? sara: yeah after dinner lol jay: bringing snacks this time I promise","expect_category":"social"}
{"id":102,"app":"WhatsApp","title":"WhatsApp","text":"Mum: Did you eat? You: yes ma Priya: pics from the wedding are up!! Mum: call me when free","expect_category":"social"}
{"id":103,"app":"Google Chrome","title":"(3) Home / X - Google Chrome","text":"For you Following Trending: #WorldCup elonmusk replied 2h 14K likes Show more posts What's happening","expect_category":"social"}
{"id":104,"app":"Google Chrome","title":"r/pcmasterrace - Reddit - Google Chrome","text":"Posted by u/techguy 5h Finally finished my build! 2.1k upvotes 340 comments Share Join Hot New Top","expect_category":"social"}
{"id":105,"app":"Google Chrome","title":"Instagram - Google Chrome","text":"Home Search Explore Reels Messages Notifications liked by priya_s and 1,204 others View all 88 comments","expect_category":"social"}
{"id":106,"app":"Microsoft Teams","title":"Chat | Design Sync | Microsoft Teams","text":"Rahul: can we move the review to 3pm? You: works for me. Anna: I'll update the invite and share the deck","expect_category":"communication"}
{"id":107,"app":"Slack","title":"#eng-backend - Acme - Slack","text":"deploy bot: v2.14 deployed to staging ken: PR #482 needs one more approver lisa: on it, reviewing now","expect_category":"communication"}
{"id":108,"app":"Google Chrome","title":"Inbox (12) - aaron@company.com - Gmail - Google Chrome","text":"Compose Inbox Starred Sent Q3 planning - please review by Friday Invoice #2231 from Vendor Re: onboarding checklist","expect_category":"communication"}
{"id":109,"app":"Microsoft Outlook","title":"Calendar - Outlook","text":"Today Mon 25 9:30 Standup 11:00 1:1 with Priya 14:00 Client call - Zoom link New event Accept Decline","expect_category":"communication"}
{"id":110,"app":"Zoom Workplace","title":"Zoom Meeting","text":"Mute Stop Video Participants (6) Share Screen Record Reactions Leave You are screen sharing Recording...","expect_category":"communication"}
{"id":111,"app":"Google Chrome","title":"Funniest Cat Fails 2026 - YouTube - Google Chrome","text":"1.2M views 3 days ago Subscribe Up next: Try Not To Laugh Challenge Autoplay 12:44 Shorts","expect_category":"entertainment"}
{"id":112,"app":"Netflix","title":"Netflix","text":"Continue Watching for Aaron Episode 4 Top 10 in India Today Because you watched Dark Play Resume 38m left","expect_category":"entertainment"}
{"id":113,"app":"Google Chrome","title":"xQc - Twitch - Google Chrome","text":"LIVE 54,210 viewers Stream chat KEKW PogChamp Follow Subscribe Just Chatting Hype Train level 3","expect_category":"entertainment"}
{"id":114,"app":"Spotify","title":"Spotify Premium","text":"Home Search Your Library Daily Mix 2 Now playing: Blinding Lights The Weeknd 2:14 / 3:20 Shuffle Repeat","expect_category":"entertainment"}
{"id":115,"app":"Valorant","title":"VALORANT","text":"ROUND 11 ATTACKERS WIN 7 - 4 Jett eliminated Sova Spike planted 0:35 Buy phase Credits 3900","expect_category":"entertainment"}
{"id":116,"app":"Google Chrome","title":"React Hooks Tutorial for Beginners - YouTube - Google Chrome","text":"Learn useState and useEffect step by step Chapters 0:00 Intro 4:12 useState 18:30 useEffect Code along","expect_category":"learning"}
{"id":117,"app":"Google Chrome","title":"Course: Machine Learning Specialization | Coursera - Google Chrome","text":"Week 2 Gradient descent for multiple linear regression Video 12 min Quiz: Practice lab Next item","expect_category":"learning"}
{"id":118,"app":"Microsoft Edge","title":"Array.prototype.map() - JavaScript | MDN - Microsoft Edge","text":"The map() method of Array instances creates a new array populated with the results of calling a provided function Syntax Parameters Examples","expect_category":"learning"}
{"id":119,"app":"Anki","title":"Japanese N4 - Anki","text":"Front: 勉強 Show Answer Back: べんきょう study Again Hard Good Easy Due today 42 New 10","expect_category":"learning"}
{"id":120,"app":"Google Chrome","title":"Khan Academy | Integration by parts - Google Chrome","text":"Practice: Integration by parts Question 3 of 7 Check Get help Watch a video Mastery points","expect_category":"learning"}
{"id":121,"app":"Google Chrome","title":"Pull request #482 · acme/api - GitHub - Google Chrome","text":"Files changed 7 Conversation Commits src/routes/users.ts + const limit = parseInt(req.query.limit) Approve Request changes","expect_category":"work"}
{"id":122,"app":"Microsoft Word","title":"Proposal_v3.docx - Word","text":"Executive summary This proposal outlines the migration plan for Q4 including timelines budget and risks Home Insert Layout Review","expect_category":"work"}
{"id":123,"app":"File Explorer","title":"Downloads - File Explorer","text":"Name Date modified Type Size setup.exe invoice.pdf photos.zip Sort View This PC Quick access","expect_category":"other"}
{"id":124,"app":"Google Chrome","title":"Amazon.in : wireless earbuds - Google Chrome","text":"Results Sort by: Featured boAt Airdopes 4.1 out of 5 stars Rs 1,299 Add to cart Deliver to Aaron","expect_category":"other"}
```

`apps/consumer/src/main/brain/laya.eval.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { layaState, loadLaya } from './laya';
import { QUESTIONS } from './questions';
import { scoreRun, type EvalRow } from './evalScore';

const here = fileURLToPath(new URL('.', import.meta.url));
const MODEL_DIR = process.env.LAYA_DIR ?? join(here, '../../../.models/laya');
const TOOLS = join(here, '../../../../../tools/laya');
// Opt-in only (loads the 1.7 GB model): `pnpm --filter @worksight/consumer test:eval` or LAYA_EVAL=1.
const optedIn = !!process.env.LAYA_EVAL || process.env.npm_lifecycle_event === 'test:eval';
const have = optedIn && existsSync(join(MODEL_DIR, 'laya.onnx'));
const GATE = 0.8; // Phase 4 spec §3.3; lower only as a recorded accepted risk (tools/laya/SPIKE-RESULTS.md)

type Sample = { id: number; app: string; title: string | null; text: string; expect_category: string };
const load = (f: string): Sample[] => readFileSync(join(TOOLS, f), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as Sample);

describe.skipIf(!have)('Laya category accuracy (tuning + hold-out)', () => {
  it('meets the gate with the app-name tie-breaker', async () => {
    const laya = await loadLaya(MODEL_DIR);
    const run = async (samples: Sample[]): Promise<EvalRow[]> => {
      const rows: EvalRow[] = [];
      for (const s of samples) {
        const a = (await laya.ask(layaState(s.app, s.title, s.text), { category: QUESTIONS.category })).category;
        if (a.type !== 'choice') throw new Error('category must be a choice');
        rows.push({ id: s.id, expected: s.expect_category, choice: a.choice, confidence: a.confidence, app: s.app });
      }
      return rows;
    };
    const tune = await run(load('samples.jsonl'));
    const hold = await run(load('samples.holdout.jsonl'));
    const t = scoreRun(tune), h = scoreRun(hold), all = scoreRun([...tune, ...hold]);
    const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
    // Metadata only: ids, labels and confidences — never screen text.
    console.log(`[laya eval] tuning laya ${pct(t.layaAcc)} final ${pct(t.finalAcc)} | holdout laya ${pct(h.layaAcc)} final ${pct(h.finalAcc)} | all final ${pct(all.finalAcc)}`);
    console.log('[laya eval] confusion (expected -> got):', JSON.stringify(all.confusion));
    console.log('[laya eval] wrong:', [...tune, ...hold].filter((r) => r.choice !== r.expected).map((r) => `${r.id}:${r.expected}->${r.choice}@${r.confidence.toFixed(2)}`).join(' '));
    expect(all.finalAcc).toBeGreaterThanOrEqual(GATE);
    expect(t.finalAcc - h.finalAcc).toBeLessThanOrEqual(0.1);
  }, 900_000);
});
```

In `apps/consumer/package.json` scripts add after `test:parity`:

```json
    "test:eval": "vitest run src/main/brain/laya.eval.test.ts",
```

- [ ] **Step 4: Run tests, typecheck**

Run: `pnpm --filter @worksight/consumer test && pnpm --filter @worksight/consumer typecheck`
Expected: PASS; `laya.eval.test.ts` shows as skipped.

- [ ] **Step 5: Commit**

```bash
git add apps/consumer/src/main/brain/questions.ts apps/consumer/src/main/brain/questions.test.ts apps/consumer/src/main/brain/evalScore.ts apps/consumer/src/main/brain/evalScore.test.ts apps/consumer/src/main/brain/laya.eval.test.ts tools/laya/samples.holdout.jsonl apps/consumer/package.json
git commit -m "feat(consumer): Laya question module and opt-in accuracy harness with hold-out set

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: Category wording rounds (manual, RAM-gated)

**Files:**
- Modify: `apps/consumer/src/main/brain/questions.ts` (category `instructions`/`criteria` only)
- Modify: `tools/laya/SPIKE-RESULTS.md` (append a "Phase 4 wording" section)
- Modify (only if the gate is not met after 5 rounds): `apps/consumer/src/main/brain/laya.eval.test.ts` (`GATE` constant, with a comment pointing at SPIKE-RESULTS)

**Interfaces:**
- Consumes: `QUESTIONS`, `test:eval` harness (Task 1).
- Produces: final `QUESTIONS.category` wording (keys unchanged: the six `CATEGORIES`).

- [ ] **Step 1: Check memory**

Run: `powershell -NoProfile -Command "[math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB,1)"`
Expected: > 3 (GB). If not, STOP and report BLOCKED ("needs > 3 GB free RAM") — do not run the model.

- [ ] **Step 2: Baseline**

Run: `pnpm --filter @worksight/consumer test:eval`
Record the `[laya eval]` lines (metadata only) as round 0.

- [ ] **Step 3: Round 1 wording**

Replace `QUESTIONS.category` in `questions.ts` with:

```ts
  category: {
    type: 'choice',
    instructions: 'What is this screen mainly for? Judge by the content on screen, not only the app name.',
    criteria: {
      work: 'doing a job or study task: writing code, documents, spreadsheets, slides, design files, code review, admin forms',
      learning: 'deliberately studying: tutorials, courses, lectures, documentation or reference pages, flashcards, practice exercises',
      social: 'personal social life: social media feeds, posts and comments, chatting with friends or family, community servers and forums',
      entertainment: 'watching, listening or playing for fun: videos for fun, streams, movies and shows, music players, games, memes',
      communication: 'work or school communication: email inboxes, work chat channels, calendars, meeting and call windows',
      other: 'anything else: system settings, file management, installers, online shopping, maps, banking-free admin'
    }
  },
```

Run `pnpm --filter @worksight/consumer test:eval`; record round 1.

- [ ] **Step 4: Further rounds (max 5 total)**

For each next round change only the wording of the categories that the confusion table shows as mixed up (e.g. add a contrast sentence such as "not personal chat" to `communication`, "not work chat" to `social`, "educational videos belong to learning" to `entertainment`). Keep option keys and order. Run the eval after each round and record the numbers. Stop at the first round that passes both gate assertions, or after round 5.

- [ ] **Step 5: Keep the best round and record results**

Set `QUESTIONS.category` to the best-scoring round (highest "all final", ties → higher hold-out). Append to `tools/laya/SPIKE-RESULTS.md`:

```markdown
## Phase 4 — category wording (YYYY-MM-DD)
| Round | Tuning laya / final | Hold-out laya / final | All final |
|---|---|---|---|
| 0 (baseline) | … | … | … |
| … | … | … | … |
- Chosen: round N. Gate (≥ 80 % all, hold-out within 10 pts): PASS | FAIL (accepted risk).
- Remaining confusions: <from the confusion line>.
```

(Fill in the real numbers you recorded — no placeholders in the committed file.) If the gate failed after 5 rounds, set `GATE` in `laya.eval.test.ts` to the achieved "all final" rounded down to 2 decimals, with the comment `// accepted risk: see tools/laya/SPIKE-RESULTS.md (Phase 4 wording)`.

- [ ] **Step 6: Unit tests still pass, commit**

Run: `pnpm --filter @worksight/consumer test` (questions.test.ts must still pass).

```bash
git add apps/consumer/src/main/brain/questions.ts tools/laya/SPIKE-RESULTS.md apps/consumer/src/main/brain/laya.eval.test.ts
git commit -m "feat(consumer): tuned Laya category wording (Phase 4 accuracy rounds)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: Label storage

**Files:**
- Create: `apps/consumer/src/main/screen/labels.ts`, `apps/consumer/src/main/screen/labels.test.ts`

**Interfaces:**
- Consumes: `LayaAnswer` (`brain/laya.ts`), `CONFIDENT` (`brain/questions.ts`), `SCREEN_SCHEMA`, `createScreenStore` (`screen/store.ts`, for tests).
- Produces:
  ```ts
  export interface StoredLabel { id: number; category: string | null; categoryConf: number | null; activity: string | null; activityConf: number | null; stuck: number | null; distraction: number | null }
  export interface ReadToLabel { id: number; app: string; title: string | null; text: string }
  export interface DayLabel { at: number; appName: string; category: string }
  export function toStoredLabel(id: number, answers: Record<string, LayaAnswer>): StoredLabel;
  export interface LabelStore {
    unlabelled(limit: number): ReadToLabel[]; countUnlabelled(): number; oldestUnlabelledAt(): number | null;
    applyLabels(results: StoredLabel[], now: number): void; copyDupLabels(now: number): number; markPurged(now: number): number;
    lastLabelledAt(): number | null; confidentForDay(date: string): DayLabel[];
  }
  export function createLabelStore(db: Database.Database): LabelStore;
  ```

- [ ] **Step 1: Failing tests**

`apps/consumer/src/main/screen/labels.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import type { LayaAnswer } from '../brain/laya';
import { SCREEN_SCHEMA, createScreenStore, type ScreenStore } from './store';
import { createLabelStore, toStoredLabel, type LabelStore } from './labels';

const choice = (c: string, conf: number): LayaAnswer => ({ type: 'choice', choice: c, probabilities: {}, confidence: conf });
const score = (s: number): LayaAnswer => ({ type: 'score', score: s, probabilities: {}, confidence: 0.9 });

let db: Database.Database; let screen: ScreenStore; let labels: LabelStore;
beforeEach(() => { db = new Database(':memory:'); db.exec(SCREEN_SCHEMA); screen = createScreenStore(db); labels = createLabelStore(db); });
const add = (at: number, text: string | null, hash: string, app = 'Code', date = '2026-09-25'): number =>
  screen.insert({ at, date, appName: app, windowTitle: 't', text, textHash: hash });
const row = (id: number) => db.prepare('SELECT category, category_conf AS categoryConf, activity, stuck, distraction, labeled_at AS labeledAt FROM screen_reads WHERE id = ?').get(id) as Record<string, unknown>;

describe('toStoredLabel', () => {
  it('keeps confident choices, marks unsure ones uncertain, keeps scores', () => {
    expect(toStoredLabel(7, { category: choice('work', 0.8), activity: choice('coding', 0.3), stuck: score(0.4), distraction: score(1.6) }))
      .toEqual({ id: 7, category: 'work', categoryConf: 0.8, activity: 'uncertain', activityConf: 0.3, stuck: 0.4, distraction: 1.6 });
  });
  it('tolerates missing answers', () => {
    expect(toStoredLabel(1, {})).toEqual({ id: 1, category: null, categoryConf: null, activity: null, activityConf: null, stuck: null, distraction: null });
  });
});

describe('label store', () => {
  it('lists unlabelled reads with text, oldest first, and counts them', () => {
    add(2000, 'b', 'hb'); add(1000, 'a', 'ha'); add(3000, null, 'ha');
    expect(labels.unlabelled(10).map((r) => r.text)).toEqual(['a', 'b']);
    expect(labels.countUnlabelled()).toBe(2);
    expect(labels.oldestUnlabelledAt()).toBe(1000);
  });
  it('applies labels in one go and reports the last labelling time', () => {
    const a = add(1000, 'a', 'ha');
    labels.applyLabels([{ id: a, category: 'social', categoryConf: 0.9, activity: 'chatting', activityConf: 0.8, stuck: 0, distraction: 1.2 }], 5000);
    expect(row(a)).toMatchObject({ category: 'social', categoryConf: 0.9, activity: 'chatting', distraction: 1.2, labeledAt: 5000 });
    expect(labels.countUnlabelled()).toBe(0);
    expect(labels.lastLabelledAt()).toBe(5000);
  });
  it('copies labels onto a duplicate only once its original is labelled', () => {
    const a = add(1000, 'a', 'ha');
    const dup = add(2000, null, 'ha');
    expect(labels.copyDupLabels(3000)).toBe(0);
    expect(row(dup).labeledAt).toBeNull();
    labels.applyLabels([{ id: a, category: 'work', categoryConf: 0.7, activity: 'coding', activityConf: 0.6, stuck: 0.1, distraction: 0 }], 4000);
    expect(labels.copyDupLabels(5000)).toBe(1);
    expect(row(dup)).toMatchObject({ category: 'work', activity: 'coding', labeledAt: 5000 });
  });
  it('marks purged unlabelled rows as done with no labels', () => {
    const p = add(1000, null, '');
    expect(labels.markPurged(9000)).toBe(1);
    expect(row(p)).toMatchObject({ category: null, labeledAt: 9000 });
  });
  it('returns only confident categories for a day', () => {
    const a = add(1000, 'a', 'ha', 'Chrome'); const b = add(2000, 'b', 'hb', 'Chrome'); add(3000, 'c', 'hc', 'Chrome', '2026-09-24');
    labels.applyLabels([
      { id: a, category: 'social', categoryConf: 0.9, activity: null, activityConf: null, stuck: null, distraction: null },
      { id: b, category: 'uncertain', categoryConf: 0.2, activity: null, activityConf: null, stuck: null, distraction: null }
    ], 5000);
    expect(labels.confidentForDay('2026-09-25')).toEqual([{ at: 1000, appName: 'Chrome', category: 'social' }]);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @worksight/consumer test`
Expected: FAIL — cannot resolve `./labels`.

- [ ] **Step 3: Implement**

`apps/consumer/src/main/screen/labels.ts`:

```ts
import type Database from 'better-sqlite3';
import type { LayaAnswer } from '../brain/laya';
import { CONFIDENT } from '../brain/questions';

export interface StoredLabel { id: number; category: string | null; categoryConf: number | null; activity: string | null; activityConf: number | null; stuck: number | null; distraction: number | null; }
export interface ReadToLabel { id: number; app: string; title: string | null; text: string; }
export interface DayLabel { at: number; appName: string; category: string; }

const pick = (a: LayaAnswer | undefined): { v: string | null; c: number | null } =>
  a?.type === 'choice' ? { v: a.confidence >= CONFIDENT ? a.choice : 'uncertain', c: a.confidence } : { v: null, c: null };
const scoreOf = (a: LayaAnswer | undefined): number | null => (a?.type === 'score' ? a.score : null);

export function toStoredLabel(id: number, answers: Record<string, LayaAnswer>): StoredLabel {
  const cat = pick(answers.category), act = pick(answers.activity);
  return { id, category: cat.v, categoryConf: cat.c, activity: act.v, activityConf: act.c, stuck: scoreOf(answers.stuck), distraction: scoreOf(answers.distraction) };
}

export interface LabelStore {
  unlabelled(limit: number): ReadToLabel[];
  countUnlabelled(): number;
  oldestUnlabelledAt(): number | null;
  applyLabels(results: StoredLabel[], now: number): void;
  copyDupLabels(now: number): number;
  markPurged(now: number): number;
  lastLabelledAt(): number | null;
  confidentForDay(date: string): DayLabel[];
}

const PENDING = 'labeled_at IS NULL AND text IS NOT NULL';

export function createLabelStore(db: Database.Database): LabelStore {
  const unl = db.prepare(`SELECT id, app_name AS app, window_title AS title, text FROM screen_reads WHERE ${PENDING} ORDER BY at, id LIMIT ?`);
  const cnt = db.prepare(`SELECT count(*) AS n, min(at) AS oldest FROM screen_reads WHERE ${PENDING}`);
  const upd = db.prepare(`UPDATE screen_reads SET category = @category, category_conf = @categoryConf, activity = @activity, activity_conf = @activityConf,
    stuck = @stuck, distraction = @distraction, labeled_at = @now WHERE id = @id`);
  // A duplicate (text NULL, hash kept) takes the labels of the latest earlier labelled read with the same hash.
  const copy = db.prepare(`UPDATE screen_reads AS d SET (category, category_conf, activity, activity_conf, stuck, distraction, labeled_at) =
    (SELECT s.category, s.category_conf, s.activity, s.activity_conf, s.stuck, s.distraction, @now FROM screen_reads s
      WHERE s.text_hash = d.text_hash AND s.labeled_at IS NOT NULL AND s.at <= d.at AND s.id <> d.id ORDER BY s.at DESC, s.id DESC LIMIT 1)
    WHERE d.labeled_at IS NULL AND d.text IS NULL AND d.text_hash <> ''
      AND EXISTS (SELECT 1 FROM screen_reads s WHERE s.text_hash = d.text_hash AND s.labeled_at IS NOT NULL AND s.at <= d.at AND s.id <> d.id)`);
  const purged = db.prepare(`UPDATE screen_reads SET labeled_at = ? WHERE labeled_at IS NULL AND text IS NULL AND text_hash = ''`);
  const last = db.prepare('SELECT max(labeled_at) AS t FROM screen_reads');
  const day = db.prepare(`SELECT at, app_name AS appName, category FROM screen_reads WHERE date = ? AND category IS NOT NULL AND category <> 'uncertain' ORDER BY at`);
  const applyAll = db.transaction((results: StoredLabel[], now: number) => { for (const r of results) upd.run({ ...r, now }); });
  return {
    unlabelled: (limit) => unl.all(limit) as ReadToLabel[],
    countUnlabelled: () => (cnt.get() as { n: number }).n,
    oldestUnlabelledAt: () => (cnt.get() as { oldest: number | null }).oldest,
    applyLabels: (results, now) => applyAll(results, now),
    copyDupLabels: (now) => copy.run({ now }).changes,
    markPurged: (now) => purged.run(now).changes,
    lastLabelledAt: () => (last.get() as { t: number | null }).t,
    confidentForDay: (date) => day.all(date) as DayLabel[]
  };
}
```

- [ ] **Step 4: Run tests, typecheck, commit**

```bash
pnpm --filter @worksight/consumer test && pnpm --filter @worksight/consumer typecheck
git add apps/consumer/src/main/screen/labels.ts apps/consumer/src/main/screen/labels.test.ts
git commit -m "feat(consumer): label storage for screen reads (uncertain threshold, dup copy, purged marking)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: Brain protocol, per-read labelling and worker entry

**Files:**
- Create: `apps/consumer/src/main/brain/protocol.ts`, `apps/consumer/src/main/brain/label.ts`, `apps/consumer/src/main/brain/label.test.ts`, `apps/consumer/src/main/brain/worker.ts`
- Modify: `apps/consumer/electron.vite.config.ts` (second main entry)

**Interfaces:**
- Consumes: `LayaRunner`, `layaState`, `loadLaya` (`brain/laya.ts`); `QUESTIONS` (`brain/questions.ts`); `toStoredLabel`, `StoredLabel`, `ReadToLabel` (`screen/labels.ts`).
- Produces: `brainRequest` / `brainResponse` (zod), types `BrainRequest = { op: 'label'; modelDir: string; reads: ReadToLabel[] }`, `BrainResponse = { op: 'labels'; results: StoredLabel[] } | { op: 'error'; message: string }`; `labelReads(runner: LayaRunner, reads: ReadToLabel[]): Promise<StoredLabel[]>`; built entry `out/main/brain.js`.

- [ ] **Step 1: Failing test**

`apps/consumer/src/main/brain/label.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { LayaAnswer, LayaRunner } from './laya';
import { labelReads } from './label';
import { brainRequest, brainResponse } from './protocol';

const fake = (seen: string[]): LayaRunner => ({
  async ask(state, questions) {
    seen.push(state);
    expect(Object.keys(questions).sort()).toEqual(['activity', 'category', 'distraction', 'stuck']);
    const c = (v: string, conf: number): LayaAnswer => ({ type: 'choice', choice: v, probabilities: {}, confidence: conf });
    const s = (v: number): LayaAnswer => ({ type: 'score', score: v, probabilities: {}, confidence: 1 });
    return { category: c('work', 0.9), activity: c('coding', 0.2), stuck: s(0.5), distraction: s(0) };
  }
});

describe('labelReads', () => {
  it('asks Laya once per read with the spec state string and stores labels', async () => {
    const seen: string[] = [];
    const out = await labelReads(fake(seen), [{ id: 3, app: 'Code', title: 'a.ts', text: 'const x' }]);
    expect(seen).toEqual(['App: Code\nWindow: a.ts\nScreen text: const x']);
    expect(out).toEqual([{ id: 3, category: 'work', categoryConf: 0.9, activity: 'uncertain', activityConf: 0.2, stuck: 0.5, distraction: 0 }]);
  });
});

describe('protocol', () => {
  it('validates requests and responses', () => {
    expect(brainRequest.safeParse({ op: 'label', modelDir: 'C:/m', reads: [{ id: 1, app: 'a', title: null, text: 't' }] }).success).toBe(true);
    expect(brainRequest.safeParse({ op: 'label', modelDir: 'C:/m', reads: [{ id: 1.5, app: 'a', title: null, text: 't' }] }).success).toBe(false);
    expect(brainResponse.safeParse({ op: 'error', message: 'x' }).success).toBe(true);
    expect(brainResponse.safeParse({ op: 'labels', results: [{ id: 1, category: 'work', categoryConf: 0.9, activity: null, activityConf: null, stuck: 3, distraction: null }] }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @worksight/consumer test`
Expected: FAIL — cannot resolve `./label`, `./protocol`.

- [ ] **Step 3: Implement**

`apps/consumer/src/main/brain/protocol.ts`:

```ts
import { z } from 'zod';

const read = z.object({ id: z.number().int(), app: z.string(), title: z.string().nullable(), text: z.string() }).strict();
export const brainRequest = z.object({ op: z.literal('label'), modelDir: z.string().min(1), reads: z.array(read).max(200) }).strict();

const conf = z.number().min(0).max(1).nullable();
const lvl = z.number().min(0).max(2).nullable();
const label = z.object({
  id: z.number().int(), category: z.string().max(40).nullable(), categoryConf: conf,
  activity: z.string().max(40).nullable(), activityConf: conf, stuck: lvl, distraction: lvl
}).strict();
// Main process trust boundary: anything the Brain sends is validated before it touches the database.
export const brainResponse = z.discriminatedUnion('op', [
  z.object({ op: z.literal('labels'), results: z.array(label) }).strict(),
  z.object({ op: z.literal('error'), message: z.string() }).strict()
]);

export type BrainRequest = z.infer<typeof brainRequest>;
export type BrainResponse = z.infer<typeof brainResponse>;
```

`apps/consumer/src/main/brain/label.ts`:

```ts
import { layaState, type LayaRunner } from './laya';
import { QUESTIONS } from './questions';
import { toStoredLabel, type ReadToLabel, type StoredLabel } from '../screen/labels';

export async function labelReads(runner: LayaRunner, reads: ReadToLabel[]): Promise<StoredLabel[]> {
  const out: StoredLabel[] = [];
  for (const r of reads) out.push(toStoredLabel(r.id, await runner.ask(layaState(r.app, r.title, r.text), QUESTIONS)));
  return out;
}
```

`apps/consumer/src/main/brain/worker.ts` (utilityProcess entry; one batch per process, then exit so ONNX Runtime's memory is returned to Windows):

```ts
import { loadLaya } from './laya';
import { labelReads } from './label';
import { brainRequest } from './protocol';

process.parentPort.once('message', async (e) => {
  try {
    const req = brainRequest.parse(e.data);
    const laya = await loadLaya(req.modelDir);
    process.parentPort.postMessage({ op: 'labels', results: await labelReads(laya, req.reads) });
    process.exit(0);
  } catch (err) {
    process.parentPort.postMessage({ op: 'error', message: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  }
});
```

In `apps/consumer/electron.vite.config.ts` replace the `main` line:

```ts
  main: {
    plugins: [externalizeDepsPlugin()],
    // brain.js is the Laya utilityProcess entry (forked per batch from index.js).
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts'), brain: resolve(__dirname, 'src/main/brain/worker.ts') } } }
  },
```

- [ ] **Step 4: Verify**

Run: `pnpm --filter @worksight/consumer test && pnpm --filter @worksight/consumer typecheck && pnpm --filter @worksight/consumer exec electron-vite build && ls apps/consumer/out/main`
Expected: tests PASS; typecheck clean; `out/main` contains `index.js` and `brain.js`. (If typecheck rejects `process.parentPort`, add `/// <reference types="electron" />` at the top of `worker.ts`.)

- [ ] **Step 5: Commit**

```bash
git add apps/consumer/src/main/brain/protocol.ts apps/consumer/src/main/brain/label.ts apps/consumer/src/main/brain/label.test.ts apps/consumer/src/main/brain/worker.ts apps/consumer/electron.vite.config.ts
git commit -m "feat(consumer): Brain protocol, per-read labelling and utilityProcess entry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: Label scheduler and reader backlog guard

**Files:**
- Create: `apps/consumer/src/main/brain/scheduler.ts`, `apps/consumer/src/main/brain/scheduler.test.ts`
- Modify: `apps/consumer/src/main/screen/reader.ts`, `apps/consumer/src/main/screen/reader.test.ts`

**Interfaces:**
- Consumes: `LabelStore` (Task 3), `brainResponse`, `BrainRequest` (Task 4).
- Produces:
  ```ts
  export type LabellingState = 'waiting' | 'idle' | 'running' | 'paused';
  export interface LabellingStatus { state: LabellingState; lastLabelledAt: number | null; pending: number }
  export interface BrainChild { post(msg: BrainRequest): void; onMessage(cb: (m: unknown) => void): void; onExit(cb: (code: number | null) => void): void; kill(): void }
  export interface LabelScheduler { tick(): void; status(): LabellingStatus; retry(): void; backlogBlocked(): boolean }
  export function createLabelScheduler(deps: { store: LabelStore; fork(): BrainChild; modelReady(): boolean; modelDir: string; now(): number; onChange?(): void }): LabelScheduler;
  ```
  Reader: new optional dep `backlogBlocked?: () => boolean`; new outcome `'skipped-backlog'`.

- [ ] **Step 1: Failing tests**

`apps/consumer/src/main/brain/scheduler.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SCREEN_SCHEMA, createScreenStore } from '../screen/store';
import { createLabelStore, type LabelStore } from '../screen/labels';
import type { BrainRequest } from './protocol';
import { createLabelScheduler, type BrainChild } from './scheduler';

const MIN = 60_000;
class FakeBrain implements BrainChild {
  sent: BrainRequest[] = []; killed = false;
  private msg: ((m: unknown) => void) | null = null; private exit: ((c: number | null) => void) | null = null;
  post(m: BrainRequest) { this.sent.push(m); }
  onMessage(cb: (m: unknown) => void) { this.msg = cb; }
  onExit(cb: (c: number | null) => void) { this.exit = cb; }
  kill() { this.killed = true; }
  reply(m: unknown) { this.msg?.(m); }
  die(code: number | null) { this.exit?.(code); }
}

let now: number; let store: LabelStore; let brains: FakeBrain[]; let ready: boolean; let db: Database.Database;
const add = (n: number, at = now) => { const s = createScreenStore(db); for (let i = 0; i < n; i++) s.insert({ at, date: '2026-09-25', appName: 'Code', windowTitle: 't', text: `x${i}`, textHash: `h${i}-${at}` }); };
const make = () => createLabelScheduler({ store, fork: () => { const b = new FakeBrain(); brains.push(b); return b; }, modelReady: () => ready, modelDir: 'M', now: () => now });
const labelsFor = (b: FakeBrain) => ({ op: 'labels', results: b.sent[0].reads.map((r) => ({ id: r.id, category: 'work', categoryConf: 0.9, activity: null, activityConf: null, stuck: null, distraction: null })) });

beforeEach(() => { vi.useFakeTimers(); now = 10 * MIN; db = new Database(':memory:'); db.exec(SCREEN_SCHEMA); store = createLabelStore(db); brains = []; ready = true; });
afterEach(() => vi.useRealTimers());

describe('label scheduler', () => {
  it('waits for 20 reads or a 10-minute-old read, and never runs without the model', () => {
    const s = make();
    add(19); s.tick(); expect(brains).toHaveLength(0);
    now += 10 * MIN; s.tick(); expect(brains).toHaveLength(1);
    expect(brains[0].sent[0]).toMatchObject({ op: 'label', modelDir: 'M' });
    expect(brains[0].sent[0].reads).toHaveLength(19);
  });
  it('reports waiting when the model is missing', () => {
    ready = false; add(25); const s = make(); s.tick();
    expect(brains).toHaveLength(0);
    expect(s.status()).toMatchObject({ state: 'waiting', pending: 25 });
  });
  it('sends at most 50 reads and stores the labels', () => {
    add(60); const s = make(); s.tick();
    expect(brains[0].sent[0].reads).toHaveLength(50);
    brains[0].reply(labelsFor(brains[0])); brains[0].die(0);
    expect(s.status()).toMatchObject({ state: 'idle', pending: 10, lastLabelledAt: now });
  });
  it('does not count a successful batch as a crash when exit arrives before the message', () => {
    add(20); const s = make(); s.tick();
    brains[0].die(0);
    brains[0].reply(labelsFor(brains[0])); // late message within the grace period
    vi.advanceTimersByTime(2000);
    expect(s.status().pending).toBe(0);
    add(20); s.tick(); expect(brains).toHaveLength(2); // no backoff was applied
  });
  it('rejects invalid Brain output and backs off 1 s, 5 s, 30 s, then pauses', () => {
    add(20); const s = make();
    const failOnce = () => { s.tick(); const b = brains[brains.length - 1]; b.reply({ op: 'labels', results: [{ id: 'bad' }] }); };
    failOnce(); expect(s.status().pending).toBe(20);
    now += 999; s.tick(); expect(brains).toHaveLength(1);
    now += 1; failOnce(); expect(brains).toHaveLength(2);
    now += 5000; failOnce(); expect(brains).toHaveLength(3);
    now += 30_000; failOnce(); expect(brains).toHaveLength(4);
  });
  it('pauses after more than 3 failures within 10 minutes and resumes on retry', () => {
    add(20); const s = make();
    for (let i = 0; i < 4; i++) { s.tick(); brains[brains.length - 1].die(1); now += 31_000; }
    expect(s.status().state).toBe('paused');
    s.tick(); expect(brains).toHaveLength(4);
    s.retry(); s.tick(); expect(brains).toHaveLength(5);
  });
  it('kills a batch that runs longer than 120 s', () => {
    add(20); const s = make(); s.tick();
    vi.advanceTimersByTime(120_000);
    expect(brains[0].killed).toBe(true);
    expect(s.status().state).toBe('idle');
  });
  it('blocks new captures only while labelling cannot run and more than 20 reads wait', () => {
    ready = false; add(20); const s = make();
    expect(s.backlogBlocked()).toBe(false);
    add(1, now + 1); expect(s.backlogBlocked()).toBe(true);
    ready = true; expect(s.backlogBlocked()).toBe(false);
  });
});
```

Append to `apps/consumer/src/main/screen/reader.test.ts` inside `describe('screen reader', ...)` (the file's existing `reader()` helper builds deps; add a second helper):

```ts
  it('skips capturing while the label backlog is blocked', async () => {
    const r = createScreenReader({
      ocr: { capture: async () => { captures++; return cap; } }, foreground: { get: async () => fg },
      settings: () => settings, idleSec: () => idle, store, now: () => now, selfPid: 1, backlogBlocked: () => true
    });
    await expect(r.tick()).resolves.toBe('skipped-backlog');
    expect(captures).toBe(0);
  });
```

(`captures`, `fg`, `cap`, `settings`, `idle`, `store`, `now` are the module-level variables the existing reader tests already use.)

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @worksight/consumer test`
Expected: FAIL — cannot resolve `./scheduler`; reader test fails on `'skipped-backlog'`.

- [ ] **Step 3: Implement**

`apps/consumer/src/main/brain/scheduler.ts`:

```ts
import type { LabelStore } from '../screen/labels';
import { brainResponse, type BrainRequest } from './protocol';

export type LabellingState = 'waiting' | 'idle' | 'running' | 'paused';
export interface LabellingStatus { state: LabellingState; lastLabelledAt: number | null; pending: number; }
export interface BrainChild {
  post(msg: BrainRequest): void;
  onMessage(cb: (m: unknown) => void): void;
  onExit(cb: (code: number | null) => void): void;
  kill(): void;
}
export interface LabelScheduler { tick(): void; status(): LabellingStatus; retry(): void; backlogBlocked(): boolean; }

export const BATCH_SIZE = 50;
export const BATCH_MIN = 20;
export const MAX_WAIT_MS = 10 * 60_000;
export const BATCH_TIMEOUT_MS = 120_000;
export const BACKLOG_LIMIT = 20;
export const RETRY_DELAYS_MS = [1_000, 5_000, 30_000] as const;
const FAIL_WINDOW_MS = 10 * 60_000;
const MAX_FAILURES = 3; // more than this within the window → paused
const EXIT_GRACE_MS = 1_000; // a clean exit may overtake the results message

export function createLabelScheduler(deps: {
  store: LabelStore; fork(): BrainChild; modelReady(): boolean; modelDir: string; now(): number; onChange?(): void;
}): LabelScheduler {
  let running = false, paused = false, retryAt = 0;
  let failures: number[] = [];
  const change = (): void => deps.onChange?.();

  const fail = (): void => {
    const now = deps.now();
    failures = [...failures.filter((t) => now - t < FAIL_WINDOW_MS), now];
    if (failures.length > MAX_FAILURES) paused = true;
    else retryAt = now + RETRY_DELAYS_MS[Math.min(failures.length, RETRY_DELAYS_MS.length) - 1];
  };

  function runBatch(): void {
    const reads = deps.store.unlabelled(BATCH_SIZE);
    running = true;
    change();
    let child: BrainChild;
    try { child = deps.fork(); } catch { running = false; fail(); change(); return; }
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      running = false;
      if (!ok) fail();
      change();
    };
    const timer = setTimeout(() => { child.kill(); finish(false); }, BATCH_TIMEOUT_MS);
    child.onMessage((m) => {
      if (settled) return;
      const r = brainResponse.safeParse(m);
      if (!r.success || r.data.op === 'error') { finish(false); return; }
      const now = deps.now();
      deps.store.applyLabels(r.data.results, now);
      deps.store.copyDupLabels(now);
      finish(true);
    });
    child.onExit((code) => {
      if (code === 0) setTimeout(() => finish(false), EXIT_GRACE_MS);
      else finish(false);
    });
    child.post({ op: 'label', modelDir: deps.modelDir, reads });
  }

  return {
    tick() {
      if (running || paused) return;
      const now = deps.now();
      deps.store.markPurged(now);
      deps.store.copyDupLabels(now);
      if (!deps.modelReady() || now < retryAt) return;
      const pending = deps.store.countUnlabelled();
      if (pending === 0) return;
      const oldest = deps.store.oldestUnlabelledAt() ?? now;
      if (pending < BATCH_MIN && now - oldest < MAX_WAIT_MS) return;
      runBatch();
    },
    status: () => ({
      state: paused ? 'paused' : running ? 'running' : deps.modelReady() ? 'idle' : 'waiting',
      lastLabelledAt: deps.store.lastLabelledAt(),
      pending: deps.store.countUnlabelled()
    }),
    retry() { paused = false; failures = []; retryAt = 0; change(); },
    backlogBlocked: () => (paused || !deps.modelReady()) && deps.store.countUnlabelled() > BACKLOG_LIMIT
  };
}
```

In `apps/consumer/src/main/screen/reader.ts`:
- Change the `ReadOutcome` union to include `'skipped-backlog'` (after `'skipped-idle'`).
- Add `backlogBlocked?: () => boolean;` to the `createScreenReader` deps type.
- After `if (deps.idleSec() >= s.idleThresholdSec) return 'skipped-idle';` insert:

```ts
      // Labelling can't keep up (model not ready or paused): stop growing the queue until it drains.
      if (deps.backlogBlocked?.()) return 'skipped-backlog';
```

- [ ] **Step 4: Run tests, typecheck, commit**

```bash
pnpm --filter @worksight/consumer test && pnpm --filter @worksight/consumer typecheck
git add apps/consumer/src/main/brain/scheduler.ts apps/consumer/src/main/brain/scheduler.test.ts apps/consumer/src/main/screen/reader.ts apps/consumer/src/main/screen/reader.test.ts
git commit -m "feat(consumer): label scheduler (batching, timeout, backoff, pause) and reader backlog guard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: Model manifest and downloader

**Files:**
- Create: `apps/consumer/src/main/models/manifest.ts`, `apps/consumer/src/main/models/downloader.ts`, `apps/consumer/src/main/models/downloader.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ModelFile { name: string; size: number; sha256: string }
  export interface Manifest { baseUrl: string; files: ModelFile[] }
  export const LAYA_REPO = 'aaronalexS/daylens-laya-onnx';
  export const LAYA_REVISION: string; // commit id, pinned in Task 11
  export const LAYA_MANIFEST: Manifest;
  export type ModelStatus = { state: 'missing' } | { state: 'downloading'; received: number; total: number; retrying: boolean } | { state: 'verifying' } | { state: 'ready' } | { state: 'error'; reason: 'no_space' | 'bad_hash' };
  export const RETRY_DELAYS_MS: readonly [5000, 30000, 120000, 600000];
  export interface Downloader { init(): Promise<ModelStatus>; start(): void; stop(): void; remove(): Promise<void>; status(): ModelStatus; done(): Promise<void> }
  export function createDownloader(deps: { dir: string; manifest: Manifest; fetch: typeof fetch; freeBytes(dir: string): Promise<number>; wait?(ms: number, signal: AbortSignal): Promise<void>; onStatus?(s: ModelStatus): void }): Downloader;
  ```

- [ ] **Step 1: Failing tests**

`apps/consumer/src/main/models/downloader.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDownloader, type Manifest } from './downloader';

const A = randomBytes(200_000), B = randomBytes(1_000);
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
type Opts = { ignoreRange?: boolean; fail?: number; cutFirstAt?: number };
let server: Server; let base: string; let dir: string; let reqs: { path: string; range?: string }[]; let opts: Opts;
const files: Record<string, Buffer> = { 'a.bin': A, 'b.json': B };

beforeEach(async () => {
  reqs = []; opts = {}; dir = mkdtempSync(join(tmpdir(), 'dl-'));
  let cut = false;
  server = createServer((req, res) => {
    const name = decodeURIComponent((req.url ?? '').split('/').pop() ?? '');
    reqs.push({ path: name, range: req.headers.range });
    if (opts.fail && opts.fail > 0) { opts.fail--; res.writeHead(500).end(); return; }
    const body = files[name]; if (!body) { res.writeHead(404).end(); return; }
    const m = /bytes=(\d+)-/.exec(req.headers.range ?? '');
    const from = m && !opts.ignoreRange ? Number(m[1]) : 0;
    res.writeHead(from ? 206 : 200, { 'content-length': String(body.length - from) });
    if (opts.cutFirstAt && !cut && name === 'a.bin') { cut = true; res.write(body.subarray(from, opts.cutFirstAt), () => res.destroy()); return; }
    res.end(body.subarray(from));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/repo/resolve/rev`;
});
afterEach(async () => { await new Promise((r) => server.close(r)); rmSync(dir, { recursive: true, force: true }); });

const manifest = (over: Partial<Record<string, string>> = {}): Manifest => ({
  baseUrl: base, files: [{ name: 'a.bin', size: A.length, sha256: over['a.bin'] ?? sha(A) }, { name: 'b.json', size: B.length, sha256: sha(B) }]
});
const make = (m = manifest(), free = 10 ** 12) => {
  const waits: number[] = [];
  const d = createDownloader({ dir, manifest: m, fetch, freeBytes: async () => free, wait: async (ms) => { waits.push(ms); } });
  return { d, waits };
};

describe('downloader', () => {
  it('downloads, verifies and becomes ready', async () => {
    const { d } = make(); expect(await d.init()).toEqual({ state: 'missing' });
    d.start(); await d.done();
    expect(d.status()).toEqual({ state: 'ready' });
    expect(readFileSync(join(dir, 'a.bin')).equals(A)).toBe(true);
    expect(existsSync(join(dir, 'a.bin.part'))).toBe(false);
  });
  it('resumes a partial file with a Range request', async () => {
    writeFileSync(join(dir, 'a.bin.part'), A.subarray(0, 50_000));
    const { d } = make(); await d.init(); d.start(); await d.done();
    expect(reqs.find((r) => r.path === 'a.bin')?.range).toBe('bytes=50000-');
    expect(readFileSync(join(dir, 'a.bin')).equals(A)).toBe(true);
  });
  it('starts over when the server ignores Range', async () => {
    opts.ignoreRange = true; writeFileSync(join(dir, 'a.bin.part'), A.subarray(0, 50_000));
    const { d } = make(); await d.init(); d.start(); await d.done();
    expect(d.status()).toEqual({ state: 'ready' });
    expect(readFileSync(join(dir, 'a.bin')).equals(A)).toBe(true);
  });
  it('retries a bad hash once, then reports bad_hash', async () => {
    const { d } = make(manifest({ 'a.bin': 'f'.repeat(64) })); await d.init(); d.start(); await d.done();
    expect(d.status()).toEqual({ state: 'error', reason: 'bad_hash' });
    expect(reqs.filter((r) => r.path === 'a.bin')).toHaveLength(2);
    expect(existsSync(join(dir, 'a.bin'))).toBe(false);
  });
  it('refuses to start without enough disk space', async () => {
    const { d } = make(manifest(), 1000); await d.init(); d.start(); await d.done();
    expect(d.status()).toEqual({ state: 'error', reason: 'no_space' });
    expect(reqs).toHaveLength(0);
  });
  it('backs off 5 s then 30 s on server errors, then succeeds', async () => {
    opts.fail = 2; const { d, waits } = make(); await d.init(); d.start(); await d.done();
    expect(waits).toEqual([5_000, 30_000]);
    expect(d.status()).toEqual({ state: 'ready' });
  });
  it('resumes after the connection drops mid-file', async () => {
    opts.cutFirstAt = 80_000; const { d } = make(); await d.init(); d.start(); await d.done();
    const ranges = reqs.filter((r) => r.path === 'a.bin').map((r) => r.range);
    expect(ranges[0]).toBeUndefined();
    expect(ranges[1]).toMatch(/^bytes=[1-9]\d*-$/); // resumed from whatever arrived before the drop
    expect(readFileSync(join(dir, 'a.bin')).equals(A)).toBe(true);
  });
  it('stop() keeps the partial file and a restart resumes it', async () => {
    opts.fail = 1000;
    const waits: number[] = [];
    let release!: () => void;
    const d = createDownloader({ dir, manifest: manifest(), fetch, freeBytes: async () => 10 ** 12, wait: (ms, signal) => { waits.push(ms); return new Promise((r) => { release = r; signal.addEventListener('abort', () => r(), { once: true }); }); } });
    await d.init(); d.start();
    while (waits.length === 0) await new Promise((r) => setTimeout(r, 5));
    d.stop(); await d.done();
    expect(d.status()).toEqual({ state: 'missing' });
    writeFileSync(join(dir, 'a.bin.part'), A.subarray(0, 10_000));
    opts.fail = 0; d.start(); await d.done();
    expect(reqs.filter((r) => r.path === 'a.bin').pop()?.range).toBe('bytes=10000-');
    expect(d.status()).toEqual({ state: 'ready' });
    void release;
  });
  it('detects an existing verified model on init and rejects a tampered one', async () => {
    const first = make(); await first.d.init(); first.d.start(); await first.d.done();
    expect(await make().d.init()).toEqual({ state: 'ready' });
    const tampered = Buffer.from(A); tampered[0] ^= 0xff;
    writeFileSync(join(dir, 'a.bin'), tampered); utimesSync(join(dir, 'a.bin'), new Date(), new Date(Date.now() + 5000));
    expect(await make().d.init()).toEqual({ state: 'missing' });
  });
  it('remove() deletes the model', async () => {
    const { d } = make(); await d.init(); d.start(); await d.done();
    await d.remove();
    expect(d.status()).toEqual({ state: 'missing' });
    expect(existsSync(join(dir, 'a.bin'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd apps/consumer && npx vitest run src/main/models` (or the fallback runner)
Expected: FAIL — cannot resolve `./downloader`.

- [ ] **Step 3: Implement**

`apps/consumer/src/main/models/manifest.ts`:

```ts
import type { Manifest } from './downloader';

export const LAYA_REPO = 'aaronalexS/daylens-laya-onnx';
// Pinned upload (a commit id) so a later push to the repo can't swap the model under users. Set in Task 11.
export const LAYA_REVISION = 'main';

export const LAYA_MANIFEST: Manifest = {
  baseUrl: `https://huggingface.co/${LAYA_REPO}/resolve/${LAYA_REVISION}`,
  files: [
    { name: 'laya.onnx', size: 1_686_012_251, sha256: 'bbd684549c90cab727e43fd1d6c9458cf6e791a6af5913110746c98ba4253ad8' },
    { name: 'tokenizer.json', size: 3_583_228, sha256: '6c8aaa9a542084f2457eab775d4eeb51f92a70c0fd9de28d5edb0ddec3c08d30' },
    { name: 'tokenizer_config.json', size: 337, sha256: '08d4cf3ac4dca381759441b85b91a6d40e688471dcd33d15d6649eb0a9a854d1' },
    { name: 'laya-meta.json', size: 519, sha256: '429b6917f0f855257f18500f163b6a01860fa6d53a0747f4e0f4ebad103a34e9' }
  ]
};
```

`apps/consumer/src/main/models/downloader.ts`:

```ts
import { createHash, type Hash } from 'node:crypto';
import { createReadStream, createWriteStream, promises as fsp, type WriteStream } from 'node:fs';
import { once } from 'node:events';
import { join } from 'node:path';

export interface ModelFile { name: string; size: number; sha256: string; }
export interface Manifest { baseUrl: string; files: ModelFile[]; }
export type ModelStatus =
  | { state: 'missing' }
  | { state: 'downloading'; received: number; total: number; retrying: boolean }
  | { state: 'verifying' }
  | { state: 'ready' }
  | { state: 'error'; reason: 'no_space' | 'bad_hash' };
export interface Downloader { init(): Promise<ModelStatus>; start(): void; stop(): void; remove(): Promise<void>; status(): ModelStatus; done(): Promise<void>; }

export const RETRY_DELAYS_MS = [5_000, 30_000, 120_000, 600_000] as const;
const SPACE_MARGIN = 500 * 1024 * 1024;
const MARKER = '.verified.json';
const PROGRESS_MS = 250;

class Fatal extends Error { constructor(readonly reason: 'no_space' | 'bad_hash') { super(reason); } }

const sizeOf = async (p: string): Promise<number> => (await fsp.stat(p).catch(() => null))?.size ?? 0;
async function feed(hash: Hash, path: string): Promise<void> {
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
}
async function hashFile(path: string): Promise<string> { const h = createHash('sha256'); await feed(h, path); return h.digest('hex'); }
const defaultWait = (ms: number, signal: AbortSignal): Promise<void> => new Promise((resolve) => {
  const t = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

export function createDownloader(deps: {
  dir: string; manifest: Manifest; fetch: typeof fetch; freeBytes(dir: string): Promise<number>;
  wait?(ms: number, signal: AbortSignal): Promise<void>; onStatus?(s: ModelStatus): void;
}): Downloader {
  const { dir, manifest } = deps;
  const wait = deps.wait ?? defaultWait;
  const total = manifest.files.reduce((a, f) => a + f.size, 0);
  let status: ModelStatus = { state: 'missing' };
  let controller: AbortController | null = null;
  let run: Promise<void> = Promise.resolve();
  let lastProgress = 0;
  const set = (s: ModelStatus): void => { status = s; deps.onStatus?.(s); };
  const final = (f: ModelFile): string => join(dir, f.name);
  const part = (f: ModelFile): string => join(dir, `${f.name}.part`);

  async function writeMarker(): Promise<void> {
    const entries: Record<string, { size: number; mtimeMs: number }> = {};
    for (const f of manifest.files) { const st = await fsp.stat(final(f)); entries[f.name] = { size: st.size, mtimeMs: st.mtimeMs }; }
    await fsp.writeFile(join(dir, MARKER), JSON.stringify(entries));
  }

  /** Download one file into place; false = hash mismatch (the partial file is deleted). */
  async function downloadFile(f: ModelFile, done: number, signal: AbortSignal): Promise<boolean> {
    let have = await sizeOf(part(f));
    if (have > f.size) { await fsp.rm(part(f)); have = 0; }
    let hash = createHash('sha256');
    if (have > 0) await feed(hash, part(f));
    if (have < f.size) {
      const res = await deps.fetch(`${manifest.baseUrl}/${f.name}`, { headers: have ? { Range: `bytes=${have}-` } : {}, signal });
      if (res.status === 200 && have > 0) { have = 0; hash = createHash('sha256'); } // server ignored Range: start over
      else if (!res.ok || !res.body) throw new Error(`http ${res.status}`);
      const out: WriteStream = createWriteStream(part(f), { flags: have ? 'a' : 'w' });
      try {
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          const b = Buffer.from(chunk);
          hash.update(b);
          if (!out.write(b)) await once(out, 'drain');
          have += b.length;
          const t = Date.now();
          if (t - lastProgress >= PROGRESS_MS) { lastProgress = t; set({ state: 'downloading', received: done + have, total, retrying: false }); }
        }
      } finally {
        await new Promise<void>((r) => out.end(() => r()));
      }
    }
    if (have !== f.size) throw new Error(`short download ${f.name}: ${have}/${f.size}`);
    set({ state: 'verifying' });
    if (hash.digest('hex') !== f.sha256) { await fsp.rm(part(f), { force: true }); return false; }
    await fsp.rename(part(f), final(f));
    return true;
  }

  async function downloadAll(signal: AbortSignal): Promise<void> {
    await fsp.mkdir(dir, { recursive: true });
    let remaining = 0;
    for (const f of manifest.files) if ((await sizeOf(final(f))) !== f.size) remaining += f.size - Math.min(await sizeOf(part(f)), f.size);
    if ((await deps.freeBytes(dir)) < remaining + SPACE_MARGIN) throw new Fatal('no_space');
    let done = 0;
    for (const f of manifest.files) {
      if ((await sizeOf(final(f))) === f.size) { done += f.size; continue; } // renamed into place only after a hash check
      if (!(await downloadFile(f, done, signal)) && !(await downloadFile(f, done, signal))) throw new Fatal('bad_hash');
      done += f.size;
    }
    await writeMarker();
    set({ state: 'ready' });
  }

  async function loop(signal: AbortSignal): Promise<void> {
    let failures = 0;
    while (!signal.aborted) {
      try { await downloadAll(signal); return; } catch (e) {
        if (signal.aborted) return;
        if (e instanceof Fatal) { set({ state: 'error', reason: e.reason }); return; }
        const delay = RETRY_DELAYS_MS[Math.min(failures, RETRY_DELAYS_MS.length - 1)];
        failures++;
        const received = status.state === 'downloading' ? status.received : 0;
        set({ state: 'downloading', received, total, retrying: true });
        await wait(delay, signal);
      }
    }
  }

  return {
    async init() {
      await fsp.mkdir(dir, { recursive: true });
      const marker = JSON.parse(await fsp.readFile(join(dir, MARKER), 'utf8').catch(() => '{}')) as Record<string, { size: number; mtimeMs: number }>;
      for (const f of manifest.files) {
        const st = await fsp.stat(final(f)).catch(() => null);
        if (!st || st.size !== f.size) { set({ state: 'missing' }); return status; }
        const m = marker[f.name];
        if (m && m.size === st.size && m.mtimeMs === st.mtimeMs) continue;
        if ((await hashFile(final(f))) !== f.sha256) { await fsp.rm(final(f), { force: true }); set({ state: 'missing' }); return status; }
      }
      await writeMarker();
      set({ state: 'ready' });
      return status;
    },
    start() {
      if (controller || status.state === 'ready') return;
      const c = new AbortController();
      controller = c;
      set({ state: 'downloading', received: 0, total, retrying: false });
      run = loop(c.signal).finally(() => { if (controller === c) controller = null; });
    },
    stop() {
      if (!controller) return;
      controller.abort();
      controller = null;
      if (status.state !== 'ready' && status.state !== 'error') set({ state: 'missing' });
    },
    async remove() {
      this.stop();
      await run;
      await fsp.rm(dir, { recursive: true, force: true });
      set({ state: 'missing' });
    },
    status: () => status,
    done: () => run
  };
}
```

- [ ] **Step 4: Run tests, typecheck, commit**

Run the downloader test focused, then the full suite and typecheck. If a test is flaky because of chunk timing, fix the implementation (not the expectation) and explain in the report.

```bash
git add apps/consumer/src/main/models/manifest.ts apps/consumer/src/main/models/downloader.ts apps/consumer/src/main/models/downloader.test.ts
git commit -m "feat(consumer): resumable, hash-verified Laya model downloader and manifest

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: Today categories from Laya labels

**Files:**
- Modify: `apps/consumer/src/main/day/today.ts`, `apps/consumer/src/main/day/today.test.ts`

**Interfaces:**
- Consumes: `DayLabel` (Task 3).
- Produces: `DayInput.labels?: DayLabel[]`; `loadTodayView(repo, settings, date, now, labelsFor?: (date: string) => DayLabel[])`.

- [ ] **Step 1: Failing tests**

Append to `apps/consumer/src/main/day/today.test.ts` (inside the existing `describe('buildTodayView', ...)`, using the file's `session`, `run`, `view`, `T` helpers):

```ts
  it('uses the most frequent confident Laya category for a session piece', () => {
    const v = view({
      sessions: [session('Google Chrome', T(9), T(10))],
      samples: run(T(9), 60, 1),
      labels: [
        { at: T(9, 5), appName: 'Google Chrome', category: 'social' },
        { at: T(9, 20), appName: 'Google Chrome', category: 'social' },
        { at: T(9, 40), appName: 'Google Chrome', category: 'learning' },
        { at: T(9, 50), appName: 'Discord', category: 'entertainment' }
      ]
    });
    expect(v.cards.map((c) => c.category)).toEqual(['social']);
    expect(v.timeline.map((s) => s.category)).toEqual(['social']);
  });
  it('falls back to the app-name rule without labels in the piece', () => {
    const v = view({
      sessions: [session('Microsoft Teams', T(9), T(10))],
      samples: run(T(9), 60, 1),
      labels: [{ at: T(11), appName: 'Microsoft Teams', category: 'social' }]
    });
    expect(v.cards.map((c) => c.category)).toEqual(['communication']);
  });
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @worksight/consumer test`
Expected: FAIL — TypeScript/assertion failure (`labels` unknown on `DayInput`; category `other` instead of `social`).

- [ ] **Step 3: Implement**

In `apps/consumer/src/main/day/today.ts`:
- Add `import type { DayLabel } from '../screen/labels';`
- Change `DayInput` to: `export interface DayInput { date: ISODate; sessions: FocusSessionRow[]; samples: ActivitySampleRow[]; labels?: DayLabel[]; }`
- Add above `dayPieces`:

```ts
/** Most frequent confident Laya category among this app's reads inside [start, end); null when there are none. */
function labelCategory(labels: DayLabel[] | undefined, appName: string, start: number, end: number): Category | null {
  if (!labels?.length) return null;
  const counts = new Map<Category, number>();
  for (const l of labels) {
    if (l.appName !== appName || l.at < start || l.at >= end || !(CATEGORIES as readonly string[]).includes(l.category)) continue;
    counts.set(l.category as Category, (counts.get(l.category as Category) ?? 0) + 1);
  }
  let best: Category | null = null;
  let n = 0;
  for (const c of CATEGORIES) { const k = counts.get(c) ?? 0; if (k > n) { best = c; n = k; } }
  return best;
}
```

- In `dayPieces`, replace

```ts
    const category = categoryForApp(s.appName);
    for (const p of subtract(iv, away)) pieces.push({ ...p, appName: s.appName, category });
```

with

```ts
    const fallback = categoryForApp(s.appName);
    for (const p of subtract(iv, away)) pieces.push({ ...p, appName: s.appName, category: labelCategory(day.labels, s.appName, p.start, p.end) ?? fallback });
```

- Change `loadTodayView` to:

```ts
export function loadTodayView(repo: Repositories, settings: ViewSettings, date: ISODate, now: number, labelsFor: (date: ISODate) => DayLabel[] = () => []): TodayView {
  const days: DayInput[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = shiftDate(date, -i);
    days.push({ date: d, sessions: [...repo.getFocusSessions(shiftDate(d, -1)), ...repo.getFocusSessions(d)], samples: repo.getActivitySamples(d), labels: labelsFor(d) });
  }
  return buildTodayView(days, settings, now);
}
```

(A session that starts before midnight may have reads dated the previous day; that edge is accepted — the piece falls back to the app rule.)

- [ ] **Step 4: Run tests, typecheck, commit**

```bash
pnpm --filter @worksight/consumer test && pnpm --filter @worksight/consumer typecheck
git add apps/consumer/src/main/day/today.ts apps/consumer/src/main/day/today.test.ts
git commit -m "feat(consumer): Today categories from confident Laya labels with app-name fallback

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: Settings key, IPC, preload and main wiring

**Files:**
- Modify: `apps/consumer/src/main/settings.ts`, `apps/consumer/src/main/settings.test.ts`, `apps/consumer/src/main/channels.ts`, `apps/consumer/src/main/ipc.ts`, `apps/consumer/src/preload/index.ts`, `apps/consumer/src/main/index.ts`

**Interfaces:**
- Consumes: Tasks 3–7.
- Produces: setting `screenReadingAsked` (false, renderer-editable); channels `models:get`, `models:redownload`, `models:delete`, `models:retryLabelling`; `export interface ModelsView { model: ModelStatus; labelling: LabellingStatus }` in `ipc.ts`; preload `api.models = { get, redownload, delete, retryLabelling }`.

- [ ] **Step 1: Settings (test first)**

Append to `apps/consumer/src/main/settings.test.ts`:

```ts
describe('screen reading opt-in', () => {
  it('defaults screenReadingAsked to false and lets the renderer set it', () => {
    expect(DEFAULT_SETTINGS.screenReadingAsked).toBe(false);
    expect(settingsPatch.parse({ screenReadingAsked: true })).toEqual({ screenReadingAsked: true });
    expect(settingsPatch.safeParse({ screenReadingAsked: 'yes' }).success).toBe(false);
  });
});
```

Run tests (FAIL), then in `settings.ts` add `screenReadingAsked: false` after `exclusions` in `DEFAULT_SETTINGS`, and `screenReadingAsked: z.boolean()` to `settingsPatch`. Run tests (PASS).

- [ ] **Step 2: Channels, IPC, preload**

`channels.ts` — add:

```ts
  modelsGet: 'models:get',
  modelsRedownload: 'models:redownload',
  modelsDelete: 'models:delete',
  modelsRetryLabelling: 'models:retryLabelling',
```

`ipc.ts`:
- Add imports: `import type { ModelStatus } from './models/downloader';` and `import type { LabellingStatus } from './brain/scheduler';` and `import type { DayLabel } from './screen/labels';`
- Add:

```ts
export interface ModelsView { model: ModelStatus; labelling: LabellingStatus; }
export interface ModelsDeps {
  view(): ModelsView;
  redownload(): Promise<ModelsView>;
  remove(): Promise<{ deleted: boolean }>;
  retryLabelling(): ModelsView;
}
```

- Add to `IpcDeps`: `models: ModelsDeps;` and `labelsFor(date: string): DayLabel[];`
- Change the `todayGet` handler to pass labels: `loadTodayView(d.repo, d.settings.get(), dateArg.parse(raw).date, d.now(), d.labelsFor)`.
- Change the `settingsSet` handler so turning reading on also records the answer:

```ts
  ipcMain.handle(CH.settingsSet, (_e, raw) => {
    const patch = settingsPatch.parse(raw);
    const next = d.settings.set(patch.screenReading ? { ...patch, screenReadingAsked: true } : patch);
    d.onSettingsChanged();
    return next;
  });
```

- Add handlers:

```ts
  ipcMain.handle(CH.modelsGet, () => d.models.view());
  ipcMain.handle(CH.modelsRedownload, () => d.models.redownload());
  ipcMain.handle(CH.modelsDelete, () => d.models.remove());
  ipcMain.handle(CH.modelsRetryLabelling, () => d.models.retryLabelling());
```

`preload/index.ts` — add `import type { ModelsView } from '../main/ipc';` (extend the existing import) and:

```ts
  models: {
    get: (): Promise<ModelsView> => ipcRenderer.invoke(CH.modelsGet),
    redownload: (): Promise<ModelsView> => ipcRenderer.invoke(CH.modelsRedownload),
    delete: (): Promise<{ deleted: boolean }> => ipcRenderer.invoke(CH.modelsDelete),
    retryLabelling: (): Promise<ModelsView> => ipcRenderer.invoke(CH.modelsRetryLabelling)
  },
```

- [ ] **Step 3: Main wiring (`index.ts`)**

1. Imports: add `utilityProcess` to the electron import; add `import { statfs } from 'node:fs/promises';`, `import { createLabelStore } from './screen/labels';`, `import { createLabelScheduler, type BrainChild } from './brain/scheduler';`, `import { createDownloader } from './models/downloader';`, `import { LAYA_MANIFEST } from './models/manifest';`.
2. After `const screenStore = createScreenStore(db);` add:

```ts
    // Existing users who already enabled reading in Phase 3 have answered the opt-in question.
    if (settings.get().screenReading && !settings.get().screenReadingAsked) settings.set({ screenReadingAsked: true });
    const labelStore = createLabelStore(db);
    const modelDir = process.env['DAYLENS_MODEL_DIR'] ?? join(app.getPath('userData'), 'models', 'laya');
    let lastModelPush = 0;
    const downloader = createDownloader({
      dir: modelDir, manifest: LAYA_MANIFEST, fetch: globalThis.fetch,
      freeBytes: async (d) => { const s = await statfs(d); return s.bavail * s.bsize; },
      onStatus: (st) => {
        const t = Date.now();
        if (st.state === 'downloading' && t - lastModelPush < 1000) return; // progress pushes at most 1/s
        lastModelPush = t;
        win?.webContents.send(CH.eventsUpdate);
      }
    });
    const forkBrain = (): BrainChild => {
      const child = utilityProcess.fork(join(__dirname, 'brain.js'), [], { serviceName: 'Daylens Brain', stdio: 'ignore' });
      return {
        post: (m) => child.postMessage(m),
        onMessage: (cb) => { child.on('message', cb); },
        onExit: (cb) => { child.on('exit', cb); },
        kill: () => { child.kill(); }
      };
    };
    const scheduler = createLabelScheduler({
      store: labelStore, fork: forkBrain, modelReady: () => downloader.status().state === 'ready',
      modelDir, now: () => Date.now(), onChange: () => win?.webContents.send(CH.eventsUpdate)
    });
    const syncModel = (): void => {
      const s = settings.get();
      if (s.screenReading && s.consentGranted) downloader.start(); else downloader.stop();
    };
    setInterval(() => { try { scheduler.tick(); } catch (e) { console.error('[brain] tick failed:', e); } }, 60_000);
```

3. In `createScreenReader({...})` deps add `backlogBlocked: () => scheduler.backlogBlocked(),`.
4. In `registerIpc({...})`: change `onSettingsChanged` to `() => { applyLoginItem(); syncOcr(); syncModel(); retention(); }`, and add:

```ts
      labelsFor: (date) => labelStore.confidentForDay(date),
      models: {
        view: () => ({ model: downloader.status(), labelling: scheduler.status() }),
        redownload: async () => { await downloader.remove(); syncModel(); return { model: downloader.status(), labelling: scheduler.status() }; },
        remove: async () => {
          const r = await dialog.showMessageBox(win!, {
            type: 'warning', buttons: ['Delete', 'Cancel'], defaultId: 1, cancelId: 1, title: 'Delete AI model',
            message: 'Delete the downloaded AI model?',
            detail: 'Screen reads stop being labelled until it is downloaded again (about 1.7 GB). If screen reading is on, the download starts again right away.'
          });
          if (r.response !== 0) return { deleted: false };
          await downloader.remove();
          syncModel();
          return { deleted: true };
        },
        retryLabelling: () => { scheduler.retry(); scheduler.tick(); return { model: downloader.status(), labelling: scheduler.status() }; }
      },
```

5. Startup: after `syncOcr(); retention();` add:

```ts
    downloader.init().then(() => syncModel()).catch((e) => console.error('[models] init failed:', e));
```

6. In `before-quit` add `downloader.stop();`.

- [ ] **Step 4: Verify**

Run: `pnpm --filter @worksight/consumer test && pnpm --filter @worksight/consumer typecheck && pnpm --filter @worksight/consumer exec electron-vite build`
Expected: all green; `out/main/brain.js` present. A dev launch is only done if no Daylens instance is running (single-instance lock); if one is, skip and say so.

- [ ] **Step 5: Commit**

```bash
git add apps/consumer/src/main/settings.ts apps/consumer/src/main/settings.test.ts apps/consumer/src/main/channels.ts apps/consumer/src/main/ipc.ts apps/consumer/src/preload/index.ts apps/consumer/src/main/index.ts
git commit -m "feat(consumer): wire Laya labelling, model download and models IPC

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 9: Onboarding "Your screen" step

**Files:**
- Modify: `apps/consumer/src/renderer/lib/onboardingContent.ts`, `apps/consumer/src/renderer/lib/onboardingContent.test.ts`, `apps/consumer/src/renderer/components/Onboarding.tsx`, `apps/consumer/src/renderer/components/OnboardingArt.tsx`, `apps/consumer/src/renderer/App.tsx`, `apps/consumer/src/renderer/styles.css`

**Interfaces:**
- Consumes: `api.settings.set` accepting `screenReading`, `screenReadingAsked` (Task 8).
- Produces: `STEP_COUNT = 7`; step 5 = "Your screen"; `bubbleFor(step, p, screen = false)`; `Onboarding` prop `initialScreen: boolean`.

- [ ] **Step 1: Failing tests**

In `apps/consumer/src/renderer/lib/onboardingContent.test.ts`:
- Change `const t = titles(5, p({ name: 'Aaron', goals: ['focus'] }));` to `titles(6, ...)`.
- Add inside `describe('cardsFor', ...)`:

```ts
  it('screen step shows example labels and a privacy card', () => {
    const t = titles(5, p());
    expect(t).toContain('Coding in VS Code');
    expect(t[t.length - 1]).toBe('Text only, on this PC');
  });
```

- Add a new block:

```ts
describe('screen step bubble', () => {
  it('reacts to the switch', () => {
    expect(bubbleFor(5, p(), false)).toMatch(/optional/i);
    expect(bubbleFor(5, p(), true)).toMatch(/privately/i);
    expect(STEP_COUNT).toBe(7);
  });
});
```

Run tests: FAIL.

- [ ] **Step 2: Content helpers**

In `onboardingContent.ts`:
- `export const STEP_COUNT = 7;`
- In `cardsFor`, add before `default:`:

```ts
    case 5:
      return [
        c('💻', 'Coding in VS Code', 'work', 'var(--lav)'),
        c('📺', 'Watching YouTube', 'entertainment', 'var(--peach)'),
        c('📚', 'Reading docs', 'learning', 'var(--mint)'),
        c('💬', 'Team chat', 'communication', 'var(--sky)'),
        c('🔒', 'Text only, on this PC', 'screenshot never saved', 'var(--mint)')
      ];
```

- Change the signature to `export function bubbleFor(step: number, p: Profile, screen = false): string {` and add before `default:`:

```ts
    case 5: return screen ? "Thanks! I'll learn what you're working on, privately." : 'Totally optional. Everything else works without it.';
```

Run tests: PASS.

- [ ] **Step 3: Onboarding component**

In `Onboarding.tsx`:
- Props: add `initialScreen: boolean` (destructure it).
- State: `const [screen, setScreen] = useState(initialScreen);`
- In `finish`, after the consent line insert:

```ts
      s = await api.settings.set({ screenReading: screen, screenReadingAsked: true });
      if (cancelled.current) return;
```

- In `body()`, add before `default:`:

```tsx
      case 5:
        return (<>
          <p className="ob-kicker"><i style={{ background: 'var(--sky)' }}>👀</i>Your screen</p>
          <h1 tabIndex={-1}>Let me understand<br /><b>your screen?</b></h1>
          <p className="lead" style={{ marginBottom: 14 }}>With this on, Daylens reads the text of the window in front every 30 seconds, so it can tell coding from scrolling and give you better tips.</p>
          <div className="promise">
            <div><i style={{ background: 'var(--mint)' }}>🔒</i><span><b>Text only, on this PC.</b> The screenshot is never saved or sent anywhere.</span></div>
            <div><i style={{ background: 'var(--lav)' }}>🙈</i><span>Skips <b>password managers, banking and private windows</b>. You can add more in Settings.</span></div>
            <div><i style={{ background: 'var(--peach)' }}>⬇️</i><span>Needs a one-time <b>1.7 GB</b> download, which runs in the background.</span></div>
          </div>
          <div className="ob-screen">
            <span>Read on-screen text</span>
            <button className={`sw${screen ? ' on' : ''}`} aria-label="Read on-screen text" aria-pressed={screen} onClick={() => setScreen((v) => !v)} />
          </div>
          <p className="ob-why">💡 <span><b>Good to know:</b> it's off unless you turn it on, and you can change it any time in Settings → Privacy.</span></p>
          {nav('Continue →')}
        </>);
```

- Change the `OnboardingArt` line to pass `bubble={bubbleFor(step, art, screen)}`.

In `OnboardingArt.tsx`, insert into `LOOK` before the last (✨) entry:

```ts
  { bg: 'var(--sky)', hue: '120deg', face: '👀' },
```

In `App.tsx`, pass `initialScreen={settings.screenReading}` to `<Onboarding ... />`.

In `styles.css`, before the `@media (prefers-reduced-motion: reduce)` block add:

```css
.ob-screen { display: flex; align-items: center; justify-content: space-between; max-width: 520px; background: #fff; border: 2px solid var(--line); border-radius: 18px; padding: 12px 16px; margin: 6px 0 10px; font-weight: 600; font-size: 14.5px; }
```

- [ ] **Step 4: Verify and commit**

Run: `pnpm --filter @worksight/consumer test && pnpm --filter @worksight/consumer typecheck && pnpm --filter @worksight/consumer exec electron-vite build`

```bash
git add apps/consumer/src/renderer/lib/onboardingContent.ts apps/consumer/src/renderer/lib/onboardingContent.test.ts apps/consumer/src/renderer/components/Onboarding.tsx apps/consumer/src/renderer/components/OnboardingArt.tsx apps/consumer/src/renderer/App.tsx apps/consumer/src/renderer/styles.css
git commit -m "feat(consumer): onboarding step to opt in to screen reading

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 10: Today prompt, download banner and AI model settings

**Files:**
- Create: `apps/consumer/src/renderer/lib/models.ts`, `apps/consumer/src/renderer/lib/models.test.ts`, `apps/consumer/src/renderer/components/ScreenPrompt.tsx`, `apps/consumer/src/renderer/components/ModelSection.tsx`
- Modify: `apps/consumer/src/renderer/components/TodayScreen.tsx`, `apps/consumer/src/renderer/components/SettingsScreen.tsx`, `apps/consumer/src/renderer/App.tsx`, `apps/consumer/src/renderer/styles.css`

**Interfaces:**
- Consumes: `api.models.*`, `ModelsView` (Task 8); `ModelStatus` (Task 6); `LabellingStatus` (Task 5).
- Produces: `shouldAskScreenReading(s)`, `modelStatusText(m)`, `labellingText(l)`, `bannerText(screenReading, m)`.

- [ ] **Step 1: Failing tests**

`apps/consumer/src/renderer/lib/models.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from '../../main/settings';
import { bannerText, labellingText, modelStatusText, shouldAskScreenReading } from './models';

describe('shouldAskScreenReading', () => {
  it('asks consented users once, and never users who already turned reading on', () => {
    expect(shouldAskScreenReading({ ...DEFAULT_SETTINGS, consentGranted: true })).toBe(true);
    expect(shouldAskScreenReading({ ...DEFAULT_SETTINGS, consentGranted: false })).toBe(false);
    expect(shouldAskScreenReading({ ...DEFAULT_SETTINGS, consentGranted: true, screenReadingAsked: true })).toBe(false);
    expect(shouldAskScreenReading({ ...DEFAULT_SETTINGS, consentGranted: true, screenReading: true })).toBe(false);
  });
});

describe('model texts', () => {
  it('describes each model state', () => {
    expect(modelStatusText({ state: 'missing' })).toBe('Not downloaded');
    expect(modelStatusText({ state: 'downloading', received: 700_000_000, total: 1_690_000_000, retrying: false })).toBe('Downloading 41% (0.7 of 1.7 GB)');
    expect(modelStatusText({ state: 'downloading', received: 0, total: 1_690_000_000, retrying: true })).toBe('Download paused, retrying…');
    expect(modelStatusText({ state: 'verifying' })).toBe('Checking…');
    expect(modelStatusText({ state: 'ready' })).toBe('Ready');
    expect(modelStatusText({ state: 'error', reason: 'no_space' })).toBe('Not enough disk space (needs about 2.2 GB free)');
    expect(modelStatusText({ state: 'error', reason: 'bad_hash' })).toBe("Download was damaged. Try 'Download again'.");
  });
  it('describes labelling', () => {
    expect(labellingText({ state: 'waiting', lastLabelledAt: null, pending: 3 })).toBe('Waiting for the model');
    expect(labellingText({ state: 'paused', lastLabelledAt: null, pending: 3 })).toBe('Paused after repeated errors');
    expect(labellingText({ state: 'idle', lastLabelledAt: null, pending: 0 })).toBe('Nothing labelled yet');
    expect(labellingText({ state: 'running', lastLabelledAt: null, pending: 30 })).toBe('Labelling now…');
  });
  it('shows a banner only while downloading with reading on', () => {
    expect(bannerText(true, { state: 'downloading', received: 845_000_000, total: 1_690_000_000, retrying: false })).toBe('Downloading the AI model: 50%');
    expect(bannerText(false, { state: 'downloading', received: 1, total: 2, retrying: false })).toBeNull();
    expect(bannerText(true, { state: 'ready' })).toBeNull();
  });
});
```

Run tests: FAIL.

- [ ] **Step 2: Helpers**

`apps/consumer/src/renderer/lib/models.ts`:

```ts
import type { DaylensSettings } from '../../main/settings';
import type { ModelStatus } from '../../main/models/downloader';
import type { LabellingStatus } from '../../main/brain/scheduler';
import { formatClock } from './format';

const gb = (n: number): string => (n / 1e9).toFixed(1);
const pct = (m: { received: number; total: number }): number => (m.total ? Math.floor((m.received / m.total) * 100) : 0);

export function shouldAskScreenReading(s: DaylensSettings): boolean {
  return s.consentGranted && !s.screenReadingAsked && !s.screenReading;
}

export function modelStatusText(m: ModelStatus): string {
  switch (m.state) {
    case 'missing': return 'Not downloaded';
    case 'downloading': return m.retrying ? 'Download paused, retrying…' : `Downloading ${pct(m)}% (${gb(m.received)} of ${gb(m.total)} GB)`;
    case 'verifying': return 'Checking…';
    case 'ready': return 'Ready';
    case 'error': return m.reason === 'no_space' ? 'Not enough disk space (needs about 2.2 GB free)' : "Download was damaged. Try 'Download again'.";
  }
}

export function labellingText(l: LabellingStatus): string {
  if (l.state === 'waiting') return 'Waiting for the model';
  if (l.state === 'paused') return 'Paused after repeated errors';
  if (l.state === 'running') return 'Labelling now…';
  return l.lastLabelledAt === null ? 'Nothing labelled yet' : `Last labelled at ${formatClock(l.lastLabelledAt)}`;
}

export function bannerText(screenReading: boolean, m: ModelStatus): string | null {
  return screenReading && m.state === 'downloading' && !m.retrying ? `Downloading the AI model: ${pct(m)}%` : null;
}
```

Run tests: PASS.

- [ ] **Step 3: Components**

`apps/consumer/src/renderer/components/ScreenPrompt.tsx`:

```tsx
import { useEffect, useState } from 'react';
import type { DaylensSettings } from '../../main/settings';
import type { ModelsView } from '../../main/ipc';
import { api } from '../lib/api';
import { bannerText, shouldAskScreenReading } from '../lib/models';

/** One-time opt-in card for existing users, plus a slim progress banner while the model downloads. */
export function ScreenPrompt({ settings, onChange }: { settings: DaylensSettings; onChange: (s: DaylensSettings) => void }) {
  const [models, setModels] = useState<ModelsView | null>(null);
  useEffect(() => {
    if (!settings.screenReading) { setModels(null); return; }
    const load = (): void => { api.models.get().then(setModels).catch((e) => console.error('[renderer] models.get failed:', e)); };
    load();
    const off = api.onUpdate(load);
    return off;
  }, [settings.screenReading]);

  const answer = (on: boolean): void => {
    api.settings.set(on ? { screenReading: true, screenReadingAsked: true } : { screenReadingAsked: true })
      .then(onChange).catch((e) => console.error('[renderer] settings.set failed:', e));
  };

  if (shouldAskScreenReading(settings)) {
    return (
      <div className="sp-card" role="region" aria-label="Screen reading">
        <span className="sp-ico" aria-hidden="true">👀</span>
        <div>
          <b>Let Daylens understand your screen?</b>
          <p>It reads the text of the window in front every 30 seconds to tell coding from scrolling. Text only, never screenshots, and it stays on this PC. Needs a one-time 1.7 GB download.</p>
        </div>
        <div className="sp-actions">
          <button className="btn s" onClick={() => answer(false)}>Not now</button>
          <button className="btn" onClick={() => answer(true)}>Turn on</button>
        </div>
      </div>
    );
  }
  const text = models ? bannerText(settings.screenReading, models.model) : null;
  return text ? <div className="sp-banner" role="status">{text}</div> : null;
}
```

`apps/consumer/src/renderer/components/ModelSection.tsx`:

```tsx
import { useEffect, useState } from 'react';
import type { ModelsView } from '../../main/ipc';
import { api } from '../lib/api';
import { labellingText, modelStatusText } from '../lib/models';

export function ModelSection() {
  const [view, setView] = useState<ModelsView | null>(null);
  const load = (): void => { api.models.get().then(setView).catch((e) => console.error('[renderer] models.get failed:', e)); };
  useEffect(() => {
    load();
    const off = api.onUpdate(load);
    const t = setInterval(load, 30_000);
    return () => { off(); clearInterval(t); };
  }, []);
  if (!view) return null;
  const act = (p: Promise<unknown>): void => { p.then(load).catch((e) => { console.error(e); load(); }); };

  return (
    <div className="grp">
      <h4>AI model</h4>
      <div className="srow">
        <p>Laya (on-device)<small role="status">{modelStatusText(view.model)}</small></p>
        <div className="srow-btns">
          <button className="btn s" onClick={() => act(api.models.redownload())}>Download again</button>
          <button className="btn s danger" disabled={view.model.state === 'missing'} onClick={() => act(api.models.delete())}>Delete model</button>
        </div>
      </div>
      <div className="srow">
        <p>Labelling<small role="status">{labellingText(view.labelling)}{view.labelling.pending > 0 ? ` · ${view.labelling.pending} waiting` : ''}</small></p>
        {view.labelling.state === 'paused' && <button className="btn s" onClick={() => act(api.models.retryLabelling())}>Retry</button>}
      </div>
    </div>
  );
}
```

- `TodayScreen.tsx`: change the props to `{ settings, onChange }: { settings: DaylensSettings; onChange: (s: DaylensSettings) => void }`, import `ScreenPrompt`, and render `<ScreenPrompt settings={settings} onChange={onChange} />` as the first child of `<main className="today">`.
- `App.tsx`: `<TodayScreen settings={settings} onChange={setSettings} />`.
- `SettingsScreen.tsx`: import `ModelSection` and render `<ModelSection />` directly after `<PrivacySection ... />`.
- `styles.css` (before the reduced-motion block):

```css
.sp-card { display: flex; align-items: center; gap: 14px; background: #fff; border: 2px solid var(--line); border-radius: 20px; padding: 14px 16px; margin-bottom: 16px; animation: rise .5s var(--ease) both; }
.sp-card b { font-size: 15px; }
.sp-card p { margin: 4px 0 0; font-size: 12.5px; color: var(--muted); line-height: 1.4; }
.sp-ico { font-size: 26px; width: 44px; height: 44px; border-radius: 14px; background: var(--sky); display: grid; place-items: center; flex: none; }
.sp-actions { display: flex; gap: 8px; margin-left: auto; flex: none; }
.sp-banner { background: var(--panel); border-radius: 999px; padding: 6px 14px; font-size: 12.5px; color: var(--muted); display: inline-block; margin-bottom: 12px; }
.srow-btns { display: flex; gap: 8px; }
```

(If `@keyframes rise` does not exist in styles.css, drop the `animation` declaration.)

- [ ] **Step 4: Verify and commit**

Run: `pnpm --filter @worksight/consumer test && pnpm --filter @worksight/consumer typecheck && pnpm --filter @worksight/consumer exec electron-vite build`

```bash
git add apps/consumer/src/renderer
git commit -m "feat(consumer): Today opt-in card, model download banner and AI model settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 11: Model upload, pin, and end-to-end verification

**Files:**
- Modify: `apps/consumer/src/main/models/manifest.ts` (`LAYA_REVISION`), `docs/superpowers/specs/2026-09-25-daylens-phase4-laya-labelling-design.md` (record the commit)

- [ ] **Step 1: Upload (needs the user's Hugging Face login)** — the user runs `hf auth login` in their own terminal. Then:

```bash
hf repo create aaronalexS/daylens-laya-onnx --repo-type model
hf upload aaronalexS/daylens-laya-onnx apps/consumer/.models/laya . --include "laya.onnx" "tokenizer.json" "tokenizer_config.json" "laya-meta.json"
hf upload aaronalexS/daylens-laya-onnx <model-card-folder> .   # README.md (model card) + LICENSE (Apache-2.0)
```

- [ ] **Step 2: Verify and pin**

Run: `curl -s https://huggingface.co/api/models/aaronalexS/daylens-laya-onnx` → take `sha` and check `siblings` lists the 4 files + README.md + LICENSE. For each of the 4 files, `curl -sI https://huggingface.co/aaronalexS/daylens-laya-onnx/resolve/<sha>/<file>` must return 302/200 with `x-linked-size` (LFS) or `content-length` equal to the manifest size, and `x-linked-etag` equal to the manifest SHA-256 for `laya.onnx`. Set `LAYA_REVISION = '<sha>'` and note the commit in the spec §2 table. Commit.

- [ ] **Step 3: Full checks**

`pnpm test` (all packages), `pnpm -r typecheck`, `pnpm --filter @worksight/consumer exec electron-vite build`.

- [ ] **Step 4: Real run (human + controller)**

1. Dev launch with `DAYLENS_MODEL_DIR=apps/consumer/.models/laya` (model ready immediately): turn on screen reading, use a few apps for ~10 minutes; Settings → AI model shows Ready and "Last labelled at …"; Today's timeline shows Laya categories (e.g. a browser on YouTube → entertainment); memory drops back after each batch (Task Manager: "Daylens Brain" appears briefly, then exits).
2. Real download: launch without `DAYLENS_MODEL_DIR` on a machine/profile without the model; progress banner on Today; quit mid-download and relaunch → resumes; ends in Ready.
3. Onboarding (fresh profile): "Your screen" step, off by default; turning it on → reading and download start after "Start my day". Existing profile without the answer → Today card; Not now hides it permanently.
