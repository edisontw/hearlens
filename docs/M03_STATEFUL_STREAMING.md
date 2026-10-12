# M03 Part H — Persistent offline STFT/WOLA stream

**Research synthetic PCM ONLY. No device playback, acoustic output or clinical fitting.** The new `createOfflineStatefulWDRC` processes each FFT frame only once instead of re-rendering all historical audio on each push.

## Architecture

- STFT length 1024; hop 256; one 1024-sample input ring, one 1024-sample overlap-add accumulation ring, one 1024-sample normalization-weight ring and independent per-band gain envelopes (6–8).
- Accept finite mono Float32Array of 1–4096 samples per push. No cumulative input history is stored; long streams can exceed the old 65536-sample total-clip limit.
- The first frame begins at index -768 with zero-padded past. Frames process only after all real samples in the analysis window are available; an explicit final flush zero-pads missing future samples.
- Samples are finalized only when no unprocessed future frame can add to them. The final digital PCM ceiling runs AFTER all spectral gains and overlap-add.
- The approximate steady **algorithmic lookahead is 768 samples**: 48 ms at 16 kHz, 32 ms at 24 kHz or 16 ms at 48 kHz. At initial startup the first emitted 256 samples require 1024 received samples. These are not browser/device/earphone P50/P95 latency values.
- Configuration and normalized target profile are snapshotted. Wrong sample types, nonfinite input, excessive PCM or too-large chunks cause a **faulted fail-stop state** requiring explicit `reset()`. This prevents continued output of a compromised state; no external route mute is implemented.
- `finish()` drains with zero-padding once. `reset()` discards queued samples, gain envelopes and diagnostic counters.

## Validation

Run `npm test`. Tests compare **exact Float32 output sample-for-sample** with the original offline `renderOfflineWDRC` across irregular, 256-sample and single-block partitions, Hard and Smooth modes, independent ears, 16/24/48 kHz, silence, small tail, 98304-sample sustained input, limiter saturation, fault/reset and copied config.

## Limits / next stage

Persistent DSP state does **not** make the implementation a production audio callback. FFTs and result buffers still allocate per frame/chunk; no verified callback jitter, garbage-collector pause, CPU/energy, input clock drift, gaps/underrun concealment, start/reconnect ramp or hardware mute. Numerical ceiling is not measured ear SPL or maximum power output. No NAL-NL2/DSL clinical parity, acoustic calibration, headphone/speaker route protections, watchdog or actual hearing amplification. See `docs/SAFETY.md`.

Next M03 Part I: test timestamped missing chunks and fail-closed transitions, device-independent CPU/allocation bounds and well-defined recovery; M04 only after route/calibration safety gate. Leave M01 caption lab unchanged.

## M03 Part I — integrity guard

See [M03_TIMED_STREAM_GUARD.md](./M03_TIMED_STREAM_GUARD.md) for explicit sample-offset continuity, simulated capture-clock/underrun fail-stop rules and a non-gating Node throughput/heap probe. The gate does not mute physical headphone output; safe device routing remains unimplemented.

## Part J frame scratch reuse

The stateful processor now creates four numerical scratch Float64 arrays **once at construction** (real/imag FFT frames, per-band energy, per-band gains); before each frame it clears the real/imag/energy buffers. This avoids allocating those arrays every FFT frame and retains byte-exact Float32 equivalence with the authoritative whole-clip renderer on the covered tests. `diagnostics.reusableFrameScratchBuffers = 4` and `perFrameScratchBufferAllocations = 0` describe only these scratch arrays, **not** all allocations: per-push JavaScript result arrays and returned Float32Array, envelopes/lookup metadata and runtime overhead remain. It is not an allocation-free hard real-time callback.

Pure route state machine: [M03_ROUTE_MODEL.md](./M03_ROUTE_MODEL.md).
