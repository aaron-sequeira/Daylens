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
