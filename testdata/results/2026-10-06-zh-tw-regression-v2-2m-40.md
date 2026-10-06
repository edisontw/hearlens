# Controlled regression baseline — 2026-10-06 — 2 m

Source: `zh-tw-regression-v2`

## Conditions

- receiving device: iPhone / Chrome iOS
- distance: 2 m
- playback volume field: `40`
- environment note: room
- provider: Gemini 3.5 Transcribe Live
- input mode: adaptive
- build: `20261006-adaptive-target2`
- adaptive target: -48 dBFS
- gain bounds: 1x–8x

## Audio telemetry

Across the retained one-second samples:

- median adaptive gain: approximately 7.65x,
- approximately 74% of retained samples were at or above 7x,
- approximately 61% were at or above 7.5x,
- active-speech gain was usually near the ceiling; 9/10 retained active-speech samples were at or above 7x,
- speech-level estimate was generally around -67 to -68 dBFS,
- noise floor was approximately -77 to -79 dBFS,
- limiter reduction remained 0.0 dB,
- clipped samples remained 0.00%.

During several active-speech moments, output peaks were already around -36 to -40 dBFS, so the downstream STT was not simply receiving an inaudibly small digital signal.

## Recognition observation

Recognition degraded substantially compared with 0.5 m and 1 m. The final transcript retained only fragments of the played material:

- `請把手機放在固定位置，不要改變播放音...`
- `我們下午 3 點在門口見面。`
- `第四段，醫師說下週二上午九點。`

Large portions were missed despite gain being close to the 8x ceiling.

Interpretation: the 2 m limitation is no longer well explained by insufficient scalar gain. The more likely next engineering targets are far-field SNR, room reflections/reverberation, microphone directivity, or speech-enhancement / front-end quality. Increasing gain beyond 8x would amplify noise and reverberation together and is not the preferred next step.

## Gate conclusion

The short controlled distance gate is now complete:

- 0.5 m: adaptive controller backs off into roughly 3x–6x,
- 1 m: weak speech reaches the 8x ceiling and recognition is good,
- 2 m: controller stays near the ceiling but recognition falls sharply.

This validates the adaptive normalization behavior and identifies 2 m as a front-end/SNR problem rather than a simple gain problem.

## Next experiment

Use the existing 2 m / volume-40 condition as the baseline for a conservative, reversible speech-enhancement A/B. Keep the source, playback device, volume, room, phone position, and STT provider unchanged. Do not raise the maximum gain as the first intervention.
