# HTC U23 — shortened Taiwan-Mandarin exploratory intake — 2026-10-09

## Source and status

Operator submitted one concatenated text attachment of HearLens reports and confirmed receiving device was HTC, with distance tests at 0.5 / 1 / 2 m and intentionally fewer repeats for some near cells.

**Exploratory evidence; not a completed formal 24-run matrix.**

Important intake limitations:
- Eight report headers and eight complete report **summary portions** (through `finalTranscript`) were received.
- Each report's `eventLog` was truncated in the pasted attachment at roughly 10,000 characters, so full stop/flush events and whole-run safety telemetry are **not available**.
- All eight report headers identify Web build `20261008-stop-flush1`.
- Original `test.sourceId` remains `zh-tw-regression-v2`; re-scoring uses the shorter, fixed section-3 definition `testdata/benchmark/zh-tw-regression-v2-short.json`.
- `sourceVolume` and `notes` are null in every exported report; several `receiverDevice` fields are null. HTC identity comes from the operator's accompanying statement and is **not** silently inserted into raw reports.
- Exact acoustic playback cutoff and cross-cell volume constancy cannot be independently proven from the report.
- **Operator clarification (2026-10-09): test runs may have taken place in different rooms or under other uncontrolled conditions.** Same-room setup, playback environment, and comparable acoustic conditions across runs are not established; differences cannot be attributed solely to device, capture preset, distance, or Gemini behavior.
- No distinct post-hoc reports should be invented to fill missing repeats.

## Scoring protocol

Strict display CER uses NFKC, lowercasing, and removal of whitespace / punctuation only, preserving number-format and word substitutions; denominator: **104 normalized reference characters**.

Key-field score: five predefined fields (date, afternoon 3, 健保卡, 5729, 1208).

Anchor coverage: five predefined anchors from the locked short definition.

These CER figures are descriptive, conditional on the intended section-3 cutoff, and **not valid calibrated efficacy estimates**.

## Individual HTC results

| Run | Mode | Distance | CER (edits / 104) | Key fields | Anchors | First partial* | First final* |
| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | Auto/raw | 0.5 m | 41.3% (43) | 3/5 | 3/5 | 3959 ms | 11929 ms |
| 2 | Auto/raw | 0.5 m | 42.3% (44) | 4/5 | 4/5 | 11293 ms | 15749 ms |
| 3 | Auto/raw | 1 m | 100.0% (104) | 0/5 | 0/5 | null | null |
| 4 | Auto/raw | 2 m | 100.0% (104) | 0/5 | 0/5 | null | null |
| 5 | Auto/raw | 2 m | 100.0% (104) | 0/5 | 0/5 | null | null |
| 6 | Far/Noisy/voice | 2 m | 100.0% (104) | 0/5 | 0/5 | null | null |
| 7 | Far/Noisy/voice | 1 m | 23.1% (24) | 4/5 | 4/5 | 9442 ms | 33446 ms |
| 8 | Far/Noisy/voice | 0.5 m | 9.6% (10) | 5/5 | 4/5 | 14195 ms | 39415 ms |

* Client-observed first-audio-chunk-to-caption startup timing, **not acoustic speech-to-caption latency**. Null means no final/partial event recorded in the complete report summary.

Per-cell median (only where n=2):
- HTC Auto 0.5 m: **41.8% CER**.
- HTC Auto 2 m: **100.0% CER**.

Do not average one-repeat cells as if their variability is known.

## Capture / audio diagnostic notes

- Auto/raw's browser **reported** `MediaStreamTrack.getSettings()` values for `echoCancellation`, `noiseSuppression`, and `autoGainControl` as false.
- Far/Noisy/voice's browser **reported** values for those three settings as true. These are browser-exposed capture settings, **not independent verification that the corresponding acoustic processing was effective or consistent**. The operator cannot independently confirm actual HTC EC/NS/AGC operation.
- Available truncated event-log excerpts show **0.00% clipped** at retained logged level samples; **full-run clipping is not verifiable**.
- Available Far/Noisy log excerpts contain stretches with `raw-rms=-160 dBFS`, consistent with strong platform voice gating / suppression. This is an observation, not proof it caused the 2 m transcript failure.
- Despite successful PCM capture and nonzero audio levels in the Auto 1/2 m excerpts, those sessions retained no caption text. The reports alone cannot attribute the failure to microphone acoustics, model behavior, or finalization.
- One Auto 0.5 m transcript extends into `第四段`, which suggests minor cutoff variation; treat this batch as exploratory.

## Interpretation and deferred verification decision

1. The HTC Far/Noisy 0.5 m run retained all five predefined key fields, while Auto/raw 1–2 m and the single Far/Noisy 2 m run retained no final transcript. These observations are **specific to the reported runs**, not controlled proof of a distance/preset/device effect.
2. The 2 m Far/Noisy result conflicts with earlier successful HTC 2 m voice-capture evidence. **Unrecorded room/acoustic conditions, playback level/orientation, and unknown effective OS processing** are plausible confounders. No single cause is established.
3. **No immediate retest is required.** The operator explicitly prefers to pause repeat testing unless resolving the discrepancy becomes necessary for a concrete development decision.
4. Do not alter adaptive gain, global Auto capture policy, or safety settings based on these exploratory differences. Continue planned product work independently.
5. Reopen a focused, matched-condition HTC Auto/Far-Noisy test **only** if a reproducible caption failure blocks product use, if a global capture-policy change is being considered, or if quantitative cross-device claims will be made. At that point, fix room, playback source/volume, device orientations, source cutoff and log capture details before interpreting discrepancies.
6. Fill receiver, source-volume, and environment metadata in future exports without retroactively altering existing raw reports.

The earlier iPhone operator-truncated exploratory intake remains separately documented. Do not pool scores across devices as a formal controlled comparison without matching source cutoff, playback level, build and metadata.
