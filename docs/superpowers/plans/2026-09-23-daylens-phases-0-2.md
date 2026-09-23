# Daylens Phases 0–2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove Laya runs from TypeScript via ONNX and that Windows OCR is fast enough (Phase 0), extract the shared tracking code into `packages/core` (Phase 1), and ship a runnable Daylens app shell with the Today dashboard showing screen time, per-category/app usage, a day timeline, a health score and weekly bars (Phase 2).

**Architecture:** Phase 0 adds a Python toolchain in `tools/laya/` that produces golden labels and an ONNX export, plus a TypeScript port of Laya's input formatting/post-processing in `apps/consumer/src/main/brain/laya.ts` verified against those goldens. Phase 1 moves tracker/DB/rollup code from `apps/agent` into `packages/core` (consumed as TypeScript source, bundled by electron-vite). Phase 2 builds `apps/consumer` (Electron + React 19, plain CSS from the approved mockups) on top of `@worksight/core`; all numbers are computed by pure, unit-tested functions in `apps/consumer/src/main/day/`.

**Tech Stack:** Electron 33, electron-vite 2, React 19, TypeScript 5.7, Vitest 2, better-sqlite3, active-win, uiohook-napi, zod; Phase 0: Python 3.11, PyTorch (CPU), transformers, onnx/onnxruntime, `onnxruntime-node`, `@huggingface/transformers` (tokenizer), Windows.Media.Ocr via PowerShell 5.1.

**Spec:** `docs/superpowers/specs/2026-09-23-daylens-consumer-app-design.md` (UI source of truth: `docs/superpowers/specs/assets/daylens-mockups/`).

## Global Constraints

- Platform: Windows 10/11 only for Daylens v1. Shell for commands below: Git Bash (the repo's default), run from the repo root unless a step says otherwise.
- Branch: `feat/daylens-consumer`. Every commit message ends with a blank line then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- pnpm with `node-linker=hoisted` (see `.npmrc`). Workspace packages are consumed as **TypeScript source**; `@worksight/core` MUST be a **devDependency** of each app so electron-vite bundles it (dependencies are externalized). Native deps (`better-sqlite3`, `active-win`, `uiohook-napi`) MUST be listed in each app's `dependencies`.
- ABI dance (existing): `pretest` runs `pnpm rebuild better-sqlite3` (Node ABI); `predev` runs `scripts/rebuild-native.cjs` (Electron ABI). To read a DB outside Electron use Node while on the Node ABI.
- `apps/agent` behaviour must not change. Its tests and typecheck must stay green after every task.
- Design tokens (spec §4, verbatim): background `#FBF8F4`, panel `#F2EBE6`, ink `#171717`, muted `#77716C`, line `#E7DFD8`; lavender `#D8D2FC` (work), mint `#BFEBD3` (learning/health), pink `#F4C6C8` (social), peach `#F9DDB9` (entertainment). Font DM Sans, self-hosted (app must work offline). Motion `--spring: cubic-bezier(.2,1.3,.35,1)`, `--ease: cubic-bezier(.22,.8,.26,1)`. CSS keyframes/transitions only — no animation library. Honour `prefers-reduced-motion`.
- Screenshots are never written to disk by product code.
- Tests: Vitest, colocated `*.test.ts`, `environment: 'node'`.

## Review Focus

1. **In-progress and crashed sessions** — the current focus session has `endedAt = null`; the dashboard must count it up to "now", while an older `null`-ended session (crash leftover) must count as 0, not "until now". → test in Task 10.
2. **Sessions spanning midnight** — a session 23:50→00:20 must contribute 20 min to today and must not vanish because the tracker dates sessions by start. → test in Task 10.
3. **Away from the PC with a window focused** — no-input stretches ≥ 10 min must not count as screen time (the tracker keeps the session open). Short pauses (< 10 min) still count. → test in Task 10.
4. **Lock screen** — `LockApp.exe` sessions must never count as screen time. → test in Task 10.
5. **Empty first day** — no rows at all must render zeros: health score 100, no `NaN` anywhere, week bars of height 0. → tests in Tasks 9 and 10.

---

## Phase 0 — Spike: Laya → ONNX, Windows OCR latency

Outcome: `tools/laya/SPIKE-RESULTS.md` records GO (approach A: ONNX) or NO-GO (fallback B: Python sidecar) for Laya, and the OCR median latency. Phases 1–2 do not depend on the result — continue with Task 5 either way, but tell the human partner the outcome.

### Task 1: Laya reference labels and golden set (Python)

**Files:**
- Create: `tools/laya/requirements.txt`
- Create: `tools/laya/questions.json`
- Create: `tools/laya/samples.jsonl`
- Create: `tools/laya/make_golden.py`
- Modify: `.gitignore`
- Output (committed): `tools/laya/golden.root.json`, `tools/laya/golden.typed-decisions.json`, `tools/laya/sequences.json`, `tools/laya/golden.json`

**Interfaces:**
- Produces: `questions.json` — the single source of the four Laya questions (TS reads it too). `golden.json` — `[{ id, state, answers: { [qid]: { choice?: string, score?: number, probabilities: Record<string, number>, confidence: number } } }]`. `sequences.json` — `[{ id, qid, ids: number[], markers: number[] }]` from Python `build_sequence` for the chosen checkpoint.

Background: Laya (`convaiinnovations/laya`) is a ModernBERT-large encoder + decision head. Its HF repo ships the reference code: `rl_agent_api.py` (`RLAgent.system_one(state, questions)`) and `rl_common.py` (`build_sequence`, `DecisionModel`). Each question becomes one sequence `[CLS] "<type> question: <instructions>" [SEP] [MASK] opt0 [MASK] opt1 … [SEP] <state> [SEP]`; the head scores each `[MASK]`. Two checkpoints exist: repo root (`max_len` 512) and `typed-decisions/` (`max_len` 1024). This task measures which labels our screen text better.

- [ ] **Step 1: Ignore local artifacts**

Append to `.gitignore`:

```gitignore

# Daylens local model files + Laya tooling venv
apps/consumer/.models/
tools/laya/.venv/
```

- [ ] **Step 2: Create the Python environment**

`tools/laya/requirements.txt`:

```text
--extra-index-url https://download.pytorch.org/whl/cpu
torch>=2.4
transformers>=4.48
safetensors
huggingface_hub
numpy
onnx>=1.16
onnxruntime>=1.19
```

Run:

```bash
cd tools/laya && py -3.11 -m venv .venv && source .venv/Scripts/activate && pip install -r requirements.txt && python -c "import torch, transformers, onnxruntime; print(torch.__version__, transformers.__version__, onnxruntime.__version__)"
```

Expected: three version numbers print, no errors.

- [ ] **Step 3: Write the questions (shared with TypeScript)**

`tools/laya/questions.json`:

```json
{
  "category": {
    "type": "choice",
    "instructions": "Which kind of activity is the user doing on this screen?",
    "criteria": {
      "work": "job or study tasks: coding, documents, spreadsheets, design, admin",
      "learning": "tutorials, documentation, courses, educational videos",
      "social": "social media feeds, personal messaging, forums",
      "entertainment": "videos, streaming, games, memes, music for fun",
      "communication": "email, work chat, calendars, meetings",
      "other": "system settings, file management, shopping, anything else"
    }
  },
  "activity": {
    "type": "choice",
    "instructions": "What is the user doing right now?",
    "criteria": ["coding", "writing", "reading", "watching", "scrolling", "chatting", "designing", "gaming", "browsing", "other"]
  },
  "stuck": {
    "type": "score",
    "instructions": "How stuck or blocked does the user appear on their current task?",
    "criteria": ["working smoothly", "minor friction, searching for answers", "visible errors, failures or repeated attempts"]
  },
  "distraction": {
    "type": "score",
    "instructions": "How distracting is this screen compared with focused work?",
    "criteria": ["on-task", "mild detour", "infinite feed, autoplay, clickbait or unrelated to work"]
  }
}
```

- [ ] **Step 4: Write 48 labelled screen-text samples (8 per category)**

`tools/laya/samples.jsonl` (one JSON object per line; `text` imitates Windows OCR output of the active window):

```jsonl
{"id":1,"app":"Visual Studio Code","title":"invite.tsx - worksight - Visual Studio Code","text":"src > app > invite.tsx export async function acceptInvite(token: string) { const { data, error } = await supabase.rpc('accept_invite', { token }); if (error) throw error; return data }","expect_category":"work"}
{"id":2,"app":"Microsoft Excel","title":"Q3-budget.xlsx - Excel","text":"Revenue Q1 Q2 Q3 Total =SUM(B2:D2) Marketing 12,400 13,100 15,900 Payroll 88,000 88,000 91,500 Sheet1 Sheet2","expect_category":"work"}
{"id":3,"app":"Figma","title":"Onboarding flow - Figma","text":"Frame 12 Auto layout Fill FBF8F4 Corner radius 28 Components Assets Prototype Share Design Inspect","expect_category":"work"}
{"id":4,"app":"Windows Terminal Host","title":"Windows PowerShell","text":"PS C:/repo> pnpm test  src/tracking/tracker.test.ts (12 tests) Test Files 9 passed Tests 64 passed Duration 3.2s","expect_category":"work"}
{"id":5,"app":"Microsoft Word","title":"Project proposal.docx - Word","text":"1. Executive summary This proposal outlines the migration of the billing service to the new platform. 2. Timeline and budget","expect_category":"work"}
{"id":6,"app":"Google Chrome","title":"Fix invite flow by aaron - Pull Request #42 - GitHub - Google Chrome","text":"Files changed 4 Conversation Commits 3 Review requested Approve Merge pull request src/app/invite.tsx +12 -4","expect_category":"work"}
{"id":7,"app":"Android Studio","title":"MainActivity.kt - MyApp","text":"class MainActivity : AppCompatActivity() { override fun onCreate(savedInstanceState: Bundle?) { super.onCreate(savedInstanceState) Gradle sync finished","expect_category":"work"}
{"id":8,"app":"Google Chrome","title":"Sprint 14 board - Jira - Google Chrome","text":"To do In progress Done WS-212 Add retry to sync engine Story points 3 Assignee Aaron WS-214 Fix tray icon","expect_category":"work"}
{"id":9,"app":"Google Chrome","title":"Understanding React Server Components - YouTube - Google Chrome","text":"React Conf 2025 Understanding React Server Components 48:12 Transcript Chapters Next: Suspense deep dive","expect_category":"learning"}
{"id":10,"app":"Google Chrome","title":"Getting Started: Layouts and Pages | Next.js - Google Chrome","text":"Docs App Router Getting Started Layouts and Pages A page is UI that is rendered on a specific route. Creating a page","expect_category":"learning"}
{"id":11,"app":"Google Chrome","title":"Machine Learning Specialization | Coursera - Google Chrome","text":"Week 2 Gradient descent for multiple linear regression Video 12 min Practice quiz Next item Course notes","expect_category":"learning"}
{"id":12,"app":"Google Chrome","title":"Integration by parts | Khan Academy - Google Chrome","text":"Integration by parts: integral of u dv = uv - integral of v du Practice 3 of 5 Check answer Get help Hint","expect_category":"learning"}
{"id":13,"app":"Google Chrome","title":"Python For Loops - W3Schools - Google Chrome","text":"Python For Loops A for loop is used for iterating over a sequence Example fruits = ['apple', 'banana'] for x in fruits: print(x) Try it Yourself","expect_category":"learning"}
{"id":14,"app":"Anki","title":"Anki - Spanish vocab","text":"Donde esta la biblioteca? Show answer Again Hard Good Easy 12 new 40 review","expect_category":"learning"}
{"id":15,"app":"Google Chrome","title":"Duolingo - Google Chrome","text":"Translate this sentence Je voudrais un cafe s'il vous plait Check Skip Lesson 4 of 10 French","expect_category":"learning"}
{"id":16,"app":"Google Chrome","title":"Array.prototype.reduce() - JavaScript | MDN - Google Chrome","text":"The reduce() method of Array instances executes a user-supplied reducer callback function on each element Syntax reduce(callbackFn, initialValue)","expect_category":"learning"}
{"id":17,"app":"Google Chrome","title":"Instagram - Google Chrome","text":"Home Search Explore Reels Messages Liked by sam_k and 2,341 others View all 88 comments Suggested for you Follow","expect_category":"social"}
{"id":18,"app":"Discord","title":"#general | Gaming Crew - Discord","text":"jake: anyone on tonight? mia: yeah after 9 lol @here new patch dropped Message #general","expect_category":"social"}
{"id":19,"app":"Google Chrome","title":"Home / X - Google Chrome","text":"For you Following What is happening?! Post 12K reposts Trending in India Show more Who to follow","expect_category":"social"}
{"id":20,"app":"Google Chrome","title":"r/pcmasterrace - Reddit - Google Chrome","text":"Posted by u/throwaway 5h My first build! 2.3k upvotes 412 comments Join Share Sort by Best","expect_category":"social"}
{"id":21,"app":"WhatsApp","title":"WhatsApp","text":"Mom: did you eat? You: yes Priya: see you at 7? Type a message Chats Status Communities","expect_category":"social"}
{"id":22,"app":"Google Chrome","title":"Facebook - Google Chrome","text":"What's on your mind? Stories Reels Marketplace John shared a memory 5 years ago Like Comment Share","expect_category":"social"}
{"id":23,"app":"Google Chrome","title":"TikTok - Make Your Day - Google Chrome","text":"For You Following LIVE #fyp #funny 1.2M likes 8,402 comments original sound Share","expect_category":"social"}
{"id":24,"app":"Telegram Desktop","title":"Telegram","text":"Crypto Chat 12,402 members Pinned message Saved Messages you: link here Write a message...","expect_category":"social"}
{"id":25,"app":"Google Chrome","title":"Minecraft but every block is random - YouTube - Google Chrome","text":"Minecraft but every block is random 2.4M views Subscribe Up next Autoplay I survived 100 days in hardcore","expect_category":"entertainment"}
{"id":26,"app":"Steam Client WebHelper","title":"Steam","text":"STORE LIBRARY COMMUNITY Elden Ring PLAY Last played today Achievements 34/42 Friends activity","expect_category":"entertainment"}
{"id":27,"app":"Google Chrome","title":"Netflix - Google Chrome","text":"Stranger Things Season 4 Episode 3 Skip intro Next episode Audio and subtitles Continue watching","expect_category":"entertainment"}
{"id":28,"app":"Spotify","title":"Spotify Premium","text":"Liked Songs 482 songs Now playing Blinding Lights The Weeknd Shuffle Repeat Queue","expect_category":"entertainment"}
{"id":29,"app":"Riot Client","title":"League of Legends","text":"PLAY Ranked Solo/Duo Find match Champions Loot Store Honor Missions","expect_category":"entertainment"}
{"id":30,"app":"Google Chrome","title":"xQc - Twitch - Google Chrome","text":"LIVE 84,212 viewers Just Chatting Chat PogChamp KEKW Subscribe with Prime Follow","expect_category":"entertainment"}
{"id":31,"app":"Google Chrome","title":"9GAG - Go Fun The World - Google Chrome","text":"Hot Trending Fresh when the code works on the first try 12.4k points 402 comments Save","expect_category":"entertainment"}
{"id":32,"app":"deadlock.exe","title":"Deadlock","text":"Match found Lane Yellow Souls 12,400 Abilities Shop Kill feed Respawn in 12","expect_category":"entertainment"}
{"id":33,"app":"Microsoft Outlook","title":"Inbox - aaron@company.com - Outlook","text":"Focused Other Re: Invoice 2231 Hi Aaron, please find attached the updated invoice Reply Reply all Forward","expect_category":"communication"}
{"id":34,"app":"Slack","title":"#eng-standup (Channel) - Acme - Slack","text":"Today: finish sync retry Blockers: none Thread 4 replies Message #eng-standup Huddle","expect_category":"communication"}
{"id":35,"app":"Google Chrome","title":"Inbox (12) - Gmail - Google Chrome","text":"Compose Inbox Starred Sent Stripe: Your invoice is ready Google Calendar: Invitation: Design review","expect_category":"communication"}
{"id":36,"app":"Microsoft Teams","title":"Chat | Microsoft Teams","text":"Meeting in 5 min Weekly planning Join Chat Files Priya: can you share the deck?","expect_category":"communication"}
{"id":37,"app":"Google Chrome","title":"Google Calendar - Week of September 21 - Google Chrome","text":"Mon 22 Standup 9:30 Design review 14:00 Tue 23 1:1 with manager Create Today","expect_category":"communication"}
{"id":38,"app":"Zoom Workplace","title":"Zoom Meeting","text":"Mute Stop Video Participants 6 Share Screen Recording Reactions Leave","expect_category":"communication"}
{"id":39,"app":"Rocket.Chat","title":"Rocket.Chat","text":"# support Channel user123: login page not loading agent: can you clear cache? Send","expect_category":"communication"}
{"id":40,"app":"Google Chrome","title":"Meet - abc-defg-hij - Google Chrome","text":"You are presenting 5 participants Raise hand Leave call Captions Turn off camera","expect_category":"communication"}
{"id":41,"app":"Windows Explorer","title":"Downloads - File Explorer","text":"Name Date modified Type Size setup.exe Application 45 MB invoice.pdf screenshot_2026.png","expect_category":"other"}
{"id":42,"app":"Settings","title":"Settings","text":"System Display Sound Notifications Focus Power and battery Storage Nearby sharing","expect_category":"other"}
{"id":43,"app":"Task Manager","title":"Task Manager","text":"Processes Performance CPU 12% Memory 64% Disk 1% Google Chrome 1.2 GB End task","expect_category":"other"}
{"id":44,"app":"Google Chrome","title":"Amazon.in: Wireless mouse - Google Chrome","text":"Logitech M331 Silent Plus Rs 1,299 Add to Cart Buy Now Customer reviews 4.4 out of 5","expect_category":"other"}
{"id":45,"app":"Proton VPN","title":"Proton VPN","text":"Connected India 12 Quick Connect Disconnect Secure Core NetShield","expect_category":"other"}
{"id":46,"app":"Norton 360","title":"Norton 360","text":"You are protected Device Security Scan now Last scan: 2 days ago","expect_category":"other"}
{"id":47,"app":"Google Chrome","title":"Google Maps - Google Chrome","text":"Directions Your location to Phoenix Mall 24 min via Ring Road Traffic Start","expect_category":"other"}
{"id":48,"app":"Settings","title":"Settings","text":"Windows Update You're up to date Last checked: Today Pause updates Update history","expect_category":"other"}
```

- [ ] **Step 5: Write the golden generator**

`tools/laya/make_golden.py`:

```python
"""Run official Laya (RLAgent) over samples.jsonl.

Writes golden.<ckpt>.json (answers) and, with --sequences, sequences.json
(Python build_sequence output) used by the TypeScript port's exact-match test.
Usage:  python make_golden.py --ckpt root|typed-decisions [--sequences]
"""
import argparse
import json
import pathlib
import sys

from huggingface_hub import snapshot_download

ROOT = pathlib.Path(__file__).parent
ap = argparse.ArgumentParser()
ap.add_argument("--ckpt", choices=["root", "typed-decisions"], default="root")
ap.add_argument("--sequences", action="store_true")
args = ap.parse_args()

snap = pathlib.Path(snapshot_download("convaiinnovations/laya", allow_patterns=[
    "rl_agent_api.py", "rl_common.py", "rl_agent_config.json", "model.safetensors", "encoder/*", "tokenizer/*",
    "typed-decisions/*"]))
sys.path.insert(0, str(snap))
from rl_agent_api import RLAgent  # noqa: E402
from rl_common import build_sequence  # noqa: E402

mdir = snap if args.ckpt == "root" else snap / args.ckpt
agent = RLAgent(str(mdir), device="cpu")
questions = json.loads((ROOT / "questions.json").read_text(encoding="utf-8"))
samples = [json.loads(l) for l in (ROOT / "samples.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]


def state_of(s):
    return "App: %s\nWindow: %s\nScreen text: %s" % (s["app"], s["title"], s["text"][:1500])


golden, seqs, correct = [], [], 0
for s in samples:
    st = state_of(s)
    ans = agent.system_one(st, questions)["answers"]
    golden.append({"id": s["id"], "state": st, "answers": {
        q: {k: a[k] for k in ("choice", "score", "probabilities", "confidence") if k in a} for q, a in ans.items()}})
    ok = ans["category"]["choice"] == s["expect_category"]
    correct += ok
    print("%3d %s expect=%-13s got=%-13s conf=%.2f activity=%-9s stuck=%.2f distraction=%.2f" % (
        s["id"], "OK " if ok else "BAD", s["expect_category"], ans["category"]["choice"], ans["category"]["confidence"],
        ans["activity"]["choice"], ans["stuck"]["score"], ans["distraction"]["score"]))
    if args.sequences:
        for qid, q in questions.items():
            ids, markers = build_sequence(agent.tok, st, RLAgent._to_internal(q), agent.cfg["max_len"], agent.cfg["head_max_len"])
            seqs.append({"id": s["id"], "qid": qid, "ids": ids, "markers": markers})

(ROOT / ("golden.%s.json" % args.ckpt)).write_text(json.dumps(golden, indent=1), encoding="utf-8")
if args.sequences:
    (ROOT / "sequences.json").write_text(json.dumps(seqs), encoding="utf-8")
print("\n[%s] category accuracy: %d/%d = %.0f%%" % (args.ckpt, correct, len(samples), 100.0 * correct / len(samples)))
```

- [ ] **Step 6: Run both checkpoints**

```bash
cd tools/laya && source .venv/Scripts/activate && python make_golden.py --ckpt root && python make_golden.py --ckpt typed-decisions
```

Expected: 48 lines each (first run downloads ~1.6 GB), ending `[root] category accuracy: N/48 = X%` and `[typed-decisions] …`. Write both accuracies down; they go into SPIKE-RESULTS.md (Task 4).

- [ ] **Step 7: Choose the checkpoint and freeze the golden set**

Pick the checkpoint with the higher category accuracy (tie → `root`, shorter context = faster). Then, with `<ckpt>` = your choice:

```bash
cd tools/laya && source .venv/Scripts/activate && python make_golden.py --ckpt <ckpt> --sequences && cp golden.<ckpt>.json golden.json
```

Expected: `sequences.json` (192 entries = 48 × 4) and `golden.json` exist. **Usefulness gate:** chosen accuracy ≥ 80 % (≥ 39/48). If below, still continue, but flag it in SPIKE-RESULTS.md — it means the question wording needs work before Phase 4.

- [ ] **Step 8: Commit**

```bash
git add .gitignore tools/laya/requirements.txt tools/laya/questions.json tools/laya/samples.jsonl tools/laya/make_golden.py tools/laya/golden*.json tools/laya/sequences.json
git commit -m "spike(laya): reference labels + golden set for Daylens screen text

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: Export Laya to ONNX and check parity in Python

**Files:**
- Create: `tools/laya/export_onnx.py`
- Output (not committed, gitignored): `apps/consumer/.models/laya/{laya.onnx, laya.int8.onnx, tokenizer.json, tokenizer_config.json, laya-meta.json}`

**Interfaces:**
- Consumes: checkpoint choice from Task 1 (`--ckpt`), `golden.json`, `questions.json`, `samples.jsonl`.
- Produces: ONNX graph with inputs `input_ids` int64 [b,l], `attention_mask` int64 [b,l], `marker_pos` int64 [b,k], `marker_mask` int64 [b,k] (0/1), `qtype` int64 [b] (choice=0, score=1); outputs `logits` float32 [b,k] (masked slots = -1e4), `act` float32 [b,2]. `laya-meta.json`: `{ ckpt, max_len, head_max_len, temperature: number[3], temperature_by_options: Record<string, number>, cls_id, sep_id, mask_id, pad_id, mask_token }`.

- [ ] **Step 1: Write the exporter**

`tools/laya/export_onnx.py`:

```python
"""Export Laya's DecisionModel to ONNX (fp32 + int8) and verify parity against PyTorch and golden.json.

Usage: python export_onnx.py --ckpt root|typed-decisions
"""
import argparse
import json
import pathlib
import shutil
import sys

import numpy as np
import onnxruntime as ort
import torch
from huggingface_hub import snapshot_download
from onnxruntime.quantization import QuantType, quantize_dynamic
from safetensors.torch import load_file

ROOT = pathlib.Path(__file__).parent
OUT = ROOT.parent.parent / "apps" / "consumer" / ".models" / "laya"
ap = argparse.ArgumentParser()
ap.add_argument("--ckpt", choices=["root", "typed-decisions"], default="root")
args = ap.parse_args()

snap = pathlib.Path(snapshot_download("convaiinnovations/laya", allow_patterns=[
    "rl_agent_api.py", "rl_common.py", "rl_agent_config.json", "model.safetensors", "encoder/*", "tokenizer/*",
    "typed-decisions/*"]))
sys.path.insert(0, str(snap))
from rl_agent_api import RLAgent  # noqa: E402
from rl_common import QTYPES, DecisionModel, build_sequence, collate_items  # noqa: E402
from transformers import AutoConfig, AutoModel, AutoTokenizer  # noqa: E402

mdir = snap if args.ckpt == "root" else snap / args.ckpt
cfg = json.loads((mdir / "rl_agent_config.json").read_text())
tok = AutoTokenizer.from_pretrained(str(mdir / "tokenizer"))

# Rebuild with EAGER attention (exportable) and load the same weights. Disable the
# nn.TransformerEncoderLayer fast path, which does not trace to ONNX.
torch.backends.mha.set_fastpath_enabled(False)
enc = AutoModel.from_config(AutoConfig.from_pretrained(str(mdir / "encoder")), attn_implementation="eager")
enc.config.reference_compile = False
model = DecisionModel(enc, cfg["head_layers"], len(cfg["act_costs"]) + 1)
model.load_state_dict(load_file(str(mdir / "model.safetensors")), strict=True)
model = model.float().eval()


class Export(torch.nn.Module):
    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, input_ids, attention_mask, marker_pos, marker_mask, qtype):
        return self.m(input_ids, attention_mask, marker_pos, marker_mask.bool(), qtype)


