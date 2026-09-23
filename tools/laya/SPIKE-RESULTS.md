# Daylens Phase 0 — Spike results (2026-09-23)

## Laya
- Checkpoint compared: root = 35/48 (73%), typed-decisions = 37/48 (77%) → chosen: typed-decisions
- Usefulness gate (category accuracy ≥ 80%): FAIL
- ONNX export: OK
- torch vs ORT fp32 max |logit diff|: 0.00005 (want < 1e-3)
- Python ORT vs golden — fp32: 100% choices (96/96), max score err 0.0000; int8: 63.5% choices (61/96), max score err 0.6372 (best alternative int8 recipe 72.9%)
- TS sequence parity (sequences.json): 0 mismatches (want 0)
- TS decision parity — fp32: not run (memory) — pending, worst score err not run (memory) — pending, not run (memory) — pending ms/read; int8: not run (memory) — pending, not run (memory) — pending, not run (memory) — pending ms/read
- Model files: laya.onnx 1686 MB, laya.int8.onnx 423 MB
- **Decision:** GO approach A — ship fp32 ONNX (1.7 GB); int8 rejected (accuracy); TS decision-level parity pending re-run; question wording must be improved before Phase 4 (77% < 80%).

## Windows OCR
- PowerShell version: 5.1.26100.9444 · screen: 1707x1067
- Cold start 566 ms · median 93 ms · p90 100 ms (target median < 400 ms)
- Unicode output correct: yes (Console encoding forced to UTF-8; captured text rendered cleanly with no mojibake/`?` substitution — this run's on-screen text happened to be ASCII-only, so no accented/em-dash glyph was exercised specifically, but the pipeline that would carry them is UTF-8 end-to-end)
- **Decision:** PowerShell helper OK

## Notes
- Task 1 misclassification pattern (11/48 errors on typed-decisions): the model most often confuses `social` and `communication` with `entertainment` (7 of 11 errors — e.g. chatting/watching/browsing text gets pulled toward "entertainment"), and some `work` samples with short, terse coding-snippet OCR text get pulled toward `other`. Confidence on every BAD row was low (0.06–0.43), so low model confidence correlates with wrongness — a usable signal for downstream logic. This pattern, plus the 77% overall accuracy, points at question/category wording (especially disambiguating `social`/`communication`/`entertainment`) as the main lever before Phase 4, not a model-capability problem per se.
- Follow-ups carried forward:
  - fp16 or weight-only (MatMulNBits) quantization spike to cut the fp32 model's 1.7 GB footprint, since standard dynamic int8 quantization fails the accuracy bar (63.5% vs ≥98% target; best alternative recipe found was 72.9%).
  - Re-run TS decision-level parity (`cd apps/consumer && npx vitest run src/main/brain/laya.parity.test.ts`, then again with `LAYA_ONNX=laya.int8.onnx`) once free system memory is comfortably above ~2 GB; it was not run in Task 3 because the process was stopped by the harness under system memory pressure (free RAM dropped to ~542 MB mid-run).
  - OCR bench passed its latency gate comfortably (median 93 ms vs a 400 ms target) on this machine's primary-screen resolution (1707x1067); a 4K screen should be re-checked separately since it may be ~2-3x slower per the brief's own estimate.
