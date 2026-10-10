# Roadmap

## M00 — Foundation

Goal: turn research conclusions into enforceable architecture.

- [x] Define product position.
- [x] Define Web/native boundary.
- [x] Define safety invariants.
- [x] Define audiogram-processing research boundary.
- [x] Define test strategy.
- [x] Create runnable Web Hearing Lab.
- [x] Add CI/build checks.

Exit: repository builds, documentation and safety rules agree with implementation skeleton.

## M01 — Caption Hearing Lab

Goal: validate the simplest useful product.

- microphone permission flow,
- requested/actual capture diagnostics,
- large-text live caption UI,
- [x] STT provider abstraction,
- [x] browser speech recognition as optional fallback only,
- [x] Gemini 3.5 Transcribe Live provider + MN4 ephemeral-token broker scaffold,
- [x] deploy Gemini token broker on MN4 and complete browser-to-Gemini Live E2E validation,
- [x] add Traditional Chinese display conversion for Gemini captions,
- [x] add manual input-gain and audio-level telemetry as engineering probes,
- [x] replace fixed-gain exploration with adaptive input normalization + limiter,
- [x] add fast customization: Auto + Far/Noisy + one-tap reset plus a collapsed bounded engineering profile layer; Near/Normal remain intentionally omitted because current 0.5 m / 1 m telemetry does not justify distinct behavior,
- [x] log/export the active tuning profile so tests are reproducible,
- [x] run a short controlled 0.5 / 1 / 2 m regression gate after normalization stabilizes,
- [x] validate Far/Noisy voice capture on at least one additional receiving phone before considering it for Auto (HTC U23 2 m A/B PASS; post-run distance correction recorded),
- [x] run one HTC U23 1 m Auto vs Far/Noisy safety A/B (PASS: voice materially improved transcript continuity with zero retained clipping; global Auto remains raw for cross-device conservatism),
- [ ] run the locked reduced-disturbance M01 Taiwan Mandarin benchmark (`docs/M01_FORMAL_BENCHMARK.md`): 24 short-prefix controlled runs through section 3, automated strict CER / key-field / utterance-coverage scoring; current client timing remains engineering telemetry until a speech-onset reference is added,
- [x] Google Cloud streaming provider + server-side WebSocket proxy scaffold (later paid comparison),
- [x] 30 s rolling transcript with segmented recent-history view,
- [x] "What did they just say?" recent-history panel with copy action,
- [x] explicit persistent text-size control (一般 / 大 / 特大),
- no login,
- no audio amplification.

Exit criteria:

- usable on current Android Chrome and iOS Safari for caption workflow,
- [x] client-observed first partial/final caption startup latency telemetry (first-audio-chunk reference when available; formal end-to-end benchmark remains separate),
- session transcript clears by default,
- [x] older-user manual UX pass (caption size, start/stop clarity, recall, one-handed mobile use).
- [x] caption-startup telemetry smoke gate PASS on iPhone (`20261008-caption-latency1`).

## M02 — Phone-Near-Talker Validation

Goal: quantify the product's most important physical advantage.

- distance test harness,
- quiet/TV/restaurant/car/clinic scenes,
- phone vs ear-position recordings,
- delta-SNR analysis,
- listening test protocol.

Exit: evidence that proximity improves useful speech capture under target scenes.

## M03 — Audiogram Profile + Offline DSP Tests

Goal: build the personalization domain layer before live output.

- [x] M03 Part A: versioned per-ear audiogram model, validation, safe serialization, provenance and explicit missing data,
- [x] M03 Part A: bounded log-frequency interpolation (no extrapolation), golden unit tests and documentation; no live output,
- [x] M03 Part B: versioned offline per-ear prescription-target/I-O representation with 50/65/80 dB SPL nominal input anchors, independent 1–8 band target data, bounded interpolation and golden tests (no live output),
- [ ] independent audiogram-to-target prescription generation with externally verified reference targets, numerical parity evaluation and provenance review,
- [x] M03 Part C: offline synthetic-only 6–8 band STFT WDRC prototype with per-ear independent processing, bounded target gains, attack/release smoothing and a final digital PCM limiter; deterministic no-bypass tests (not hearing-output safety validation),
- [x] M03 Part D: deterministic synthetic frequency, input/output compression, envelope and final-limiter characterization; CLI + CI numerical report, non-gating machine-specific throughput baseline (see `docs/M03_DSP_CHARACTERIZATION.md`),
- [x] M03 Part E: add opt-in smooth cosine-overlap frequency weighting and matched synthetic crossover/identity/limiter regression; preserve default hard mode until broader validation.
- [ ] production-grade filterbank, frequency/temporal artifact quantification, phase/delay and stream-boundary characterization before hearing output,
- [ ] calibrated final hearing-output limiter, no-bypass safety tests and MPO verification,
- [ ] per-ear production gain bounds and start/reconnect ramp,
- [ ] calibration and headset-disconnect fail-safe gates before any live hearing path.

No live-ear safety claim.

## M04 — Controlled Wired Hearing Path

Goal: create the first calibrated research audio route.

Reference:

- selected Android phone(s),
- one wired USB-C earbud/headset,
- fixed route/volume state,
- acoustic fixture calibration.

Measure:

- input calibration,
- output response,
- end-to-end P50/P95 latency,
- disconnect fail-safe,
- gain accuracy,
- maximum output,
- CPU/battery.

## M05 — Speech Enhancement Ablation

- OFF,
- lightweight/conservative enhancement,
- experimental neural enhancement.

Judge with hearing-impaired listeners, not only objective denoising scores.

## M06 — Human A–G Evaluation

Randomized within-subject comparison against unaided and usual-hearing-aid baselines.

## Native Gate

Start Android native work when any of the following becomes blocking:

- Web cannot sustain required hearing latency,
- reliable route/disconnect handling is required,
- screen-off/background hearing is required,
- production on-device STT is required,
- external USB-C microphone integration is required.

Native is a reliability decision, not a DSP-complexity milestone.

## Development / validation discipline

Detailed strategy: [DEVELOPMENT_VALIDATION_STRATEGY.md](./DEVELOPMENT_VALIDATION_STRATEGY.md)

Key rule: manual `?gain=` values are exploratory engineering controls, not product tuning targets. Use small question-specific gates while the pipeline is changing; reserve the larger cross-device / cross-speaker benchmark for a frozen processing version.