questions = json.loads((ROOT / "questions.json").read_text(encoding="utf-8"))
golden = json.loads((ROOT / "golden.json").read_text(encoding="utf-8"))


def batch_for(state):
    items = []
    for q in questions.values():
        iq = RLAgent._to_internal(q)
        ids, markers = build_sequence(tok, state, iq, cfg["max_len"], cfg["head_max_len"])
        items.append({"ids": ids, "markers": markers, "qtype": QTYPES[iq["t"]], "target": [0.0] * len(markers),
                      "label": -1, "episode": 0, "ep_step": 0, "ep_len": 1})
    b = collate_items([items], tok.pad_token_id)
    return b["input_ids"], b["attention_mask"], b["marker_pos"], b["marker_mask"].long(), b["qtype"]


OUT.mkdir(parents=True, exist_ok=True)
onnx_path = OUT / "laya.onnx"
example = batch_for(golden[0]["state"])
torch.onnx.export(
    Export(model), example, str(onnx_path), opset_version=17, dynamo=False,
    input_names=["input_ids", "attention_mask", "marker_pos", "marker_mask", "qtype"], output_names=["logits", "act"],
    dynamic_axes={"input_ids": {0: "b", 1: "l"}, "attention_mask": {0: "b", 1: "l"}, "marker_pos": {0: "b", 1: "k"},
                  "marker_mask": {0: "b", 1: "k"}, "qtype": {0: "b"}, "logits": {0: "b", 1: "k"}, "act": {0: "b"}})
print("exported", onnx_path, "%.0f MB" % (onnx_path.stat().st_size / 1e6))
quantize_dynamic(str(onnx_path), str(OUT / "laya.int8.onnx"), weight_type=QuantType.QInt8)
print("quantized", OUT / "laya.int8.onnx", "%.0f MB" % ((OUT / "laya.int8.onnx").stat().st_size / 1e6))

# --- parity: torch(eager) vs ORT fp32 logits, and ORT decisions vs golden (fp32 and int8)
names = ["input_ids", "attention_mask", "marker_pos", "marker_mask", "qtype"]
sessions = {v: ort.InferenceSession(str(OUT / f), providers=["CPUExecutionProvider"])
            for v, f in (("fp32", "laya.onnx"), ("int8", "laya.int8.onnx"))}
max_diff, agree, total, score_err = 0.0, {"fp32": 0, "int8": 0}, 0, {"fp32": 0.0, "int8": 0.0}
qids = list(questions.keys())
with torch.no_grad():
    for g in golden:
        b = batch_for(g["state"])
        t_logits = model(b[0], b[1], b[2], b[3].bool(), b[4])[0].numpy()
        feeds = {n: x.numpy().astype(np.int64) for n, x in zip(names, b)}
        for v, sess in sessions.items():
            o_logits = sess.run(["logits"], feeds)[0]
            if v == "fp32":
                max_diff = max(max_diff, float(np.abs(o_logits - t_logits)[b[3].numpy() == 1].max()))
            for r, qid in enumerate(qids):
                q = RLAgent._to_internal(questions[qid])
                k = int(b[3][r].sum())
                bucket = ("choice" if q["t"] == "choice" else "score") + ":" + ("2" if k <= 2 else "3-5" if k <= 5 else "6-10" if k <= 10 else "11+")
                temp = cfg.get("temperature_by_options", {}).get(bucket, cfg["temperature"][QTYPES[q["t"]]])
                z = o_logits[r, :k] / temp
                p = np.exp(z - z.max()); p /= p.sum()
                if q["t"] == "choice":
                    agree[v] += list(q["crit"].keys())[int(p.argmax())] == g["answers"][qid]["choice"]
                    total += v == "fp32"
                else:
                    score_err[v] = max(score_err[v], abs(float((np.arange(k) * p).sum()) - g["answers"][qid]["score"]))

print("max |logit diff| torch vs ORT fp32: %.5f (want < 1e-3)" % max_diff)
for v in ("fp32", "int8"):
    print("%s: choice agreement %d/%d = %.1f%% (want >= 98%%), max score error %.4f (want <= 0.05)" % (
        v, agree[v], total, 100.0 * agree[v] / total, score_err[v]))

for f in ("tokenizer.json", "tokenizer_config.json"):
    shutil.copy(mdir / "tokenizer" / f, OUT / f)
(OUT / "laya-meta.json").write_text(json.dumps({
    "ckpt": args.ckpt, "max_len": cfg["max_len"], "head_max_len": cfg["head_max_len"],
    "temperature": cfg["temperature"], "temperature_by_options": cfg.get("temperature_by_options", {}),
    "cls_id": tok.cls_token_id, "sep_id": tok.sep_token_id, "mask_id": tok.mask_token_id,
    "pad_id": tok.pad_token_id, "mask_token": tok.mask_token}, indent=1), encoding="utf-8")
print("wrote", OUT / "laya-meta.json")
```

- [ ] **Step 2: Run the export**

```bash
cd tools/laya && source .venv/Scripts/activate && python export_onnx.py --ckpt <ckpt from Task 1>
```

Expected output (numbers vary): `exported … laya.onnx ~1600 MB`, `quantized … ~420 MB`, `max |logit diff| … < 1e-3`, and two agreement lines. Record every number for SPIKE-RESULTS.md.

If `torch.onnx.export` raises: (a) error mentions `_transformer_encoder_layer_fwd` / native MHA → confirm `set_fastpath_enabled(False)` ran before the model was built; (b) the exporter writes weights as external data (a `laya.onnx.data` or many tensor files next to `laya.onnx`) → that is fine; keep them in the same folder, `InferenceSession` finds them automatically; (c) any other ModernBERT op failure → record the exact error in SPIKE-RESULTS.md, mark Laya **NO-GO (fallback B)**, skip Task 3 Steps 5–7, continue with Task 4.

- [ ] **Step 3: Commit**

```bash
git add tools/laya/export_onnx.py
git commit -m "spike(laya): ONNX export (fp32 + int8) with torch/golden parity check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: Consumer package seed + TypeScript Laya runtime

**Files:**
- Create: `apps/consumer/package.json`
- Create: `apps/consumer/tsconfig.json`, `apps/consumer/tsconfig.node.json`, `apps/consumer/tsconfig.web.json`
- Create: `apps/consumer/vitest.config.ts`
- Create: `apps/consumer/src/main/brain/laya.ts`
- Test: `apps/consumer/src/main/brain/laya.test.ts` (pure, always runs)
- Test: `apps/consumer/src/main/brain/laya.parity.test.ts` (skipped unless model files exist)

**Interfaces:**
- Consumes: `tools/laya/questions.json`, `tools/laya/sequences.json`, `tools/laya/golden.json`, `apps/consumer/.models/laya/*` (Task 2).
- Produces (used by Phase 4 Brain):
  ```ts
  export type LayaQuestion =
    | { type: 'choice'; instructions: string; criteria: Record<string, string | null> | string[] }
    | { type: 'score'; instructions: string; criteria: string[] };
  export type LayaAnswer =
    | { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number }
    | { type: 'score'; score: number; probabilities: Record<string, number>; confidence: number };
  export interface LayaMeta { max_len: number; head_max_len: number; temperature: number[]; temperature_by_options: Record<string, number>; cls_id: number; sep_id: number; mask_id: number; pad_id: number; mask_token: string }
  export interface TokenEncoder { encode(text: string): number[] }   // no special tokens
  export function renderOptions(q: LayaQuestion): string[];
  export function buildSequence(enc: TokenEncoder, meta: LayaMeta, state: string, q: LayaQuestion): { ids: number[]; markers: number[] };
  export function tempBucket(qtype: 0 | 1, k: number): string;
  export function toAnswer(q: LayaQuestion, logits: number[], meta: LayaMeta): LayaAnswer;
  export function layaState(app: string, title: string | null, text: string | null): string;
  export interface LayaRunner { ask(state: string, questions: Record<string, LayaQuestion>): Promise<Record<string, LayaAnswer>> }
  export async function loadLaya(dir: string, onnxFile?: string): Promise<LayaRunner>;
  ```

- [ ] **Step 1: Seed the consumer package**

`apps/consumer/package.json`:

```json
{
  "name": "@worksight/consumer",
  "version": "0.0.0",
  "private": true,
  "description": "Daylens: see your day clearly",
  "main": "out/main/index.js",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.web.json && tsc --noEmit -p tsconfig.node.json"
  },
  "dependencies": {},
  "devDependencies": {
    "typescript": "^5.7.3",
    "vitest": "^2.1.8"
  }
}
```

`apps/consumer/tsconfig.json`:

```json
{ "files": [], "references": [{ "path": "./tsconfig.node.json" }, { "path": "./tsconfig.web.json" }] }
```

`apps/consumer/tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "strict": true, "esModuleInterop": true, "skipLibCheck": true,
    "resolveJsonModule": true, "noEmit": true, "types": ["node"]
  },
  "include": ["src/main/**/*", "src/preload/**/*", "src/shared/**/*"]
}
```

`apps/consumer/tsconfig.web.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "strict": true, "esModuleInterop": true, "skipLibCheck": true,
    "jsx": "react-jsx", "lib": ["ES2022", "DOM", "DOM.Iterable"], "noEmit": true
  },
  "include": ["src/renderer/**/*", "src/shared/**/*"]
}
```

`apps/consumer/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['src/**/*.test.ts'], environment: 'node' }
});
```

Then install the runtime deps (the tokenizer comes from transformers.js; pin `onnxruntime-node` to the exact version transformers.js itself depends on, so only one copy exists):

```bash
pnpm install && pnpm --filter @worksight/consumer add @huggingface/transformers@^3 && V=$(node -p "require('./node_modules/@huggingface/transformers/package.json').dependencies['onnxruntime-node']") && echo "onnxruntime-node $V" && pnpm --filter @worksight/consumer add "onnxruntime-node@$V"
```

Expected: both appear under `dependencies` in `apps/consumer/package.json`.

- [ ] **Step 2: Write the failing pure tests**

`apps/consumer/src/main/brain/laya.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderOptions, buildSequence, tempBucket, toAnswer, layaState, type LayaMeta, type TokenEncoder } from './laya';

const meta: LayaMeta = {
  max_len: 40, head_max_len: 24, temperature: [1, 1, 1], temperature_by_options: {},
  cls_id: 1, sep_id: 2, mask_id: 3, pad_id: 0, mask_token: '[MASK]'
};
// One token per character (code + 10) keeps positions easy to reason about.
const enc: TokenEncoder = { encode: (t) => [...t].map((c) => c.charCodeAt(0) + 10) };

describe('renderOptions', () => {
  it('renders choice criteria as "key: description" and bare keys for lists', () => {
    expect(renderOptions({ type: 'choice', instructions: 'x', criteria: { a: 'alpha', b: null } })).toEqual(['a: alpha', 'b']);
    expect(renderOptions({ type: 'choice', instructions: 'x', criteria: ['a', 'b'] })).toEqual(['a', 'b']);
  });
  it('renders score criteria as levels', () => {
    expect(renderOptions({ type: 'score', instructions: 'x', criteria: ['low', 'high'] })).toEqual(['level 0: low', 'level 1: high']);
  });
});

describe('buildSequence', () => {
  it('lays out [CLS] head [SEP] [MASK]opt… [SEP] state [SEP] with markers on the masks', () => {
    const { ids, markers } = buildSequence(enc, meta, 'st', { type: 'choice', instructions: 'q', criteria: ['a', 'b'] });
    expect(ids[0]).toBe(meta.cls_id);
    expect(markers).toHaveLength(2);
    for (const m of markers) expect(ids[m]).toBe(meta.mask_id);
    expect(ids[ids.length - 1]).toBe(meta.sep_id);
    // state tokens sit right before the final [SEP]
    expect(ids.slice(-3, -1)).toEqual(enc.encode('st'));
  });
  it('truncates the state so the sequence never exceeds max_len', () => {
    const { ids } = buildSequence(enc, meta, 'x'.repeat(500), { type: 'choice', instructions: 'q', criteria: ['a', 'b'] });
    expect(ids.length).toBeLessThanOrEqual(meta.max_len);
    expect(ids[ids.length - 1]).toBe(meta.sep_id);
  });
  it('replaces the literal mask token inside user text', () => {
    const { ids } = buildSequence(enc, meta, '[MASK]', { type: 'choice', instructions: 'q', criteria: ['a', 'b'] });
    expect(ids.filter((t) => t === meta.mask_id)).toHaveLength(2);
  });
});

describe('tempBucket', () => {
  it('buckets by question type and option count', () => {
    expect(tempBucket(0, 2)).toBe('choice:2');
    expect(tempBucket(0, 6)).toBe('choice:6-10');
    expect(tempBucket(1, 3)).toBe('score:3-5');
    expect(tempBucket(0, 12)).toBe('choice:11+');
  });
});

describe('toAnswer', () => {
  it('picks the argmax choice with zero confidence on a uniform distribution', () => {
    const a = toAnswer({ type: 'choice', instructions: 'q', criteria: ['a', 'b'] }, [0, 0], meta);
    expect(a.type).toBe('choice');
    if (a.type === 'choice') { expect(a.probabilities).toEqual({ a: 0.5, b: 0.5 }); expect(a.confidence).toBeCloseTo(0, 5); }
    const b = toAnswer({ type: 'choice', instructions: 'q', criteria: ['a', 'b'] }, [0, 20], meta);
    if (b.type === 'choice') { expect(b.choice).toBe('b'); expect(b.confidence).toBeGreaterThan(0.99); }
  });
  it('computes the expected level for scores', () => {
    const a = toAnswer({ type: 'score', instructions: 'q', criteria: ['l', 'm', 'h'] }, [-30, -30, 30], meta);
    if (a.type === 'score') expect(a.score).toBeCloseTo(2, 3);
  });
  it('applies the per-bucket temperature', () => {
    const hot = { ...meta, temperature_by_options: { 'choice:2': 1000 } };
    const a = toAnswer({ type: 'choice', instructions: 'q', criteria: ['a', 'b'] }, [0, 20], hot);
    if (a.type === 'choice') expect(a.probabilities.b).toBeLessThan(0.51);
  });
});

describe('layaState', () => {
  it('formats app, title and text (first 1500 chars) exactly like the Python golden generator', () => {
    expect(layaState('Code', 't', 'hello')).toBe('App: Code\nWindow: t\nScreen text: hello');
    expect(layaState('Code', null, null)).toBe('App: Code\nWindow: \nScreen text: ');
    expect(layaState('C', 't', 'x'.repeat(2000)).endsWith('x'.repeat(1500))).toBe(true);
    expect(layaState('C', 't', 'x'.repeat(2000))).toHaveLength('App: C\nWindow: t\nScreen text: '.length + 1500);
  });
});
```

- [ ] **Step 3: Run to confirm failure**

Run: `pnpm --filter @worksight/consumer test`
Expected: FAIL — `Failed to load url ./laya` (module not found).

