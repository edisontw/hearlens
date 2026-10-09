# HearLens work handoff — 2026-10-09

This file records state **before** the next implementation slice. GitHub `main` remains the single source of truth; always fetch the **current** main SHA again at the start of a new session.

## Repository / deployment

- Repo: https://github.com/edisontw/hearlens
- Pages: https://edisontw.github.io/hearlens/
- Latest verified main before this handoff: `9b9330438e0106b99a5ead352e6a070ee69908ca`
- Main CI: PASS at that SHA (run `37946236985`)
- Last user-facing Web build: `20261008-stop-flush1`; deployed successfully following PR #21.
- No further app/audio changes in the HTC result-documentation PRs #22–#24.

## Product constraints

Caption-first smartphone communication assistance for older adults. A future personalized-audio path is research-only until calibration and output safety are proven. **Current M01 does not provide hearing amplification.**

Do not treat the Web prototype as a clinically fitted hearing aid, directly map `dB HL -> +dB EQ`, or provide uncalibrated live output. Consult `docs/PRODUCT_VISION.md`, `docs/SAFETY.md`, `docs/AUDIOGRAM_FITTING.md`, and `docs/WEB_NATIVE_DECISION.md` before implementing audiogram or hearing DSP features.

## M00 / M01 implemented and validated

- Web lab + GitHub Pages CI, permission / requested / actual microphone diagnostics, Android Chrome and iPhone Web testing.
- Gemini 3.5 Transcribe Live as primary STT; MN4 HTTPS ephemeral-token broker; browser connects to Gemini directly (microphone audio does not traverse MN4). Browser SpeechRecognition is backup only.
- Traditional Chinese displayed captions.
- Adaptive input normalization with target `-48 dBFS`, gain range `1–8×`, gain-up `350 ms` / gain-down `120 ms`, processing limiter ceiling `0.95`, audio-level logs. These are STT input-path controls, **not hearing-output safety calibration**.
- Quick presets: **Auto -> raw capture**; **Far/Noisy -> voice capture**. Do not globally switch Auto to voice without matched-condition evidence.
- Bounded engineering-only tuning URL/profile + reset, versioned test reports and build identifiers.
- 30 s rolling transcript and recent-history "What did they just say?" copy; three font-size settings; older-user caption UX gate.
- Client-observed first-audio-chunk to first-partial / first-final telemetry. This is **not** calibrated acoustic speech-onset latency.
- Stop/drain defensive hardening in PR #21: avoid closing on first final; wait for turnComplete plus sliding 1 s grace and 5 s overall timeout. It was **not** demonstrated as the root cause of missing long-source captions: users had intentionally stopped the playback early.

## October 8–9 controlled-playback exploratory intake

- Full reference WAV `testdata/audio/hearlens-zh-tw-regression-v2.wav`, 45.554 s; many runs stopped playback near end of section 3 to avoid acoustic disturbance.
- Correct shorter reference: `testdata/benchmark/zh-tw-regression-v2-short.json`, from beginning to `第三段，我的電話末四碼是五七二九，房間號碼是一二零八。`
- **Never score unplayed sections as deletion errors.** Earlier full-WAV CER tables were invalid and corrected in PR #22.
- iPhone: **11 reports** in initial attachment, expected 12; the Auto/1 m repeat 2 report was not present. Short-reference exploratory scores and caveats in `testdata/results/2026-10-08-iphone-benchmark-prefx-diagnostic.md`.
- HTC U23: **8 report summaries** in second attachment; Auto 0.5 m ×2, Auto 1 m ×1, Auto 2 m ×2, Far/Noisy 2 m ×1, Far/Noisy 1 m ×1, Far/Noisy 0.5 m ×1. In that intake, HTC Auto 1/2 m and one Far/Noisy 2 m run yielded no final text; other cells produced partial-to-strong transcripts. Scores, null fields and truncated-log limitations in `testdata/results/2026-10-09-htc-u23-short-prefix-exploratory.md`.
- HTC `getSettings()` returned EC/NS/AGC false for Auto/raw and true for Far/Noisy/voice, **but these are reported flags, not independent verification of real processing efficacy**.
- User clarified runs may have been in different rooms or had other uncontrolled acoustic/playback conditions. Source volume and notes are missing from the exported HTC reports. **No causal attribution to device, mode, distance, Gemini, or stop/drain is supported by this data alone.**
- User explicitly prefers **not to repeat HTC/iPhone distance benchmarks now**. Repeat only if an actual reproducible product failure blocks progress, a global capture-policy decision requires it, or publication-grade comparative evidence becomes necessary. PR #24 documented the deferral.
- Therefore the formal 24-run M01 benchmark remains **not completed** and should not be represented as passing or quietly closed.

