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
- [x] **M01 mobile caption readability (2026-10-14):** responsive portrait/short-landscape controls, 44–48 px button targets, natural long-text wrapping, bounded keyboard-focusable caption scroll and near-bottom-only auto-follow; all caption sizes and STT/audiogram/output safety boundaries preserved. Structural CSS/unit CI (not phone visual acceptance). [Record](./M01_MOBILE_CAPTION_LAYOUT_2026-10-14.md).
- [x] **M01 live 30-second caption freshness (2026-10-13):** bounded display tick removes expired final/interim text during silence and updates open recall age labels, without repeated aria-live announcements; session report finals remain full and immutable. Synthetic UI/logic CI only; no recording or hearing output change. [Record](./M01_LIVE_ROLLING_CAPTION_FRESHNESS_2026-10-13.md).
- [x] **M01 mobile foreground/microphone lifecycle fail-stop (2026-10-13):** fail-stop on hidden/pagehide and OS-ended capture, bounded 2-s sustained-mute response, stale async permission/token startup rejection, and no auto-resume; only deterministic browser-mock/CI verification. [Record](./M01_MOBILE_LIFECYCLE_FAILSTOP_2026-10-13.md). Real OS background tests not claimed.
- [x] **M01 Gemini unexpected transport fail-stop (2026-10-13):** fatal WebSocket close/error now stops microphone capture, invalidates stale caption callbacks and restores a manual-start UI with finalized text retained; ordinary user Stop/drain is unaffected. Unit/synthetic regression; no new phone measurements or hearing audio. [Decision record](./M01_GEMINI_FATAL_SESSION_RECOVERY_2026-10-13.md).
- [x] **M01 formal batch intake tooling (2026-10-13; software only):** validate locked WAV SHA-256, frozen build/source/device/preset metadata, 24 individual slots and manual section-3 cutoff/setup attestations; automatically score strict CER/key fields/anchors and summarize only complete paired cells. Historical exploratory reports are not promoted. Tests/CI added; **this does NOT complete the 24 physical runs**. [Intake instructions](./M01_FORMAL_BATCH_INTAKE_2026-10-13.md).
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
- [x] **M03 Part Q (2026-10-14):** explicit **synthetic-only** CAMFIT compressive gain to existing offline STFT/WDRC fixture projection with strict fictional 65 dB model input↔dBFS reference, per-ear independent six-band/50–65–80 anchors, gain/digital clipping guards and deterministic PCM equivalence tests; explicitly no physical acoustic calibration, production gain prescription, live output/route, or ear-level MPO. [Scope and blockers](./M03_CAMFIT_SYNTHETIC_WDRC_BRIDGE_2026-10-14.md).
- [x] **M03 Part P (2026-10-14):** reproducible CI direct **original upstream PyClarity** `gainrule_camfit_compr` plus genuine upstream `Audiogram`, SHA-pinned to Clarity commit/blob IDs; 8 bilateral audiograms, 324 exact band×input×ear cells across varied levels, **max difference 3.55e−14 dB** (tolerance 1e−6 dB) PASS. This verifies specified research arithmetic only, not NAL-NL2/DSL, real-ear measurements, calibrated WDRC or permitted hearing output. [Reference protocol, code and CI evidence](./M03_CAMFIT_PYTHON_CROSSCHECK_2026-10-14.md).
- [x] **M03 Part O (2026-10-14):** independent offline **CAMFIT compressive** gain calculator with six coherent LTASS band intervals, six required measured thresholds per ear, 50/65/80 model-input anchors, CR and model output caps; fixed complete-grid NumPy reference reproduction at **36 individual cells** + spectral/CR values, missing-data/asymmetric negative CI. Not NAL-NL2/DSL, measured real-ear gain, independently executed PyClarity code or approved live audio output. [Record](./M03_CAMFIT_COMPRESSION_2026-10-14.md).
- [x] **M03 Part N (2026-10-14):** real **CAMFIT linear** research gain-from-audiogram module (measured six-frequency thresholds per ear) crosschecked against PyClarity upstream golden sums 284.8 and 1589.2; nominal input levels 50/65/80 with an arithmetic cap kept **separate** from WDRC/clinical REIG/REAR and physical output. Not NAL-NL2/DSL, nonlinear compression or verified ear-level MPO. [Design record](./M03_CAMFIT_LINEAR_RESEARCH_2026-10-14.md).
- [x] **M03 Part M (2026-10-14; software only):** exact audiogram/reference-protocol target alignment and per-ear/frequency/50–65–80 dB SPL nominal gain error reporting; invalid or mismatched origins, unsupported REAR/REIG metrics and missing measured anchors fail closed. Synthetic CI proves *comparator arithmetic only*. External reference authenticity, independent prescription formula and true numerical parity remain open. [Decision and reference requirements](./M03_PRESCRIPTION_REFERENCE_PARITY_2026-10-14.md).
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

