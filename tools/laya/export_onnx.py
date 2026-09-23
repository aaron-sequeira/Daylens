"""Export Laya's DecisionModel to ONNX (fp32 + int8) and verify parity against PyTorch and golden.json.

Usage: python export_onnx.py --ckpt root|typed-decisions
"""
import argparse
import gc
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


MIN = torch.finfo(torch.float32).min


def head_layer(layer, x, pad_bias):
    """nn.TransformerEncoderLayer(batch_first, norm_first=True, eval) re-implemented with shape-free reshapes.

    The legacy exporter bakes the traced seq/batch sizes into nn.MultiheadAttention's internal view() calls,
    so the stock layer only runs at the traced shape. Same parameters, same math (dropout is identity in eval).
    """
    assert layer.norm_first and not layer.training
    sa = layer.self_attn
    q, k, v = torch.nn.functional.linear(layer.norm1(x), sa.in_proj_weight, sa.in_proj_bias).chunk(3, dim=-1)
    q, k, v = (t.unflatten(-1, (sa.num_heads, sa.head_dim)).transpose(1, 2) for t in (q, k, v))  # [b,H,l,hd]
    att = torch.softmax(torch.matmul(q, k.transpose(-1, -2)) * sa.head_dim ** -0.5 + pad_bias, dim=-1)
    x = x + sa.out_proj(torch.matmul(att, v).transpose(1, 2).flatten(2))
    return x + layer.linear2(layer.activation(layer.linear1(layer.norm2(x))))


class Export(torch.nn.Module):
    """DecisionModel.forward with traceable masks (no transformers masking_utils) and the head from head_layer()."""

    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, input_ids, attention_mask, marker_pos, marker_mask, qtype):
        m, marker_mask = self.m, marker_mask.bool()
        keep = attention_mask.bool()[:, None, None, :]  # [b,1,1,l]
        pos = torch.cumsum(torch.ones_like(input_ids[0]), 0) - 1  # [l] = arange(l)
        near = (pos[:, None] - pos[None, :]).abs() <= m.encoder.config.sliding_window  # [l,l]
        # Tested on transformers 5.17.0: needs ModernBertModel's per-layer-type attention-mask dict + config.sliding_window.
        masks = {"full_attention": (~keep).float() * MIN, "sliding_attention": (~(keep & near)).float() * MIN}
        h = m.encoder(input_ids=input_ids, attention_mask=masks, position_ids=pos[None]).last_hidden_state
        h = h + m.type_emb(qtype)[:, None, :]
        pad_bias = (~keep).float() * MIN
        for layer in m.head.layers:
            h = head_layer(layer, h, pad_bias)
        # --- below: verbatim from DecisionModel.forward
        idx = marker_pos.clamp(min=0)[:, :, None].expand(-1, -1, h.size(-1))
        logits = m.scorer(torch.gather(h, 1, idx)).squeeze(-1).float()
        logits = logits.masked_fill(~marker_mask, -1e4)
        p = torch.softmax(logits.detach(), -1)
        k = marker_mask.sum(-1).clamp(min=2).float()
        ent = -(p * torch.log(p.clamp_min(1e-9))).sum(-1) / torch.log(k)
        top2 = p.topk(2, -1).values
        feats = torch.stack([top2[:, 0], top2[:, 0] - top2[:, 1], ent, k / 255.0], -1)
        act_logits = m.act_head(torch.cat([h[:, 0].float(), feats], -1))
        return logits, act_logits


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


def sub(b, rows):
    """Select batch rows and trim padding to that sub-batch's own max length / option count (right-padded)."""
    b = [x[rows] for x in b]
    n_tok, n_opt = int(b[1].sum(1).max()), int(b[3].sum(1).max())
    return b[0][:, :n_tok], b[1][:, :n_tok], b[2][:, :n_opt], b[3][:, :n_opt], b[4]


def torch_out(mod, b):
    lg, act = mod(b[0], b[1], b[2], b[3].bool(), b[4]) if mod is model else mod(*b)
    return lg.numpy(), act.numpy()


