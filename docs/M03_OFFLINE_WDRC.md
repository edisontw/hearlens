# M03 Part C — Offline multiband WDRC research prototype

**OFFLINE SYNTHETIC AUDIO ONLY. Not a hearing aid, clinical fitting engine, calibrated limiter, SPL measurement, or live-audio backend.** This slice changes no Web/M01 code, cloud tokens, microphone settings, hearing-path routing, or speaker/headphone output.

## Data flow

```text
synthetic mono Float32 PCM + synthetic dBFS reference
          ↓
per-ear 6–8-band validated synthetic Part B I/O target
          ↓
STFT (1024-point FFT, 256-sample hop, centered Hann WOLA)
          ↓
log-midpoint assigned frequency bins → per-band RMS estimate
          ↓
synthetic nominal input: 65 + band_dBFS − synthetic_reference_dBFS
          ↓
clamp detector coordinate to research grid 50–80 dB SPL labels
          ↓
Part B target gain lookup; cap algorithmic gain
          ↓
attack/release smoothing; per-bin multiplicative gain
          ↓
inverse STFT; weighted overlap-add
          ↓
FINAL bounded digital PCM limiter (+ Float32 rounding headroom)
          ↓
Float32Array returned to offline tests ONLY
```

### Example

```js
import { renderOfflineWDRC } from "./packages/dsp/offline-wdrc.mjs";
const rendered = renderOfflineWDRC({
  samples: syntheticMonoFloat32, // synthetic test signal
  sampleRate: 16000,
  targets: syntheticResearchTargets, // Part B schema, 6–8 bands for this ear
  ear: "left",
  syntheticRmsDbFSAt65DbSPL: -37, // arbitrary simulation reference; NOT calibration
  maxGainDb: 12,                   // synthetic test cap; NOT a clinical per-ear max
  limiterCeiling: 0.8,             // digital full scale; NOT ear-level dB SPL
  attackMs: 15,
  releaseMs: 500,
});
// rendered.samples is an offline numerical result. Never route to earphones.
```

No automatic live playback, no browser APIs, no state persistence, and no network. The function validates and freezes a canonical Part B target copy but does not modify caller PCM. Every call begins with independent filter/gain state; separate `ear` invocations never share state.

## Algorithm / validation boundaries

- Mono Float32 samples, 1–65,536 frames; allowed sample rates 16/24/48 kHz. Non-finite, excessive (>16 absolute) and unsupported inputs throw before rendering.
- Exactly 6–8 **explicit** ascending research band centers for the selected ear, all strictly below Nyquist. No extrapolated or filled bands. Source must have `origin.kind = synthetic-fixture`; external-unverified, missing-ear or underspecified 1–5-band curves fail closed.
- Bin ownership is determined by geometric midpoints of adjacent band centers; lower/higher out-of-center bins map to edge bands. This is a *prototype rectangular spectral partition*, NOT a validated hearing-aid filterbank, smoothly overlapping crossover, full spectral-channel allocation, or measured per-band response.
- Frame-windowed Parseval RMS is assigned to bins for each band. The synthetic reference specifies only an artificial correspondence between digital RMS dBFS and **nominal** 65 dB SPL grid label. It is never the environment SPL-to-ADC calibration. Detector coordinates beyond 50/80 are **clamped to the nearest anchor**, not extrapolated; silence remains zero.
- Each research target gain is interpolated linearly in the nominal input dB domain by the Part B lookup. Gain increases use release smoothing (default 500 ms); decreases use attack smoothing (default 15 ms), with finite [5,100] and [100,2000] ms configuration bounds. Gain starts at 0 dB at each offline invocation. Algorithmic gain upper cap is 0–24 dB, default 12; this is **not** an MPO, validated insertion gain, or calibrated safety limit. Changes at FFT-frame cadence are not claimed to match hearing-aid attack/release specifications.
- Inverse FFT and Hann-squared-normalized overlap-add reconstruct zero-gain fixtures approximately identically; dynamic time-frequency gains may cause spectral/temporal artifacts. A final instantaneous hard limiter clips after *all* band gains and summation. One-ULP-sized digital headroom accounts for Float32 rounding; output magnitudes never exceed supplied digital ceiling [0.05,0.95]. This is not a true-peak, look-ahead, acoustic-output, distortion-free or clinical limiter.
- Result diagnostics: ear, center frequencies, processed frame count, requested gains capped count, final limited sample count and maximum post-limiter digital amplitude. These are engineering-only; no measured SPL or real-ear gain inferred.

## Automated gates

Run `npm test`. Golden/adversarial cases verify zero-gain reconstruction, deterministic repeatability, L/R independence, 6- and 8-band research fixtures, silence, strict sample/config/provenance validation, Nyquist rejection and **final limiter cannot be bypassed by high summed synthetic bands** (including Float32 rounding). Regression failures must block merge.

The prototype does **not** establish numerical prescription parity with NAL-NL2/DSL, output SPL, reliable 6–8 band clinical frequency response, processing latency P95, background operation, headset routing, reconnect/mute, or medical-device suitability. Before any live audio path: validate acoustically calibrated input and output, device/earphone route, per-ear MPO and gain limits, start/reconnect ramps, a production-grade final limiter and watchdog/disconnect fail-safe with real hardware (see [SAFETY.md](./SAFETY.md) and [TEST_PROTOCOL.md](./TEST_PROTOCOL.md)). Do not request new HTC/iPhone caption distance tests for this offline module.