- [ ] **Step 4: Implement `laya.ts`**

`apps/consumer/src/main/brain/laya.ts`:

```ts
// TypeScript port of Laya's reference inference (convaiinnovations/laya rl_common.py + rl_agent_api.py).
// Sequence layout and post-processing must stay byte-for-byte compatible with the Python code:
// laya.parity.test.ts checks it against tools/laya/{sequences,golden}.json.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type LayaQuestion =
  | { type: 'choice'; instructions: string; criteria: Record<string, string | null> | string[] }
  | { type: 'score'; instructions: string; criteria: string[] };

export type LayaAnswer =
  | { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: 'score'; score: number; probabilities: Record<string, number>; confidence: number };

export interface LayaMeta {
  max_len: number; head_max_len: number;
  temperature: number[]; temperature_by_options: Record<string, number>;
  cls_id: number; sep_id: number; mask_id: number; pad_id: number; mask_token: string;
}

export interface TokenEncoder { encode(text: string): number[] }

const QTYPE = { choice: 0, score: 1 } as const;
const round4 = (x: number): number => Math.round(x * 1e4) / 1e4;

function choiceCriteria(q: Extract<LayaQuestion, { type: 'choice' }>): Record<string, string | null> {
  return Array.isArray(q.criteria) ? Object.fromEntries(q.criteria.map((c) => [c, null])) : q.criteria;
}

export function renderOptions(q: LayaQuestion): string[] {
  if (q.type === 'choice') return Object.entries(choiceCriteria(q)).map(([k, v]) => (v ? `${k}: ${v}` : k));
  return q.criteria.map((c, i) => `level ${i}: ${c}`);
}

function optionKeys(q: LayaQuestion): string[] {
  return q.type === 'choice' ? Object.keys(choiceCriteria(q)) : q.criteria.map((_, i) => String(i));
}

export function buildSequence(enc: TokenEncoder, meta: LayaMeta, state: string, q: LayaQuestion): { ids: number[]; markers: number[] } {
  const strip = (s: string): string => s.split(meta.mask_token).join(' ');
  let headIds = enc.encode(`${q.type} question: ${strip(q.instructions)}`);
  let optIds = renderOptions(q).map((o) => [meta.mask_id, ...enc.encode(' ' + strip(o)).slice(0, 48)]);
  const used = (): number => optIds.reduce((a, o) => a + o.length, 0);
  let budget = meta.head_max_len - used();
  if (budget < 16) { // too many / too long options: shrink every option text evenly (mirrors Python)
    const per = Math.max(4, Math.floor((meta.head_max_len - 16) / Math.max(1, optIds.length)));
    optIds = optIds.map((o) => o.slice(0, per));
    budget = meta.head_max_len - used();
  }
  headIds = headIds.slice(0, Math.max(8, budget));
  const ids = [meta.cls_id, ...headIds, meta.sep_id];
  const markers: number[] = [];
  for (const o of optIds) { markers.push(ids.length); ids.push(...o); }
  ids.push(meta.sep_id);
  const room = Math.max(0, meta.max_len - ids.length - 1);
  const st = enc.encode(strip(state)).slice(0, room);
  const all = [...ids, ...st, meta.sep_id].slice(0, meta.max_len);
  return { ids: all, markers: markers.filter((m) => m < meta.max_len) };
}

export function tempBucket(qtype: 0 | 1, k: number): string {
  const size = k <= 2 ? '2' : k <= 5 ? '3-5' : k <= 10 ? '6-10' : '11+';
  return `${qtype === 0 ? 'choice' : 'score'}:${size}`;
}

export function toAnswer(q: LayaQuestion, logits: number[], meta: LayaMeta): LayaAnswer {
  const k = logits.length;
  const qt = QTYPE[q.type];
  const t = meta.temperature_by_options[tempBucket(qt, k)] ?? meta.temperature[qt];
  const z = logits.map((x) => x / t);
  const mx = Math.max(...z);
  const e = z.map((x) => Math.exp(x - mx));
  const s = e.reduce((a, b) => a + b, 0);
  const p = e.map((x) => x / s);
  const ent = -p.reduce((a, v) => a + v * Math.log(Math.min(1, Math.max(v, 1e-12))), 0);
  const confidence = round4(k < 2 ? 1 : 1 - ent / Math.log(k));
  const keys = optionKeys(q);
  const probabilities = Object.fromEntries(keys.map((key, i) => [key, round4(p[i])]));
  if (q.type === 'choice') {
    const best = p.indexOf(Math.max(...p));
    return { type: 'choice', choice: keys[best], probabilities, confidence };
  }
  return { type: 'score', score: round4(p.reduce((a, v, i) => a + i * v, 0)), probabilities, confidence };
}

export function layaState(app: string, title: string | null, text: string | null): string {
  return `App: ${app}\nWindow: ${title ?? ''}\nScreen text: ${(text ?? '').slice(0, 1500)}`;
}

export interface LayaRunner { ask(state: string, questions: Record<string, LayaQuestion>): Promise<Record<string, LayaAnswer>> }

export async function loadLaya(dir: string, onnxFile = 'laya.onnx'): Promise<LayaRunner> {
  const [{ PreTrainedTokenizer }, ort] = await Promise.all([import('@huggingface/transformers'), import('onnxruntime-node')]);
  const read = (f: string): unknown => JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const tok = new PreTrainedTokenizer(read('tokenizer.json') as object, read('tokenizer_config.json') as object);
  const enc: TokenEncoder = { encode: (t) => tok.encode(t, { add_special_tokens: false }) as number[] };
  const meta = read('laya-meta.json') as LayaMeta;
  const session = await ort.InferenceSession.create(join(dir, onnxFile));

  return {
    async ask(state, questions) {
      const qids = Object.keys(questions);
      const seqs = qids.map((id) => {
        const s = buildSequence(enc, meta, state, questions[id]);
        if (s.markers.length !== renderOptions(questions[id]).length) throw new Error(`question ${id}: options do not fit in head_max_len=${meta.head_max_len}`);
        return s;
      });
      const n = seqs.length;
      const L = Math.max(...seqs.map((s) => s.ids.length));
      const K = Math.max(...seqs.map((s) => s.markers.length));
      const ids = new BigInt64Array(n * L).fill(BigInt(meta.pad_id));
      const att = new BigInt64Array(n * L);
      const mpos = new BigInt64Array(n * K);
      const mmask = new BigInt64Array(n * K);
      const qtype = new BigInt64Array(n);
      seqs.forEach((s, r) => {
        s.ids.forEach((v, i) => { ids[r * L + i] = BigInt(v); att[r * L + i] = 1n; });
        s.markers.forEach((m, i) => { mpos[r * K + i] = BigInt(m); mmask[r * K + i] = 1n; });
        qtype[r] = BigInt(QTYPE[questions[qids[r]].type]);
      });
      const out = await session.run({
        input_ids: new ort.Tensor('int64', ids, [n, L]),
        attention_mask: new ort.Tensor('int64', att, [n, L]),
        marker_pos: new ort.Tensor('int64', mpos, [n, K]),
        marker_mask: new ort.Tensor('int64', mmask, [n, K]),
        qtype: new ort.Tensor('int64', qtype, [n])
      });
      const logits = out.logits.data as Float32Array;
      return Object.fromEntries(qids.map((id, r) => [
        id, toAnswer(questions[id], Array.from(logits.subarray(r * K, r * K + seqs[r].markers.length)), meta)
      ]));
    }
  };
}
```

- [ ] **Step 5: Run pure tests to confirm they pass**

Run: `pnpm --filter @worksight/consumer test`
Expected: PASS (all tests in `laya.test.ts`).

- [ ] **Step 6: Write the parity test (real model, skipped when absent)**

`apps/consumer/src/main/brain/laya.parity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSequence, loadLaya, type LayaMeta, type LayaQuestion, type TokenEncoder } from './laya';

const here = fileURLToPath(new URL('.', import.meta.url));
const MODEL_DIR = process.env.LAYA_DIR ?? join(here, '../../../.models/laya');
const ONNX = process.env.LAYA_ONNX ?? 'laya.onnx';
const TOOLS = join(here, '../../../../../tools/laya');
const have = existsSync(join(MODEL_DIR, ONNX)) && existsSync(join(TOOLS, 'golden.json'));
const json = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;

describe.skipIf(!have)(`Laya ONNX parity (${ONNX})`, () => {
  const questions = json<Record<string, LayaQuestion>>(join(TOOLS, 'questions.json'));

  it('builds token sequences identical to Python build_sequence', async () => {
    const { PreTrainedTokenizer } = await import('@huggingface/transformers');
    const tok = new PreTrainedTokenizer(json(join(MODEL_DIR, 'tokenizer.json')), json(join(MODEL_DIR, 'tokenizer_config.json')));
    const enc: TokenEncoder = { encode: (t) => tok.encode(t, { add_special_tokens: false }) as number[] };
    const meta = json<LayaMeta>(join(MODEL_DIR, 'laya-meta.json'));
    const golden = json<{ id: number; state: string }[]>(join(TOOLS, 'golden.json'));
    const stateOf = new Map(golden.map((g) => [g.id, g.state]));
    const seqs = json<{ id: number; qid: string; ids: number[]; markers: number[] }[]>(join(TOOLS, 'sequences.json'));
    let mismatches = 0;
    for (const s of seqs) {
      const got = buildSequence(enc, meta, stateOf.get(s.id)!, questions[s.qid]);
      if (JSON.stringify(got.ids) !== JSON.stringify(s.ids) || JSON.stringify(got.markers) !== JSON.stringify(s.markers)) mismatches++;
    }
    expect(mismatches).toBe(0);
  });

  it('matches golden decisions: >= 98% choices, scores within 0.05', async () => {
    const laya = await loadLaya(MODEL_DIR, ONNX);
    const golden = json<{ id: number; state: string; answers: Record<string, { choice?: string; score?: number }> }[]>(join(TOOLS, 'golden.json'));
    let agree = 0, total = 0, worstScore = 0;
    const t0 = Date.now();
    for (const g of golden) {
      const ans = await laya.ask(g.state, questions);
      for (const [qid, a] of Object.entries(ans)) {
        if (a.type === 'choice') { total++; if (a.choice === g.answers[qid].choice) agree++; }
        else worstScore = Math.max(worstScore, Math.abs(a.score - (g.answers[qid].score ?? 0)));
      }
    }
    console.log(`[laya parity ${ONNX}] choices ${agree}/${total}, worst score error ${worstScore.toFixed(4)}, ${((Date.now() - t0) / golden.length).toFixed(0)} ms/read`);
    expect(agree / total).toBeGreaterThanOrEqual(0.98);
    expect(worstScore).toBeLessThanOrEqual(0.05);
  }, 600_000);
});
```

- [ ] **Step 7: Run parity for fp32 and int8**

```bash
cd apps/consumer && npx vitest run src/main/brain/laya.parity.test.ts && LAYA_ONNX=laya.int8.onnx npx vitest run src/main/brain/laya.parity.test.ts
```

Expected: both `it`s PASS for fp32; the log line prints agreement and **ms/read** (record both runs for SPIKE-RESULTS.md). int8 may fail the bar — that is a finding, not a blocker: record it. If the sequence test fails for fp32, the tokenizer/format port is wrong: print the first mismatching `{id,qid}` and diff `got.ids` against `s.ids` to find the divergence (typically whitespace handling in `encode(' ' + option)`), fix `buildSequence`, re-run.

- [ ] **Step 8: Commit**

```bash
git add apps/consumer/package.json apps/consumer/tsconfig*.json apps/consumer/vitest.config.ts apps/consumer/src/main/brain pnpm-lock.yaml
git commit -m "spike(consumer): TypeScript Laya runtime (onnxruntime-node) + parity tests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: Windows OCR helper, latency bench, spike results

**Files:**
- Create: `apps/consumer/resources/ocr-helper.ps1`
- Create: `apps/consumer/scripts/bench-ocr.mjs`
- Create: `tools/laya/SPIKE-RESULTS.md`

**Interfaces:**
- Produces (Phase 3 wraps it in a supervised client): `ocr-helper.ps1` protocol over stdio, UTF-8.
  - On start it prints one line: `{"ready":true}` or `{"ready":false,"error":"no_ocr_language"}` (then exits 2).
  - Request: one line `"<id> <base64 PNG>"` (plain text, NOT JSON — Windows PowerShell 5.1's `ConvertFrom-Json` caps input at ~2 MB, a full-HD PNG in base64 exceeds that).
  - Response: one JSON line `{"id":"<id>","text":"<lines joined by \n>","ms":<int>}` or `{"id":"<id>","error":"<message>"}`.

- [ ] **Step 1: Write the helper**

`apps/consumer/resources/ocr-helper.ps1`:

```powershell
# Daylens OCR helper: long-lived Windows PowerShell 5.1 process wrapping Windows.Media.Ocr (built into Windows 10/11).
# Protocol: stdin lines "<id> <base64 png>"; stdout JSON lines. Images are decoded in memory and never written to disk.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataWriter, Windows.Storage.Streams, ContentType = WindowsRuntime]

$asTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
function Await($op, [Type]$type) {
  $task = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))
  $task.Wait(-1) | Out-Null
  $task.Result
}
function Emit($obj) { [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress)) }

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) { Emit @{ ready = $false; error = 'no_ocr_language' }; exit 2 }
Emit @{ ready = $true }

while ($null -ne ($line = [Console]::In.ReadLine())) {
  $sp = $line.IndexOf(' ')
  $id = if ($sp -gt 0) { $line.Substring(0, $sp) } else { $line }
  try {
    if ($sp -le 0) { throw 'malformed request' }
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $bytes = [Convert]::FromBase64String($line.Substring($sp + 1))
    $stream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
    $writer = New-Object Windows.Storage.Streams.DataWriter($stream)
    $writer.WriteBytes($bytes)
    $null = Await ($writer.StoreAsync()) ([UInt32])
    $null = $writer.DetachStream()
    $stream.Seek(0)
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    $text = ($result.Lines | ForEach-Object { $_.Text }) -join "`n"
    $bitmap.Dispose(); $stream.Dispose()
    Emit @{ id = $id; text = $text; ms = $sw.ElapsedMilliseconds }
  } catch {
    Emit @{ id = $id; error = "$($_.Exception.Message)" }
  }
}
```

- [ ] **Step 2: Write the bench**

`apps/consumer/scripts/bench-ocr.mjs`:

```js
// Dev-only: measures ocr-helper.ps1 cold start and per-image latency on a live primary-screen capture.
// The capture stays in memory (base64 over pipes); nothing is written to disk.
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const RUNS = 20;
const helper = fileURLToPath(new URL('../resources/ocr-helper.ps1', import.meta.url));
const capture = [
  'Add-Type -AssemblyName System.Windows.Forms,System.Drawing',
  '$b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds',
  '$bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height',
  '$g=[System.Drawing.Graphics]::FromImage($bmp)',
  '$g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size)',
  '$ms=New-Object System.IO.MemoryStream',
  '$bmp.Save($ms,[System.Drawing.Imaging.ImageFormat]::Png)',
  'Write-Output "$($b.Width)x$($b.Height) $([Convert]::ToBase64String($ms.ToArray()))"'
].join('; ');
const [size, png] = execFileSync('powershell', ['-NoProfile', '-Command', capture], { maxBuffer: 256 * 1024 * 1024 }).toString().trim().split(' ');
console.log(`capture ${size}, ${(png.length / 1e6).toFixed(1)} MB base64`);

const t0 = Date.now();
const p = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', helper], { stdio: ['pipe', 'pipe', 'inherit'] });
const lines = createInterface({ input: p.stdout });
const next = () => new Promise((res) => lines.once('line', (l) => res(JSON.parse(l))));

const ready = await next();
console.log('ready', ready, `cold start ${Date.now() - t0} ms`);
if (!ready.ready) process.exit(1);

const wall = [];
let first;
for (let i = 0; i < RUNS; i++) {
  const s = Date.now();
  p.stdin.write(`${i} ${png}\n`);
  const r = await next();
  if (r.error) { console.error('error', r.error); process.exit(1); }
  wall.push(Date.now() - s);
  first ??= r;
}
p.stdin.end();
wall.sort((a, b) => a - b);
console.log(`median ${wall[Math.floor(RUNS / 2)]} ms, p90 ${wall[Math.floor(RUNS * 0.9)]} ms (target median < 400 ms)`);
console.log(`text sample (${first.text.length} chars):\n${first.text.slice(0, 400)}`);
```

- [ ] **Step 3: Run the bench**

With some text-heavy window (e.g. this plan in an editor) on the primary screen:

```bash
node apps/consumer/scripts/bench-ocr.mjs
```

Expected: `ready {"ready":true} cold start ~1000–2500 ms`, then `median … ms, p90 … ms`, then a readable text sample (check non-ASCII like `—` or `é` renders correctly, not as `?`/mojibake). Gate: median < 400 ms for a 1080p screen (a 4K screen may be ~2–3× slower; note the resolution). If the helper errors on `AsTask`, run `powershell -NoProfile -Command '$PSVersionTable.PSVersion'` and record it — the fallback is the compiled C# helper named in spec §14.

- [ ] **Step 4: Write the spike results**

`tools/laya/SPIKE-RESULTS.md` (fill every value from Tasks 1–4 runs; keep the headings):

```markdown
# Daylens Phase 0 — Spike results (YYYY-MM-DD)

## Laya
- Checkpoint compared: root = __/48 (__%), typed-decisions = __/48 (__%) → chosen: ____
- Usefulness gate (category accuracy ≥ 80%): PASS / FAIL
- ONNX export: OK / FAILED (error: ____)
- torch vs ORT fp32 max |logit diff|: ____ (want < 1e-3)
- Python ORT vs golden — fp32: __% choices, max score err ____; int8: __% choices, max score err ____
- TS sequence parity (sequences.json): __ mismatches (want 0)
- TS decision parity — fp32: __/__ choices, worst score err ____, ____ ms/read; int8: __/__, ____, ____ ms/read
- Model files: laya.onnx ____ MB, laya.int8.onnx ____ MB
- **Decision:** GO approach A (ship fp32 | int8) / NO-GO → fallback B (bundled Python laya-serve)

## Windows OCR
- PowerShell version: ____ · screen: ____
- Cold start ____ ms · median ____ ms · p90 ____ ms (target median < 400 ms)
- Unicode output correct: yes / no
- **Decision:** PowerShell helper OK / switch to compiled C# helper

