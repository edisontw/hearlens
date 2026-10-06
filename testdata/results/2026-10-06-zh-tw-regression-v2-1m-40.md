# Controlled regression baseline — 2026-10-06

Source: `zh-tw-regression-v2`

## Conditions

- receiving device: iPhone / Chrome iOS
- distance: 1 m
- playback volume field: `40`
- environment note: room
- provider: Gemini 3.5 Transcribe Live
- input mode: adaptive
- build: `20261006-preflight1`

## Audio telemetry

The retained telemetry showed:

- adaptive gain: 8.00x on every retained audio-level sample,
- speech-level estimate: approximately -66.8 dBFS,
- noise floor: approximately -78 dBFS,
- active-speech raw RMS commonly around -63 to -70 dBFS,
- output peaks roughly -33 to -54 dBFS,
- limiter reduction: 0.0 dB,
- clipped samples: 0.00%.

Interpretation: under this 1 m condition, the controller was permanently at the 8x ceiling. Therefore this run demonstrates that the Gemini path and 8x distant-speech amplification are effective, but it does not yet demonstrate adaptive back-off.

The previous -30 dBFS target is much higher than the effective level used in this successful run. A speech estimate near -66.8 dBFS plus 8x gain (about +18.1 dB) produces approximately -48.7 dBFS. The next engineering target is therefore moved to -48 dBFS so distant speech can still reach the 8x ceiling while closer/stronger speech can back off.

## Recognition observations

Recognition preserved the main daily-content sentences, date/time, phone digits 5729, and room number 1208. Main observed errors:

- omitted: `現在進行 HearLens 中文語音辨識測試`,
- omitted structural labels: `第四段` and `第六段`,
- substitution: `一點縫` -> `一點風`,
- `台灣` / `臺灣` is treated as an orthographic variant rather than a content error.

Do not use this single run as a formal accuracy benchmark.
