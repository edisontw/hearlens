# M03 strong/weak-band short-pulse characterization (2026-11-23)

## Scope and reproducibility

This study uses **only synthetic 48 kHz PCM and the existing offline Auto-FIR research cores**. It does not authorize microphone capture, playback, hearing output, calibrated SPL, clinical fitting or perceptual claims.

Baseline source: main `28670421e2864d55600ddb341599bad3f084f0f4` (PR #147). Targeted test added to `packages/dsp/offline-auto-fir.integration.test.mjs`, already included in `npm test`. Reproduce without running the complete suite:

```sh
node --test packages/dsp/offline-auto-fir.integration.test.mjs
```

**Stimulus:** 3 seconds at 48 kHz. A continuous 2 kHz weak tone has -42 dBFS RMS; an additional 1 kHz strong tone at -22 dBFS RMS is present from 1.00 to 1.18 s (180 ms). The test compares unchanged default `restart` and opt-in `fixed-horizon` using the existing left-ear synthetic target fixture. It processes 480 samples per callback with a 480-sample detector control clock; the frozen-gain 256-sample FIR group delay is removed in the measurement alignment.

**Metric:** each 10 ms output window is projected onto the known 2 kHz sinusoid. The recovered 2 kHz amplitude divided by the injected weak-tone amplitude defines `20 log10(output / input)` in **digital dB**, not dB SPL. The reported `rangeDb` is the peak-to-peak windowed gain estimate over the named period. It is **not** a full waveform distortion, intelligibility, hearing-level or perceptual-pumping measure. It excludes the 1 kHz fundamental from the 2 kHz projection but does not fully distinguish dynamic modulation from spectral leakage or interaction products.

## First observed output

The initial comparison ran the GitHub-sourced JavaScript modules in an isolated V8 environment (without actual audio devices or Node audio output), using the same fixture construction and algorithm source. Values are descriptive and subject to reproduction with the Node test:

| Weak 2 kHz projected gain, dB | Restart | Fixed-horizon |
| --- | ---: | ---: |
| Baseline mean, 700–900 ms | 5.3324 | 5.3321 |
| Strong-tone pulse mean, 1000–1180 ms | 5.1637 | 5.0250 |
| Early recovery range, 1190–1450 ms | 0.0392 | 0.1157 |
| Late recovery mean, 2100–2400 ms | 5.2670 | 5.2805 |

The candidate shows approximately **2.95× larger** early-recovery range in this fixture (0.1157 vs 0.0392 dB). The absolute difference is very small and has **no justified perceptual acceptance threshold**. Both candidate and baseline peak samples were about 0.2041, within the 0.3 **digital** limiter ceiling; neither invoked the limiter for this input. The test also explicitly checks no audio route, output authorization disabled and zero future lookahead.

## Decision and limits

**NO CHANGE** to algorithm or transition policy. The previously documented fixed-horizon **NO-GO for default enablement** remains in force. One mixed-band transient is additional evidence of a measurable trade-off; it is not sufficient to rank perceived quality or to establish universal superiority of restart. Importantly, the test asserts numeric validity, isolation and digital-safety properties rather than freezing the current recovery-range difference into a desired quality threshold.

The distinct speech-shaped, near-boundary follow-up is recorded in [M03_SYLLABLE_BOUNDARY_ENVELOPE_2026-11-23.md](./M03_SYLLABLE_BOUNDARY_ENVELOPE_2026-11-23.md); the short-duration 5/10/20 ms sweep and finite M03 exit decision are in [M03_SHORT_SPIKE_QUALITY_2026-11-23.md](./M03_SHORT_SPIKE_QUALITY_2026-11-23.md). Together they still support **no production DSP change**. Subjective, acoustic SPL, ear-output, device-routing and Native-performance questions remain outside the offline M03 gate and are deferred to M04/Native.