## Recommended next independent development slice

Proceed without waiting for more physical-phone tests. The most useful immediate slice is **M03 Part A — pure, offline audiogram profile domain layer** (while M02 physical near-talker scene validation and M01 formal benchmark remain deferred). This starts the major outstanding personalized-hearing goal without enabling unsafe live output.

1. Fetch current GitHub `main` SHA and examine the relevant files; use a feature branch / PR and standard CI.
2. Implement a reusable, browser-independent **per-ear audiogram data model** with explicitly recorded frequencies (250, 500, 1000, 2000, 4000, 8000 Hz where available), thresholds in dB HL, missing-data handling, provenance, input validation and safe serialization.
3. Implement and unit-test **log-frequency interpolation** with well-defined behavior at missing frequencies and frequency-range boundaries; preserve separate left/right profiles.
4. Add deterministic golden cases, malformed/missing-data tests, and left/right non-cross-contamination tests.
5. Document that these are audiometric-threshold representations only. **Do not** apply threshold dB HL as direct audio gain. Do not implement live mic-to-earphone amplification, speaker output, SPL claims, or a clinical NAL-NL2/DSL equivalence claim in this first slice.
6. Keep the domain logic independent of the Web UI, with future DSP/prescription and native clients as consumers.
7. Prefer focused automated tests + docs and only request a physical test if the new functionality genuinely requires one.

After M03 Part A, follow the roadmap through prescription-target research, multiband WDRC offline DSP, independent left/right processing, final limiter safety regression, and eventually a calibrated wired route (M04); this must remain separate from current caption controls.

## Key files

- `docs/ROADMAP.md`
- `docs/PRODUCT_VISION.md`
- `docs/SAFETY.md`
- `docs/AUDIOGRAM_FITTING.md`
- `docs/TEST_PROTOCOL.md`
- `docs/WEB_NATIVE_DECISION.md`
- `docs/DEVELOPMENT_VALIDATION_STRATEGY.md`
- `docs/M01_FORMAL_BENCHMARK.md`
- `testdata/benchmark/zh-tw-regression-v2-short.json`
- `testdata/results/2026-10-08-iphone-benchmark-prefx-diagnostic.md`
- `testdata/results/2026-10-09-htc-u23-short-prefix-exploratory.md`

## Work discipline

- GitHub `main` sole source of truth; fetch and verify **current** SHA before edits. Do not trust this handoff's SHA after new merges.
- Preserve working caption pipeline and deploy without incidental tuning.
- Keep changes small, reviewable, testable. Prefer branch -> unit/CI -> PR -> merge -> verify `main` and CI.
- Avoid re-running the already examined 0.5/1/2 m matrix just because new code or documentation is added.
- Record material product/safety decisions in docs, not merely in chat.

## M03 Part A implementation update (2026-10-09)

- Following this handoff, M03 Part A is implemented in `packages/audiogram/audiogram.mjs`; see `docs/M03_AUDIOGRAM_PROFILE.md`.
- Pure offline ES module: v1 canonical per-ear thresholds at 250/500/1000/2000/4000/8000 Hz, explicit nulls, strict numeric and provenance checks, JSON round-trip.
- Log-frequency interpolation is only between real measured anchors; outside range/single-anchor/absent-ear cases yield unavailable rather than fabricated thresholds.
- Tests: `packages/audiogram/audiogram.test.mjs` is included in root `npm test`.
- No M01 STT, capture preset, gain, Pages build or cloud token changes; M01 formal 24-run benchmark remains deferred.
- Next focused slice after merging: M03 Part B offline prescription-target representation and research acceptance gates, **not** live amplification.
