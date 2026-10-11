# M03 Part F — Dense synthetic Hard/Smooth DSP A/B

**Decision: keep `hard` as the default; `smooth` remains opt-in/offline.** The synthetic filterbank A/B evidence strongly supports smoother *frequency-response transitions*, but does not prove listening quality, clinical parity, ear SPL, or latency.

## Reproducible implementation

- `packages/dsp/offline-wdrc.ab.testkit.mjs`: deterministic fixture grids, projected tone gains and harmonic/two-tone/transient/limiter probes
- `packages/dsp/offline-wdrc.ab.test.mjs`: eight verification gates integrated with root `npm test`
- `tools/characterize-crossover-ab.mjs`: machine-readable full JSON A/B report
- `.github/workflows/ci.yml`: runs test suite, previous M03D baseline and new Part F report on Node 22
- Independent branch run [#38102134441](https://github.com/edisontw/hearlens/actions/runs/38102134441): **93/93 tests PASS**.

Run `npm test` and `npm run characterize:crossover`. This reports deterministic signal metrics, not environment-dependent CPU timing. The Part D performance probe is separate.

**Stimulus controls:** 16,000 Hz mono; 1024-point STFT and 256-frame hop; each single-tone probe is 32,768 samples (2.048 s) at synthetic peak amplitude 0.008. The fundamental gain is projected from the tail interval after time-dependent gain settling, not a measurement of real-ear insertion gain. For each adjacent center pair the boundary is the geometric mean; targets below are 0 dB and targets at/above are synthetic +9 dB across the 50/65/80 nominal input-level anchors. Six-band scan: 11 frequencies at ±0.125 octave about each boundary in 0.025-octave steps. Eight-band scan: seven frequencies at ±0.12 octave in 0.04-octave steps. **Each frequency and mode uses an identical newly constructed synthetic input** and renderer initial state. These gain steps are stress cases, not hearing prescriptions.

## Dense crossover results

At each geometric boundary, compute the **largest absolute adjacent-row change** in measured projected gain dB. The metric is explicitly dependent on this sweep density; a larger value may occur at finer points or different stimuli. Figures are rounded to 0.001 dB.

| Bands | Boundary (Hz) | Hard maximum jump (dB) | Smooth maximum jump (dB) |
|---|---|---:|---:|
| 6 | 250 / 500 | 2.442 | 0.916 |
| 6 | 500 / 1000 | 4.071 | 0.970 |
| 6 | 1000 / 2000 | 5.485 | 0.984 |
| 6 | 2000 / 4000 | 6.421 | 0.988 |
| 6 | 4000 / 6000 | 5.637 | 0.989 |
| 8 | 250 / 375 | 3.424 | 1.426 |
| 8 | 375 / 500 | 4.664 | 1.499 |
| 8 | 500 / 750 | 5.006 | 1.537 |
| 8 | 750 / 1000 | 4.958 | 1.558 |
| 8 | 1000 / 2000 | 5.486 | 1.570 |
| 8 | 2000 / 4000 | 6.421 | 1.576 |
| 8 | 4000 / 6000 | 5.637 | 1.577 |

**12/12 observed synthetic seams improved.** The maximum jump observed anywhere in the scanned set fell from 6.421 dB (Hard) to 1.577 dB (Smooth), though these maxima occur in potentially different rows. Regression tolerances **were frozen after observing the initial Part F baseline**, not prospectively determined clinical acceptance limits: all 12 seams must improve by at least 0.4 dB, and each smooth maximum step must remain below 2 dB under the same fixtures. They do not imply acceptable human-perceived distortion.

Uniform synthetic +6 dB across all bands: both modes measure 5.828 dB at each of 250, 500, 1000, 2000, 4000 and 6000 Hz after finite smoothing time. This is not evidence of NAL/DSL target accuracy.

## Limited distortion and time-domain probes

The following are *diagnostics*, not THD+N, IEC/ANSI electroacoustic certification, total in-band distortion, safe true peak or hearing-aid performance.

| Probe | Hard | Smooth | Interpretation |
|---|---:|---:|---|
| 1000 Hz / 0 dB target: H2–H5 summed projection | ≈0.000% | ≈0.000% | Negative control; limited by numerical/analysis floor |
| 1410 Hz / synthetic split-gain target: H2–H5 projection | 0.021% | 0.021% | No observed advantage in this narrow tonal harmonic probe |
| 1700 Hz / +9 dB band: H2–H4 projection | 0.020% | 0.020% | Active-gain tone; results nearly identical |
| Two-tone 1410/1420 Hz: output 1400 Hz sideband | −56.685 dBc | −54.481 dBc | Smooth spur about 2.2 dB larger (less negative) |
| Two-tone 1410/1420 Hz: output 1430 Hz sideband | −54.446 dBc | −54.299 dBc | Comparable, smooth marginally larger |
| Single synthetic click: preceding-sample share of rendered energy | 1.077% | 1.042% | Pre-ringing proxy; not latency |
| Single synthetic click: following-sample energy share | 1.079% | 1.044% | Post-ringing proxy; not clinical artifact tolerance |
| Strong synthetic input, final digital limiter at 0.1 | ≤0.100 | ≤0.100 | After the entire multiband sum, bounded Float32 output |

Harmonic percentages use projection of second through fifth harmonics where below the 8 kHz Nyquist frequency, relative to the fundamental in a finite tail window. 1700 Hz permits only H2–H4. Two-tone dBc compares the 1400/1430 Hz projected sideband amplitude to the larger of the 1410/1420 Hz projected fundamentals over a one-second coherent window. **The slightly higher Smooth sideband forbids a blanket "distortion improved" conclusion.** Total power distortion, broadband noise, sidebands outside the selected pair and transient audible pre-echo were not measured.

The limiter is a digital PCM bound only; it cannot guarantee ear-level dB SPL. The click pre/post-energy percentage is not a measured group delay, phase response, or perceptual ringing score.

## Decision and remaining gates

**Accepted as a research improvement:** smooth per-bin cosine overlap consistently reduces synthetic jump measurements in the tested windows, while core identity/uniform gain and the final digital ceiling remain covered by automated regression. **Not accepted as a live hearing filterbank or promoted default.**

Before any change to default or hearing output, investigate wider multitone/noise/stationary sweeps, modulation and sideband artifacts, streaming state and block-boundary continuity, phase/group delay and true-peak behavior. For actual hearing output additionally require input/output acoustic calibration, per-ear gain/MPO, route/disconnect fail-closed, start/reconnect ramps, reliable real-time latency and device-specific verification. Do **not** conflate these with M01 microphone STT normalization or request another HTC/iPhone caption distance matrix.
