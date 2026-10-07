# iPhone caption-startup telemetry smoke test — 2026-10-08

## Purpose

Verify that build `20261008-caption-latency1` exports usable first-partial / first-final client-side startup telemetry before the formal benchmark.

## Report context

- Build: `20261008-caption-latency1`
- Provider: Gemini 3.5 Transcribe Live
- Runtime: Auto / raw / adaptive
- Adaptive target: `-48 dBFS`
- Gain range: `1x–8x`
- Platform: iPhone / iOS 18.7.8 / Chrome iOS 143
- Actual capture sample rate: 48 kHz
- Actual echo cancellation: false
- Actual noise suppression: false
- Actual AGC: false

The exported test metadata did not specify controlled distance, playback volume, receiving-device label, or room condition. This run is therefore a telemetry smoke test only and must not be included as a formal accuracy benchmark result.

## Caption-startup telemetry

The report correctly selected `first-audio-chunk` as the client-side reference:

- audio startup from session start: **6716 ms**
- first partial after first audio chunk: **1978 ms**
- first final after first audio chunk: **3753 ms**
- first partial from session start: **8694 ms**
- first final from session start: **10469 ms**

Interpretation:

- **PASS** for telemetry plumbing: both partial and final timing values were exported and were not left undefined.
- The 6.716 s pre-audio interval includes permission/device diagnostics plus token, WebSocket, setup, and capture startup. It must not be called speech-recognition latency.
- The 1.978 s / 3.753 s values are client-observed caption startup delays after audio transmission begins. They are useful engineering telemetry but are still not acoustic speech-onset-to-caption latency.

## Audio telemetry

Retained samples showed:

- adaptive gain approximately 1.63x–3.59x in the excerpt,
- limiter reduction 0.0 dB,
- clipping 0.00%.

## Decision

**PASS — caption-startup telemetry smoke gate.**

The M01 telemetry implementation is operational. Proceed to the locked formal benchmark protocol; do not repeat distance tuning merely because the telemetry layer was added.
