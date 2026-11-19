# M03 — CAMFIT/STFT versus causal WDRC: offline decision (2026-11-19)

**Decision:** NO-GO for replacing the CAMFIT-driven STFT research reference with the current SW2 causal WDRC as equivalent personalized hearing compensation. Keep the causal processor as a zero-future-input-lookahead **offline research baseline**. **No real hearing output is authorized.**

Source-of-truth repository: `edisontw/hearlens`. Tested source revision: [`5ae2eb96c4a3f162a37ed10167960ee312c12925`](https://github.com/edisontw/hearlens/commit/5ae2eb96c4a3f162a37ed10167960ee312c12925). The results below were obtained by executing these unmodified JavaScript module bodies in an isolated V8 environment on 2026-11-19; this was **not** a Node CI, Android, browser-AudioWorklet, headphone, or acoustic test. No production code was modified.

## Research question and algorithmic scope

Can the existing `createOfflineCausalResearchDSP` implement the same *synthetic* per-ear CAMFIT-derived gain behavior as `renderOfflineWDRC`, while eliminating the reference stream's 768-sample (16 ms at 48 kHz) future-input holdback?

The paths are **not equivalent today**:

- `packages/prescription-camfit-compression/camfit-compression.mjs` computes independent six-band left/right model gain anchors at nominal 50/65/80 input-level coordinates. The fixture bridge `packages/prescription-camfit-bridge/camfit-synthetic-wdrc.mjs` feeds those anchors into the STFT renderer (1024-point WOLA, 256-sample hop; hard/smooth band weighting).
- `packages/dsp/offline-causal-wdrc.mjs` instead uses sequential one-pole low-pass/residual bands, `baseGainsDb`, one `thresholdDbfs`, and per-band downward-compression `ratios`. It has no direct 50/65/80 CAMFIT target-law input. Its filterbank has frequency-dependent phase/group delay despite zero future-input lookahead.
- Neither renderer has microphone dBFS-to-SPL calibration, per-ear earphone SPL/MPO calibration, Android hard mute, physical route isolation, or a live sound-output authorization.

## A. Static equal-anchor comparison: frequency response

To isolate the filterbank/gain-shape difference, each renderer was configured with the **same fixed 65-coordinate CAMFIT gain per frequency band**, capped at 12 dB. Dynamic compression was disabled: causal `ratios=1`; STFT's 50/65/80 target values were all set equal to that one capped 65-coordinate gain. The synthetic input was a 48 kHz mono, 1-second sine tone; results are final-250-ms output/input RMS gains. STFT: smooth crossover, 15 ms attack, 100 ms release; causal: five crossover boundaries at geometric means of the six octave centers, 15/100 ms dynamics, final digital ceiling 0.8. No limiter activated.

Illustrative independent per-ear profiles (dB HL at 250/500/1k/2k/4k/8k): left `[0,5,10,15,20,25]`; right `[10,15,20,25,30,35]`. These are **fictional research inputs**, not a user's audiogram.

| Ear | Test tone | STFT measured gain | Causal measured gain | Causal minus STFT |
| --- | ---: | ---: | ---: | ---: |
| Left | 500 Hz | 0.00 dB | -0.37 dB | -0.37 dB |
| Left | 1 kHz | 0.00 dB | -1.20 dB | -1.20 dB |
| Left | 2 kHz | +1.95 dB | +0.64 dB | -1.31 dB |
| Left | 4 kHz | +7.12 dB | +3.71 dB | **-3.41 dB** |
| Left | 8 kHz | +2.27 dB | +4.13 dB | +1.85 dB |
| Right | 500 Hz | 0.00 dB | -0.97 dB | -0.97 dB |
| Right | 1 kHz | +5.69 dB | +4.72 dB | -0.98 dB |
| Right | 2 kHz | +11.94 dB | +9.26 dB | -2.68 dB |
| Right | 4 kHz | +12.00 dB | +10.81 dB | -1.19 dB |
| Right | 8 kHz | +4.14 dB | +9.94 dB | **+5.80 dB** |

**Interpretation:** a marked asymmetric high-frequency error persists even when level-dependent compression is deliberately removed. The existing sequential IIR band mixing is **not** a drop-in substitute for the smooth STFT spectral weighting. The 65-coordinate gain numbers are reference-model coordinates, not real-ear insertion gains.

## B. Level-dependent proxy comparison: not target-law parity

A separate exploratory 50/65/80 run kept the real CAMFIT anchor triplet on STFT. To exercise the independent causal law, the causal processor was only **approximated** with `baseGainsDb=min(12,G50)`, `ratios=CAMFIT model compressionRatio`, and one shared `thresholdDbfs=-52`. The same 1-second 48 kHz test-tone approach was used, with synthetic RMS input levels `-52/-37/-22 dBFS` representing nominal 50/65/80; both algorithms had 15 ms attack, 500 ms release, and 0.8 digital ceiling. Neither final limiter activated.

| Ear / tone | Nominal input | STFT gain | Causal proxy gain | Difference |
| --- | ---: | ---: | ---: | ---: |
| Left / 8 kHz | 50 | +8.11 dB | +6.00 dB | -2.11 dB |
| Left / 8 kHz | 65 | +1.90 dB | +4.77 dB | +2.87 dB |
| Left / 8 kHz | 80 | 0.00 dB | +3.71 dB | +3.71 dB |
| Right / 8 kHz | 50 | +9.95 dB | +10.97 dB | +1.03 dB |
| Right / 8 kHz | 65 | +3.45 dB | +9.88 dB | **+6.43 dB** |
| Right / 8 kHz | 80 | 0.00 dB | +8.86 dB | **+8.86 dB** |

These differences **combine** filterbank response, fundamentally different WDRC/anchor interpolation laws, envelope smoothing, and synthetic level mapping. They must **not** be described as an isolated 8.86-dB filterbank defect or clinical-output excess. They show why reusing CAMFIT ratios/initial gain without a common target law is invalid.

## C. Callback-shaped host cost (non-gating exploratory)

Two independent ears, each processing 48,000 samples at 48 kHz in 375 chunks of 128 samples; 750 total calls. Input: 1 kHz + 2.8 kHz synthetic tones; same offline modules, `processInto`, 5 sequential host runs, initialization included in each timing.

| Measure | Stateful STFT | Causal |
| --- | ---: | ---: |
| Host median elapsed time for two ears | 1,050 ms | 272 ms |
| Median ratio on this host | baseline | ~3.86x faster |
| Future-input lookahead | 768 samples / 16 ms | 0 samples |
| Samples actually emitted before flush, both ears | 94,208 | 96,000 |

**Limitations:** V8 Code Mode host timing is not Android CPU, true real-time performance, battery use, p95 callback time, or acoustic end-to-end latency. STFT retained 768 pending samples **per ear**; the output counts differ because the stream was not finalized. Timings are not apples-to-apples completed-output throughput measurements, not CI performance acceptance criteria, and do not justify live audio.

## Decision / action gate

1. **NO-GO — direct substitution:** the current causal processor does not preserve the prescribed synthetic CAMFIT frequency response or level-dependent gain law.
2. **GO — conditional, offline only:** if the low-lookahead path remains worth pursuing, first define a **shared per-ear 50/65/80 target law** and a bounded multi-band crossover with measurable shaped-gain error; evaluate in one focused synthetic comparison before deciding whether to implement a new causal DSP. Do not repeatedly tune the present first-order split by guesswork.
3. **BLOCKED — Android/Bluetooth/worn hearing:** input/output SPL calibration, real output-route isolation/queued-audio hard mute, and AIR31-specific acoustic signal identity/latency are **not** established. No mic-to-headphone stream, live hearing output, or wearer test is authorized.
4. **M01 CLOSED:** the owner's Moto g62 2026-11-19 caption acceptance was PASS; reopen only for a new, reproducible substantial defect. No routine M01 field matrix.
5. **M04 DEFERRED:** no new SW1–SW4, D6.1/D6.2 recording or unmeasurable AIR31 trial without fresh evidence that makes the acoustic output identifiable.

References: [active roadmap](./ROADMAP.md), [safety constraints](./SAFETY.md), [CAMFIT synthetic bridge](./M03_CAMFIT_SYNTHETIC_WDRC_BRIDGE_2026-10-14.md), [SW2 causal DSP](./SW2_CAUSAL_DSP_SOFTWARE_CEILING_2026-10-12.md), [SW2-B phase/artifacts](./SW2B_FILTER_PHASE_ARTIFACTS_2026-10-13.md), [existing M03 characterization](./M03_DSP_CHARACTERIZATION.md). All earlier research specifications, tests and original field observations are retained.