## SW4 — Native input timing evidence and actual acoustic measurement plan (2026-10-14)

- [x] **SW4-A (software instrumentation, unmeasured on phone):** Android input-only diagnostic APK v0.4.0 observes matching MONOTONIC `AudioRecord` sample timestamps + sample-frame progression during a **user-started capture**, logs timestamp age and signed frame-clock skew with missing/stale/regressing/error states, and discards each PCM sample; JVM regression and Android debug APK CI. **Not** mic acoustic input latency or Bluetooth E2E delay. [Evidence-bound measurement decision](./SW4_ANDROID_INPUT_CLOCK_AND_ACOUSTIC_BENCH_DECISION_2026-10-14.md).
- [x] **SW4-B (method/protocol):** distinguish existing software input clock and passive output-route observations from **physical** phone mic SPL→dBFS transfer, nonhuman A2DP/LE acoustic latency, left/right ear-coupler MPO and proven speaker fallback hard mute. Minimum instrumentation requirements and GO/NO-GO documented.
- [ ] **Hardware gated / explicitly deferred:** synchronized nonhuman acoustic Bluetooth playback latency and output-route fault bench; separately calibrated ear-simulator L/R output; verification that an OS route change **never emits amplified sound from the phone speaker**. No on-ear amplification authorized, and no mandatory repeated SW1 mic or SW3 AIR31 field tests.

## M04 — SOFTWARE-FIRST phone DSP / microphone-routing ceiling (updated 2026-10-12)

**LATEST USER DIRECTION (2026-10-12, field follow-up):** use the **PHONE built-in microphone as the primary input**, phone Native DSP to process PCM and **ordinary Bluetooth earbuds primarily for output**. Earbud microphones, HFP/SCO uplink, iOS high-quality AirPods capture and custom hardware POCs are **deferred optional fallbacks**, not next-step prerequisites. No mandatory placement near talker, occluded ear canal or separate microphone. Evaluate software-only capacity first. Do not assume a measured safe low-latency acoustic output path. Distinguish ordinary headset recording inputs from undocumented transparency/ANC microphone buses. See [M04 software-first investigation](./M04_SOFTWARE_FIRST_CAPTURE_FEASIBILITY_2026-10-12.md).

