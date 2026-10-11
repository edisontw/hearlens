# HearLens M03 Part G handoff — 2026-10-11

Latest main must always be fetched from GitHub before future work. Initial base: `91d1311c8da301b6fcd4e94d6e9b26d1bd9c2529`.

M03 Part G adds `packages/dsp/offline-wdrc.chunked.mjs` and `packages/dsp/offline-wdrc.chunked.test.mjs`: offline-only replay-based chunk adapter with one-FFT-window prefix holdback, exact Float32 reference equivalence, validation/atomic updates, final flush and strong clipping regression. Read `docs/M03_CHUNKED_STATE.md` before modifying it.

It is **not** a streaming audio implementation suitable for live hearing. Each chunk recomputes all accumulated frames, up to 65536 PCM samples; it has no bounded-memory sustained stream, device routes or headphone output. Do not call measured processing throughput acoustic latency.

Next M03 Part H should replace the replay adapter with a truly persistent streaming STFT/WOLA state engine and compare against reference; ensure gain envelope continuity, bounded FIFO, watchdog/no-bypass final limiter and restart fail-closed. M01 captions continue unchanged, 24-run formal test remains deferred. No HTC/iPhone retest needed now.
