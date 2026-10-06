# Controlled regression baseline — 2026-10-06 — 0.5 m

Source: `zh-tw-regression-v2`

## Conditions

- receiving device: iPhone / Chrome iOS
- distance: 0.5 m
- playback volume field: `40`
- environment note: room
- provider: Gemini 3.5 Transcribe Live
- input mode: adaptive
- build: `20261006-adaptive-target2`
- adaptive target: -48 dBFS
- gain bounds: 1x–8x

## Audio telemetry

Observed retained gain values ranged from 1.00x to 6.28x, with a median around 4.99x across the displayed 1 s samples. During clearly active-speech samples, gain was approximately 2.19x–6.02x.

Other observations:

- speech-level estimate was generally around -61 to -65 dBFS,
- noise floor was around -79 dBFS,
- limiter reduction remained 0.0 dB,
- clipped samples remained 0.00%,
- output peaks were commonly around -39 to -49 dBFS during speech.

Interpretation: unlike the 1 m / volume-40 baseline, which stayed at the 8x ceiling, the 0.5 m run showed clear adaptive back-off into roughly the 3x–6x region. This validates that the -48 dBFS engineering target creates useful headroom for distance-dependent gain adaptation.

## Recognition observation

The short excerpt was transcribed correctly apart from the product name `HearLens`, which Gemini rendered as `Nuance`. This is treated as a proper-noun/model recognition issue rather than an input-level failure.

Do not use this short run as a formal accuracy benchmark.

## Next gate

Run the same source and playback volume at 2 m. Expected behavior:

- gain should spend substantial time at or near the 8x ceiling,
- limiter should remain inactive,
- clipping should remain 0%,
- recognition should remain usable enough to determine whether level, rather than SNR, is now the dominant limitation.
