# Controlled regression — 2026-10-07 — 2 m voice capture repeat

Source: `zh-tw-regression-v2`

## Conditions

- receiving device: iPhone / Chrome iOS
- distance: 2 m
- playback volume field: `40`
- environment note: room
- provider: Gemini 3.5 Transcribe Live
- build: `20261006-voice-repeat1`
- input mode: adaptive
- capture mode: voice
- adaptive target: -48 dBFS

## Actual capture settings

The actual Gemini microphone stream reported:

- echoCancellation: true
- sampleRate: 48,000 Hz
- volume: 1

The browser did not report active noise suppression or automatic gain control in the actual track settings.

## Repeatability result

This second 2 m voice-capture run again produced substantially more continuous recognition than the prior raw-capture baseline.

The transcript retained:

- the date opening,
- the fixed-position / playback-volume instruction,
- the 3 PM meeting sentence,
- the health-card / phone / umbrella sentence,
- phone digits `5729`,
- the Tuesday 9:30 follow-up sentence,
- breakfast items,
- the beginning of the sixth instruction.

As in the first voice run, audio levels changed materially compared with raw capture. Many speech chunks were roughly -40 to -55 dBFS RMS, with adaptive gain frequently around 1x–2x, although weaker chunks still drove gain upward. Limiter reduction remained 0.0 dB and clipped samples remained 0.00%.

## Decision

The improvement is now considered reproducible on this iPhone / iOS Chrome device.

- Keep Auto on raw capture because cross-device evidence is still insufficient.
- Promote voice capture into the user-selectable `Far / Noisy` quick preset.
- Keep the -48 dBFS adaptive normalization and 1x–8x gain bounds unchanged.
- Do not add custom denoising DSP yet.
- Validate the Far / Noisy policy on at least one additional phone before considering it for Auto.

This remains an engineering result, not a formal accuracy benchmark.
