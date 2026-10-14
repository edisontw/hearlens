# M03 Part Q — Explicit synthetic CAMFIT → offline WDRC trial (2026-10-14)

**Scope:** engineering-only, isolated in-memory synthetic-PCM test. **No real-world acoustic calibration, hearing assistance output, medical fitting, user interface, microphone capture, phone speaker, Bluetooth routing, or clinical approval.**

## Decision

[M03 Part P](./M03_CAMFIT_PYTHON_CROSSCHECK_2026-10-14.md) established that the six-band CAMFIT compressive research **model** matches unmodified upstream PyClarity for eight bilateral audiograms (324 level×frequency×ear cells; max deviation ~3.55×10⁻¹⁴ dB). This is necessary but not sufficient to feed a real DSP. The existing [Part C](./M03_OFFLINE_WDRC.md) STFT/WDRC receives **synthetic-only** 50/65/80 input-anchor gain profiles and an *invented* `syntheticRmsDbFSAt65DbSPL` number. CAMFIT's gains are **model coordinates**, not physical headphone gain. The Part C input-to-SPL mapping is equally uncalibrated.

**Therefore, Part Q provides an explicit, disposable SYNTHETIC-FIXTURE projection only**, so we can characterize algorithm interactions without falsely claiming HL→physical gain conversion or claiming safety.

## Implemented API

`packages/prescription-camfit-bridge/camfit-synthetic-wdrc.mjs` exports one public entrypoint:

`renderCamfitSyntheticWDRC(config)`

It enforces **exactly** these required fields:

- `schema: "hearlens-m03-camfit-synthetic-wdrc-trial-v1"`
- `usage: "offline-synthetic-test-only"`
- `audiogram`: canonical `hearlens-audiogram-v1` data containing *measured* 250/500/1k/2k/4k/8k Hz thresholds for each available ear; no interpolation/extrapolation or cross-ear substitution; the selected ear must exist
- `samples`: in-memory synthetic mono `Float32Array`, validated by the authoritative Part C renderer; NO PCM sink or audio device API in the adapter
- `sampleRate`: **24000 or 48000**; reject 16000 because the 8000 Hz upper CAMFIT band center would be **at Nyquist**, which the renderer disallows
- `ear`: `left` or `right`, independent
- `syntheticInputReference`: exact schema `hearlens-m03-fictional-65dbspl-to-dbfs-v1`; `rmsDbFSAtNominal65` finite −90..−3; **`physicalMicCalibrated:false`**, **`physicalReceiverCalibrated:false`**, **`route:"none"`**. This is a *fictional scalar model coordinate*; it is not dB HL→real dB SPL or microphone sensitivity calibration.
- `maxGainDb`: explicit research upper gain cap **0..12 dB**, applied independently by authoritative Part C, not a calibrated per-ear MPO
- `limiterCeiling`: explicit **0.05..0.8** digital full-scale clip ceiling, NOT an acoustic ear-level SPL limit
- `crossoverMode`: explicit `hard` or `smooth`; neither is a hearing-aid-quality crossover

Unknown fields and any claim of a live/authorized/calibrated route are rejected, rather than ignored; configurations cannot supply their own target overrides. **There is no default hardware calibration, DSP binding, Bluetooth endpoint, playback permission or route override.**

The adapter first computes genuine research CAMFIT level-dependent gains for **exact 50,65,80 model-input coordinates**. It then *labels* a temporary `hearlens-prescription-targets-v1` instance as `origin.kind:"synthetic-fixture"` (NOT a trusted external clinical prescription) and delegates to the existing **`renderOfflineWDRC`**. This test mapping makes no REAR/REIG/RECD or calibrated PCM assertions. The output is an in-memory synthetic `Float32Array` and a frozen, inspectable synthetic target projection/diagnostic result with `physicallyCalibrated:false`, `clinicalParityEstablished:false`, `hearingOutputAuthorized:false`, and `route:"none"`.

**No part of this result may enter a live audio sink.** The presence of an offline PCM array does not prove future OS speaker-fallback prevention or any safe output limit.

## Deterministic tests

`npm test` now includes `packages/prescription-camfit-bridge/camfit-synthetic-wdrc.test.mjs`. It checks:

1. Exact transfer of the six source frequencies and all 50/65/80 model gain anchors, including independent previously verified 1 kHz values **25.448208542 / 20.832153685 / 16.216098828 dB**.
2. Bit-exact PCM equality with the authoritative existing `renderOfflineWDRC` when run using the same projected fixture (in both hard and smooth crossover modes); no alternate/downgraded DSP or limiter introduced.
3. Separate L/R audiograms and zero-loss ear produce independent target gains and synthetic signal results.
4. Extreme but finite synthetic signal is kept under the requested final **digital** ceiling on both ears, and gain-cap/limiter diagnostics are populated.
5. Partial, missing ear, malformed, non-finite, wrong frequency/sample rate, false calibration or output-route claims, unknown options, and unsupported high caps fail *before output*.
6. Source-only regression ensuring this bridge does not add device/network/PCM playback APIs.

No physical phone/HTC/iPhone/Bluetooth validation is required to test this **synthetic-only** interface. The existing M01 subtitle acceptance is not reopened.

## Important limitations and next actual engineering work

- The WDRC uses a **single synthetic input-level reference per ear** and computes a band RMS in digital full scale. This is *not* a spectrally calibrated phone microphone and must not be confused with the per-band ISTS/LTASS coordinates in CAMFIT. Tested data may therefore model an interesting compression shape while failing to predict any real speech gain, acoustic output or intelligibility.
- The `synthetic-fixture` source label is a simulation authorization for Part C only, not evidence of clinical fitting or real output authorization. The resulting `Float32Array` is for memory-only tests.
- Part C's prototype STFT filterbank, gain envelope, limiter and full-buffer transform still require physical hardware and more complete distortion/latency verification. A nominal `maxGainDb` cap and digital clip limiter do **not** constrain calibrated ear-level MPO.
- The next **hardware-dependent** step is designing or obtaining **measured** microphone dBFS↔environment SPL and separately per-ear headphone coupler/ear-simulator output calibration references (including model/volume/routing identity). Native physical route fallback and rapid hard mute are separately blocking. Ordinary Bluetooth earbuds remain the preferred eventual output, not a justification to skip physical tests.
- NAL-NL2/DSL licensing/clinical numerical equivalence remains unproven. CAMFIT is a research rule; adult audiogram self-fitting must respect [SAFETY.md](./SAFETY.md).

**Do not promote this synthetic bridge into a native/production hearing audio path by importing it directly.**
