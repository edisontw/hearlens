# HearLens M03 Part J handoff — 2026-10-12

GitHub `main` is the sole source of truth. This work began at `c964be89f1440fabbb6b03f4f97027c43dcc5bce`; **fetch and verify main SHA** before doing any next slice.

M03J adds **four reused per-instance Float64 scratch buffers** to `packages/dsp/offline-wdrc.stateful.mjs`, previously recreated for every 1024/256 STFT frame. `packages/dsp/offline-wdrc.stateful.test.mjs` checks byte-exact Float32 parity after longer irregular-chunk reuse in Hard/Smooth and L/R. There are still per-chunk JS array/Float32Array and other target lookup allocations: **not allocation-free production audio**.

M03J also adds `packages/dsp/offline-route-safety.mjs` and its tests: a **pure simulated** route gate with initial muted state, mock wired-headphones-only route ID and calibration/profile identifiers, explicit user arm, simulated start ramp, fail-stop on speaker/route change/DSP failure, and explicit reset/new attestation for reconnection. The state machine has **no device integration, hardware mute, real acoustic calibration or production MPO.** Read `docs/M03_ROUTE_MODEL.md` and `docs/SAFETY.md`.

M03I timed sample-clock continuity guard, standalone DSP, M01 Gemini caption functionality and formal benchmark status remain unchanged. `npm test` and `npm run benchmark:stream` remain gates/probes.

**Next**: M03K, characterize further memory allocation and GC jitter, prototype *isolated* callback API/no-alloc processing, and specify genuine wired-headset hardware/OS disconnect + no speaker fallback plus independent per-ear calibrated output MPO. Do not activate headphone output until all safeguards and acoustic measurements pass. No HTC/iPhone retest required for offline code.
