# M03 Part O — CAMFIT compressive research gain (2026-10-14)

**Status:** complete six-band research calculation and fixed independent numerical regression; **not** a clinical prescription or hearing-output implementation. M01 closed; no changes to caption or microphone capture.

## Why CAMFIT compression

M03 Part N implemented **linear** CAMFIT insertion gains from an audiogram, but hearing-assistance prescription is typically level dependent. NAL-NL2 / DSL v5 are different clinical rules and are not claimed here. This step implements an independently labeled, nonlinear CAMFIT research gain-table calculation for input levels 50, 65 and 80 dB SPL **in a model coordinate only**, with six octave bands and per-ear independently measured thresholds.

Reference source pinned at commit `9df6486fb0bddc7619b3b99f1b3a5c72c109a3ec`:
- [Clarity / PyClarity CAMFIT compressive function](https://github.com/claritychallenge/clarity/blob/9df6486fb0bddc7619b3b99f1b3a5c72c109a3ec/clarity/enhancer/gha/gainrule_camfit.py), derived from openMHA; by the Clarity project (MIT licence) with upstream openMHA attribution.
- [Upstream gainrule_camfit_compr tests](https://github.com/claritychallenge/clarity/blob/9df6486fb0bddc7619b3b99f1b3a5c72c109a3ec/tests/enhancer/gha/test_gainrule_camfit.py). The upstream regression's six center frequencies are paired with **only two edge endpoints [250,8000]**. PyClarity fills only one of six LTASS bands and leaves other nominal speech bands at zero. Its checksum `2140.1762291737905` for that under-specified configuration is **not a valid target** for our coherent six-band model. Do not adapt fitting band edges to satisfy an inconsistent fixture.
- Algorithm: Moore et al. (1999), *Use of a loudness model for hearing-aid fitting: II. Hearing aids with multi-channel compression*; Cambridge CAMFIT, distinct from NAL-NL2 and DSL v5.

## Fixed model assumptions, not acoustic calibration

Implemented in `packages/prescription-camfit-compression/camfit-compression.mjs`.

- Audio-band centers **[250, 500, 1000, 2000, 4000, 8000] Hz** and exactly **seven monotonically increasing edges [177,354,707,1414,2828,5657,11314] Hz**. There is one complete band interval per center. Edges are frozen; future variants need separately labelled reference fixtures and tests.
- Exactly measured six-frequency thresholds, independently for each present ear, are mandatory. An unavailable entire ear can remain `null`; absent individual thresholds fail without extrapolation.
- Byrne et al. 1994 long-term average speech spectrum (LTASS), 25 centers and reference third-octave powers, integrated proportionally over each model band. Convert to nominal **65 dB speech-band** model with the same **−5 dB offset** used by PyClarity. Derive minimum speech level by subtracting **38 dB**.
- The `isothr` ISO 226/389-derived free-field threshold conversion comes from PyClarity's published reference grid. This is a **model coefficient**, never a sound-card, headphone, ear-simulator, real-ear, or dBFS calibration.
- Use the previously implemented CAMFIT **linear insertion gain** at each frequency for the compression-ratio reference; calculate `Gmin = HL + IsoThreshold - Lmin`; denominator is `max(13, Lmid + Glinear - Lmin - Gmin)`, and `CR = max(1, 38/denominator)`.
- Compute gain `G(f,L) = Gmin + (L-Lmin)×(1/CR−1)` (equivalent to the upstream output-then-subtract-input rule), clipped below at zero, with upper model arithmetic ceiling `100-L`. For an all-zero normal-hearing audiogram on one ear, gain is always zero on that ear (PyClarity behavior).
- User-submitted model input level grid must be finite, ascending, distinct and within **0–100**; default **50/65/80**. The **100** is a *research output coordinate*, not an acoustic maximum output pressure (MPO), nor a final output limiter.

## Numerical reference

A separate NumPy reproduction of the **pinned upstream CAMFIT equations** with a *complete six-band edge grid* and equal bilateral thresholds **[30,40,50,60,70,80] dB HL** gives these **per-ear** gains in dB, rounded only here for display:

| Model input | 250 Hz | 500 Hz | 1000 Hz | 2000 Hz | 4000 Hz | 8000 Hz |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 50 dB | 8.300167 | 14.140471 | 25.448209 | 29.688450 | 30.804462 | 50.000000 |
| 65 dB | 2.246429 | 10.267599 | 20.832154 | 22.919817 | 21.521377 | 35.000000 |
| 80 dB | 0.000000 | 6.394727 | 16.216099 | 16.151183 | 12.238292 | 20.000000 |

Total of all **36** gain cells (two ears × six bands × three levels) = **684.338870237275**, strictly a numerical software checksum, *not summed gain or sound-pressure level*. With inputs **[30,40,50,60,70,80]**, the corresponding complete-edge six-level checksum is **1725.8181903097243**, NOT the incompatible upstream sparse-edge `2140.1762291737905`.

The CI test asserts **each cell** against the NumPy reproduction to ≤1e−7 dB and verifies the speech-band levels, all six compression ratios, both ears and independent input grid choices. This is algorithm arithmetic agreement with the reference equations **for these conditions**, not direct execution of external PyClarity tests on our default band grid. Expanded multi-audiogram parity against the pinned Python program and varying band conditions is still needed before scientific claims of general numerical equivalence.

## Output boundary and safety

The result has schema `hearlens-camfit-compression-research-v1`, quantity `camfit-compressive-model-gain-db`, explicit six edges, source commit, per-band CR/speech minimum/ISO model coefficient, and independent per-ear gains.

It is **NOT** a `hearlens-prescription-targets-v1` nominal reference target, a REAR/REIG/RECD result, or a device gain. No automatic converter, WDRC attachment or PCM output sink is added. All `inputSPLCalibrated`, `outputSPLCalibrated`, `clinicalParityEstablished`, and `hearingOutputAuthorized` flags remain false.

The CI tests additionally verify zero-loss/a missing whole ear, asymmetric ears, absent or malformed measurements, non-increasing input grids, monotonic model I/O, upper/lower arithmetic caps, freeze/no-mutation and a source-level no-hearing-playback guard. Running `npm test` is **offline** and requires no headset, microphone or repeated M01 field benchmark.

**Next meaningful stage:** Compare nonlinear CAMFIT across an independent set of synthetic audiograms and clinically relevant fitting-condition variants using the actual pinned Python implementation as an executable oracle (where available), then decide if/how its research gain *coordinates* can be mapped into existing independent WDRC anchors without inappropriate claims. Actual hardware output stays blocked until [SAFETY.md](./SAFETY.md) physical speaker-fallback mute, Bluetooth delay and per-ear MPO gates pass.
