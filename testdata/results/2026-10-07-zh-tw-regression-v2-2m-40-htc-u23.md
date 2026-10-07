# HTC U23 cross-device Far/Noisy validation — 2026-10-07

## Purpose

Validate whether the reproducible 2 m benefit of the `Far / Noisy` voice-capture preset extends beyond the first iPhone test path.

## Controlled condition

- Build: `20261007-device-gate1`
- Source: `zh-tw-regression-v2`
- Receiving device: HTC U23
- Actual distance: **2 m**
- Playback volume field: `40`
- Environment note: `room`
- Input mode: adaptive
- Adaptive target: `-48 dBFS`
- Gain range: `1x–8x`

### Metadata correction

Both exported reports contain `distance: "1 m"` / `"1m"`. The tester confirmed after completing the runs that **both tests were actually performed at 2 m**.

The raw report metadata should remain unchanged for traceability. This result note is the authoritative post-run correction.

## A — Auto / raw capture

Runtime:

- preset: `auto`
- capture: `raw`
- actual echo cancellation: `false`
- actual noise suppression: `false`
- actual AGC: `false`
- sample rate: 48 kHz

Recognition:

- only one short final fragment was retained: `這段，今天天氣不`

Telemetry:

- adaptive gain moved across a broad range rather than simply remaining at the 8x ceiling,
- several output peaks were already strong enough for STT input,
- limiter reduction remained `0.0 dB`,
- clipping remained `0.00%`.

Interpretation: as in the earlier 2 m raw test, the failure is not explained by insufficient scalar gain alone.

## B — Far / Noisy / voice capture

Runtime:

- preset: `far-noisy`
- capture: `voice`
- actual echo cancellation: `true`
- actual noise suppression: `true`
- actual AGC: `true`
- sample rate: 48 kHz

Recognition produced multiple coherent final segments, including:

- fixed-position / playback-volume instruction,
- the 3 PM meeting sentence,
- health card / phone / umbrella content,
- numeric content including room number `1208`,
- the closing fixed Taiwan-Mandarin test sentence.

The transcript was not fully complete, and one numeric string was recognized as `45729`; this run should therefore not be treated as a formal accuracy score.

Telemetry:

- speech-active levels were frequently much stronger than the raw far-field baseline,
- silence/noise intervals were strongly suppressed,
- limiter reduction remained `0.0 dB`,
- clipping remained `0.00%`.

## Decision

**PASS — cross-device Far/Noisy validation.**

The voice-capture improvement is now observed on:

1. the original iPhone test path, reproducibly at 2 m, and
2. HTC U23 / Android Chrome at 2 m.

This supports keeping `Far / Noisy = voice capture` as an evidence-based user preset.

It does **not** yet justify changing global Auto from raw to voice. On the HTC U23, the voice path actually enables EC + NS + AGC, so the next minimum test is:

- HTC U23,
- 1 m,
- same locked source and playback volume,
- Auto once,
- Far/Noisy once.

Purpose: check whether the more aggressive Android voice-processing path preserves normal-distance speech before any Auto-policy change.
