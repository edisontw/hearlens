# M03 Part D — Reproducible offline DSP characterization

**Status: characterization harness PASS; prototype filterbank quality NOT accepted for a live hearing path.** No clinical NAL-NL2/DSL fitting, dB HL → gain conversion, hardware output or phone measurements. The separate STT/caption code remains unchanged.

## Reproducibility and provenance

Source files:
- `packages/dsp/offline-wdrc.characterization.mjs` — pure deterministic fixture generator and analysis; uses existing Part C renderer without modifying it.
- `packages/dsp/offline-wdrc.characterization.test.mjs` — automated numerical and negative tests; included in `npm test`.
- `tools/characterize-offline-wdrc.mjs` — machine-readable JSON report.
- `.github/workflows/ci.yml` — prints deterministic report and separate **non-gating** performance measurements on Node 22/Linux.

Run:
~~~bash
npm test
npm run characterize:dsp
npm run characterize:dsp -- --benchmark
~~~

The deterministic reference below is from GitHub Actions run [#38045801520](https://github.com/edisontw/hearlens/actions/runs/38045801520); the repeat with performance probe is run [#38045889899](https://github.com/edisontw/hearlens/actions/runs/38045889899). Synthetic fixture/report schema is `hearlens-m03d-offline-characterization-v1`; values are **rounded to three decimals** for display (e.g., reported zero error does not mean mathematical exact zero).

The fixture has 16 kHz mono Float32, 1024-point STFT (64 ms window span), 256-sample hop (16 ms), band centers 250/500/1000/2000/4000/6000 Hz, and default 500 ms release. Tested gains are invented synthetic values, not clinical prescriptions or real-ear targets. `syntheticRmsDbFSAt65DbSPL = -37` is a coordinate for simulation, **not an ADC or acoustic calibration**.

## Observed deterministic numbers

| Test fixture | Measurement | Interpretation |
|---|---|---|
| Zero-gain deterministic noise + impulse | Maximum difference printed 0.000 (three decimals); asserted ≤ 0.000001 | Floating-point identity reconstruction at test tolerances |
| Uniform synthetic +6 dB across six bands | 5.828 dB at each of 250/500/1000/2000/4000/6000 Hz | Flat within tested frequency points after approximately 2 s gain settling, not final steady-state fitting parity |
| 1000 Hz, sine peak amplitude 0.006, input −47.447 dBFS | 10.479 dB measured gain | Example synthetic low-level response |
| Same 1000 Hz, amplitude 0.030, input −33.468 dBFS | 6.860 dB gain | Intermediate level compression |
| Same 1000 Hz, amplitude 0.120, input −21.427 dBFS | 3.889 dB gain | Higher level receives less gain; demonstrates arithmetic compression only |
| Synthetic amplitude step; projected gains in windows | Soft-before 8.635 dB; loud-early 4.005; loud-late 4.000; soft-early 5.431; soft-late 10.499 | Faster gain reduction and slower recovery; **not** measured hardware Attack/Release constants |
| Extreme synthetic signal +80 dB supplied curve, digital ceiling 0.2 | 7,168 limited samples; peak printed 0.200 (asserted ≤0.2 before rounding) | Digital PCM clipping bound still enforced after band summation, **not** safe ear SPL |

**Important negative finding: hard crossover discontinuity.** With a deliberately different gain on either side of the 1000/2000 Hz band split, the geometric midpoint is approximately 1414.214 Hz. The output moved from 3.736 dB at **1410 Hz** to 7.354 dB at **1420 Hz**, a **3.618 dB change across only 10 Hz**. Values at 1400/1430 Hz were 0.503/8.646 dB. This is not a smooth validated crossover and is explicitly a blocker before any real-audio deployment. The fixture's split uses 0 versus 9 dB targets and WDRC warm-up; different stimuli may show different transitions. The test records the jump instead of incorrectly asserting that all frequency responses are acceptable.

## Machine-dependent CPU throughput (NOT latency)

One 1-second synthetic clip per test, Node 22 on a GitHub Actions Linux runner, one warmup plus three measured iterations. These are wall-clock batch-render times from run [#38045889899](https://github.com/edisontw/hearlens/actions/runs/38045889899), **not** normalized real-time DSP benchmarks, guaranteed phone CPU figures, or acoustic onset-to-earphone latency.

| Sample rate | Observed times (ms) | Median (ms) |
|---|---|---|
| 16 kHz | 12.876, 11.289, 11.226 | 11.289 |
| 24 kHz | 18.008, 18.399, 16.598 | 18.008 |
| 48 kHz | 32.633, 32.630, 32.516 | 32.630 |

The renderer processes the entire clip offline; it does not implement a real-time callback, scheduling, route control, or headset disconnect fail-safe. STFT window/hop time (64/16 ms at 16 kHz; 21.3/5.3 ms at 48 kHz) is **not** a measured algorithmic P50/P95 or physical end-to-end latency. The measurement does not include audio capture, buffering, UI/browser scheduling, DAC/headphone output or operating-system interruptions.

## Acceptance interpretation

**Passed (scope-limited):** deterministic finite synthetic rendering, near-zero-gain reconstruction, uniform-tone flatness at listed test points, input-level gain reduction, step response direction, independent ear processing inherited from Part C, hard digital limiter and repeatable report generation. CI should block regressions in these checks.

**Not passed / unmeasured:** acceptable inter-band smoothness (known discontinuity); frequency response in dense multi-tone/noise stimuli; spectral distortion/THD+N; frequency-dependent group delay, transient ringing, aliasing, perceptual quality, fitted gain tolerance, physical maximum output, acoustic latency and battery behavior. No claim of equivalence to hearing-aid prescriptions or safe output for users.

## Next focused development slice

**M03 Part E — spectral crossover remediation.** Design and compare smooth overlapping frequency-band weighting against the current rectangular hard-bin partition using matched synthetic input and target fixtures. Include dense frequency sweeps around *every* crossover, energy/complementarity and zero-gain identity preservation, impulsive artifact and limiter regression. Require explicit numerical acceptance thresholds and publish before/after results; do not tune thresholds after seeing results without documenting the rationale. Do not integrate live audio or request a new HTC/iPhone caption matrix. Only after the spectral algorithm is sufficiently characterized should streaming latency/route/calibration research advance.
