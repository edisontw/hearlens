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
- [x] M03 Part F: deterministic 6- and 8-band dense A/B across all 12 boundaries, selected harmonic/two-tone/transient and final-limiter probes; CI JSON report. Smooth reduces jumps in all tested synthetic seams but remains opt-in pending broader DSP/artifact verification.
- [x] M03 Part G: offline replay-based chunk adapter, exact full-reference equivalence across chunk sizes and modes, final flush/atomic validation, no live output; **not** a bounded-memory real-time stream,
- [x] M03 Part H: persistent synthetic-only 1024/256 STFT/WOLA, fixed 1024-sample input/sum/weight rings and 6–8 gain envelopes, exact Float32 offline-reference checks, flush, reset, strict chunk validation and fail-stop; algorithmic lookahead is not measured acoustic latency,
- [x] M03 Part I: offline sample-clock continuity gate (gap/overlap/reordering, invalid timestamps, clock regression, simulated underrun) with explicit reset and no gap concealment; bounded state and non-gating Node CPU/heap probe; no physical route or output,
- [x] M03 Part J: reusable per-instance Float64 FFT, energy and gain scratch arrays (preserved exact offline parity), plus a PURE synthetic route authorization/start ramp/disconnect fail-stop model; does not actually enforce device routing or calibrated SPL,
- [x] M03 Part K (offline prototype): caller-reused output buffer API, per-instance prevalidated target anchor cache, numerical no-overwrite regression, non-gating callback CPU/heap probe and native physical-route/per-ear MPO architecture requirements; **no actual audio route**,
- [ ] M03 Part K exit gates: verified allocation/GC and realtime behavior on target phone, verified headset route (Bluetooth-first feasibility; wired control), no speaker fallback and hard mute on disconnect, independent measured L/R MPO and acoustic calibration before any live amplification,
- [x] M03 Part L: isolated timestamp-guarded reusable-buffer processInto and no-PCM mock route-port negative fixtures for disconnect, route switch, missing observations, sample-clock faults, reset and rearm; **only model semantics, no physical mute or output**,
- [ ] production-grade filterbank, frequency/temporal artifact quantification, phase/delay and stream-boundary characterization before hearing output,
- [ ] calibrated final hearing-output limiter, no-bypass safety tests and MPO verification,
- [ ] per-ear production gain bounds and start/reconnect ramp,
- [ ] calibration and headset-disconnect fail-safe gates before any live hearing path.

No live-ear safety claim.

## M04 — SOFTWARE-FIRST phone DSP / microphone-routing ceiling (updated 2026-10-12)

**LATEST USER DIRECTION:** defer **all hardware POCs**, ODM/chipset engagement, purchases and acoustic bench hardware. Evaluate how far **ordinary phone native software + everyday Bluetooth earbuds** can go first. Phone DSP on PCM is feasible; Bluetooth merely transports its processed output. Revisit earbud microphone input over HFP/LE and iOS 26 supported AirPods high-quality recording, not only phone mic. Distinguish ordinary headset recording inputs from undocumented transparency/ANC microphone buses. See [M04 software-first investigation](./M04_SOFTWARE_FIRST_CAPTURE_FEASIBILITY_2026-10-12.md).

- [x] **SW0:** official Android/iOS capability recheck, S1 phone-mic→DSP→Bluetooth, S2 earbud communication-mic→phone-DSP→earbud, S3 first-party transparency+independent captions; latency/safety constraints and findings recorded.
- [ ] **SW1 priority:** isolated Android Native microphone and audio-route diagnostics with **NO playback, NO output PCM**, permissions and opt-in metadata export, requested vs actual input/output, UNPROCESSED, mic direction, BLE/HFP switching.
- [ ] **SW2:** software-only model for DSP and routing delay/quality ceiling; identify if smaller minimum-phase/causal WDRC could materially change budget without new live output.
- [ ] **SW3:** simulated route-policy fail-stop and interruption tests for S1/S2; no speech amplification.
- [ ] **SW4:** investigate iOS Native phone-mic/A2DP vs headset-mic/HFP and iOS 26 high-quality AirPods capture in input-only mode where supported.
- [ ] **HARDWARE POC / physical acoustic trials: PARKED** until user explicitly revises priority; remains a prerequisite for *any* future real-ear hearing output.
- [ ] **M03M:** keep paused until route feasibility clarifies where lower-latency DSP engineering has value.

The prior M04-A earbud-local SDK/ODM recommendation below is preserved as a **historical conditional future option**, **NOT the active work order**. Do not automatically continue to M04-B1 hardware acquisition.

## M04 — Earbud-local DSP feasibility study (historical, hardware POC deferred)

- [x] **M04-A (2026-10-12):** desk API/standards/vendor evidence matrix, model-specific first-party versus third-party boundaries, architecture GO/CONDITIONAL/NO-GO, two bench POCs, and no-live-output decision. See [M04A evidence and decision record](./M04A_EARBUD_LOCAL_DSP_FEASIBILITY_2026-10-12.md).
- [ ] **M04-B1:** select licensed/documented programmable local-DSP hardware or research platform, confirm device/firmware/SDK, predeclare ear-coupler/safety, fail-closed hardware and latency measurement plan.
- [ ] **M04-B2:** perform *nonhuman* acoustic latency/routing/limiter/mute bench trials; a dedicated phone→Bluetooth route-only benchmark is secondary, never proof of daily open-fit amplification.
- [ ] **M03M scope decision:** pause further generic STFT development until M04-B confirms an actual controllable acoustic path; then select ported on-device DSP or narrow measured remote-mic prototype.

**M04 priority correction:** Bluetooth is still the preferred daily accessory/parameter interface, but primary nearby-conversation hearing must use **ear-local microphone and local DSP** *if* vendor/hardware gates pass. A phone microphone carried through LE Audio/A2DP is not the same architecture. Current M03L remains entirely synthetic; **no real-ear amplification**.


Goal: determine whether the preferred everyday Bluetooth-controlled headset can provide **near-ear microphone → local DSP → open-ear receiver** processing under documented vendor firmware control, with phone-microphone → Bluetooth evaluated separately on a nonhuman bench for optional remote scenarios. Neither BLE/LE Audio transport nor a local chip alone proves acoustic feasibility.

References:

- one selected Android phone and **one fixed Bluetooth earbud/headset**, preferably with verifiable LE Audio support; retain standard Bluetooth/A2DP as a compatibility comparison,
- **one wired USB-C pair as low-latency baseline**, not the default product requirement,
- fixed output volume, actual audio route and microphone source verified independently (phone mic must remain the source),
- acoustic fixture for independently measured left/right calibration.

Measure:

- true microphone-to-ear P50/P95, worst observed delays and jitter (do not infer from codec labels),
- subjective delayed/direct-sound coexistence in nearby conversation vs remote microphone scenarios,
- BT disconnect/codec change/reconnection/phone call interruptions and **physical no-speaker-fallback** traces,
- per-ear frequency response, peak output/MPO at verified volume, channel mapping and worst-case limits,
- CPU/battery/thermal effects and reliability.

**Stop gate:** never enable actual hearing amplification until hardware route lock/mute and independently calibrated per-ear protection are physically demonstrated. Use caption-only fallback if latency or safety is unacceptable. See [M04_BLUETOOTH_EVALUATION.md](./M04_BLUETOOTH_EVALUATION.md).

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
