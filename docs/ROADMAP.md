# HearLens roadmap — current decision (2026-11-24)

**Authoritative work-order index.** GitHub's live `main` is the source of truth; any SHA in historical documentation is a snapshot. Earlier work plans, milestone handoffs and percentage allocations are historical and do **not** authorize repeating completed work. [Product vision](./PRODUCT_VISION.md) · [Safety](./SAFETY.md) · [M03 causal/CAMFIT offline review](./M03_CAUSAL_CAMFIT_OFFLINE_REVIEW_2026-11-19.md) · [M03 short-spike quality convergence](./M03_SHORT_SPIKE_QUALITY_2026-11-23.md).

## Current milestone gates

| Area | Decision | What is verified | What is **not** verified |
| --- | --- | --- | --- |
| **M01 — captions** | **CLOSED / maintenance** (owner acceptance, 2026-11-19) | Moto g62 Android Chrome everyday session **PASS**; existing caption functionality and engineering regressions. Reopen for a new, reproducible significant regression only. | Formal multi-device WER/clinical benefit; these are not required to close the current engineering phase. |
| **M03 — personal hearing DSP** | **Offline synthetic quality-convergence gate COMPLETE** (research only; no live DSP); causal direct replacement **NO-GO** | Existing per-ear research targets and WDRC work plus focused 5/10/20 ms short-spike comparison of restart and fixed-horizon, callback partition, isolation, limiter, reset and fail-stop invariants. No practical net improvement justified a production DSP change. | Physical input/output SPL calibration, device routing/mute, and real Android Native callback CPU/deadline/allocation evidence are outside M03 and belong to M04/Native. Clinical fitting and worn benefit are not established. |
| **M04 — AIR31/A2DP and Native path** | **BLOCKED** for open-ear real-time hearing; field acquisition and acoustic measurement **DEFERRED** | Existing Moto g62 input and Android playing-A2DP observations; synthetic output policies and ambiguous-arrival rejection (#137). | Independent earbud-specific acoustic evidence, calibrated phone-mic/receiver output and per-ear MPO, measured route behavior and hard mute/no-speaker fallback, Native performance on target devices. |

M01 closure is a development decision, **not** a declaration of formally validated caption accuracy or medical effectiveness. M03's digital limiter constrains PCM, not ear-level dB SPL. M04's A2DP playing route is not evidence of earbud acoustic output.

## M03 offline quality-convergence exit gate

The bounded synthetic transition comparison is complete: the short-spike test records input-envelope residual, frozen-FIR residual, dynamic residual, weak-band change/range, recovery bounds, output peak, overshoot against a frozen-gain control and limiter counts. The minimum callback/stereo/finite-value/limiter/reset/fail-stop invariants are covered by the adjacent focused tests. The measured short-pulse trade-offs did not justify a change; keep `restart` as default and `fixed-horizon` **NO-GO**. Do not extend M03 with open-ended parameter or duration sweeps. Reopen only for a reproducible offline correctness failure or a candidate evaluated against independent synthetic stimuli with a predeclared practical acceptance criterion.

Move physical acoustic calibration, device routing and safe-mute evidence, and target-device Native callback performance to M04/Native. These require physical routes or native target environments and are not offline M03 exit criteria. M04 remains blocked and acoustic measurement remains deferred.

## Next work — only when a meaningful engineering gate exists

**M03 future work, conditional:** The offline quality-convergence slice is closed. Reopen only for a reproducible defect or a concrete candidate with declared criteria, independent synthetic evidence and a measured net benefit. Do not start another broad search based only on a possible parameter or architecture variation.

**M03 candidate screened 2026-11-19:** [Static minimum-phase FIR spike](./M03_MINPHASE_FIR_STATIC_SPIKE_2026-11-19.md) preserves an *idealized 65-coordinate static spectral gain shape* substantially better than the current first-order IIR on two synthetic per-ear fixtures. This is **not** dynamic 50/65/80 CAMFIT parity, a proven low-cost Android stream, or permission for playback. Do not connect to hearing output or replace the reference STFT. Additional engineering is conditional on a shared level-dependent law and callback feasibility; otherwise park it.

**M03 dynamic generalization screen, 2026-11-19:** The 513-tap FIR candidate still matches the two original CAMFIT-derived profiles within 0.143/1.212 dB at most across 45 prescribed-level combinations per ear, but **100 additional, non-CAMFIT synthetic six-band gain shapes show up to 4.936 dB error** (95th percentile per-profile max 3.679 dB). A 1025-tap FIR lowers the worst stress error to 2.890 dB at roughly twice the direct-convolution cost. A 50-ms same-history FIR coefficient crossfade passes algebraic equivalence only, not hearing artifacts or real callback safety. **NO-GO for general dynamic FIR integration** on current evidence; do not start live Android DSP or another broad search. Detailed optional screen: [FIR spike](./M03_MINPHASE_FIR_STATIC_SPIKE_2026-11-19.md).

**M03 offline dynamic gain core, 2026-11-19:** A [fixed-basis linear-phase FIR research prototype](./M03_FIXED_BASIS_DYNAMIC_FIR_2026-11-19.md) now accepts *explicit synthetic* six-band 50/65/80 input coordinates, applies the same per-band anchor interpolation, and smoothly updates a 513-tap composite kernel in a preallocated callback loop. It is a bounded **offline gain-law/transition proof**, not a dynamic WDRC: there is no automatic per-band level estimator, acoustic calibration, Android callback acceptance, or headphone output. Fixed-gain linear-phase delay is 256 samples (5.33 ms at 48 kHz), with the previous generalization limitations still applicable. Only consider a measured and robust automatic per-band detector and real-time budget after reviewing this evidence; do not ship or re-open M04 field work.

**M04 parked:** Do not repeat SW1–SW4, D6.1/D6.2, raise test-tone volume, request additional owner recordings, or purchase new hardware. Only resume physical feasibility after new independently identifiable AIR31 acoustic output evidence and a test plan capable of rejecting direct-source/echo ambiguities. Acoustic latency cannot be inferred from codec frame times, Android timestamps, `AudioContext.outputLatency` or the #137 correlation screen. Ordinary Bluetooth earphones remain an ergonomic preference, not a demonstrated low-latency transparent hearing path.

**Safety release is separate from algorithm success:** Any real-phone microphone-to-earphone amplification remains prohibited until calibrated per-ear output, real hard-mute/no-speaker-fallback including already queued audio, routing interruptions and gain ramp have passed physical evidence gates. [Safety](./SAFETY.md).

## Engineering workflow

- Consult current `main`, related PR/CI and focused specifications before changing code.
- Implement only a real, reproducible defect or a decision-gated capability; preserve existing work and test with the smallest relevant suite.
- Branch/PR with reviewed CI for source changes; avoid redundant docs-only cycles and unnecessary GitHub Actions usage.
- No standing manual user test matrix or arbitrary M01/M03/M04 work quota. User tests only after a materially new, safely verifiable capability is ready.
- Retain source observations, underlying tests and safety documents even if historical *handoff instructions* are removed. Git history preserves prior snapshots.

## Native DSP research ladder (offline synthetic PCM only)

This is a separate implementation track from M03's closed offline quality-convergence gate. All stages use synthetic PCM and remain isolated from production DSP and audio hardware.

- **N01 — fixed FIR parity and host probe: COMPLETE.** PR [#152](https://github.com/edisontw/hearlens/pull/152) merged as `6b1ee4d732bcd8827d97493d19f33a61013c4e11`. Reproduction, precision controls, allocation probe, and the latest host-dependent timing snapshot are recorded in [the Native FIR README](../research/detached-native-fir/README.md).
- **N02 — dynamic FIR, restart, limiter, reset, fail-stop: IMPLEMENTED; PR #153 OPEN DRAFT.** The C++ core matches `packages/dsp/offline-dynamic-fir.mjs` on synthetic stereo fixtures across five callback partitions. It accepts explicit nominal targets; it does not include the automatic six-band detector or constitute complete Auto-FIR.
- **N03 — six-band detector and complete Native Auto-FIR: NOT STARTED.** Begin only after N02 review and exact-head CI pass. Preserve the JS detector/gain law and test with synthetic inputs.
- **N04 — headless ARM64 synthetic benchmark: NOT STARTED.** It must not open audio devices. Without target-device measurements, report cross-compile/headless evidence only; do not claim Android device performance.

Native progress does not change M01 or M04 status. A digital limiter bounds PCM samples and does not establish safe ear-level SPL, acoustic MPO, route behavior, or a hard mute.

## Historical evidence (not active instructions)

- [Earlier roadmap](./ROADMAP_HISTORY_2026-10-20.md)
- [2026-11-02 delivery policy (superseded)](./CONTINUOUS_DELIVERY_PLAN_2026-11-02.md) and [12-round retrospective](./DELIVERY_REVIEW_ROUND12_2026-11-02.md)
- [M04 diagnostic/evidence reset](./M04D62_DIAGNOSTICS_AND_PROGRESS_RESET_2026-10-22.md)
- [CAMFIT research bridge](./M03_CAMFIT_SYNTHETIC_WDRC_BRIDGE_2026-10-14.md), [SW2 causal baseline](./SW2_CAUSAL_DSP_SOFTWARE_CEILING_2026-10-12.md)
- [Test protocol](./TEST_PROTOCOL.md) for future **evidence-gated** testing, not immediate requests.
