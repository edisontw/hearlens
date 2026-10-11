# HearLens M03 Part H handoff — 2026-10-12

**Fetch current GitHub main SHA first.** This work began from `8a788d294137d8dad8b5548deab9821c6d4b477a`; it may have moved. GitHub main remains the sole source of truth.

Part H adds `packages/dsp/offline-wdrc.stateful.mjs`, regression tests `packages/dsp/offline-wdrc.stateful.test.mjs` and `docs/M03_STATEFUL_STREAMING.md`. The original offline renderer exports numerical FFT/filterbank helpers without changing its actual rendering behavior. Persistent 1024-frame/256-hop STFT and gain state use ring buffers (1024 PCM, 1024 overlap, 1024 weights), process frames exactly once and emit output after the final digital limiter. Reference comparison is byte-exact Float32 per sample across all tested modes, ears and chunk schedules. Strict 4096-sample chunk cap. Error faults until explicit reset.

**This is not a live/audio amplification route.** No physical SPL or per-ear MPO, calibrated limiter, route disconnect fail-closed, no-speaker fallback, start/reconnect ramp, real-time callback or measured end-to-end latency. M01 captions and STT remain intact. Do not rerun the 24-run M01 benchmark during offline DSP work.

Next M03 Part I: timestamped discontinuities, missing data/underrun policy, bounded CPU and allocations, reset/ramp safety state-machine planning. Prefer synthetic tests until M04 controlled-device calibration design is approved. Run `npm test` plus characterization scripts.
