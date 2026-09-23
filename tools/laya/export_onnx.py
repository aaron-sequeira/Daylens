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
