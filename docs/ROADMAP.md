# HearLens roadmap — current decision (2026-11-19)

**Authoritative work-order index.** GitHub's live `main` is the source of truth; any SHA in historical documentation is a snapshot. Earlier work plans, milestone handoffs and percentage allocations are historical and do **not** authorize repeating completed work. [Product vision](./PRODUCT_VISION.md) · [Safety](./SAFETY.md) · [M03 causal/CAMFIT offline review](./M03_CAUSAL_CAMFIT_OFFLINE_REVIEW_2026-11-19.md).

## Current milestone gates

| Area | Decision | What is verified | What is **not** verified |
| --- | --- | --- | --- |
| **M01 — captions** | **CLOSED / maintenance** (owner acceptance, 2026-11-19) | Moto g62 Android Chrome everyday session **PASS**; existing caption functionality and engineering regressions. Reopen for a new, reproducible significant regression only. | Formal multi-device WER/clinical benefit; these are not required to close the current engineering phase. |
| **M03 — personal hearing DSP** | **Offline research only**; causal direct replacement **NO-GO** | Separate per-ear audiograms, research CAMFIT computation and upstream fixtures, STFT offline WDRC/digital limiter, SW2 causal 0-future-lookahead baseline; the 2026-11-19 targeted comparison documents non-equivalence. | A common causal 50/65/80 gain law, satisfactory shaped-frequency response, physical input/output calibration, safe live route/mute, clinical fitting or worn benefit. |
| **M04 — AIR31/A2DP** | **BLOCKED** for open-ear real-time hearing; field acquisition **DEFERRED** | Moto g62 built-in mic input and Android playing-A2DP route observations; synthetic output policies and ambiguous-arrival rejection (#137). | Confirmed earbud-specific acoustic signal, measured phone-mic-to-AIR31 acoustic E2E latency, no-speaker-fallback hard mute, per-ear acoustic MPO and daily-use benefit. |

M01 closure is a development decision, **not** a declaration of formally validated caption accuracy or medical effectiveness. M03's digital limiter constrains PCM, not ear-level dB SPL. M04's A2DP playing route is not evidence of earbud acoustic output.

## Next work — only when a meaningful engineering gate exists

**M03 first, conditional:** Avoid additional STFT-versus-causal tuning or tests for their own sake. If a concrete low-lookahead causal design is proposed, require (a) a shared independent 50/65/80 research target law, (b) per-ear shaped-gain response and envelope acceptance criteria against the existing STFT synthetic reference, (c) bounded callback memory/computation and final digital limiting. A **single focused offline** proof is the next justified implementation slice; if no promising design exists, park it rather than opening a low-value PR.

**M03 candidate screened 2026-11-19:** [Static minimum-phase FIR spike](./M03_MINPHASE_FIR_STATIC_SPIKE_2026-11-19.md) preserves an *idealized 65-coordinate static spectral gain shape* substantially better than the current first-order IIR on two synthetic per-ear fixtures. This is **not** dynamic 50/65/80 CAMFIT parity, a proven low-cost Android stream, or permission for playback. Do not connect to hearing output or replace the reference STFT. Additional engineering is conditional on a shared level-dependent law and callback feasibility; otherwise park it.

**M03 dynamic generalization screen, 2026-11-19:** The 513-tap FIR candidate still matches the two original CAMFIT-derived profiles within 0.143/1.212 dB at most across 45 prescribed-level combinations per ear, but **100 additional, non-CAMFIT synthetic six-band gain shapes show up to 4.936 dB error** (95th percentile per-profile max 3.679 dB). A 1025-tap FIR lowers the worst stress error to 2.890 dB at roughly twice the direct-convolution cost. A 50-ms same-history FIR coefficient crossfade passes algebraic equivalence only, not hearing artifacts or real callback safety. **NO-GO for general dynamic FIR integration** on current evidence; do not start live Android DSP or another broad search. Detailed optional screen: [FIR spike](./M03_MINPHASE_FIR_STATIC_SPIKE_2026-11-19.md).

**M04 parked:** Do not repeat SW1–SW4, D6.1/D6.2, raise test-tone volume, request additional owner recordings, or purchase new hardware. Only resume physical feasibility after new independently identifiable AIR31 acoustic output evidence and a test plan capable of rejecting direct-source/echo ambiguities. Acoustic latency cannot be inferred from codec frame times, Android timestamps, `AudioContext.outputLatency` or the #137 correlation screen. Ordinary Bluetooth earphones remain an ergonomic preference, not a demonstrated low-latency transparent hearing path.

**Safety release is separate from algorithm success:** Any real-phone microphone-to-earphone amplification remains prohibited until calibrated per-ear output, real hard-mute/no-speaker-fallback including already queued audio, routing interruptions and gain ramp have passed physical evidence gates. [Safety](./SAFETY.md).

## Engineering workflow

- Consult current `main`, related PR/CI and focused specifications before changing code.
- Implement only a real, reproducible defect or a decision-gated capability; preserve existing work and test with the smallest relevant suite.
- Branch/PR with reviewed CI for source changes; avoid redundant docs-only cycles and unnecessary GitHub Actions usage.
- No standing manual user test matrix or arbitrary M01/M03/M04 work quota. User tests only after a materially new, safely verifiable capability is ready.
- Retain source observations, underlying tests and safety documents even if historical *handoff instructions* are removed. Git history preserves prior snapshots.

## Historical evidence (not active instructions)

- [Earlier roadmap](./ROADMAP_HISTORY_2026-10-20.md)
- [2026-11-02 delivery policy (superseded)](./CONTINUOUS_DELIVERY_PLAN_2026-11-02.md) and [12-round retrospective](./DELIVERY_REVIEW_ROUND12_2026-11-02.md)
- [M04 diagnostic/evidence reset](./M04D62_DIAGNOSTICS_AND_PROGRESS_RESET_2026-10-22.md)
- [CAMFIT research bridge](./M03_CAMFIT_SYNTHETIC_WDRC_BRIDGE_2026-10-14.md), [SW2 causal baseline](./SW2_CAUSAL_DSP_SOFTWARE_CEILING_2026-10-12.md)
- [Test protocol](./TEST_PROTOCOL.md) for future **evidence-gated** testing, not immediate requests.
