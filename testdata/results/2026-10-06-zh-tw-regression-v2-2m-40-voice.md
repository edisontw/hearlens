# Controlled regression — 2026-10-06 — 2 m voice capture

Source: `zh-tw-regression-v2`

## Conditions

- receiving device: iPhone / Chrome iOS
- distance: 2 m
- playback volume field: `40`
- environment note: room
- provider: Gemini 3.5 Transcribe Live
- build: `20261006-voice-capture1`
- input mode: adaptive
- capture mode: voice
- adaptive target: -48 dBFS

## Browser processing request / support

Requested:

- echo cancellation: true
- noise suppression: true
- automatic gain control: true

Reported support:

- echo cancellation: true
- noise suppression: false
- automatic gain control: false

Diagnostic track actual settings reported echo cancellation enabled. Noise suppression and AGC were not reported as active.

## Observed front-end behavior

Compared with the prior 2 m raw-capture baseline, the capture level changed materially.

Raw 2 m baseline:

- speech estimate generally around -67 to -68 dBFS,
- adaptive gain mostly 7.4x–8x,
- transcript contained only scattered fragments.

Voice-capture run:

- after the initial seconds, many speech chunks were roughly -45 to -35 dBFS RMS,
- adaptive gain usually backed off to about 1.0x–1.4x,
- no limiter reduction,
- 0.00% clipping,
- transcript became substantially more continuous through the first, second, and part of the third test sentences.

The large level change means this is not merely a small echo-cancellation toggle. On this iPhone/browser combination, requesting the voice profile appears to select a materially different platform capture behavior. The browser reports only echo cancellation as a supported/actual named constraint, so the exact platform processing behind the level change should not be inferred from constraint names alone.

## Recognition observation

The voice run recognized a much larger continuous portion of the controlled speech than the raw 2 m run. It still contained errors, including the phone-number/room-number transition and `1208` being rendered as `11208`.

Interpretation: voice capture is a promising far-field front-end candidate, but one run is not enough to make it the default because the raw and voice runs did not yield perfectly aligned recognized excerpts and STT sessions can vary.

## Decision

- keep raw capture as the default for now,
- repeat the same 2 m / volume-40 voice run once,
- if the repeat again produces materially more complete transcription with stable levels and no clipping, promote voice processing into the future Far/Noisy preset,
- do not add custom denoising DSP before this repeat is resolved.