- [x] **SW0:** official Android/iOS capability recheck, S1 phone-mic→DSP→Bluetooth, S2 earbud communication-mic→phone-DSP→earbud, S3 first-party transparency+independent captions; latency/safety constraints and findings recorded.
- [x] **SW1 Android input-only prototype + field verification (2026-10-12):** independent native Android app built/CI PASS. moto g62 5G API33 captured actual BUILTIN_MIC#15 48 kHz mono in MIC, UNPROCESSED and VOICE_RECOGNITION; **12–13 s approximate playback intervals** showed respective median RMS **−61.3/−62.7/−47.9 dBFS**, no clipping. MIC confirmed functional; VOICE_RECOGNITION is **louder, not proven better**. UNPROCESSED unsupported by device property. **AIR31 headset mic remains untested by explicit user choice; no longer a blocker.** See [first field observation](./SW1_FIRST_ANDROID_INPUT_PROBE_2026-10-12.md) and [second run and priority decision](./SW1_FOLLOWUP_PHONE_MIC_PRIMARY_2026-10-12.md).
- [x] **SW2-A (synthetic-only):** phone-microphone 48-kHz reference, isolated causal 6/8-band IIR-residual WDRC candidate, deterministic identity/limiter/left-right/fault tests, report comparing existing **16 ms STFT lookahead** to **0 ms additional future-input lookahead** with explicit *nonzero/unknown group delay and unmeasured Bluetooth physical path*. CI synthetic characterization. [SW2 reference and limitations](./SW2_CAUSAL_DSP_SOFTWARE_CEILING_2026-10-12.md).
- [x] **SW2-B (offline characterization):** implement exact **static/frozen-gain complex transfer**, phase and frequency-specific group-delay computation validated against direct DFT of the processor's impulse, dense 250–8000 Hz crossover scans, impulse pre/postcursor, synthetic quiet→loud→quiet WDRC level response, deterministic regression. See [SW2-B evidence and limitations](./SW2B_FILTER_PHASE_ARTIFACTS_2026-10-13.md). **This is not time-varying WDRC group delay, acoustic latency, hearing benefit, or approval to output audio.** Node benchmark remains host-only.
- [ ] **SW2-C (conditional):** interpret quantified phase/crossover artifacts, choose whether matched-fit filterbank redesign would materially improve the phone-mic→Bluetooth path; only pursue if it addresses a real bottleneck. Avoid endless DSP optimization before route feasibility.
- [x] **SW3 synthetic-only Bluetooth output route policy:** independent metadata-only model for phone built-in mic → Bluetooth A2DP/LE (mock endpoint), exact input/output identities, fresh-per-chunk mock observations, format/channel/focus/call/foreground/ear-count guards, simulated speaker fallback and reconnect fail-stop, explicit reset/user start and zero ramp on rearm. **No PCM or physical mute/route guarantee.** See [SW3 no-PCM model and limits](./SW3_BLUETOOTH_OUTPUT_FAIL_CLOSED_MODEL_2026-10-13.md).
- [x] **SW3-Native passive output observability (code/CI):** independent Android input-only debug APK adds API 33+ `AudioManager.getAudioDevicesForAttributes` anticipated MEDIA/speech vs ACCESSIBILITY/speech output-device lists, with explicit separation from available devices, selected communication route and **unobserved active playback**. Button, foreground/devices-added/removal refresh, no sound/PCM output. It is **not** physical speaker fallback protection or measured Bluetooth latency; optional one-button field confirmation remains open. See [SW3-Native evidence](./SW3_NATIVE_ANDROID_OUTPUT_OBSERVABILITY_2026-10-13.md).
- [x] **SW3-Native field PASS (2026-10-13):** Motorola moto g62 5G API 33, versioned SW3-Native v0.2.0, AIR31 connected. Three passive `getAudioDevicesForAttributes` checks (activity resume, device added, user button) all predicted **AIR31 Bluetooth A2DP #135** for both MEDIA/SPEECH and ACCESSIBILITY/SPEECH. **No playback; no active routed sink, Bluetooth latency or physical fallback protection observed.** [Compact field evidence](./SW3_NATIVE_AIR31_FIELD_RESULT_2026-10-13.md). No repeat of the one-button trial or microphone tests.
- [x] **SW3-C Android API route-control decision + native 30-second silent observation audit (2026-10-13):** no-output Java state monitor, foreground polling + device events, fail-closed stale/speaker/disconnect/mode/ambiguity guards, JVM regression + versioned APK; **no track is ever played**. Public API route *preference* and late callbacks do not furnish an atomic hardware no-speaker-fallback guarantee. SW3-Native v0.2.0 AIR31 observation stays PASS and needs no repeat. [Decision and limits](./SW3C_ANDROID_ROUTE_CONTROL_DECISION_2026-10-13.md).
- [ ] **SW3 physical output gate (DEFERRED, requires explicit user reauthorization):** if subsequently needed, isolate a nonhuman acoustic route/speaker-leakage test, independently calibrate L/R SPL/MPO, then measure real A2DP/LE E2E delay. Software prediction monitoring never grants playback.
- [ ] **SW4 (OPTIONAL/DEFERRED):** iOS phone-mic/A2DP viability and optional headset-mic/HFP or iOS 26 high-quality AirPods capture only after Android phone-mic-first software ceiling is clearer.
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
