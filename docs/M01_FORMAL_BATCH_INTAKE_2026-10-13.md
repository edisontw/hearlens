# M01 formal benchmark — software-ready batch intake (2026-10-13)

## Status

**Software intake tooling implemented; formal clinical/acoustic data collection NOT performed.** The earlier iPhone 11-report and HTC 8-report truncated/exploratory batches are **not** converted into the new formal 24-run core. The original [locked M01 protocol](./M01_FORMAL_BENCHMARK.md) and existing strict single-run CER scorer are unchanged. No device capture, new acoustic playback, revised STT settings, online collector or hearing output is introduced.

**Why:** SW3-C showed that Android native predicted routing is not physical hard-mute/speaker-fallback proof. Actual amplification remains blocked; the useful existing product is caption-first. Rather than repeat phone trials before a frozen version, the next low-cost step is making benchmark intake reproducible and unable to silently promote incomplete historical results.

## Implementation

- `tools/validate-m01-batch.mjs`: validates one explicit *operator-authored* manifest and the existing short-source definition, reads separate original exported JSON reports, checks the on-disk WAV SHA-256 against the locked value, scores each accepted run with the existing `scoreBenchmarkReport` (strict CER, 5 fields, 5 anchors), builds 12 device×preset×distance cells, and shows both repeats, median/range CER and median accuracy/coverage **only for cells with both repeats**.
- `testdata/benchmark/m01-batch-manifest.example.json`: deliberately **not valid** until frozen source/build/device labels/volume are filled and each run has its own matching JSON report. Never populate it using retrospective guesses.
- The 24 slots are exactly **two identified receiving devices × Auto/raw and Far-Noisy/voice × 0.5/1/2 m × repeats 1/2**. No software auto-fills missing runs, converts transcript text into a different source, or treats a blank report as zero error.
- Before a run is accepted, the original report must contain correct source ID `zh-tw-regression-v2`, main/test build consistency (build ID is recorded in report; exact main SHA is pinned in manifest), Gemini provider, adaptive/default tuning, matched preset-capture policy, receiving-device label, distance, unchanged volume, nonempty environment/orientation notes, event log and final-transcript field. Operator explicitly attests three things per file: completed section-3 spoken cutoff, controlled room/setup, and reviewed available audio telemetry. These attestations are **manual provenance**, not automated physical measurement.
- Duplicate slot, wrong phone, absent source hash, missing cutoff confirmation, custom gain, unmatched capture mode, inconsistent build or skipped repeat => **INCOMPLETE**. The tool reports accepted runs and missing slots without declaring a complete benchmark.
- **No audio output** of any kind is created; tests use fabricated *synthetic report fixtures* and the locked existing WAV file solely for SHA checking.

## Usage, only when the formal source/build is frozen

1. Copy `testdata/benchmark/m01-batch-manifest.example.json` to a separate working directory as `manifest.json` and replace placeholders **before** test collection; keep original reports and actual confirmed per-run cutoff/setup/telemetry notes.
2. Add one manifest entry for each individual report. Entries use a path relative to the manifest's directory, a designated `repeat` of 1 or 2, and **true** values only for conditions independently confirmed:
   ```json
   {"file":"run01.json","repeat":1,"cutoffConfirmed":true,"setupConfirmed":true,"telemetryReviewed":true}
   ```
3. `npm run benchmark:batch -- /path/to/manifest.json testdata/benchmark/zh-tw-regression-v2-short.json --preview` reports incomplete cells without failing shell status. Drop `--preview` when requiring a **COMPLETE** 24-run validation: INCOMPLETE returns exit code 1, usage / unreadable input returns 2. Do not interpret the preview exit code as a pass.
4. Keep output JSON beside the raw reports outside the source tree if they contain personal data. Individual transcripts/diagnostics may be sensitive; do not automatically commit or upload them.

## Explicit limitations

- Source audio hash is physically verified from the repository WAV. The `frozen.mainSha` field is syntactically pinned; the tool cannot independently prove a deployed browser actually executed that GitHub SHA. Build ID consistency, source acquisition conditions and actual microphone output rely on the run record and operator verification.
- A run's manually declared cutoff is **not proved by STT text**. Missing transcribed words are expected in imperfect ASR; do not require reference completion as a proxy for playback completion.
- Event-log presence is not an objective full-run clipping or limiter guarantee. `telemetryReviewed` is the operator's confirmation; future instrumented QA must validate full-session telemetry, and any anomalies remain documented. No inferred acoustic latency from client timestamp values.
- Completeness only means a **well-formed controlled 24-run dataset**; it never means the STT met an invented CER acceptance threshold or medical/hearing efficacy.
- The iPhone/HTC exploratory datasets documented on 2026-10-08/09 remain isolated due to missing metadata/variable setup/truncation and should not be repeated merely to make this software gate green.
- SW1–SW3 physical route/mute/MPO gates remain blocked. **No user action needed in this iteration.**