## Notes
- Anything surprising (misclassified samples worth rewording questions for, etc.)
```

- [ ] **Step 5: Commit and report**

```bash
git add apps/consumer/resources/ocr-helper.ps1 apps/consumer/scripts/bench-ocr.mjs tools/laya/SPIKE-RESULTS.md
git commit -m "spike(consumer): Windows OCR helper + latency bench; Phase 0 results

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Report both decisions (Laya A/B, OCR helper OK/C#) to the human partner before starting Task 5.

---

## Phase 1 — Extract `packages/core`

### Task 5: Move tracking/DB/rollup into `@worksight/core` and rewire the agent

**Files:**
- Modify: `pnpm-workspace.yaml`, `package.json` (root)
- Move (`git mv`): `apps/agent/scripts/rebuild-native.cjs` → `scripts/rebuild-native.cjs`
- Move: `apps/agent/src/shared/date.ts` → `packages/core/src/date.ts`
- Move: `apps/agent/src/main/db/{schema,schema.test,database,repositories,repositories.test}.ts` → `packages/core/src/db/`
- Move: `apps/agent/src/main/tracking/{types,idle,idle.test,processLifecycle,processLifecycle.test,tracker,tracker.test,activeWindow,inputActivity}.ts` → `packages/core/src/tracking/`
- Move: `apps/agent/src/main/summary/{rollup,rollup.test}.ts` → `packages/core/src/summary/`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/vitest.config.ts`, `packages/core/src/types.ts`, `packages/core/src/index.ts`, `packages/core/src/adapters.ts`
- Modify: `packages/core/src/tracking/tracker.ts`, `packages/core/src/tracking/tracker.test.ts`, `packages/core/src/tracking/activeWindow.ts`
- Modify: `apps/agent/package.json`, `apps/agent/src/shared/types.ts`, `apps/agent/src/main/index.ts`, `apps/agent/src/main/ipc/handlers.ts`, `apps/agent/src/main/cloud/sync.ts`, `apps/agent/src/main/settings.test.ts`, `apps/agent/src/renderer/components/TodayView.tsx`

**Interfaces:**
- Produces:
  - `@worksight/core` (Node only): `openDatabase(path)`, `SCHEMA_SQL`, `createRepositories(db): Repositories` (+ `StartSessionInput`, `AppEventInput`, `ActivitySampleInput`, `DailySummaryCache`), `createTracker(deps: TrackerDeps): Tracker`, `systemClock`, `Clock`, `ForegroundSource`, `InputSource`, `isActiveBucket`, `computeDaySummary`, `localDate`, and every type from `./types`.
  - `@worksight/core/adapters` (Node, native): `ActiveWinForegroundSource`, `UiohookInputSource`.
  - `@worksight/core/types` (browser-safe, types only): `ISODate, Rect, ForegroundInfo (+ optional bounds), InputCounts, FocusSessionRow, ActivitySampleRow, AppUsage, DaySummary, TrackingStatus, TrackerSettings`.
  - `@worksight/core/date` (browser-safe): `localDate(ms): ISODate`.
  - `TrackerDeps.getSettings` now returns `TrackerSettings = { idleThresholdSec; captureWindowTitles; pollIntervalMs; bucketSizeSec; trackingPaused }`. The agent's `AppSettings extends TrackerSettings`, so it passes unchanged.

- [ ] **Step 1: Register the package folder and move files**

`pnpm-workspace.yaml`:

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

```bash
mkdir -p packages/core/src/db packages/core/src/tracking packages/core/src/summary scripts
git mv apps/agent/scripts/rebuild-native.cjs scripts/rebuild-native.cjs
git mv apps/agent/src/shared/date.ts packages/core/src/date.ts
for f in schema schema.test database repositories repositories.test; do git mv apps/agent/src/main/db/$f.ts packages/core/src/db/$f.ts; done
for f in types idle idle.test processLifecycle processLifecycle.test tracker tracker.test activeWindow inputActivity; do git mv apps/agent/src/main/tracking/$f.ts packages/core/src/tracking/$f.ts; done
for f in rollup rollup.test; do git mv apps/agent/src/main/summary/$f.ts packages/core/src/summary/$f.ts; done
grep -rl "shared/types\|shared/date" packages/core/src | xargs sed -i "s#'../../shared/types'#'../types'#; s#'../../shared/date'#'../date'#"
grep -rn "shared/" packages/core/src || echo "no stale shared/ imports"
```

Expected: last command prints `no stale shared/ imports`.

- [ ] **Step 2: Create the core package files**

`packages/core/package.json`:

```json
{
  "name": "@worksight/core",
  "version": "0.0.0",
  "private": true,
  "description": "Shared tracking, SQLite storage and rollups for WorkSight Agent and Daylens",
  "exports": {
    ".": "./src/index.ts",
    "./adapters": "./src/adapters.ts",
    "./types": "./src/types.ts",
    "./date": "./src/date.ts"
  },
  "scripts": {
    "pretest": "pnpm rebuild better-sqlite3",
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "active-win": "^8.2.1",
    "better-sqlite3": "^11.8.1",
    "uiohook-napi": "^1.5.4"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.12",
    "typescript": "^5.7.3",
    "vitest": "^2.1.8"
  }
}
```

`packages/core/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "strict": true, "esModuleInterop": true, "skipLibCheck": true,
    "resolveJsonModule": true, "noEmit": true, "types": ["node"]
  },
  "include": ["src/**/*"]
}
```

`packages/core/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['src/**/*.test.ts'], environment: 'node' }
});
```

`packages/core/src/types.ts`:

```ts
// Browser-safe shared types (no runtime code). Imported by main, preload and renderer code.
export type ISODate = string; // YYYY-MM-DD (local)

export interface Rect { x: number; y: number; width: number; height: number; }

export interface ForegroundInfo {
  appName: string;
  appPath: string | null;
  title: string | null;
  pid: number;
  bounds?: Rect | null; // window bounds from active-win (Daylens: capture crop + fullscreen detection)
}

export interface InputCounts {
  mouseMoves: number;
  mouseDistancePx: number;
  clicks: number;
  scrolls: number;
  keyEvents: number;
}

export interface FocusSessionRow {
  id: number;
  appName: string;
  appPath: string | null;
  windowTitle: string | null;
  pid: number | null;
  startedAt: number;
  endedAt: number | null;
  durationSec: number | null;
  date: ISODate;
}

export interface ActivitySampleRow {
  id: number;
  bucketStart: number;
  bucketEnd: number;
  mouseMoves: number;
  mouseDistancePx: number;
  clicks: number;
  scrolls: number;
  keyEvents: number;
  active: 0 | 1;
  appName: string | null;
  date: ISODate;
}

export interface AppUsage {
  appName: string;
  totalSec: number;
  sessions: number;
  firstOpenAt: number | null;
  lastCloseAt: number | null;
  activePct: number; // 0..100
}

export interface DaySummary {
  date: ISODate;
  totalTrackedSec: number;
  activeSec: number;
  idleSec: number;
  apps: AppUsage[];
}

export interface TrackingStatus { paused: boolean; currentApp: string | null; sessionStartedAt: number | null; }

/** The subset of app settings the tracker reads. Each app's settings type extends this. */
export interface TrackerSettings {
  idleThresholdSec: number;
  captureWindowTitles: boolean;
  pollIntervalMs: number;
  bucketSizeSec: number;
  trackingPaused: boolean;
}
```

`packages/core/src/adapters.ts`:

```ts
// Native OS adapters. Kept out of the main index so tests and non-Electron code never load native hooks.
export { ActiveWinForegroundSource } from './tracking/activeWindow';
export { UiohookInputSource } from './tracking/inputActivity';
```

`packages/core/src/index.ts`:

```ts
export * from './types';
export { localDate } from './date';
export { SCHEMA_SQL } from './db/schema';
export { openDatabase } from './db/database';
export * from './db/repositories';
export * from './tracking/types';
export { createTracker } from './tracking/tracker';
export type { Tracker, TrackerDeps } from './tracking/tracker';
export { isActiveBucket } from './tracking/idle';
export { computeDaySummary } from './summary/rollup';
```

- [ ] **Step 3: Narrow the tracker's settings type and add window bounds**

In `packages/core/src/tracking/tracker.ts` replace:

```ts
import type { AppSettings } from '../types';
```

with:

```ts
import type { TrackerSettings } from '../types';
```

and replace:

```ts
  getSettings: () => AppSettings;
```

with:

```ts
  getSettings: () => TrackerSettings;
```

In `packages/core/src/tracking/tracker.test.ts` replace the whole `getSettings: () => ({ … }),` line with:

```ts
    getSettings: () => ({ idleThresholdSec: 60, captureWindowTitles: true, pollIntervalMs: 2000, bucketSizeSec: 60, trackingPaused: false }),
```

In `packages/core/src/tracking/activeWindow.ts` replace:

```ts
type ActiveWinFn = () => Promise<{ title?: string; owner: { name: string; path?: string; processId: number } } | undefined>;
```

with:

```ts
type ActiveWinFn = () => Promise<{ title?: string; bounds?: { x: number; y: number; width: number; height: number }; owner: { name: string; path?: string; processId: number } } | undefined>;
```

and replace:

```ts
      return { appName: r.owner.name, appPath: r.owner.path ?? null, title: r.title ?? null, pid: r.owner.processId };
```

with:

```ts
      return { appName: r.owner.name, appPath: r.owner.path ?? null, title: r.title ?? null, pid: r.owner.processId, bounds: r.bounds ?? null };
```

- [ ] **Step 4: Run core tests**

```bash
pnpm install && pnpm --filter @worksight/core test && pnpm --filter @worksight/core typecheck
```

Expected: all moved tests PASS (schema, repositories, idle, processLifecycle, tracker, rollup); typecheck exits 0.

- [ ] **Step 5: Rewire the agent**

`apps/agent/package.json`: change the two script lines and add the devDependency:

```json
    "predev": "node ../../scripts/rebuild-native.cjs",
```

```json
    "prebuild": "node ../../scripts/rebuild-native.cjs",
```

and in `devDependencies` add `"@worksight/core": "workspace:*",`.

Replace `apps/agent/src/shared/types.ts` entirely with:

```ts
import type { ISODate, TrackerSettings } from '@worksight/core/types';

// Tracking/storage types live in @worksight/core; re-exported so agent imports stay unchanged.
export type {
  ISODate, Rect, ForegroundInfo, InputCounts, FocusSessionRow, ActivitySampleRow, AppUsage, DaySummary, TrackingStatus, TrackerSettings
} from '@worksight/core/types';

export interface AiSummaryResult { text: string; model: string; generatedAt: number; }
export interface AiSummaryError { error: 'no_key' | 'failed'; message?: string; }

export type AiProvider = 'anthropic' | 'openai' | 'gemini' | 'openrouter' | 'custom';

export interface AppSettings extends TrackerSettings {
  aiEnabled: boolean;
  aiProvider: AiProvider;
  aiModel: string;
  aiBaseUrl: string; // only used for the 'custom' provider
  consentGranted: boolean;
  cloudSyncEnabled: boolean;
  cloudSyncWindowDays: number;
  hasApiKey: boolean; // true if the CURRENT provider has a key saved; renderer never receives the raw key
}

export interface DailyActivityRow {
  user_id: string;
  date: ISODate;
  total_tracked_sec: number;
  active_sec: number;
  idle_sec: number;
  by_app: { app_name: string; total_sec: number; sessions: number; active_pct: number }[];
}

export interface CloudSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch SECONDS (GoTrue expires_at)
  userId: string;
  email: string;
}

export interface CloudSyncStatus {
  connected: boolean;
  email: string | null;
  enabled: boolean;
  lastSyncedAt: number | null; // epoch ms
  lastError: string | null;
}
```

In `apps/agent/src/main/index.ts` replace these six lines:

```ts
import { openDatabase } from './db/database';
import { createRepositories } from './db/repositories';
import { createSettingsStore } from './settings';
import { createTracker } from './tracking/tracker';
import { systemClock } from './tracking/types';
import { ActiveWinForegroundSource } from './tracking/activeWindow';
import { UiohookInputSource } from './tracking/inputActivity';
```

with:

```ts
import { openDatabase, createRepositories, createTracker, systemClock } from '@worksight/core';
import { ActiveWinForegroundSource, UiohookInputSource } from '@worksight/core/adapters';
import { createSettingsStore } from './settings';
```

In `apps/agent/src/main/ipc/handlers.ts` replace:

```ts
import type { Repositories } from '../db/repositories';
import type { SettingsStore } from '../settings';
import type { Tracker } from '../tracking/tracker';
import { computeDaySummary } from '../summary/rollup';
```

with:

```ts
import { computeDaySummary, type Repositories, type Tracker } from '@worksight/core';
import type { SettingsStore } from '../settings';
```

Then rewrite the remaining imports mechanically and confirm nothing points at moved files:

```bash
sed -i "s#'../summary/rollup'#'@worksight/core'#; s#'../../shared/date'#'@worksight/core/date'#" apps/agent/src/main/cloud/sync.ts
sed -i "s#'./db/schema'#'@worksight/core'#" apps/agent/src/main/settings.test.ts
sed -i "s#'../../shared/date'#'@worksight/core/date'#" apps/agent/src/renderer/components/TodayView.tsx
grep -rnE "from '(\.\./)*(db|tracking|summary/rollup|shared/date)[/']|from '\./(db|tracking)/" apps/agent/src || echo "agent rewired"
```

Expected: `agent rewired`.

- [ ] **Step 6: Point the root scripts at every package with tests**

Root `package.json` `scripts` — replace the `"test"` line with:

```json
    "test": "pnpm --filter @worksight/core --filter @worksight/agent test",
```

- [ ] **Step 7: Verify the agent is unchanged**

```bash
pnpm install && pnpm --filter @worksight/agent test && pnpm --filter @worksight/agent typecheck && pnpm --filter @worksight/agent exec electron-vite build && ! grep -q 'require("@worksight/core' apps/agent/out/main/index.js && echo "core bundled (no runtime import)"
```

Expected: all agent tests PASS, typecheck exits 0, `electron-vite build` succeeds, and the chain ends by printing `core bundled (no runtime import)` (core is inlined, not `require`d). Then run `pnpm dev`, confirm the agent window opens and the Today view shows the current app after ~10 s, and quit from the tray.

- [ ] **Step 8: Commit**

```bash
git add -A pnpm-workspace.yaml package.json pnpm-lock.yaml scripts packages/core apps/agent
git commit -m "refactor: extract tracking/DB/rollup into @worksight/core (agent unchanged)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: Typed key-value settings store in core

**Files:**
- Create: `packages/core/src/settings/kv.ts`
- Test: `packages/core/src/settings/kv.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces:
  ```ts
  export type KvValue = string | number | boolean;
  export interface KvStore<T extends Record<string, KvValue>> { get(): T; set(patch: Partial<T>): T }
  export function createKvStore<T extends Record<string, KvValue>>(db: Database.Database, defaults: T): KvStore<T>;
  ```
  Uses the existing `settings (key TEXT PRIMARY KEY, value TEXT)` table from `SCHEMA_SQL`.

- [ ] **Step 1: Write the failing test**

`packages/core/src/settings/kv.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../db/schema';
import { createKvStore } from './kv';

const DEFAULTS = { goal: 420, paused: false, windDown: '23:00' };
let db: Database.Database;
beforeEach(() => { db = new Database(':memory:'); db.exec(SCHEMA_SQL); });

