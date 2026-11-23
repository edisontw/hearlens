# M03 short-spike quality convergence (2026-11-23)

## Scope and reproduction

This closes the current **offline synthetic transition-quality comparison**. It does not enable a microphone, audio route, browser playback, Bluetooth output, physical calibration, clinical fitting or a hearing claim. The 48 kHz Float32 PCM is generated inside the test and consumed only by the disconnected research processors.

Run only this characterization and the relevant invariants:

```sh
node --test --test-name-pattern="short 5, 10 and 20 ms synthetic PCM spikes compare transition policies and controls" packages/dsp/offline-auto-fir.integration.test.mjs
node --test --test-name-pattern="real offline detector \+ FIR automatic retarget remains callback-partition invariant|real left/right profiles remain distinct; limiter, reset and fail-stop remain enforced|concurrent ears keep independent delay lines and control state|fixed-horizon retarget mode keeps stereo isolation, partitions, limiter and reset|short 5, 10 and 20 ms synthetic PCM spikes compare transition policies and controls" packages/dsp/offline-auto-fir.integration.test.mjs
```

Each 5/10/20 ms fixture is rendered from a fresh processor. A continuous −44 dBFS RMS 1.5 kHz weak tone overlaps a −23 dBFS RMS 1.4 kHz gated sinusoid. The carriers straddle the 1/2 kHz band boundary. The pulse is rectangular (no edge taper) and starts at 600 ms. The detector/control interval is 10 ms, the coefficient transition is 50 ms, and the symmetric 513-tap FIR has a 256-sample (5.33 ms) frozen-gain group delay. The test compares the unchanged `restart` default with opt-in `fixed-horizon`.

The residual window is 20 ms and fits both known carriers by least squares. Three controls keep the interpretation bounded:

1. The raw-input residual estimates energy from the imposed short envelope outside the two steady carriers.
2. For each transition policy, a matched control processes the identical weak-only prefix through the FIR and detector, then stops detector retargets at the pulse boundary while continuing to filter the same pulse input. Its pre-pulse 2 kHz nominal level is 53.009 for the persistent-weak fixture (the other five bands are 50); after one second of silence, all six are 50. The control output is bit-identical to the dynamic output before the event. Its residual captures the FIR response/transient at that policy-specific pre-pulse operating point; differences from the raw input are a control comparison, not an additive decomposition.
3. The dynamic output adds detector and coefficient-transition behavior. `limitedSamples` is reported independently; primary fixtures have zero limiter action. A separate 20 ms over-range pulse confirms the limiter and is excluded from the quality comparison.

The weak-carrier projection is reported both raw and after subtracting an independently rendered strong-only stream. The subtraction reduces near-carrier envelope leakage, but the detector is nonlinear, so the difference is not pure isolated weak-filter gain. Recovery means the first of three consecutive 10 ms projections within 0.1 dB of the pre-pulse baseline. `null` means that threshold was not crossed within the 1700 ms observation window. Overshoot is positive 1 ms RMS excess over the matched frozen-gain render; the signed maximum delta is also reported. All amplitudes and dB values are digital PCM coordinates, not dB SPL.

## Measured results

The focused test reports full precision JSON. The rounded values below are from that test, with each duration isolated in its own fresh run.

| Pulse | Policy | Event peak (linear / dBFS) | Max 1 ms delta vs pre-pulse control | Positive overshoot | Weak-band minimum change | Weak-band range | Recovery within 0.1 dB | Limited samples |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 5 ms | restart | 0.20312 / −13.84 dBFS | 0 dB | 0 dB | −0.623 dB | 0.664 dB | 1545 ms | 0 |
| 5 ms | fixed-horizon | 0.20312 / −13.85 dBFS | 0 dB | 0 dB | −0.762 dB | 0.804 dB | 1435 ms | 0 |
| 10 ms | restart | 0.20313 / −13.84 dBFS | 0 dB | 0 dB | −0.784 dB | 0.843 dB | >1700 ms | 0 |
| 10 ms | fixed-horizon | 0.20312 / −13.84 dBFS | 0 dB | 0 dB | −0.940 dB | 1.000 dB | >1700 ms | 0 |
| 20 ms | restart | 0.20313 / −13.84 dBFS | 0 dB | 0 dB | −0.946 dB | 0.975 dB | >1700 ms | 0 |
| 20 ms | fixed-horizon | 0.20312 / −13.84 dBFS | 0 dB | 0 dB | −1.117 dB | 1.146 dB | >1700 ms | 0 |

