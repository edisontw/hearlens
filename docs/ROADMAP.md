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
- [ ] run the formal Taiwan Mandarin latency/accuracy benchmark only after the capture / normalization / segmentation path is frozen,
- [x] Google Cloud streaming provider + server-side WebSocket proxy scaffold (later paid comparison),
- [x] 30 s rolling transcript with segmented recent-history view,
- [x] "What did they just say?" recent-history panel with copy action,
- [x] explicit persistent text-size control (一般 / 大 / 特大),
- no login,
- no audio amplification.

Exit criteria:

- usable on current Android Chrome and iOS Safari for caption workflow,
- partial/final caption latency telemetry,
- session transcript clears by default,
- [ ] older-user manual UX pass (caption size, start/stop clarity, recall, one-handed mobile use).

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

- per-ear audiogram model,
- log-frequency interpolation,
- target I/O representation,
- 6–8 band WDRC prototype,
- limiter,
- gain ramp,
- golden vectors,
- no-bypass limiter regression test.

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
