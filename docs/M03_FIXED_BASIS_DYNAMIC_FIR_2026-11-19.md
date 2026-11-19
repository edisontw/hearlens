# M03 — offline fixed-basis dynamic FIR core (2026-11-19)

**Scope: synthetic, software-only proof. No hearing output.** This implements the missing common *per-band 50/65/80 gain interpolation* and transitions between externally supplied simulated nominal input-level vectors. It does **not** implement independent acoustic band-level measurement, clinically calibrated compression, or a real-time Android hearing path. It neither changes the reference STFT processor nor substitutes for the [earlier FIR stress screen](./M03_MINPHASE_FIR_STATIC_SPIKE_2026-11-19.md).

## Design

Source: `packages/dsp/offline-dynamic-fir.mjs`. Test: `packages/dsp/offline-dynamic-fir.test.mjs`.

- Hard-gated `usage:"offline-synthetic-test-only"`, `sampleRate:48000`, one selected left/right ear, synthetic-fixture target provenance, exact six octave centers 250/500/1000/2000/4000/8000 Hz; unknown route or authorization options rejected.
- **Fixed filter basis:** six 513-tap Hamming-windowed linear-phase FIRs. Band weights follow the smooth STFT reference's geometric crossovers and raised-cosine ±0.18-octave blending. Each basis is designed only once with the existing 4096-point offline FFT and shared between ears. Their sum reconstructs a 256-sample delayed identity for unity gains.
- **Shared target law:** explicit `setSyntheticBandLevels([L250,L500,L1000,L2000,L4000,L8000])` with *fictional nominal levels* limited to 50–80. For each band, interpolate the canonical synthetic `gainDbByInputLevel["50"/"65"/"80"]` linearly in **dB**, cap gain at the research limit 0–12 dB, then convert to linear amplitude. Distinct ears use independent target profiles. There is no automatic input-level detector and **no physical SPL measurement**.
- **Dynamic coefficients:** synthesize a *single* 513-tap kernel from the six fixed basis kernels and level-dependent amplitudes. On further explicit updates, use a raised-cosine coefficient interpolation over a bounded transition (default test: 50 ms); another update during a transition starts from the instantaneous blended kernel. The input-history ring is preserved. Coefficient generation is outside `processInto()`.
- **Bounded callback model:** `processInto(input,destination)` processes 1–4096 synthetic Float32 input samples synchronously into a caller-owned Float32 buffer. No output-array allocation, FFT, source mutation or device I/O in the per-sample processing path. Malformed PCM or aliasing faults until explicit `reset()`; the final post-mix **digital** limiter is applied to every emitted sample.
- **Latency:** 0 *future input* lookahead, but **256 samples = 5.333 ms frozen-gain linear-phase group delay** at 48 kHz, plus unknown device/BT pipeline. During coefficient morphing, the filter is time varying and a single LTI group-delay value is not sufficient.
- **Compute:** naive direct kernel requires 513 multiplications per output sample per ear: **24.624 million MAC/s per ear** at 48 kHz, **49.248 million stereo**. Kernel updates cost another ~6×513 operations at each explicit level update; no repeated FFT. A local Node 22 illustrative batch (one second of 48 kHz samples for *both* ears in 128-sample chunks; one profile update) had ~190 ms median elapsed of five runs. This is **not** an Android real-time, callback p95, thermals or Bluetooth latency measurement.

## Focused verification

Local Node 22 isolated module tests passed **7/7** before integration. The GitHub CI test suite runs the identical module/tests against the repository's canonical `normalizePrescriptionTargets` and `offlineFFT`. Tests check:

1. All six independently supplied nominal band input levels, with exact 50/65/80 anchors and intermediate interpolation; left/right target separation and output authorization false.
2. At 65 model-coordinate level, a 513-tap synthetic impulse frequency response at each of six octave centers agrees with **the capped 65-coordinate model gain within 1.5 dB**, for the two *illustrative* audiograms from the 2026-11-19 review. This is not broader fitting equivalence or quality acceptance.
3. Exact 256-sample delayed identity when all six gains are zero; no confusion with zero acoustic delay.
4. Bit-identical Float32 output across one-sample and 128-sample chunking, including re-targeting during an unfinished fade.
5. Extreme bounded input and final digital limiting; malformed input is rejected before any destination modification and faults the research processor.
6. Strict rejection of live/output/unknown config, wrong sample rate/ear and out-of-bounds nominal coordinates.
7. Source-level absence of microphone, playback, device or network APIs.

## Status and next decision gate

**GO for an isolated mathematical gain-law + coefficient-morph core only. NO-GO for calling this a functional WDRC or enabling audio output.** The 50/65/80 values in these tests are **injected**; a real bandwise envelope detector, a trustworthy synthetic-versus-input mapping, target tracking and compression transients remain unimplemented.

The [prior 100-shape stress study](./M03_MINPHASE_FIR_STATIC_SPIKE_2026-11-19.md) shows the fixed-length filter also has significant response errors outside the two selected examples. This module retains that limitation; it does not improve tap-length robustness. Additional runtime benchmarking on an Android device, automatic gain changes, calibration, no-speaker-fallback and queued-audio hard mute remain separate gates, **not unlocked by a successful CI run**.

**Owner decisions preserved:** M01 caption phase CLOSED; M04 AIR31 acoustic route BLOCKED, physical studies DEFERRED. No new phone test, hardware purchase, live stream or clinical efficacy claim is requested.

See [ROADMAP](./ROADMAP.md) and [SAFETY](./SAFETY.md).
