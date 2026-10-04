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
- [ ] deploy Gemini token broker on MN4 and run Taiwan Mandarin latency/accuracy benchmark,
- [x] Google Cloud streaming provider + server-side WebSocket proxy scaffold (later paid comparison),
- 15–30 s rolling transcript,
- "What did they just say?",
- text-size control,
- no login,
- no audio amplification.

Exit criteria:

- usable on current Android Chrome and iOS Safari for caption workflow,
- partial/final caption latency telemetry,
- session transcript clears by default,
- older-user manual UX pass.

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