| Pulse | Raw input envelope residual | Restart pre-pulse FIR control | Fixed-horizon pre-pulse FIR control | Restart dynamic residual | Fixed-horizon dynamic residual |
| --- | ---: | ---: | ---: | ---: | ---: |
| 5 ms | +2.410 dBc | +2.283 dBc | +2.283 dBc | +2.286 dBc | +2.288 dBc |
| 10 ms | −0.136 dBc | −0.153 dBc | −0.153 dBc | −0.152 dBc | −0.150 dBc |
| 20 ms | −152.3 dBc | −38.217 dBc | −38.220 dBc | −37.666 dBc | −36.569 dBc |

The 5 ms raw weak-carrier projection range is 11.66 dB for restart and 11.80 dB for fixed-horizon, while the strong-only-subtracted incremental ranges are 0.664 and 0.804 dB. This is a direct example of short-envelope leakage dominating the raw near-carrier projection. At 20 ms, the input residual is at the numerical floor, while the policy-matched pre-pulse FIR residual is about −38.22 dBc; the dynamic residual is higher by about 0.55 dB for restart and 1.65 dB for fixed-horizon. The fixed-horizon dynamic residual is about 1.10 dB higher than restart. These dBc values are residual-to-fitted energy ratios, not THD or perceptual scores.

At the 1700 ms observation horizon, the terminal incremental weak-band offsets for restart/fixed-horizon are −0.081/−0.064 dB (5 ms), −0.139/−0.113 dB (10 ms), and −0.221/−0.185 dB (20 ms). The latter two durations did not cross the three-window recovery criterion within the observation window, so they are recorded as lower bounds (`>1700 ms`) rather than extrapolated recovery times.

After 1.0 second of silence, the 20 ms pulse peaks at 0.189439 (−14.45 dBFS) for both policies; the largest 1 ms RMS delta against the frozen-gain control is 0 dB and `limitedSamples` is 0. A weak 1.5 kHz probe starts 180 ms later. Its initial gain estimate is 4.746 dB (restart) and 4.611 dB (fixed-horizon); both settle within 0.1 dB of their late probe level after 1730 ms and 1650 ms, respectively. Late probe estimates are 5.610 and 5.616 dB.

The separate 0.7-peak synthetic over-range 20 ms pulse reaches the 0.3 digital ceiling. The test counts **822 limited samples** for restart and **821** for fixed-horizon. This proves that the software limiter activates on that stress fixture; it does not establish safe SPL.

## Decision and finite M03 exit

**No useful net improvement was reproduced.** Fixed-horizon shortens the recovery by 110 ms in the 5 ms case and 80 ms in the post-silence probe, but it also causes 0.14–0.19 dB more minimum weak-band attenuation in the three persistent-weak cases and increases weak-band range. Measured positive transient overshoot is 0 dB at the reported precision for both policies against their matched pre-pulse controls. Its 20 ms dynamic residual is higher than restart. No acceptance threshold here establishes that any small numerical difference is perceptually valuable. Keep `restart` as the default and retain **fixed-horizon NO-GO** for default enablement. No production DSP logic changes are justified.

The bounded offline M03 quality gate is complete when this deterministic characterization and the focused invariants pass, the observed trade-offs are recorded, and no correctness failure is reproducible within these specific fixtures. This PR supplies that evidence. Do not continue duration/parameter sweeps or tune thresholds without a separately specified stimulus and predeclared, practically meaningful acceptance criterion. Reopen this M03 slice only for a reproducible offline correctness failure or a concrete candidate with replicated net improvement across independent synthetic fixtures.

Physical acoustic calibration (mic input and per-ear receiver output/MPO), device routing and fail-muted fallback, and real Android Native callback CPU/deadline/allocation validation move to **M04/Native**. They are not M03 offline exit conditions. M04 remains **BLOCKED**; acoustic measurements remain **DEFERRED**. No Moto g62/AIR31 owner test is requested by this study.
