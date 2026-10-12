# HearLens M03 Part K handoff — 2026-10-12

**Source of truth: GitHub `main` — verify latest SHA before all subsequent work.** This M03K branch began at verified main `95ac33931e8bdd2ae21954ddc56967fb537fcc59` (M03J, PR #35, 128/128 reported PASS). Branch: `feat/m03k-offline-callback-contract`.

## Implemented in isolated offline research only

1. `packages/dsp/offline-wdrc.stateful.mjs` now caches three synthetic target anchors per band at construction instead of allocating/normalizing profile+query objects inside every FFT frame, while preserving the original reference interpolation cases and numeric order.
2. Added `requiredOutputSamples(length)` and `processInto(input,destination)`, where caller owns independent Float32 input/output buffers. Output returns **a numeric written-prefix count** and never creates a per-push result array; short destination, aliased backing store and invalid PCM fault before ingest with explicit reset required. Existing `push/finish` behavior is unchanged. A callback can release 256 samples on a single-sample input, so destination preflight is mandatory.
3. New `offline-wdrc.callback.test.mjs` compares original whole-clip reference across both ears, three rates and hard/smooth with irregular chunks, plus prefix/no-overwrite, alias, fail-stop/reset, sustained limiter and mixed path.
4. `npm run benchmark:callback` is a **non-gating Node** comparison (legacy `push` vs reusable buffer). Heap snapshots and per-call timing cannot establish per-callback allocation counts, GC determinism or device latency.
5. `docs/M03K_CALLBACK_ROUTE_ARCHITECTURE.md` specifies native wired route, physical headphone disconnect and no speaker fallback, channel-specific calibration, independent calibrated final MPO, fault/interrupt response and measurement exit gates. `docs/SAFETY.md` and `docs/ROADMAP.md` point to the blockers.

## Validation state

Run `npm test` and `npm run benchmark:callback`; verify PR CI before merge. **No hardware validation performed.** The audio callback interface is only an isolated synthetic prototype and is NOT integrated into `offline-wdrc.timed.mjs`, AudioWorklet, Android native audio, browser output or any route controller.

## Next

If CI passes, review and merge the M03K offline-only changes, re-read latest `main`, then proceed with M03L: design a pure callback-clock + route-port seam and negative fixtures without enabling audio. Hardware work requires selecting a specific Android model + wired USB-C headset and physical measurement instrumentation. No HTC/iPhone STT replay is required for changes that touch only offline synthetic DSP. M01 Gemini captions, Pages, roadmap formal STT benchmark remain independent.

**Critical: do not enable actual hearing amplification before real native route assurance, measured per-ear MPO and physical unplug/speaker-fallback tests are completed.**
