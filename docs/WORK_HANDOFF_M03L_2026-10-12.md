# HearLens M03 Part L handoff — 2026-10-12

**GitHub `main` remains the only source of truth. Always fetch and verify latest SHA before starting the next work.**

M03L started at verified `main` `8f9104b3bae6efb4d5b5ec6cdff7e95109149041` (M03K merged, main CI pass). Work branch: `feat/m03l-offline-guard-port-seam`; PR #37. Always check PR/CI/merged head rather than assuming this handoff's recorded SHA is current.

## Changes

- `packages/dsp/offline-wdrc.timed.mjs`: added strict timestamp-guarded caller-buffer `processInto(startSample,Float32Array,Float32Array)` and `requiredOutputSamples(length)`. Reuses M03K DSP; on failed input/timestamp/processing, discards underlying state and scrubs passed destination. Existing `push`, `finish`, simulated capture clock, and fail-stop remain.
- `packages/dsp/offline-callback-port.mjs`: **pure offline** mock route + DSP sample-clock composition. After synthetic route/calibration/profile + explicit arm, each callback requires matching mock observed route and monotonic simulated clock. Missing observation, speaker or route change, invalid input/time, simulated unplug, interrupt or underrun faults. No automatic reconnect: reset, reconnect, new mock attestation and user start required. A private temporary DSP scratch is never exposed: this API returns **only candidate counts and mock metadata**, **no PCM, sink registration, output callback or device controller**.
- `packages/dsp/offline-callback-port.test.mjs`: reference Float32 parity in both ears, hard/smooth, 16/24/48 kHz, preallocated writer/no-overwrite and fail-stop; and route/clock/underrun/authorization negative fixtures.
- Safety/roadmap updated. Design detail and unresolved physical exit criteria: `docs/M03L_CALLBACK_PORT_MODEL.md`.

## What this does NOT mean

No microphone, Web Audio output, Android/iOS audio routing, physical disconnect detection, immediate hardware silence, prevention of speaker fallback, independently measured per-ear MPO or acoustic calibration is implemented. In-memory mock authorization cannot assert actual route safety or any patient-safe SPL. Callback memory determinism/GC and target-phone latency remain unverified. **Live amplification remains forbidden** until the real hardware and acoustic gates pass.

No M01/HTC/iPhone STT retest is called for by these isolated changes; Gemini captions, broker and Pages unaffected.

## Next work

Check CI on PR #37, merge only after tests pass, and confirm new `main` SHA + `main` CI. For M03M/M04: select an Android target phone and fixed wired USB-C headset; design native hard-mute/no-fallback enforcement; acquire physical unplug-to-silence evidence (including unintended phone speaker), route/sink/volume identity and calibrated coupler response for each ear. **Do not connect the mock route model to real audio playback.**