describe('createKvStore', () => {
  it('returns defaults when nothing is stored', () => {
    expect(createKvStore(db, DEFAULTS).get()).toEqual(DEFAULTS);
  });
  it('round-trips numbers, booleans and strings with their types', () => {
    const kv = createKvStore(db, DEFAULTS);
    expect(kv.set({ goal: 300, paused: true, windDown: '22:30' })).toEqual({ goal: 300, paused: true, windDown: '22:30' });
    expect(createKvStore(db, DEFAULTS).get()).toEqual({ goal: 300, paused: true, windDown: '22:30' });
  });
  it('ignores keys that are not in the defaults', () => {
    const kv = createKvStore(db, DEFAULTS);
    kv.set({ nope: 1 } as never);
    expect(db.prepare("SELECT count(*) AS n FROM settings WHERE key = 'nope'").get()).toEqual({ n: 0 });
  });
  it('falls back to the default when a stored number is corrupt', () => {
    db.prepare("INSERT INTO settings (key, value) VALUES ('goal', 'abc')").run();
    expect(createKvStore(db, DEFAULTS).get().goal).toBe(420);
  });
  it('works when set is called detached from the store object', () => {
    const { set } = createKvStore(db, DEFAULTS);
    expect(set({ goal: 100 }).goal).toBe(100);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @worksight/core test`
Expected: FAIL — cannot resolve `./kv`.

- [ ] **Step 3: Implement**

`packages/core/src/settings/kv.ts`:

```ts
import type Database from 'better-sqlite3';

export type KvValue = string | number | boolean;
export interface KvStore<T extends Record<string, KvValue>> { get(): T; set(patch: Partial<T>): T; }

/** Typed settings over the key/value `settings` table. Types come from `defaults`; unknown keys are ignored. */
export function createKvStore<T extends Record<string, KvValue>>(db: Database.Database, defaults: T): KvStore<T> {
  const read = db.prepare('SELECT value FROM settings WHERE key = ?');
  const write = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');

  const get = (): T => {
    const out: Record<string, KvValue> = { ...defaults };
    for (const [key, def] of Object.entries(defaults)) {
      const row = read.get(key) as { value: string } | undefined;
      if (!row) continue;
      if (typeof def === 'number') { const n = Number(row.value); if (Number.isFinite(n)) out[key] = n; }
      else if (typeof def === 'boolean') out[key] = row.value === 'true';
      else out[key] = row.value;
    }
    return out as T;
  };
  const set = (patch: Partial<T>): T => {
    db.transaction(() => {
      for (const [k, v] of Object.entries(patch)) if (k in defaults && v !== undefined) write.run(k, String(v));
    })();
    return get();
  };
  return { get, set };
}
```

Append to `packages/core/src/index.ts`:

```ts
export { createKvStore } from './settings/kv';
export type { KvStore, KvValue } from './settings/kv';
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @worksight/core test`
Expected: PASS (5 new tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/settings packages/core/src/index.ts
git commit -m "feat(core): typed key-value settings store

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Phase 2 — Daylens app shell + Today dashboard

### Task 7: Default app categories

**Files:**
- Create: `apps/consumer/src/shared/categories.ts`
- Test: `apps/consumer/src/shared/categories.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const CATEGORIES: readonly ['work','learning','social','entertainment','communication','other'];
  export type Category = typeof CATEGORIES[number];
  export const CATEGORY_LABEL: Record<Category, string>;
  export function displayAppName(appName: string): string; // strips ".exe"
  export function categoryForApp(appName: string): Category;
  ```
  App names come from `active-win` on Windows: usually the executable's file description (`Google Chrome`, `Windows Terminal Host`, `Discord`), otherwise the exe name (`deadlock.exe`, `LockApp.exe`). Browsers are `other` until Laya labels content (Phase 4).

- [ ] **Step 1: Write the failing test**

`apps/consumer/src/shared/categories.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { categoryForApp, displayAppName } from './categories';

describe('categoryForApp', () => {
  it.each([
    ['Visual Studio Code', 'work'], ['Code.exe', 'work'], ['Windows Terminal Host', 'work'], ['Android Studio', 'work'],
    ['Antigravity IDE', 'work'], ['Figma', 'work'], ['Microsoft Excel', 'work'], ['Docker Desktop', 'work'],
    ['Anki', 'learning'],
    ['Discord', 'social'], ['WhatsApp', 'social'], ['Telegram Desktop', 'social'],
    ['Steam Client WebHelper', 'entertainment'], ['Spotify', 'entertainment'], ['Riot Client', 'entertainment'], ['deadlock.exe', 'entertainment'], ['Rocket League', 'entertainment'],
    ['Microsoft Outlook', 'communication'], ['Slack', 'communication'], ['Microsoft Teams', 'communication'], ['Zoom Workplace', 'communication'], ['Rocket.Chat', 'communication'],
    ['Google Chrome', 'other'], ['Windows Explorer', 'other'], ['SnippingTool.exe', 'other']
  ])('%s → %s', (app, cat) => {
    expect(categoryForApp(app)).toBe(cat);
  });
});

describe('displayAppName', () => {
  it('strips a trailing .exe and whitespace', () => {
    expect(displayAppName('deadlock.exe ')).toBe('deadlock');
    expect(displayAppName('Google Chrome')).toBe('Google Chrome');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @worksight/consumer test`
Expected: FAIL — cannot resolve `./categories`.

- [ ] **Step 3: Implement**

`apps/consumer/src/shared/categories.ts`:

```ts
export const CATEGORIES = ['work', 'learning', 'social', 'entertainment', 'communication', 'other'] as const;
export type Category = typeof CATEGORIES[number];

export const CATEGORY_LABEL: Record<Category, string> = {
  work: 'Work', learning: 'Learning', social: 'Social', entertainment: 'Entertainment', communication: 'Communication', other: 'Other'
};

// ponytail: static name rules are the Phase 2 fallback; Laya labels screen content from Phase 4 (browsers stay "other" until then).
// First match wins, so "Steam Client WebHelper" hits entertainment before anything generic.
const RULES: [RegExp, Category][] = [
  [/visual studio|^code$|cursor|antigravity|android studio|intellij|pycharm|webstorm|rider|figma|photoshop|illustrator|blender|microsoft (word|excel|powerpoint|onenote)|^(winword|excel|powerpnt)$|notion|obsidian|terminal|command prompt|powershell|postman|docker desktop|notepad\+\+|sublime/i, 'work'],
  [/anki|kindle/i, 'learning'],
  [/discord|whatsapp|telegram|signal|messenger|instagram/i, 'social'],
  [/spotify|steam|epic games|netflix|vlc|riot client|league of legends|valorant|rocket league|deadlock|battle\.net|xbox/i, 'entertainment'],
  [/slack|teams|outlook|thunderbird|zoom|rocket\.chat|mail/i, 'communication']
];

export function displayAppName(appName: string): string {
  return appName.trim().replace(/\.exe$/i, '');
}

export function categoryForApp(appName: string): Category {
  const name = displayAppName(appName);
  for (const [re, category] of RULES) if (re.test(name)) return category;
  return 'other';
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @worksight/consumer test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/consumer/src/shared
git commit -m "feat(consumer): default app categories

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: Day time math (rest periods, clipping, subtraction)

**Files:**
- Create: `apps/consumer/src/main/day/time.ts`
- Test: `apps/consumer/src/main/day/time.test.ts`
- Modify: `apps/consumer/package.json` (add `@worksight/core` devDependency + native deps + `pretest`)

**Interfaces:**
- Consumes: `ActivitySampleRow`, `FocusSessionRow`, `ISODate` from `@worksight/core/types`; `localDate` from `@worksight/core/date`.
- Produces:
  ```ts
  export interface Interval { start: number; end: number }
  export const GAP_TOLERANCE_MS = 5_000;
  export function restPeriods(samples: ActivitySampleRow[]): Interval[];          // merged no-input buckets + gaps between buckets
  export function atLeast(periods: Interval[], ms: number): Interval[];
  export function subtract(iv: Interval, cuts: Interval[]): Interval[];
  export function clip(iv: Interval, lo: number, hi: number): Interval | null;
  export function dayBounds(date: ISODate): Interval;                             // local midnight → next local midnight (DST-safe)
  export function shiftDate(date: ISODate, days: number): ISODate;
  export function sessionInterval(s: FocusSessionRow, isLatest: boolean, now: number): Interval;
  ```

- [ ] **Step 1: Wire the consumer to core**

In `apps/consumer/package.json` set `scripts` to:

```json
  "scripts": {
    "pretest": "pnpm rebuild better-sqlite3",
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.web.json && tsc --noEmit -p tsconfig.node.json"
  },
```

then run:

```bash
pnpm --filter @worksight/consumer add better-sqlite3@^11.8.1 active-win@^8.2.1 uiohook-napi@^1.5.4 zod@^3.24.1 && pnpm --filter @worksight/consumer add -D "@worksight/core@workspace:*" @types/better-sqlite3@^7.6.12
```

And in root `package.json` replace the `"test"` line with:

```json
    "test": "pnpm --filter @worksight/core --filter @worksight/agent --filter @worksight/consumer test",
```

- [ ] **Step 2: Write the failing test**

`apps/consumer/src/main/day/time.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { ActivitySampleRow, FocusSessionRow } from '@worksight/core/types';
import { restPeriods, atLeast, subtract, clip, dayBounds, shiftDate, sessionInterval } from './time';

const MIN = 60_000;
const T = (h: number, m = 0): number => new Date(2026, 8, 23, h, m).getTime();
const sample = (start: number, active: 0 | 1): ActivitySampleRow => ({
  id: 0, bucketStart: start, bucketEnd: start + MIN, mouseMoves: 0, mouseDistancePx: 0, clicks: 0, scrolls: 0, keyEvents: 0, active, appName: 'Code', date: '2026-09-23'
});
const run = (from: number, minutes: number, active: 0 | 1): ActivitySampleRow[] =>
  Array.from({ length: minutes }, (_, i) => sample(from + i * MIN, active));

describe('restPeriods', () => {
  it('merges consecutive inactive buckets and splits on active ones', () => {
    const s = [...run(T(10), 5, 1), ...run(T(10, 5), 3, 0), ...run(T(10, 8), 2, 1), ...run(T(10, 10), 1, 0)];
    expect(restPeriods(s)).toEqual([{ start: T(10, 5), end: T(10, 8) }, { start: T(10, 10), end: T(10, 11) }]);
  });
  it('treats a gap between buckets (PC asleep, tracker off) as rest and merges it with adjacent inactivity', () => {
    const s = [...run(T(10), 2, 1), ...run(T(10, 2), 1, 0), ...run(T(11), 2, 1)];
    expect(restPeriods(s)).toEqual([{ start: T(10, 2), end: T(11) }]);
  });
  it('is order-independent and empty for no samples', () => {
    expect(restPeriods([])).toEqual([]);
    const s = [...run(T(10), 2, 0)].reverse();
    expect(restPeriods(s)).toEqual([{ start: T(10), end: T(10, 2) }]);
  });
});

describe('atLeast / subtract / clip', () => {
  it('filters by duration', () => {
    expect(atLeast([{ start: 0, end: MIN }, { start: 0, end: 3 * MIN }], 2 * MIN)).toEqual([{ start: 0, end: 3 * MIN }]);
  });
  it('removes cut intervals from an interval', () => {
    expect(subtract({ start: 0, end: 100 }, [{ start: 20, end: 30 }, { start: 90, end: 200 }])).toEqual([{ start: 0, end: 20 }, { start: 30, end: 90 }]);
    expect(subtract({ start: 0, end: 100 }, [{ start: -5, end: 500 }])).toEqual([]);
    expect(subtract({ start: 0, end: 100 }, [])).toEqual([{ start: 0, end: 100 }]);
  });
  it('clips to bounds or returns null', () => {
    expect(clip({ start: 0, end: 100 }, 50, 200)).toEqual({ start: 50, end: 100 });
    expect(clip({ start: 0, end: 10 }, 50, 200)).toBeNull();
  });
});

describe('dates', () => {
  it('gives local midnight bounds and shifts dates', () => {
    expect(dayBounds('2026-09-23')).toEqual({ start: T(0), end: new Date(2026, 8, 24).getTime() });
    expect(shiftDate('2026-09-01', -1)).toBe('2026-08-31');
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('sessionInterval', () => {
  const s = (endedAt: number | null): FocusSessionRow => ({ id: 1, appName: 'Code', appPath: null, windowTitle: null, pid: 1, startedAt: T(10), endedAt, durationSec: null, date: '2026-09-23' });
  it('uses endedAt when finished', () => { expect(sessionInterval(s(T(11)), false, T(12))).toEqual({ start: T(10), end: T(11) }); });
  it('runs the latest open session up to now', () => { expect(sessionInterval(s(null), true, T(12))).toEqual({ start: T(10), end: T(12) }); });
  it('counts an older open session (crash leftover) as zero length', () => { expect(sessionInterval(s(null), false, T(12))).toEqual({ start: T(10), end: T(10) }); });
});
```

- [ ] **Step 3: Run to confirm failure**

Run: `pnpm --filter @worksight/consumer test`
Expected: FAIL — cannot resolve `./time`.

- [ ] **Step 4: Implement**

`apps/consumer/src/main/day/time.ts`:

```ts
import type { ActivitySampleRow, FocusSessionRow, ISODate } from '@worksight/core/types';
import { localDate } from '@worksight/core/date';

export interface Interval { start: number; end: number; }
export const GAP_TOLERANCE_MS = 5_000; // buckets closer than this are contiguous

/** Periods without input: inactive buckets plus gaps between buckets (PC asleep / tracker off), merged. */
export function restPeriods(samples: ActivitySampleRow[]): Interval[] {
  const out: Interval[] = [];
  const push = (r: Interval): void => {
    const last = out[out.length - 1];
    if (last && r.start - last.end <= GAP_TOLERANCE_MS) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  };
  let prevEnd: number | null = null;
  for (const s of [...samples].sort((a, b) => a.bucketStart - b.bucketStart)) {
    if (prevEnd !== null && s.bucketStart - prevEnd > GAP_TOLERANCE_MS) push({ start: prevEnd, end: s.bucketStart });
    if (s.active === 0) push({ start: s.bucketStart, end: s.bucketEnd });
    prevEnd = Math.max(prevEnd ?? s.bucketEnd, s.bucketEnd);
  }
  return out;
}

export const atLeast = (periods: Interval[], ms: number): Interval[] => periods.filter((p) => p.end - p.start >= ms);

/** Parts of `iv` not covered by any cut. ponytail: O(pieces × cuts), fine for one day of sessions. */
export function subtract(iv: Interval, cuts: Interval[]): Interval[] {
  let parts = [iv];
  for (const c of cuts) {
    parts = parts.flatMap((p) => (c.end <= p.start || c.start >= p.end ? [p] : [
      ...(c.start > p.start ? [{ start: p.start, end: c.start }] : []),
      ...(c.end < p.end ? [{ start: c.end, end: p.end }] : [])
    ]));
  }
  return parts;
}

export function clip(iv: Interval, lo: number, hi: number): Interval | null {
  const start = Math.max(iv.start, lo), end = Math.min(iv.end, hi);
  return end > start ? { start, end } : null;
}

export function dayBounds(date: ISODate): Interval {
  const [y, m, d] = date.split('-').map(Number);
  return { start: new Date(y, m - 1, d).getTime(), end: new Date(y, m - 1, d + 1).getTime() };
}

export function shiftDate(date: ISODate, days: number): ISODate {
  const [y, m, d] = date.split('-').map(Number);
  return localDate(new Date(y, m - 1, d + days).getTime());
}

/** The latest session may still be open (runs to now); any other open session is a crash leftover and counts as 0. */
export function sessionInterval(s: FocusSessionRow, isLatest: boolean, now: number): Interval {
  const end = s.endedAt ?? (isLatest ? now : s.startedAt);
  return { start: s.startedAt, end: Math.max(s.startedAt, end) };
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @worksight/consumer test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/consumer/package.json apps/consumer/src/main/day package.json pnpm-lock.yaml
git commit -m "feat(consumer): day time math (rest periods, clipping, open sessions)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 9: Screen-health score

**Files:**
- Create: `apps/consumer/src/main/day/health.ts`
- Test: `apps/consumer/src/main/day/health.test.ts`

**Interfaces:**
- Consumes: `restPeriods`, `atLeast` (Task 8).
- Produces:
  ```ts
  export const BREAK_MS = 2 * 60_000;
  export interface HealthInput { samples: ActivitySampleRow[]; screenSec: number; dailyGoalMin: number; windDownTime: string; breakIntervalMin: number }
  export interface Health { score: number; breaks: number; expectedBreaks: number; longestStretchSec: number; lateNight: boolean }
  export function computeHealth(i: HealthInput): Health;
  ```
  Formula (spec §9.5, constants live here): `100 − 5·max(0, expected − breaks) − 10·max(0, longestStretchH − 1) − 15·[lateNight] − 20·min(1, max(0, screen/goal − 1))`, clamped 0–100, rounded. Late night = any active bucket at/after `windDownTime` or before 05:00. Breaks = rest periods ≥ 2 min. Longest stretch = longest time between breaks.

- [ ] **Step 1: Write the failing test**

`apps/consumer/src/main/day/health.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { ActivitySampleRow } from '@worksight/core/types';
import { computeHealth } from './health';

const MIN = 60_000;
const T = (h: number, m = 0): number => new Date(2026, 8, 23, h, m).getTime();
const run = (from: number, minutes: number, active: 0 | 1): ActivitySampleRow[] =>
  Array.from({ length: minutes }, (_, i) => ({
    id: 0, bucketStart: from + i * MIN, bucketEnd: from + (i + 1) * MIN, mouseMoves: 0, mouseDistancePx: 0, clicks: 0, scrolls: 0, keyEvents: 0, active, appName: 'Code', date: '2026-09-23'
  }));
const base = { dailyGoalMin: 420, windDownTime: '23:00', breakIntervalMin: 50 };

describe('computeHealth', () => {
  it('is a perfect, NaN-free 100 on an empty day', () => {
    expect(computeHealth({ ...base, samples: [], screenSec: 0 })).toEqual({ score: 100, breaks: 0, expectedBreaks: 0, longestStretchSec: 0, lateNight: false });
  });
  it('penalises 3 h without a break: missed breaks and a long stretch', () => {
    const h = computeHealth({ ...base, samples: run(T(10), 180, 1), screenSec: 3 * 3600 });
    expect(h).toMatchObject({ breaks: 0, expectedBreaks: 3, longestStretchSec: 3 * 3600, lateNight: false });
    expect(h.score).toBe(65); // 100 - 15 (3 missed) - 20 (2 h over 1 h)
  });
  it('counts a 5-minute pause as a break and splits the stretch', () => {
    const samples = [...run(T(10), 60, 1), ...run(T(11), 5, 0), ...run(T(11, 5), 115, 1)];
    const h = computeHealth({ ...base, samples, screenSec: 3 * 3600 });
    expect(h).toMatchObject({ breaks: 1, expectedBreaks: 3, longestStretchSec: 115 * 60 });
    expect(h.score).toBe(81); // 100 - 10 - 9.17
  });
  it('does not count a 1-minute pause as a break', () => {
    const samples = [...run(T(10), 30, 1), ...run(T(10, 30), 1, 0), ...run(T(10, 31), 29, 1)];
    expect(computeHealth({ ...base, samples, screenSec: 3600 }).breaks).toBe(0);
  });
  it('flags late-night use after wind-down and before 5 am', () => {
    expect(computeHealth({ ...base, samples: run(T(23, 30), 10, 1), screenSec: 600 }).lateNight).toBe(true);
    expect(computeHealth({ ...base, samples: run(T(2), 10, 1), screenSec: 600 }).lateNight).toBe(true);
    expect(computeHealth({ ...base, samples: run(T(23, 30), 10, 0), screenSec: 0 }).lateNight).toBe(false);
    expect(computeHealth({ ...base, samples: run(T(21), 10, 1), screenSec: 600 }).lateNight).toBe(false);
  });
  it('caps the over-goal penalty at 20 points', () => {
    const h = computeHealth({ ...base, dailyGoalMin: 60, samples: run(T(10), 30, 1), screenSec: 5 * 3600 });
    expect(h.score).toBe(80);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @worksight/consumer test`
Expected: FAIL — cannot resolve `./health`.

- [ ] **Step 3: Implement**

`apps/consumer/src/main/day/health.ts`:

```ts
import type { ActivitySampleRow } from '@worksight/core/types';
import { atLeast, restPeriods } from './time';

export const BREAK_MS = 2 * 60_000;
const EARLY_MORNING_MIN = 5 * 60; // activity before 05:00 also counts as late night
// Score weights (spec §9.5) — tune here.
const W = { missedBreak: 5, perHourOverOne: 10, lateNight: 15, overGoal: 20 };

export interface HealthInput { samples: ActivitySampleRow[]; screenSec: number; dailyGoalMin: number; windDownTime: string; breakIntervalMin: number; }
export interface Health { score: number; breaks: number; expectedBreaks: number; longestStretchSec: number; lateNight: boolean; }

export function computeHealth(i: HealthInput): Health {
  const sorted = [...i.samples].sort((a, b) => a.bucketStart - b.bucketStart);
  const breaks = atLeast(restPeriods(sorted), BREAK_MS);

  let longest = 0;
  if (sorted.length) {
    let edge = sorted[0].bucketStart;
    for (const b of breaks) { longest = Math.max(longest, b.start - edge); edge = Math.max(edge, b.end); }
    longest = Math.max(longest, sorted[sorted.length - 1].bucketEnd - edge);
  }

  const [wh, wm] = i.windDownTime.split(':').map(Number);
  const windDownMin = wh * 60 + wm;
  let activeMs = 0;
  let lateNight = false;
  for (const s of sorted) {
    if (s.active !== 1) continue;
    activeMs += s.bucketEnd - s.bucketStart;
    const d = new Date(s.bucketStart);
    const minute = d.getHours() * 60 + d.getMinutes();
    if (minute >= windDownMin || minute < EARLY_MORNING_MIN) lateNight = true;
  }

  const expectedBreaks = Math.floor(activeMs / 60_000 / i.breakIntervalMin);
  const over = i.dailyGoalMin > 0 ? i.screenSec / (i.dailyGoalMin * 60) - 1 : 0;
  const raw = 100
    - W.missedBreak * Math.max(0, expectedBreaks - breaks.length)
    - W.perHourOverOne * Math.max(0, longest / 3_600_000 - 1)
    - W.lateNight * (lateNight ? 1 : 0)
    - W.overGoal * Math.min(1, Math.max(0, over));
  return {
    score: Math.round(Math.min(100, Math.max(0, raw))),
    breaks: breaks.length, expectedBreaks, longestStretchSec: Math.round(longest / 1000), lateNight
  };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @worksight/consumer test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/consumer/src/main/day/health.ts apps/consumer/src/main/day/health.test.ts
git commit -m "feat(consumer): screen-health score

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 10: Today view model + loader

**Files:**
- Create: `apps/consumer/src/main/day/today.ts`
- Test: `apps/consumer/src/main/day/today.test.ts`

**Interfaces:**
- Consumes: Task 7 `categoryForApp`, `CATEGORIES`, `Category`; Task 8 `restPeriods`, `atLeast`, `subtract`, `clip`, `dayBounds`, `shiftDate`, `sessionInterval`; Task 9 `computeHealth`, `Health`; core `Repositories`.
- Produces (renderer renders exactly this):
  ```ts
  export const AWAY_MS = 10 * 60_000;
  export interface DayInput { date: ISODate; sessions: FocusSessionRow[]; samples: ActivitySampleRow[] } // sessions: previous day's + this day's
  export interface ViewSettings { dailyGoalMin: number; windDownTime: string; breakIntervalMin: number }
  export interface AppTime { appName: string; seconds: number }
  export interface CategoryCard { category: Category; seconds: number; apps: AppTime[] }            // apps: top 3, desc
  export interface TimelineSegment { start: number; end: number; category: Category }
  export interface DayBar { date: ISODate; seconds: number; byCategory: Record<Category, number> }
  export interface TodayView {
    date: ISODate; now: number; screenSec: number; activeSec: number; goalSec: number; firstSeenAt: number | null;
    cards: CategoryCard[]; timeline: TimelineSegment[]; health: Health; week: DayBar[]; // week: 7 days oldest → today
  }
  export function buildTodayView(days: DayInput[], settings: ViewSettings, now: number): TodayView; // days: 7, last = the day shown
  export function loadTodayView(repo: Repositories, settings: ViewSettings, date: ISODate, now: number): TodayView;
  ```

- [ ] **Step 1: Write the failing test**

`apps/consumer/src/main/day/today.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL, createRepositories } from '@worksight/core';
import type { ActivitySampleRow, FocusSessionRow } from '@worksight/core/types';
import { buildTodayView, loadTodayView, type DayInput } from './today';

const MIN = 60_000;
const DATE = '2026-09-23';
const T = (h: number, m = 0, day = 23): number => new Date(2026, 8, day, h, m).getTime();
const settings = { dailyGoalMin: 420, windDownTime: '23:00', breakIntervalMin: 50 };
let nextId = 1;
const session = (appName: string, start: number, end: number | null, date = DATE): FocusSessionRow => ({
  id: nextId++, appName, appPath: null, windowTitle: null, pid: 1, startedAt: start, endedAt: end,
  durationSec: end === null ? null : Math.round((end - start) / 1000), date
});
const run = (from: number, minutes: number, active: 0 | 1): ActivitySampleRow[] =>
  Array.from({ length: minutes }, (_, i) => ({
    id: 0, bucketStart: from + i * MIN, bucketEnd: from + (i + 1) * MIN, mouseMoves: 0, mouseDistancePx: 0, clicks: 0, scrolls: 0, keyEvents: 0, active, appName: null, date: DATE
  }));
const emptyWeek = (): DayInput[] => ['17', '18', '19', '20', '21', '22'].map((d) => ({ date: `2026-09-${d}`, sessions: [], samples: [] }));
const view = (today: Omit<DayInput, 'date'>, now = T(18)) => buildTodayView([...emptyWeek(), { date: DATE, ...today }], settings, now);

describe('buildTodayView', () => {
  it('renders an empty first day as zeros with no NaN', () => {
    const v = view({ sessions: [], samples: [] });
    expect(v).toMatchObject({ screenSec: 0, activeSec: 0, goalSec: 420 * 60, firstSeenAt: null, cards: [], timeline: [] });
    expect(v.health.score).toBe(100);
    expect(v.week).toHaveLength(7);
    expect(v.week.every((d) => d.seconds === 0 && !Number.isNaN(d.seconds))).toBe(true);
  });

  it('groups screen time into category cards with top apps, sorted by time', () => {
    const v = view({
      sessions: [session('Visual Studio Code', T(9), T(11)), session('Discord', T(11), T(11, 30)), session('Figma', T(11, 30), T(12))],
      samples: run(T(9), 180, 1)
    });
    expect(v.screenSec).toBe(3 * 3600);
    expect(v.activeSec).toBe(3 * 3600);
    expect(v.cards.map((c) => [c.category, c.seconds])).toEqual([['work', 9000], ['social', 1800]]);
    expect(v.cards[0].apps).toEqual([{ appName: 'Visual Studio Code', seconds: 7200 }, { appName: 'Figma', seconds: 1800 }]);
    expect(v.firstSeenAt).toBe(T(9));
  });

  it('counts the open latest session up to now, but not an older open session', () => {
    const v = view({ sessions: [session('Figma', T(8), null), session('Visual Studio Code', T(9), null)], samples: run(T(8), 90, 1) }, T(9, 30));
    expect(v.screenSec).toBe(30 * 60);
  });

  it('includes the part after midnight of a session that started yesterday', () => {
    const v = view({ sessions: [session('Visual Studio Code', T(23, 50, 22), T(0, 20), '2026-09-22')], samples: run(T(0), 20, 1) });
    expect(v.screenSec).toBe(20 * 60);
    expect(v.timeline).toEqual([{ start: T(0), end: T(0, 20), category: 'work' }]);
  });

  it('removes away time (no input for >= 10 min) but keeps short pauses', () => {
    const samples = [...run(T(10), 20, 1), ...run(T(10, 20), 20, 0), ...run(T(10, 40), 15, 1), ...run(T(10, 55), 5, 0)];
    const v = view({ sessions: [session('Google Chrome', T(10), T(11))], samples });
    expect(v.screenSec).toBe(40 * 60);
    expect(v.timeline).toEqual([{ start: T(10), end: T(10, 20), category: 'other' }, { start: T(10, 40), end: T(11), category: 'other' }]);
  });

  it('never counts the lock screen', () => {
    const v = view({ sessions: [session('LockApp.exe', T(12), T(13)), session('Slack', T(13), T(13, 10))], samples: run(T(12), 70, 1) });
    expect(v.screenSec).toBe(10 * 60);
    expect(v.cards.map((c) => c.category)).toEqual(['communication']);
  });

  it('merges adjacent same-category pieces on the timeline', () => {
    const v = view({ sessions: [session('Visual Studio Code', T(9), T(9, 30)), session('Figma', T(9, 30), T(10)), session('Discord', T(10), T(10, 5))], samples: run(T(9), 65, 1) });
    expect(v.timeline).toEqual([{ start: T(9), end: T(10), category: 'work' }, { start: T(10), end: T(10, 5), category: 'social' }]);
  });

  it('builds weekly bars per category, oldest first', () => {
    const days = emptyWeek();
    days[0] = { date: '2026-09-17', sessions: [session('Spotify', T(10, 0, 17), T(11, 0, 17), '2026-09-17')], samples: [] };
    const v = buildTodayView([...days, { date: DATE, sessions: [], samples: [] }], settings, T(18));
    expect(v.week[0]).toMatchObject({ date: '2026-09-17', seconds: 3600 });
    expect(v.week[0].byCategory.entertainment).toBe(3600);
    expect(v.week[6].date).toBe(DATE);
  });
});

describe('loadTodayView', () => {
  it('reads 7 days (plus the day before each) from the repositories', () => {
    const db = new Database(':memory:');
    db.exec(SCHEMA_SQL);
    const repo = createRepositories(db);
    const id = repo.startFocusSession({ appName: 'Visual Studio Code', appPath: null, windowTitle: 'a.ts', pid: 1, startedAt: T(9), date: DATE });
    repo.finalizeFocusSession(id, T(10));
    for (const { id: _id, ...s } of run(T(9), 60, 1)) repo.insertActivitySample(s);
    const v = loadTodayView(repo, settings, DATE, T(18));
    expect(v.screenSec).toBe(3600);
    expect(v.week.map((d) => d.date)).toEqual(['2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22', DATE]);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @worksight/consumer test`
Expected: FAIL — cannot resolve `./today`.

- [ ] **Step 3: Implement**

`apps/consumer/src/main/day/today.ts`:

```ts
import type { Repositories } from '@worksight/core';
import type { ActivitySampleRow, FocusSessionRow, ISODate } from '@worksight/core/types';
import { CATEGORIES, categoryForApp, type Category } from '../../shared/categories';
import { atLeast, clip, dayBounds, restPeriods, sessionInterval, shiftDate, subtract, type Interval } from './time';
import { computeHealth, type Health } from './health';

// ponytail: no input for >= 10 min counts as "away" even with a window focused (also drops input-free video).
// Phase 4 refines this with Laya's activity=watching label.
export const AWAY_MS = 10 * 60_000;
const NOT_SCREEN = /^lockapp(\.exe)?$/i; // Windows lock screen
const TIMELINE_JOIN_MS = 60_000;

export interface DayInput { date: ISODate; sessions: FocusSessionRow[]; samples: ActivitySampleRow[]; }
export interface ViewSettings { dailyGoalMin: number; windDownTime: string; breakIntervalMin: number; }
export interface AppTime { appName: string; seconds: number; }
export interface CategoryCard { category: Category; seconds: number; apps: AppTime[]; }
export interface TimelineSegment { start: number; end: number; category: Category; }
export interface DayBar { date: ISODate; seconds: number; byCategory: Record<Category, number>; }
export interface TodayView {
  date: ISODate; now: number; screenSec: number; activeSec: number; goalSec: number; firstSeenAt: number | null;
  cards: CategoryCard[]; timeline: TimelineSegment[]; health: Health; week: DayBar[];
}

interface Piece extends Interval { appName: string; category: Category; }

const sec = (ms: number): number => Math.round(ms / 1000);
const zeroByCategory = (): Record<Category, number> => Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;

/** On-screen pieces of the day: sessions clipped to the day, minus lock screen and away periods. */
function dayPieces(day: DayInput, now: number): Piece[] {
  const bounds = dayBounds(day.date);
  const away = atLeast(restPeriods(day.samples), AWAY_MS);
  const sorted = [...day.sessions].sort((a, b) => a.startedAt - b.startedAt);
  const pieces: Piece[] = [];
  sorted.forEach((s, i) => {
    if (NOT_SCREEN.test(s.appName.trim())) return;
    const iv = clip(sessionInterval(s, i === sorted.length - 1, now), bounds.start, bounds.end);
    if (!iv) return;
    const category = categoryForApp(s.appName);
    for (const p of subtract(iv, away)) pieces.push({ ...p, appName: s.appName, category });
  });
  return pieces;
}

const totalMs = (pieces: Interval[]): number => pieces.reduce((a, p) => a + (p.end - p.start), 0);

function cardsOf(pieces: Piece[]): CategoryCard[] {
  const byCat = new Map<Category, Map<string, number>>();
  for (const p of pieces) {
    const apps = byCat.get(p.category) ?? new Map<string, number>();
    apps.set(p.appName, (apps.get(p.appName) ?? 0) + (p.end - p.start));
    byCat.set(p.category, apps);
  }
  return [...byCat.entries()]
    .map(([category, apps]) => ({
      category,
      seconds: sec([...apps.values()].reduce((a, b) => a + b, 0)),
      apps: [...apps.entries()].map(([appName, ms]) => ({ appName, seconds: sec(ms) })).sort((a, b) => b.seconds - a.seconds).slice(0, 3)
    }))
    .filter((c) => c.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds);
}

function timelineOf(pieces: Piece[]): TimelineSegment[] {
  const out: TimelineSegment[] = [];
  for (const p of [...pieces].sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1];
    if (last && last.category === p.category && p.start - last.end <= TIMELINE_JOIN_MS) last.end = Math.max(last.end, p.end);
    else out.push({ start: p.start, end: p.end, category: p.category });
  }
  return out;
}

function barOf(day: DayInput, now: number): DayBar {
  const byCategory = zeroByCategory();
  const pieces = dayPieces(day, now);
  for (const p of pieces) byCategory[p.category] += p.end - p.start;
  for (const c of CATEGORIES) byCategory[c] = sec(byCategory[c]);
  return { date: day.date, seconds: sec(totalMs(pieces)), byCategory };
}

export function buildTodayView(days: DayInput[], settings: ViewSettings, now: number): TodayView {
  const today = days[days.length - 1];
  const pieces = dayPieces(today, now);
  const screenSec = sec(totalMs(pieces));
  const activeSec = sec(today.samples.filter((s) => s.active === 1).reduce((a, s) => a + (s.bucketEnd - s.bucketStart), 0));
  return {
    date: today.date, now, screenSec, activeSec, goalSec: settings.dailyGoalMin * 60,
    firstSeenAt: pieces.length ? Math.min(...pieces.map((p) => p.start)) : null,
    cards: cardsOf(pieces),
    timeline: timelineOf(pieces),
    health: computeHealth({ samples: today.samples, screenSec, ...settings }),
    week: days.map((d) => barOf(d, now))
  };
}

export function loadTodayView(repo: Repositories, settings: ViewSettings, date: ISODate, now: number): TodayView {
  const days: DayInput[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = shiftDate(date, -i);
    days.push({ date: d, sessions: [...repo.getFocusSessions(shiftDate(d, -1)), ...repo.getFocusSessions(d)], samples: repo.getActivitySamples(d) });
  }
  return buildTodayView(days, settings, now);
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @worksight/consumer test`
Expected: PASS (all of today.test.ts plus earlier files).

- [ ] **Step 5: Commit**

```bash
git add apps/consumer/src/main/day/today.ts apps/consumer/src/main/day/today.test.ts
git commit -m "feat(consumer): Today view model (screen time, categories, timeline, week)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 11: Electron main process, settings, IPC, preload

**Files:**
- Create: `apps/consumer/src/main/settings.ts`
- Test: `apps/consumer/src/main/settings.test.ts`
- Create: `apps/consumer/src/main/channels.ts`, `apps/consumer/src/main/ipc.ts`, `apps/consumer/src/main/index.ts`, `apps/consumer/src/preload/index.ts`
- Create: `apps/consumer/electron.vite.config.ts`, `apps/consumer/index.html`, `apps/consumer/src/renderer/main.tsx` (temporary stub, replaced in Task 12)
- Create: `apps/consumer/resources/tray.png`, `apps/consumer/resources/icon.png` (copies of the agent's)
- Modify: `apps/consumer/package.json`

**Interfaces:**
- Consumes: core `openDatabase`, `createRepositories`, `createTracker`, `systemClock`, `createKvStore`, `Tracker`, `Repositories`, `KvStore`; adapters; Task 10 `loadTodayView`, `TodayView`.
- Produces:
  ```ts
  // settings.ts
  export const DEFAULT_SETTINGS: { consentGranted: boolean; trackingPaused: boolean; idleThresholdSec: number; captureWindowTitles: boolean; pollIntervalMs: number; bucketSizeSec: number; dailyGoalMin: number; windDownTime: string; breakIntervalMin: number; openAtLogin: boolean };
  export type DaylensSettings = typeof DEFAULT_SETTINGS;
  export const settingsPatch: z.ZodType<SettingsPatch>;  // renderer-editable keys only, strict
  export type SettingsPatch = Partial<Pick<DaylensSettings, 'dailyGoalMin' | 'windDownTime' | 'breakIntervalMin' | 'captureWindowTitles' | 'openAtLogin'>>;
  // preload → window.daylens
  export type DaylensApi = {
    today(date: string): Promise<TodayView>;
    settings: { get(): Promise<DaylensSettings>; set(patch: SettingsPatch): Promise<DaylensSettings> };
    consent: { grant(): Promise<DaylensSettings> };
    tracking: { status(): Promise<TrackingStatus>; set(on: boolean): Promise<TrackingStatus> };
    onUpdate(cb: () => void): () => void;
  };
  ```

- [ ] **Step 1: Add the Electron/React toolchain**

```bash
pnpm --filter @worksight/consumer add -D electron@^33.3.1 electron-vite@^2.3.0 vite@^6.0.7 react@^19.0.0 react-dom@^19.0.0 @types/react@^19.0.4 @types/react-dom@^19.0.2 @vitejs/plugin-react@^4.3.4 @fontsource-variable/dm-sans
cp apps/agent/resources/tray.png apps/agent/resources/icon.png apps/consumer/resources/
```

Then add these `scripts` to `apps/consumer/package.json` (keep `pretest`, `test`, `typecheck`):

```json
    "predev": "node ../../scripts/rebuild-native.cjs",
    "dev": "electron-vite dev",
```

- [ ] **Step 2: Write the failing settings test**

`apps/consumer/src/main/settings.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { settingsPatch, DEFAULT_SETTINGS } from './settings';

describe('settingsPatch', () => {
  it('accepts valid user-editable settings', () => {
    expect(settingsPatch.parse({ dailyGoalMin: 300, windDownTime: '22:30', breakIntervalMin: 45, captureWindowTitles: false, openAtLogin: true }))
      .toEqual({ dailyGoalMin: 300, windDownTime: '22:30', breakIntervalMin: 45, captureWindowTitles: false, openAtLogin: true });
  });
  it.each([
    [{ dailyGoalMin: 5 }], [{ dailyGoalMin: 2000 }], [{ windDownTime: '25:00' }], [{ windDownTime: '9pm' }],
    [{ breakIntervalMin: 3 }], [{ consentGranted: true }], [{ trackingPaused: true }], [{ pollIntervalMs: 1 }]
  ])('rejects %j', (patch) => {
    expect(settingsPatch.safeParse(patch).success).toBe(false);
  });
  it('ships sane defaults', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ consentGranted: false, dailyGoalMin: 420, windDownTime: '23:00', breakIntervalMin: 50 });
  });
});
```

- [ ] **Step 3: Run to confirm failure**

Run: `pnpm --filter @worksight/consumer test`
Expected: FAIL — cannot resolve `./settings`.

- [ ] **Step 4: Implement settings, channels, IPC**

`apps/consumer/src/main/settings.ts`:

```ts
import { z } from 'zod';

export const DEFAULT_SETTINGS = {
  consentGranted: false,
  trackingPaused: false,
  idleThresholdSec: 60,
  captureWindowTitles: true,
  pollIntervalMs: 2000,
  bucketSizeSec: 60,
  dailyGoalMin: 420,
  windDownTime: '23:00',
  breakIntervalMin: 50,
  openAtLogin: true
};
export type DaylensSettings = typeof DEFAULT_SETTINGS;

// Only these are editable from the renderer; consent and pause have dedicated channels, tracker internals none.
export const settingsPatch = z.object({
  dailyGoalMin: z.number().int().min(60).max(1440),
  windDownTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  breakIntervalMin: z.number().int().min(10).max(180),
  captureWindowTitles: z.boolean(),
  openAtLogin: z.boolean()
}).partial().strict();
export type SettingsPatch = z.infer<typeof settingsPatch>;
```

`apps/consumer/src/main/channels.ts`:

```ts
export const CH = {
  todayGet: 'today:get',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  consentGrant: 'consent:grant',
  trackingStatus: 'tracking:status',
  trackingSet: 'tracking:set',
  eventsUpdate: 'events:update'
} as const;
```

`apps/consumer/src/main/ipc.ts`:

```ts
import { ipcMain } from 'electron';
import { z } from 'zod';
import type { KvStore, Repositories, Tracker } from '@worksight/core';
import { CH } from './channels';
import { settingsPatch, type DaylensSettings } from './settings';
import { loadTodayView } from './day/today';

const dateArg = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

export interface IpcDeps {
  repo: Repositories;
  settings: KvStore<DaylensSettings>;
  tracker: Tracker;
  setTracking(on: boolean): void;
  onSettingsChanged(): void;
  now(): number;
}

export function registerIpc(d: IpcDeps): void {
  ipcMain.handle(CH.todayGet, (_e, raw) => loadTodayView(d.repo, d.settings.get(), dateArg.parse(raw).date, d.now()));
  ipcMain.handle(CH.settingsGet, () => d.settings.get());
  ipcMain.handle(CH.settingsSet, (_e, raw) => {
    const next = d.settings.set(settingsPatch.parse(raw));
    d.onSettingsChanged();
    return next;
  });
  ipcMain.handle(CH.consentGrant, () => {
    d.settings.set({ consentGranted: true });
    if (!d.settings.get().trackingPaused) d.tracker.start();
    return d.settings.get();
  });
  ipcMain.handle(CH.trackingStatus, () => d.tracker.status());
  ipcMain.handle(CH.trackingSet, (_e, raw) => { d.setTracking(z.boolean().parse(raw)); return d.tracker.status(); });
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @worksight/consumer test`
Expected: PASS.

- [ ] **Step 6: Main process entry, preload, build config**

`apps/consumer/src/main/index.ts`:

```ts
import { app, BrowserWindow, Menu, Tray, powerMonitor } from 'electron';
import { join } from 'node:path';
import { createKvStore, createRepositories, createTracker, openDatabase, systemClock } from '@worksight/core';
import { ActiveWinForegroundSource, UiohookInputSource } from '@worksight/core/adapters';
import { CH } from './channels';
import { registerIpc } from './ipc';
import { DEFAULT_SETTINGS } from './settings';

app.setName('Daylens');
const startHidden = process.argv.includes('--hidden');
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 1100, minHeight: 720, show: false, backgroundColor: '#FBF8F4',
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#FBF8F4', symbolColor: '#171717', height: 40 },
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.on('ready-to-show', () => { if (!startHidden) win?.show(); });
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win?.hide(); } });
  win.on('closed', () => { win = null; });
  if (process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
}

function showWindow(): void {
  if (!win) createWindow();
  win?.show();
  win?.focus();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(() => {
    const db = openDatabase(join(app.getPath('userData'), 'daylens.sqlite'));
    const repo = createRepositories(db);
    const settings = createKvStore(db, DEFAULT_SETTINGS);

    let lastPush = 0;
    // ponytail: drop pushes closer than 2 s; the renderer also polls every 30 s, so a dropped push only delays by <30 s.
    const pushUpdate = (): void => {
      const t = Date.now();
      if (t - lastPush < 2000) return;
      lastPush = t;
      win?.webContents.send(CH.eventsUpdate);
    };

    const tracker = createTracker({
      foreground: new ActiveWinForegroundSource(),
      input: new UiohookInputSource(),
      clock: systemClock,
      repo,
      getSettings: () => settings.get(),
      getSystemIdleSec: () => powerMonitor.getSystemIdleTime(),
      onUpdate: pushUpdate
    });

    function refreshTray(): void {
      const paused = settings.get().trackingPaused;
      tray?.setContextMenu(Menu.buildFromTemplate([
        { label: 'Open Daylens', click: showWindow },
        { label: paused ? 'Resume tracking' : 'Pause tracking', click: () => setTracking(paused) },
        { type: 'separator' },
        { label: 'Quit', click: () => { quitting = true; app.quit(); } }
      ]));
    }
    function setTracking(on: boolean): void {
      settings.set({ trackingPaused: !on });
      if (on && settings.get().consentGranted) tracker.start(); else tracker.stop();
      refreshTray();
      win?.webContents.send(CH.eventsUpdate);
    }
    const applyLoginItem = (): void => {
      // Only the packaged app registers itself; in dev this would register electron.exe.
      if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: settings.get().openAtLogin, args: ['--hidden'] });
    };

    registerIpc({ repo, settings, tracker, setTracking, onSettingsChanged: applyLoginItem, now: () => Date.now() });
    createWindow();

    // Start tracking BEFORE the tray: a tray failure must never prevent tracking.
    const s = settings.get();
    if (s.consentGranted && !s.trackingPaused) tracker.start();
    applyLoginItem();

    try {
      tray = new Tray(app.isPackaged ? join(process.resourcesPath, 'tray.png') : join(__dirname, '../../resources/tray.png'));
      tray.setToolTip('Daylens');
      tray.on('click', showWindow);
      refreshTray();
    } catch (e) {
      console.error('[main] tray setup failed (tracking unaffected):', e);
    }

    app.on('before-quit', () => { quitting = true; tracker.stop(); });
  });
}

app.on('window-all-closed', () => { /* keep running in the tray */ });
```

`apps/consumer/src/preload/index.ts`:

```ts
import { contextBridge, ipcRenderer } from 'electron';
import type { TrackingStatus } from '@worksight/core/types';
import { CH } from '../main/channels';
import type { DaylensSettings, SettingsPatch } from '../main/settings';
import type { TodayView } from '../main/day/today';

const api = {
  today: (date: string): Promise<TodayView> => ipcRenderer.invoke(CH.todayGet, { date }),
  settings: {
    get: (): Promise<DaylensSettings> => ipcRenderer.invoke(CH.settingsGet),
    set: (patch: SettingsPatch): Promise<DaylensSettings> => ipcRenderer.invoke(CH.settingsSet, patch)
  },
  consent: { grant: (): Promise<DaylensSettings> => ipcRenderer.invoke(CH.consentGrant) },
  tracking: {
    status: (): Promise<TrackingStatus> => ipcRenderer.invoke(CH.trackingStatus),
    set: (on: boolean): Promise<TrackingStatus> => ipcRenderer.invoke(CH.trackingSet, on)
  },
  onUpdate: (cb: () => void): (() => void) => {
    const listener = (): void => cb();
    ipcRenderer.on(CH.eventsUpdate, listener);
    return () => ipcRenderer.off(CH.eventsUpdate, listener);
  }
};

export type DaylensApi = typeof api;
contextBridge.exposeInMainWorld('daylens', api);
```

`apps/consumer/electron.vite.config.ts`:

```ts
import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

// externalizeDepsPlugin externalizes package.json "dependencies" only; @worksight/core is a devDependency, so it is bundled.
export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    root: '.',
    build: { rollupOptions: { input: { index: resolve(__dirname, 'index.html') } } },
    plugins: [react()]
  }
});
```

`apps/consumer/index.html`:

```html
<!doctype html>
<html>
  <head><meta charset="UTF-8" /><title>Daylens</title></head>
  <body><div id="root"></div><script type="module" src="/src/renderer/main.tsx"></script></body>
</html>
```

`apps/consumer/src/renderer/main.tsx` (stub; Task 12 replaces it):

```tsx
import { createRoot } from 'react-dom/client';

createRoot(document.getElementById('root')!).render(<p style={{ padding: 60 }}>Daylens shell</p>);
```

- [ ] **Step 7: Typecheck and smoke-run**

```bash
pnpm --filter @worksight/consumer typecheck && pnpm --filter @worksight/consumer dev
```

Expected: typecheck exits 0; a 1280×860 cream window with native Windows min/max/close buttons shows "Daylens shell"; a tray icon appears with Open / Pause / Quit. Close the window (it hides), reopen from the tray, then Quit from the tray.

- [ ] **Step 8: Commit**

```bash
git add apps/consumer pnpm-lock.yaml
git commit -m "feat(consumer): Electron main process, settings, IPC, preload, tray

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 12: Renderer foundation — theme, title bar, rail, consent

**Files:**
- Create: `apps/consumer/src/renderer/styles.css`
- Create: `apps/consumer/src/renderer/lib/api.ts`, `apps/consumer/src/renderer/lib/format.ts`
- Test: `apps/consumer/src/renderer/lib/format.test.ts`
- Create: `apps/consumer/src/renderer/components/Icon.tsx`, `TitleBar.tsx`, `Rail.tsx`, `Consent.tsx`
- Create: `apps/consumer/src/renderer/App.tsx`
- Modify: `apps/consumer/src/renderer/main.tsx`

**Interfaces:**
- Consumes: `window.daylens` (Task 11), `Category`/`CATEGORY_LABEL`/`displayAppName` (Task 7).
- Produces:
  ```ts
  // lib/format.ts
  export function formatHm(sec: number): string;            // 22320 → "6h 12m", 2880 → "48m", 20 → "0m"
  export function formatClock(ms: number): string;          // "8:12 am"
  export function hourLabel(h: number): string;             // 0|24 → "12 am", 12 → "12 pm", 14 → "2 pm"
  export function appInitials(appName: string): string;     // "Google Chrome" → "GC", "Discord" → "D", "deadlock.exe" → "D"
  export function appColor(appName: string): string;        // stable hsl() per app
  export function joinApps(names: string[]): string;        // ["A","B","C"] → "A, B & C"
  export function healthLabel(score: number): string;       // >=75 "Pretty healthy", >=50 "Could use a break", else "Rough day"
  // components
  export type IconName = 'home' | 'settings' | 'work' | 'learning' | 'social' | 'entertainment' | 'communication' | 'other' | 'all' | 'sun';
  export function Icon(p: { name: IconName }): JSX.Element;
  export type Route = 'today' | 'settings';
  export function Rail(p: { route: Route; onNavigate(r: Route): void }): JSX.Element;
  export function TitleBar(p: { tracking: boolean | null }): JSX.Element; // null = before consent / loading
  export function Consent(p: { onAccept(): void }): JSX.Element;
  ```

- [ ] **Step 1: Write the failing format test**

`apps/consumer/src/renderer/lib/format.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatHm, formatClock, hourLabel, appInitials, appColor, joinApps, healthLabel } from './format';

describe('format', () => {
  it('formatHm', () => {
    expect(formatHm(22320)).toBe('6h 12m');
    expect(formatHm(2880)).toBe('48m');
    expect(formatHm(3600)).toBe('1h 0m');
    expect(formatHm(20)).toBe('0m');
    expect(formatHm(-5)).toBe('0m');
  });
  it('formatClock', () => {
    expect(formatClock(new Date(2026, 8, 23, 8, 12).getTime())).toBe('8:12 am');
    expect(formatClock(new Date(2026, 8, 23, 15, 5).getTime())).toBe('3:05 pm');
    expect(formatClock(new Date(2026, 8, 23, 0, 0).getTime())).toBe('12:00 am');
  });
  it('hourLabel', () => {
    expect([0, 8, 12, 14, 24].map(hourLabel)).toEqual(['12 am', '8 am', '12 pm', '2 pm', '12 am']);
  });
  it('appInitials', () => {
    expect(appInitials('Google Chrome')).toBe('GC');
    expect(appInitials('Discord')).toBe('D');
    expect(appInitials('deadlock.exe')).toBe('D');
    expect(appInitials('Windows Terminal Host')).toBe('WT');
  });
  it('appColor is stable per app', () => {
    expect(appColor('Discord')).toBe(appColor('Discord'));
    expect(appColor('Discord')).toMatch(/^hsl\(\d+ 55% 52%\)$/);
  });
  it('joinApps', () => {
    expect(joinApps(['A'])).toBe('A');
    expect(joinApps(['A', 'B'])).toBe('A & B');
    expect(joinApps(['A', 'B', 'C'])).toBe('A, B & C');
  });
  it('healthLabel', () => {
    expect([90, 75, 60, 10].map(healthLabel)).toEqual(['Pretty healthy', 'Pretty healthy', 'Could use a break', 'Rough day']);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @worksight/consumer test`
Expected: FAIL — cannot resolve `./format`.

- [ ] **Step 3: Implement format + api**

`apps/consumer/src/renderer/lib/format.ts`:

```ts
import { displayAppName } from '../../shared/categories';

export function formatHm(sec: number): string {
  const m = Math.floor(Math.max(0, sec) / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

export function formatClock(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  return `${((h + 11) % 12) + 1}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

export function hourLabel(h: number): string {
  const hh = h % 24;
  return `${((hh + 11) % 12) + 1} ${hh < 12 ? 'am' : 'pm'}`;
}

export function appInitials(appName: string): string {
  return displayAppName(appName).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

export function appColor(appName: string): string {
  let h = 0;
  for (const c of appName) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 55% 52%)`;
}

export function joinApps(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

export function healthLabel(score: number): string {
  return score >= 75 ? 'Pretty healthy' : score >= 50 ? 'Could use a break' : 'Rough day';
}
```

`apps/consumer/src/renderer/lib/api.ts`:

```ts
import type { DaylensApi } from '../../preload';

declare global { interface Window { daylens: DaylensApi } }
export const api: DaylensApi = window.daylens;
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @worksight/consumer test`
Expected: PASS.

- [ ] **Step 5: Styles (tokens + every component class used in Tasks 12–14)**

`apps/consumer/src/renderer/styles.css` — values lifted from `docs/superpowers/specs/assets/daylens-mockups/today-dashboard.html` and `onboarding-settings.html`:

```css
:root {
  --win: #FBF8F4; --panel: #F2EBE6; --ink: #171717; --muted: #77716C; --line: #E7DFD8; --white: #fff;
  --lav: #D8D2FC; --mint: #BFEBD3; --pink: #F4C6C8; --peach: #F9DDB9; --sky: #CFE6FB; --stone: #E9E3DD;
  --cat-work: var(--lav); --cat-learning: var(--mint); --cat-social: var(--pink);
  --cat-entertainment: var(--peach); --cat-communication: var(--sky); --cat-other: var(--stone);
  --spring: cubic-bezier(.2, 1.3, .35, 1); --ease: cubic-bezier(.22, .8, .26, 1);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body, #root { height: 100%; }
body { font-family: 'DM Sans Variable', system-ui, sans-serif; background: var(--win); color: var(--ink); overflow: hidden; -webkit-font-smoothing: antialiased; }
button { font: inherit; color: inherit; }

@keyframes rise { from { opacity: 0; transform: translateY(16px); } }
@keyframes grow { from { transform: scaleX(0); } }
@keyframes growy { from { transform: scaleY(0); } }
@keyframes ring { from { stroke-dashoffset: 201px; } to { stroke-dashoffset: var(--to); } }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes bob { 50% { transform: translateY(-10px); } }

/* title bar: the right ~140px belongs to the native Windows buttons (titleBarOverlay) */
.titlebar { height: 40px; display: flex; align-items: center; gap: 8px; padding: 0 150px 0 18px; font-size: 13px; font-weight: 600; border-bottom: 1px solid var(--line); -webkit-app-region: drag; user-select: none; }
.titlebar .status { margin-left: auto; font-weight: 500; color: var(--muted); display: flex; align-items: center; gap: 7px; }
.titlebar .dot { width: 7px; height: 7px; border-radius: 50%; background: #34C38F; box-shadow: 0 0 0 4px rgba(52, 195, 143, .18); }
.titlebar .dot.off { background: #C9C2BB; box-shadow: none; }

.shell { display: grid; grid-template-columns: 84px 1fr 330px; gap: 22px; padding: 20px; height: calc(100vh - 40px); }
.shell.wide { grid-template-columns: 84px 1fr; }

/* rail */
.rail { background: var(--panel); border-radius: 22px; display: flex; flex-direction: column; align-items: center; padding: 22px 0; gap: 14px; }
.logo { width: 40px; height: 40px; border-radius: 12px; background: var(--ink); color: #fff; display: grid; place-items: center; margin-bottom: 26px; }
.nav { width: 48px; height: 48px; border-radius: 50%; border: 0; background: var(--white); display: grid; place-items: center; cursor: pointer; transition: transform .25s var(--spring), background .2s; }
.nav:hover { transform: scale(1.08); }
.nav.on { background: var(--ink); color: #fff; }
.nav svg, .logo svg { width: 20px; height: 20px; }
.spacer { flex: 1; }

/* today — main column */
.today { overflow-y: auto; padding: 14px 6px 20px 14px; display: flex; flex-direction: column; }
.date { font-size: 14px; color: var(--muted); margin-bottom: 10px; animation: rise .6s var(--ease) both; }
.headline { font-weight: 400; font-size: 54px; line-height: 1.05; letter-spacing: -.025em; margin-bottom: 26px; animation: rise .6s .05s var(--ease) both; }
.headline b { font-weight: 600; }
.pills { display: flex; gap: 10px; margin-bottom: 24px; flex-wrap: wrap; }
.pill { display: flex; align-items: center; gap: 9px; padding: 6px 18px 6px 6px; border: 0; border-radius: 999px; background: var(--white); font-size: 13px; font-weight: 500; cursor: pointer; transition: transform .25s var(--spring); }
.pill:hover { transform: translateY(-2px); }
.pill i { width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; background: var(--win); border: 1px solid var(--line); }
.pill.on { background: var(--ink); color: #fff; }
.pill.on i { background: #fff; color: var(--ink); border: 0; }
.pill svg { width: 17px; height: 17px; }
.sec { font-size: 14px; color: var(--muted); margin-bottom: 12px; display: flex; justify-content: space-between; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 22px; }
.card { background: var(--c); border-radius: 22px; padding: 16px 18px; min-height: 140px; display: flex; flex-direction: column; transition: transform .35s var(--spring), box-shadow .3s; animation: rise .7s var(--ease) both; }
.card:hover { transform: translateY(-4px); box-shadow: 0 18px 30px -18px rgba(0, 0, 0, .35); }
.ctop { display: flex; align-items: center; gap: 10px; font-size: 12px; }
.ico { width: 34px; height: 34px; border-radius: 50%; background: rgba(255, 255, 255, .85); display: grid; place-items: center; }
.ico svg { width: 17px; height: 17px; }
.chip { margin-left: auto; background: rgba(255, 255, 255, .9); border-radius: 999px; padding: 4px 10px; font-size: 12px; font-weight: 600; }
.card h3 { font-weight: 500; font-size: 19px; line-height: 1.25; margin-top: auto; padding-top: 14px; max-width: 88%; }
.cfoot { display: flex; justify-content: space-between; align-items: end; margin-top: 6px; font-size: 12px; color: rgba(0, 0, 0, .6); }
.apps { display: flex; }
.apps b { width: 24px; height: 24px; border-radius: 50%; border: 2px solid rgba(255, 255, 255, .9); margin-left: -7px; display: grid; place-items: center; font-size: 9px; color: #fff; }
.empty { background: var(--white); border-radius: 22px; padding: 28px; color: var(--muted); font-size: 14px; margin-bottom: 22px; }

/* timeline */
.tl { background: var(--white); border-radius: 20px; padding: 14px 18px 12px; animation: rise .7s .3s var(--ease) both; }
.tlbar { position: relative; height: 30px; border-radius: 10px; background: #F5F1EC; overflow: hidden; }
.seg { position: absolute; top: 0; bottom: 0; background: var(--c); transform-origin: left; animation: grow .9s var(--ease) both; }
.now { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--ink); border-radius: 2px; }
.ticks { position: relative; height: 16px; margin-top: 7px; font-size: 11px; color: var(--muted); }
.ticks span { position: absolute; transform: translateX(-50%); white-space: nowrap; }

/* right panel */
.panel { background: var(--panel); border-radius: 22px; padding: 18px; display: flex; flex-direction: column; gap: 12px; overflow-y: auto; }
.ptitle { font-weight: 600; font-size: 15px; padding: 4px 2px; }
.box { background: var(--white); border-radius: 18px; padding: 14px 16px; animation: rise .6s var(--ease) both; }
.health { display: flex; align-items: center; gap: 14px; }
.ring { position: relative; width: 78px; height: 78px; flex: none; }
.ring svg { transform: rotate(-90deg); }
.ring circle.p { stroke-dasharray: 201px; animation: ring 1.4s .3s var(--ease) both; }
.ring .val { position: absolute; inset: 0; display: grid; place-items: center; font-size: 22px; font-weight: 600; }
.health h4 { font-size: 15px; font-weight: 600; }
.health p { font-size: 12px; color: var(--muted); margin-top: 3px; line-height: 1.4; }
.bhead { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: var(--muted); }
.big { display: flex; align-items: baseline; gap: 6px; margin: 6px 0 10px; }
.big b { font-size: 24px; font-weight: 500; }
.big span { font-size: 12px; color: var(--muted); }
.gbar { height: 12px; border-radius: 12px; background: var(--panel); overflow: hidden; }
.gbar div { height: 100%; border-radius: 12px; background: linear-gradient(90deg, var(--mint), #9ADBB9); transform-origin: left; animation: grow 1.2s .3s var(--ease) both; }
.gbar div.over { background: linear-gradient(90deg, var(--peach), #F4B183); }
.bars { display: flex; justify-content: space-between; align-items: flex-end; height: 118px; gap: 6px; border-top: 1px dashed var(--line); padding-top: 6px; }
.bar { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 5px; font-size: 10px; color: var(--muted); height: 100%; }
.stack { width: 100%; border-radius: 8px; overflow: hidden; display: flex; flex-direction: column-reverse; transform-origin: bottom; animation: growy .9s var(--ease) both; }
.bar.today .stack { outline: 2px solid var(--ink); outline-offset: 2px; }
.bar.today span { background: var(--ink); color: #fff; border-radius: 5px; padding: 1px 6px; }

/* consent (onboarding step 1 look) */
.consent { display: grid; grid-template-columns: 1fr 1fr; height: calc(100vh - 40px); }
.consent-l { padding: 56px 56px 44px; display: flex; flex-direction: column; overflow-y: auto; }
.consent-l > * { animation: rise .55s var(--ease) both; }
.consent-l h1 { font-weight: 400; font-size: 52px; letter-spacing: -.025em; line-height: 1.05; margin: 20px 0 14px; }
.consent-l h1 b { font-weight: 600; }
.lead { font-size: 15px; color: #4B4642; line-height: 1.55; margin-bottom: 22px; max-width: 460px; }
.promise { display: flex; flex-direction: column; gap: 12px; margin-bottom: 28px; }
.promise div { display: flex; gap: 12px; align-items: center; font-size: 14px; line-height: 1.4; }
.promise i { flex: none; width: 34px; height: 34px; border-radius: 12px; display: grid; place-items: center; font-style: normal; }
.btn { border: 0; border-radius: 999px; padding: 12px 22px; font-weight: 600; font-size: 14px; cursor: pointer; background: var(--ink); color: #fff; transition: transform .25s var(--spring); width: max-content; }
.btn:hover { transform: scale(1.04); }
.btn.s { background: var(--white); color: var(--ink); border: 1px solid var(--line); }
.consent-r { margin: 14px; border-radius: 22px; position: relative; overflow: hidden; display: grid; place-items: center; background: var(--mint); }
.orb { width: 260px; height: 260px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #fff, rgba(255, 255, 255, 0) 60%), conic-gradient(from 0deg, var(--lav), var(--mint), var(--peach), var(--pink), var(--lav)); animation: spin 18s linear infinite; }
.float { position: absolute; background: var(--white); border-radius: 16px; padding: 10px 14px; font-size: 12.5px; box-shadow: 0 14px 30px -16px rgba(0, 0, 0, .3); animation: bob 5s ease-in-out infinite; }
.float b { display: block; font-size: 15px; }

/* settings */
.settings { overflow-y: auto; padding: 6px 6px 20px; max-width: 760px; }
.settings h1 { font-size: 34px; font-weight: 500; letter-spacing: -.02em; margin: 8px 0 18px; }
.grp { background: var(--white); border-radius: 20px; padding: 6px 18px; margin-bottom: 14px; animation: rise .6s var(--ease) both; }
.grp h4 { font-size: 12px; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); font-weight: 600; padding: 12px 0 4px; }
.srow { display: flex; align-items: center; gap: 14px; padding: 13px 0; border-top: 1px solid var(--line); font-size: 14px; }
.grp h4 + .srow { border-top: 0; }
.srow p { flex: 1; }
.srow p small { display: block; color: var(--muted); font-size: 12.5px; margin-top: 2px; line-height: 1.4; }
.srow input[type=range] { width: 200px; accent-color: #171717; }
.srow input[type=time], .srow select { font: inherit; border: 1px solid var(--line); border-radius: 10px; padding: 6px 10px; background: var(--win); }
.sw { flex: none; width: 36px; height: 22px; border: 0; border-radius: 22px; background: rgba(0, 0, 0, .18); position: relative; cursor: pointer; transition: background .3s; }
.sw::after { content: ""; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform .35s var(--spring); }
.sw.on { background: var(--ink); }
.sw.on::after { transform: translateX(14px); }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
}
```

- [ ] **Step 6: Icons, title bar, rail, consent**

`apps/consumer/src/renderer/components/Icon.tsx`:

```tsx
export type IconName = 'home' | 'settings' | 'work' | 'learning' | 'social' | 'entertainment' | 'communication' | 'other' | 'all' | 'sun';

const PATHS: Record<IconName, JSX.Element> = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  work: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>,
  learning: <path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2zM22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z" />,
  social: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12z" />,
  entertainment: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m10 9 5 3-5 3z" /></>,
  communication: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
  other: <><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" /></>,
  all: <><rect x="3.5" y="3.5" width="7" height="7" rx="3.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="3.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="3.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="3.5" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5" /></>
};

export function Icon({ name }: { name: IconName }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
```

`apps/consumer/src/renderer/components/TitleBar.tsx`:

```tsx
import { Icon } from './Icon';

export function TitleBar({ tracking }: { tracking: boolean | null }) {
  return (
    <div className="titlebar">
      <span style={{ width: 16, height: 16, display: 'inline-grid' }}><Icon name="sun" /></span>
      Daylens
      {tracking !== null && (
        <span className="status"><i className={`dot${tracking ? '' : ' off'}`} />{tracking ? 'Tracking' : 'Paused'}</span>
      )}
    </div>
  );
}
```

`apps/consumer/src/renderer/components/Rail.tsx`:

```tsx
import { Icon } from './Icon';

export type Route = 'today' | 'settings';

export function Rail({ route, onNavigate }: { route: Route; onNavigate: (r: Route) => void }) {
  return (
    <aside className="rail">
      <div className="logo"><Icon name="sun" /></div>
      <button className={`nav${route === 'today' ? ' on' : ''}`} title="Today" aria-label="Today" onClick={() => onNavigate('today')}><Icon name="home" /></button>
      <div className="spacer" />
      <button className={`nav${route === 'settings' ? ' on' : ''}`} title="Settings" aria-label="Settings" onClick={() => onNavigate('settings')}><Icon name="settings" /></button>
    </aside>
  );
}
```

`apps/consumer/src/renderer/components/Consent.tsx` (copy reflects what Phase 2 actually tracks — Phase 3 extends it when screen reading arrives):

```tsx
export function Consent({ onAccept }: { onAccept: () => void }) {
  return (
    <div className="consent">
      <div className="consent-l">
        <h1>See your day<br /><b>clearly.</b></h1>
        <p className="lead">Daylens quietly keeps track of how you spend time on your PC, so you can see where the day went and build healthier screen habits.</p>
        <div className="promise">
          <div><i style={{ background: 'var(--mint)' }}>🔒</i><span><b>Everything stays on this PC.</b> No account, no cloud, no uploads.</span></div>
          <div><i style={{ background: 'var(--lav)' }}>🪟</i><span>Records <b>which app and window</b> is in front, and for how long.</span></div>
          <div><i style={{ background: 'var(--pink)' }}>⌨️</i><span>Counts mouse and keyboard <b>activity</b> to tell active from idle. It <b>never records what you type</b>.</span></div>
          <div><i style={{ background: 'var(--peach)' }}>⏸</i><span>Pause any time from the tray icon.</span></div>
        </div>
        <button className="btn" onClick={onAccept}>Start tracking →</button>
      </div>
      <div className="consent-r">
        <div className="orb" />
        <div className="float" style={{ top: '18%', left: '10%' }}><span style={{ color: 'var(--muted)' }}>Today</span><b>6h 12m</b></div>
        <div className="float" style={{ top: '26%', right: '9%', animationDelay: '-1.5s', background: 'var(--lav)' }}>✦ 90-min focus streak</div>
        <div className="float" style={{ bottom: '20%', left: '14%', animationDelay: '-3s', background: 'var(--peach)' }}>☀ Your week at a glance</div>
        <div className="float" style={{ bottom: '14%', right: '12%', animationDelay: '-2s' }}>Health score <b>72</b></div>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: App + entry**

`apps/consumer/src/renderer/App.tsx` (Task 13 adds `TodayScreen`, Task 14 adds `SettingsScreen`; until then both routes render a placeholder `<main />`):

```tsx
import { useEffect, useState } from 'react';
import type { DaylensSettings } from '../main/settings';
import { api } from './lib/api';
import { TitleBar } from './components/TitleBar';
import { Rail, type Route } from './components/Rail';
import { Consent } from './components/Consent';

export default function App() {
  const [settings, setSettings] = useState<DaylensSettings | null>(null);
  const [route, setRoute] = useState<Route>('today');

  useEffect(() => {
    void api.settings.get().then(setSettings);
    return api.onUpdate(() => void api.settings.get().then(setSettings)); // tray pause/resume
  }, []);

  if (!settings) return <TitleBar tracking={null} />;
  if (!settings.consentGranted) {
    return (<><TitleBar tracking={null} /><Consent onAccept={async () => setSettings(await api.consent.grant())} /></>);
  }
  return (
    <>
      <TitleBar tracking={!settings.trackingPaused} />
      <div className={`shell${route === 'settings' ? ' wide' : ''}`}>
        <Rail route={route} onNavigate={setRoute} />
        <main />
      </div>
    </>
  );
}
```

Replace `apps/consumer/src/renderer/main.tsx` with:

```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/dm-sans';
import './styles.css';
import App from './App';

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
```

- [ ] **Step 8: Typecheck and look**

```bash
pnpm --filter @worksight/consumer typecheck && pnpm --filter @worksight/consumer dev
```

Expected: typecheck exits 0. To see the consent screen on a fresh DB, delete `%APPDATA%/Daylens/daylens.sqlite*` before launching. Consent screen matches onboarding step 1 of `onboarding-settings.html` (DM Sans, orb spinning, floating cards bobbing). Clicking **Start tracking →** shows the title bar with a green "Tracking" dot and the rail (Today active). Pausing from the tray flips the dot to grey "Paused".

- [ ] **Step 9: Commit**

```bash
git add apps/consumer/src/renderer
git commit -m "feat(consumer): renderer theme, title bar, rail, consent screen

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 13: Today screen

**Files:**
- Create: `apps/consumer/src/renderer/components/TodayScreen.tsx`, `Timeline.tsx`, `HealthPanel.tsx`
- Modify: `apps/consumer/src/renderer/App.tsx`

**Interfaces:**
- Consumes: `TodayView`, `TimelineSegment`, `DayBar`, `CategoryCard` (Task 10); `CATEGORIES`, `CATEGORY_LABEL`, `displayAppName`, `Category` (Task 7); `formatHm`, `formatClock`, `hourLabel`, `appInitials`, `appColor`, `joinApps`, `healthLabel` (Task 12); `localDate` from `@worksight/core/date`.
- Produces: `TodayScreen({ settings })` rendering main column + right panel as two grid children (fragment).

- [ ] **Step 1: Timeline**

`apps/consumer/src/renderer/components/Timeline.tsx`:

```tsx
import type { TimelineSegment } from '../../main/day/today';
import type { Category } from '../../shared/categories';
import { formatHm, hourLabel } from '../lib/format';

const HOUR = 3_600_000;

export function Timeline({ date, segments, now, longestStretchSec, highlight }: {
  date: string; segments: TimelineSegment[]; now: number; longestStretchSec: number; highlight: Category | 'all';
}) {
  const [y, m, d] = date.split('-').map(Number);
  const midnight = new Date(y, m - 1, d).getTime();
  const firstH = segments.length ? Math.floor((segments[0].start - midnight) / HOUR) : 8;
  const lastH = segments.length ? Math.ceil((segments[segments.length - 1].end - midnight) / HOUR) : 22;
  const startH = Math.min(8, firstH);
  const endH = Math.min(24, Math.max(22, lastH));
  const origin = midnight + startH * HOUR;
  const span = (endH - startH) * HOUR;
  const pct = (t: number): number => Math.min(100, Math.max(0, ((t - origin) / span) * 100));
  const ticks: number[] = [];
  for (let h = startH; h <= endH; h += 2) ticks.push(h);
  const showNow = now >= origin && now <= origin + span;

  return (
    <div className="tl">
      <p className="sec" style={{ marginBottom: 10 }}>Your day <span>Longest stretch without a break: {formatHm(longestStretchSec)}</span></p>
      <div className="tlbar">
        {segments.map((s, i) => (
          <div key={i} className="seg" style={{
            left: `${pct(s.start)}%`, width: `${Math.max(0.3, pct(s.end) - pct(s.start))}%`,
            ['--c' as string]: `var(--cat-${s.category})`, animationDelay: `${0.3 + i * 0.03}s`,
            opacity: highlight === 'all' || highlight === s.category ? 1 : 0.25
          }} />
        ))}
        {showNow && <div className="now" style={{ left: `${pct(now)}%` }} />}
      </div>
      <div className="ticks">
        {ticks.map((h) => <span key={h} style={{ left: `${((h - startH) / (endH - startH)) * 100}%` }}>{hourLabel(h)}</span>)}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Health panel (ring, goal, week)**

`apps/consumer/src/renderer/components/HealthPanel.tsx`:

```tsx
import type { TodayView } from '../../main/day/today';
import { CATEGORIES } from '../../shared/categories';
import { formatHm, healthLabel } from '../lib/format';

const RING = 201; // 2πr for r = 32

export function HealthPanel({ view }: { view: TodayView }) {
  const { health, week } = view;
  const max = Math.max(1, ...week.map((d) => d.seconds));
  const tracked = week.filter((d) => d.seconds > 0);
  const avgSec = tracked.length ? tracked.reduce((a, d) => a + d.seconds, 0) / tracked.length : 0;
  const goalPct = view.goalSec > 0 ? view.screenSec / view.goalSec : 0;
  const details = [
    `${health.breaks} break${health.breaks === 1 ? '' : 's'} taken`,
    `longest stretch ${formatHm(health.longestStretchSec)}`,
    health.lateNight ? 'late-night use' : 'no late-night use'
  ].join(' · ');

  return (
    <aside className="panel">
      <p className="ptitle">Screen health</p>
      <div className="box health">
        <div className="ring">
          <svg width="78" height="78">
            <circle cx="39" cy="39" r="32" stroke="#F2EBE6" strokeWidth="9" fill="none" />
            <circle className="p" cx="39" cy="39" r="32" stroke="#7FD1A8" strokeWidth="9" fill="none" strokeLinecap="round"
              style={{ ['--to' as string]: `${RING * (1 - health.score / 100)}px` }} />
          </svg>
          <div className="val">{health.score}</div>
        </div>
        <div><h4>{healthLabel(health.score)}</h4><p>{details}</p></div>
      </div>

      <div className="box" style={{ animationDelay: '.1s' }}>
        <div className="bhead">Daily goal <span>under {formatHm(view.goalSec)}</span></div>
        <div className="big"><b>{formatHm(view.screenSec)}</b><span>{goalPct <= 1 ? `${formatHm(view.goalSec - view.screenSec)} left` : `${formatHm(view.screenSec - view.goalSec)} over`}</span></div>
        <div className="gbar"><div className={goalPct > 1 ? 'over' : ''} style={{ width: `${Math.min(100, goalPct * 100)}%` }} /></div>
      </div>

      <div className="box" style={{ animationDelay: '.2s' }}>
        <div className="bhead">Screen time · last 7 days</div>
        <div className="big"><b>{formatHm(avgSec)}</b><span>average on tracked days</span></div>
        <div className="bars">
          {week.map((d, i) => {
            const isToday = i === week.length - 1;
            const label = isToday ? 'Today' : new Date(`${d.date}T12:00:00`).toLocaleDateString([], { weekday: 'short' });
            return (
              <div key={d.date} className={`bar${isToday ? ' today' : ''}`} title={`${label}: ${formatHm(d.seconds)}`}>
                <div className="stack" style={{ height: `${(d.seconds / max) * 90}px`, animationDelay: `${0.3 + i * 0.08}s` }}>
                  {CATEGORIES.filter((c) => d.byCategory[c] > 0).map((c) => (
                    <div key={c} style={{ height: `${(d.byCategory[c] / d.seconds) * 100}%`, background: `var(--cat-${c})` }} />
                  ))}
                </div>
                <span>{label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
```

- [ ] **Step 3: Today screen**

`apps/consumer/src/renderer/components/TodayScreen.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { localDate } from '@worksight/core/date';
import type { DaylensSettings } from '../../main/settings';
import type { TodayView } from '../../main/day/today';
import { CATEGORY_LABEL, displayAppName, type Category } from '../../shared/categories';
import { api } from '../lib/api';
import { appColor, appInitials, formatClock, formatHm, joinApps } from '../lib/format';
import { Icon } from './Icon';
import { Timeline } from './Timeline';
import { HealthPanel } from './HealthPanel';

export function TodayScreen({ settings }: { settings: DaylensSettings }) {
  const [view, setView] = useState<TodayView | null>(null);
  const [filter, setFilter] = useState<Category | 'all'>('all');

  useEffect(() => {
    let alive = true;
    const load = (): void => { void api.today(localDate(Date.now())).then((v) => { if (alive) setView(v); }); };
    load();
    const off = api.onUpdate(load);
    const timer = setInterval(load, 30_000); // keeps the open session and "now" marker moving
    return () => { alive = false; off(); clearInterval(timer); };
  }, [settings.dailyGoalMin, settings.windDownTime, settings.breakIntervalMin]);

  if (!view) return <><main className="today" /><aside className="panel" /></>;

  const cards = view.cards.filter((c) => filter === 'all' || c.category === filter);
  const dateLabel = new Date(view.now).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <>
      <main className="today">
        <p className="date">{dateLabel}{view.firstSeenAt !== null && ` · first on screen at ${formatClock(view.firstSeenAt)}`}</p>
        <h1 className="headline">
          {view.screenSec > 0 ? <>You spent <b>{formatHm(view.screenSec)}</b><br />on screen today</> : <>No screen time<br />yet today</>}
        </h1>

        {view.cards.length > 0 && (
          <div className="pills">
            <button className={`pill${filter === 'all' ? ' on' : ''}`} onClick={() => setFilter('all')}><i><Icon name="all" /></i>All</button>
            {view.cards.map((c) => (
              <button key={c.category} className={`pill${filter === c.category ? ' on' : ''}`} onClick={() => setFilter(c.category)}>
                <i><Icon name={c.category} /></i>{CATEGORY_LABEL[c.category]}
              </button>
            ))}
          </div>
        )}

        <p className="sec">Where your time went</p>
        {cards.length === 0 ? (
          <div className="empty">Nothing tracked yet. Keep Daylens running and this fills in as you use your PC.</div>
        ) : (
          <div className="grid">
            {cards.map((c, i) => (
              <div key={c.category} className="card" style={{ ['--c' as string]: `var(--cat-${c.category})`, animationDelay: `${0.1 + i * 0.08}s` }}>
                <div className="ctop">
                  <span className="ico"><Icon name={c.category} /></span>{CATEGORY_LABEL[c.category]}
                  <span className="chip">{formatHm(c.seconds)}</span>
                </div>
                <h3>{joinApps(c.apps.map((a) => displayAppName(a.appName)))}</h3>
                <div className="cfoot">
                  <span>{Math.round((c.seconds / Math.max(1, view.screenSec)) * 100)}% of today</span>
                  <span className="apps">{c.apps.map((a) => <b key={a.appName} style={{ background: appColor(a.appName) }}>{appInitials(a.appName)}</b>)}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        <Timeline date={view.date} segments={view.timeline} now={view.now} longestStretchSec={view.health.longestStretchSec} highlight={filter} />
      </main>
      <HealthPanel view={view} />
    </>
  );
}
```

- [ ] **Step 4: Route to it**

In `apps/consumer/src/renderer/App.tsx` add the import:

```tsx
import { TodayScreen } from './components/TodayScreen';
```

and replace `<main />` with:

```tsx
        {route === 'today' ? <TodayScreen settings={settings} /> : <main />}
```

- [ ] **Step 5: Typecheck, run, compare with the mockup**

```bash
pnpm --filter @worksight/consumer typecheck && pnpm --filter @worksight/consumer dev
```

Expected: typecheck exits 0. With tracking on, use two or three apps for ~3 minutes. Then the headline shows the minutes, category cards appear with app bubbles, the timeline shows coloured segments and a black "now" line, the health ring animates to its score, and the 7-day bars show today outlined. Clicking a category pill filters the cards and dims the other timeline segments. Open `docs/superpowers/specs/assets/daylens-mockups/today-dashboard.html` side by side: spacing, radii, colours and entrance animations should match. The mockup's AI sentences, coach cards and bell are intentionally absent until Phases 4–6.

- [ ] **Step 6: Commit**

```bash
git add apps/consumer/src/renderer
git commit -m "feat(consumer): Today dashboard (categories, timeline, health, week)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 14: Settings screen

**Files:**
- Create: `apps/consumer/src/renderer/components/SettingsScreen.tsx`
- Modify: `apps/consumer/src/renderer/App.tsx`

**Interfaces:**
- Consumes: `api.settings.set(patch: SettingsPatch)`, `api.tracking.set(on)`, `DaylensSettings`, `formatHm`.
- Produces: `SettingsScreen({ settings, onChange(next: DaylensSettings) })`.

- [ ] **Step 1: Implement**

`apps/consumer/src/renderer/components/SettingsScreen.tsx`:

```tsx
import type { DaylensSettings, SettingsPatch } from '../../main/settings';
import { api } from '../lib/api';
import { formatHm } from '../lib/format';

export function SettingsScreen({ settings, onChange }: { settings: DaylensSettings; onChange: (s: DaylensSettings) => void }) {
  const save = async (patch: SettingsPatch): Promise<void> => onChange(await api.settings.set(patch));
  const toggleTracking = async (): Promise<void> => {
    await api.tracking.set(settings.trackingPaused);
    onChange(await api.settings.get());
  };

  return (
    <main className="settings">
      <h1>Settings</h1>

      <div className="grp">
        <h4>Tracking</h4>
        <div className="srow">
          <p>{settings.trackingPaused ? 'Tracking is paused' : 'Tracking is on'}<small>Pausing stops all recording until you resume. Also available from the tray icon.</small></p>
          <button className={`btn${settings.trackingPaused ? '' : ' s'}`} onClick={toggleTracking}>{settings.trackingPaused ? 'Resume' : 'Pause'}</button>
        </div>
        <div className="srow">
          <p>Record window titles<small>Shows which file or page you were on. Turn off to record app names only.</small></p>
          <button className={`sw${settings.captureWindowTitles ? ' on' : ''}`} aria-label="Record window titles" onClick={() => save({ captureWindowTitles: !settings.captureWindowTitles })} />
        </div>
        <div className="srow">
          <p>Start with Windows<small>Opens quietly in the tray when you sign in.</small></p>
          <button className={`sw${settings.openAtLogin ? ' on' : ''}`} aria-label="Start with Windows" onClick={() => save({ openAtLogin: !settings.openAtLogin })} />
        </div>
      </div>

      <div className="grp" style={{ animationDelay: '.08s' }}>
        <h4>Goals & health</h4>
        <div className="srow">
          <p>Daily screen-time goal: <b>{formatHm(settings.dailyGoalMin * 60)}</b><small>Your health score drops as you go past it.</small></p>
          <input type="range" min={2} max={12} step={0.5} value={settings.dailyGoalMin / 60} aria-label="Daily screen-time goal in hours"
            onChange={(e) => void save({ dailyGoalMin: Math.round(Number(e.target.value) * 60) })} />
        </div>
        <div className="srow">
          <p>Wind down after<small>Screen use after this time (or before 5 am) counts as late-night use.</small></p>
          <input type="time" value={settings.windDownTime} aria-label="Wind-down time"
            onChange={(e) => { if (/^([01]\d|2[0-3]):[0-5]\d$/.test(e.target.value)) void save({ windDownTime: e.target.value }); }} />
        </div>
        <div className="srow">
          <p>Take a break every<small>Used for the "breaks taken" part of your health score.</small></p>
          <select value={settings.breakIntervalMin} aria-label="Break interval" onChange={(e) => void save({ breakIntervalMin: Number(e.target.value) })}>
            {[30, 45, 50, 60, 90].map((m) => <option key={m} value={m}>{m} minutes</option>)}
          </select>
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Route to it**

In `apps/consumer/src/renderer/App.tsx` add:

```tsx
import { SettingsScreen } from './components/SettingsScreen';
```

and replace:

```tsx
        {route === 'today' ? <TodayScreen settings={settings} /> : <main />}
```

with:

```tsx
        {route === 'today' ? <TodayScreen settings={settings} /> : <SettingsScreen settings={settings} onChange={setSettings} />}
```

- [ ] **Step 3: Typecheck and run**

```bash
pnpm --filter @worksight/consumer typecheck && pnpm --filter @worksight/consumer dev
```

Expected: the rail's gear opens Settings. Dragging the goal slider updates the label live, and Today's goal box reflects it after navigating back. Changing wind-down to a time earlier than now makes Today's health line say "late-night use" (if you were active since then). Pause flips the title-bar dot to "Paused" and the tray label to "Resume tracking". Resuming from the tray flips both back.

- [ ] **Step 4: Commit**

```bash
git add apps/consumer/src/renderer
git commit -m "feat(consumer): settings screen (tracking, goals, health)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 15: Whole-branch verification

**Files:** none new.

- [ ] **Step 1: Everything green**

```bash
pnpm test && pnpm --filter @worksight/core typecheck && pnpm --filter @worksight/agent typecheck && pnpm --filter @worksight/consumer typecheck
```

Expected: all three packages' tests PASS (consumer Laya parity tests PASS if the model files exist, otherwise reported as skipped); all typechecks exit 0.

- [ ] **Step 2: Both apps build**

```bash
pnpm --filter @worksight/agent exec electron-vite build && pnpm --filter @worksight/consumer exec electron-vite build
```

Expected: both succeed; neither `out/main/index.js` contains `require("@worksight/core")`.

- [ ] **Step 3: Real-use check**

Run `pnpm --filter @worksight/consumer dev` and leave it tracking during 30+ minutes of normal use, including a ≥ 10-minute break away from the keyboard and a lock (Win+L). Expected: the away period and lock time are not counted; the timeline shows a gap; the health panel counts the break; after unlocking, the "now" marker and the headline keep advancing without a restart.

- [ ] **Step 4: Hand off**

Report to the human partner: spike decisions (from `tools/laya/SPIKE-RESULTS.md`), test counts, and anything observed in Step 3. Phase 3 (screen reader + privacy) gets its own plan.