names = ["input_ids", "attention_mask", "marker_pos", "marker_mask", "qtype"]
feeds_of = lambda b: {n: x.numpy().astype(np.int64) for n, x in zip(names, b)}  # noqa: E731
export = Export(model).eval()


def diffs(lo, ao, lx, ax, marker_mask):
    """(max |logit diff| over live slots, max |act diff| relative to max |act|).

    act is read straight off the un-normalized residual stream (|act| ~ 5e3), where 1 fp32 ulp is ~5e-4,
    so it is compared relatively; logits pass through LayerNorm and are compared absolutely.
    """
    return float(np.abs(lo - lx)[marker_mask.numpy() == 1].max()), float(np.abs(ao - ax).max() / np.abs(ao).max())


# --- 1. the traceable re-implementation must match the stock torch model before we export it
with torch.no_grad():
    for i in (0, len(golden) // 2):
        b = batch_for(golden[i]["state"])
        dl, da = diffs(*torch_out(model, b), *torch_out(export, b), b[3])
        print("replacement vs stock torch, golden[%d] (b=%d, l=%d): max |logit diff| %.2e, act rel diff %.2e" % (
            i, *b[0].shape, dl, da))
        assert dl < 1e-4 and da < 1e-6, "replacement head/masks diverge from the stock model"

OUT.mkdir(parents=True, exist_ok=True)
onnx_path = OUT / "laya.onnx"
example = batch_for(golden[0]["state"])
with torch.no_grad():
    torch.onnx.export(
        export, example, str(onnx_path), opset_version=17, dynamo=False,
        input_names=names, output_names=["logits", "act"],
        dynamic_axes={"input_ids": {0: "b", 1: "l"}, "attention_mask": {0: "b", 1: "l"}, "marker_pos": {0: "b", 1: "k"},
                      "marker_mask": {0: "b", 1: "k"}, "qtype": {0: "b"}, "logits": {0: "b", 1: "k"}, "act": {0: "b"}})
print("exported", onnx_path, "%.0f MB" % (onnx_path.stat().st_size / 1e6))

# --- 2. dynamism: fp32 graph on batches of different b / l / k than the traced example, vs stock torch
sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
with torch.no_grad():
    for i, rows in ((1, [0, 1, 2, 3]), (len(golden) - 1, [1, 3]), (len(golden) // 3, [2]), (len(golden) // 4, [0, 2, 3])):
        b = sub(batch_for(golden[i]["state"]), rows)
        dl, da = diffs(*torch_out(model, b), *sess.run(["logits", "act"], feeds_of(b)), b[3])
        print("dynamic check golden[%d] rows %s: b=%d l=%d k=%d (traced b=%d l=%d k=%d) max |logit diff| %.2e, "
              "act rel diff %.2e" % (i, rows, *b[0].shape, b[2].shape[1], *example[0].shape, example[2].shape[1], dl, da))
        assert dl < 1e-3 and da < 1e-5, "exported graph is not shape-dynamic"
    # torch logits for every golden sample, then free torch + the fp32 session before quantizing (RAM)
    batches = [batch_for(g["state"]) for g in golden]
    t_all = [torch_out(model, b)[0] for b in batches]
del sess, export, model, enc
gc.collect()

quantize_dynamic(str(onnx_path), str(OUT / "laya.int8.onnx"), weight_type=QuantType.QInt8)
print("quantized", OUT / "laya.int8.onnx", "%.0f MB" % ((OUT / "laya.int8.onnx").stat().st_size / 1e6))
gc.collect()

# --- 3. parity: torch(eager) vs ORT fp32 logits, and ORT decisions vs golden (fp32 and int8); one session at a time
max_diff, agree, total, score_err = 0.0, {"fp32": 0, "int8": 0}, 0, {"fp32": 0.0, "int8": 0.0}
qids = list(questions.keys())
for v, f in (("fp32", "laya.onnx"), ("int8", "laya.int8.onnx")):
    sess = ort.InferenceSession(str(OUT / f), providers=["CPUExecutionProvider"])
    for g, b, t_logits in zip(golden, batches, t_all):
        o_logits = sess.run(["logits"], feeds_of(b))[0]
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
    del sess
    gc.collect()

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
