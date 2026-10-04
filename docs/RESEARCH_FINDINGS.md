# Research Findings

This document records engineering decisions derived from the initial development-decision study.

## 1. Caption-first is the correct Web MVP

Captions, rolling transcript history and phone-near-talker guidance provide value without requiring ear-level SPL calibration, headphone transfer-function knowledge or low-latency output routing.

Browser speech recognition may be used as an opportunistic fallback/demo path, but it must not become the only production STT backend.

## 2. Audiogram-aware DSP is possible on Web, but not clinically calibrated by default

Web Audio / AudioWorklet can implement:

- multiband EQ/filterbank,
- per-band level estimation,
- WDRC,
- left/right independent gain,
- limiter and ramping,
- experimental noise reduction.

The limiting factors are not the DSP equations themselves. They are:

- microphone input SPL calibration,
- headphone output SPL calibration,
- device/OS/audio-route variability,
- latency,
- mobile background lifecycle,
- individual ear-canal acoustics,
- real-ear verification.

## 3. Audiogram thresholds are not EQ gains

Never map an audiogram threshold directly to equal gain.

Preferred research architecture:

```
Audiogram dB HL
  -> prescription targets
  -> G(f, input level)
  -> WDRC target I/O curves
  -> supported-headphone correction
  -> final limiter
```

Left and right ears remain independent through profile, WDRC, gain limits and fitting.

## 4. Initial WDRC research parameters

Research starting point only, not a clinical prescription:

- 6–8 bands,
- soft / medium / loud target grid near 50 / 65 / 80 dB SPL,
- attack approximately 10–20 ms,
- release approximately 300–1000 ms,
- frequency/time gain smoothing,
- final limiter after every processing stage.

These values must remain testable configuration, not hard-coded "NAL-NL2" claims.

## 5. Calibration states must be explicit

### Uncalibrated

May provide experimental personalized frequency shaping with conservative gain.

Must not claim:

- known ear-level dB SPL,
- clinically verified MPO,
- real-ear insertion gain.

### Calibrated

Requires a defined matrix such as:

```
phone model + OS + output route + headphone model + volume state
```

and measured input/output calibration.

## 6. Reference hardware

Initial hearing-DSP reference should favor:

- a small set of Android phones,
- one specified wired USB-C earbud/headset,
- bench calibration.

Bluetooth/TWS remains useful for caption-only use, but is not the reference transparent hearing path.

## 7. Microphone proximity is a core feature

Moving the phone closer to the talker can provide a larger physical SNR improvement than trying to recover a poor ear-position signal after capture.

The product should explicitly teach:

> If speech is unclear, move the phone closer to the person speaking.

This must be validated with distance tests at roughly 20 cm / 50 cm / 1 m / 2 m across quiet, cafeteria, TV, clinic and car conditions.

## 8. Speech enhancement remains optional until proven

Order of priority:

```
mic proximity
  > calibrated audibility
  > conservative enhancement
  > aggressive neural enhancement
```

RNNoise is suitable for a lightweight experiment. DeepFilterNet belongs in a later benchmark. Success is measured by hearing-impaired speech intelligibility and listening effort, not merely cleaner audio.

## 9. Validation hierarchy

1. deterministic DSP unit tests,
2. acoustic/device bench,
3. hearing-impaired human testing.

Objective metrics are secondary to human outcomes.
