# Audiogram-Aware Processing

## Status

Research design only. No clinical equivalence claim.

## Input model

Store thresholds independently for each ear at the available audiometric frequencies, commonly:

- 250 Hz
- 500 Hz
- 1 kHz
- 2 kHz
- 4 kHz
- 8 kHz

Intermediate frequency-domain operations should use log-frequency interpolation rather than linear-Hz interpolation.

## Forbidden shortcut

Do not implement:

```
40 dB HL loss at 2 kHz => +40 dB EQ at 2 kHz
```

dB HL is not a direct ear-level SPL value, and hearing-loss prescriptions are nonlinear.

## Target architecture

```
audiogram
  -> prescription engine
  -> per-band soft/medium/loud target gain
  -> piecewise target I/O curves
  -> WDRC
  -> device/headphone correction when calibrated
  -> final limiter
```

## Prescription implementation

NAL-NL2 / DSL-style targets may be reimplemented for research, but must not be described as numerically equivalent to clinical fitting software until verified.

Before any clinical-style claim:

1. create golden audiogram cases,
2. obtain trusted clinical fitting reference targets,
3. perform numerical parity tests,
4. document deviations and supported population.

## WDRC research starting point

- 6–8 processing bands,
- target gain at approximately 50/65/80 dB SPL input,
- derive compression behavior from target I/O points,
- attack approximately 10–20 ms,
- release approximately 300–1000 ms,
- smooth gain over time/frequency,
- final limiter after all gain-producing stages.

These are engineering starting ranges, not universal prescription values.

## Calibration problem

Two separate paths must be measured:

```
environment SPL -> phone microphone/ADC -> dBFS
```

and

```
PCM dBFS -> phone/DAC -> headphone -> coupler/ear-simulator SPL
```

Without input calibration, a WDRC detector cannot know that a digital level represents 50/65/80 dB SPL.

Without output calibration, an output limiter cannot guarantee ear-level SPL.

## User fine tuning

Preferred controls are bounded perceptual adjustments rather than per-band technical gain controls:

- sound too soft / comfortable / too loud,
- speech too dull / comfortable / too sharp,
- soft speech hard to hear,
- loud sounds uncomfortable.

MPO / safety ceilings are not general-user controls.

## Implemented offline data layers (M03 A–B)

- Audiogram domain: [M03_AUDIOGRAM_PROFILE.md](./M03_AUDIOGRAM_PROFILE.md) — measured dB HL, missing-data handling and frequency interpolation only.
- Research target domain: [M03_PRESCRIPTION_TARGETS.md](./M03_PRESCRIPTION_TARGETS.md) — separately supplied nominal 50/65/80 dB SPL input labels and per-band target gain curves, no NAL-NL2/DSL calculations and no audio output.

Research I/O curves are data and cannot override calibrated-device, final-limiter, per-ear gain or disconnected-headset fail-closed requirements.

## Implemented offline DSP research slice (M03 Part C)

- [M03_OFFLINE_WDRC.md](./M03_OFFLINE_WDRC.md) — **synthetic-only** 6–8-band FFT overlap-add research renderer, per-band gain smoothing, per-ear numerical gain cap and post-mix digital limiter. No phone, calibrated routing, gain prescription or SPL measurement.
- The synthetic dBFS-to-nominal-dB-SPL reference is a *test fixture coordinate*, never a microphone calibration.
- Digital clipping safety tests do not replace physical acoustic output, on-headset disconnect fail-safe, frequency/latency characterization, production output limiter or real-ear verification.
