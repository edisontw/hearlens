# M03 Part G — Offline chunked-state equivalence gate

**Research-only, offline synthetic PCM.** The new `createOfflineChunkedWDRC` adapter tests incremental source acceptance, stable-prefix output and final flushing against the current full-clip reference renderer. It does **not** implement a real-time incremental STFT engine.

It re-renders the **entire cumulative synthetic clip on every push** and holds back 1024 output samples (one FFT window), emitting only a prefix that cannot change when new chunks arrive. `finish()` emits the remaining samples exactly once. This gives deterministic, bit-for-bit Float32 equivalence for all tested partitions but is **quadratic-cost** and restricted to a maximum cumulative 65,536 samples; it is not suitable for continuous background hearing or a live audio callback.

The adapter validates its DSP configuration before use, refuses non-Float32, empty, non-finite or excessive chunks, prevents partial state mutation on validation errors, never mutates caller PCM and cannot be reused after finalization. All audio remains in memory; no playback, browser, microphone, headset or network API exists.

Run `npm test`. Gate fixtures compare multiple irregular, single-block and 256-sample chunk schedules with hard/smooth, left/right settings, silence, short clips, adversarial loud samples and final limiter. The output must exactly equal `renderOfflineWDRC()` for the same complete source. This demonstrates a **reference equivalence model**, not a production stream scheduler, real-time delay, calibrated output SPL, MPO or medical safety certification.

**Next:** implement a genuinely bounded-memory stateful STFT/WOLA processor with persistent gain envelopes, causally scheduled 1024/256 buffering, frame-boundary noise/artifact diagnostics, underrun/reset handling and physical route fail-closed requirements before contemplating live hearing output. The M01 STT caption pipeline is unchanged.
