# M03 Part K — callback memory probe and physical output safety architecture

**Status: isolated synthetic research prototype only. Absolutely no real-ear playback, Web Audio routing, validated hardware mute or calibrated acoustic MPO.** See [SAFETY.md](./SAFETY.md).

## A. What this slice actually changes

- `createOfflineStatefulWDRC(config).processInto(inputFloat32, outputFloat32)` operates synchronously on a **caller-owned, reusable** destination and returns the number of written samples (a number, not a returned PCM array). `requiredOutputSamples(nextInputLength)` preflights the exact destination capacity. An STFT hop may release 256 samples even for a 1-sample input: never assume output length equals input length.
- Destination aliasing with source is rejected even for different views of the same ArrayBuffer. An undersized/wrong destination or invalid PCM faults before accepting input or writing output. Explicit `reset()` is required.
- The validated per-ear 50/65/80 dB SPL **synthetic** gain anchors are cached once per instance. Interpolation follows the same arithmetic order as `targetGainAtInput()`, but avoids repeated profile normalization and returned query objects inside every frame. All current modes, rates and both ears must maintain **exact Float32 parity** with `renderOfflineWDRC()`.
- Legacy `push()` / `finish()` stay available. `processInto()` is *not* wrapped by `createOfflineTimedWDRC()`, and has no timestamps/clock guard. It is deliberately not connected to real devices.
- The implementation does not construct a `result=[]` or `Float32Array.from(result)` during `processInto`. This is **not a proof of zero JS/VM allocation**, worst-case pause, bounded CPU, or AudioWorklet readiness; other code (including FFT implementation) may allocate or trigger GC.

## B. Bench procedure, not a gate

Run `npm test` for exact numerical regression. Run `npm run benchmark:callback` for a non-gating Node synthetic comparison of `push()` versus `processInto()`; optional `node tools/benchmark-offline-callback.mjs [seconds 1–12] [sampleRate 16000|24000|48000]`.

Record Node/version/OS, callback-shaped 256-sample input cadence, P50/P95/max processing time, observed heap before/after/high snapshot, total sample parity and no faults. Repeat with `node --expose-gc` for optional GC observations; do **not** claim heap differences are bytes allocated per callback. CPU, event-loop, GC and output latency must later be measured on chosen **actual target phone**, separately for 16/24/48 kHz and left/right (including 2-channel), with sustained operation, thermal and screen-lifecycle changes. No audio output and no phone STT re-test are needed for this isolated change.

## C. Required adapter layers (NOT implemented)

A safe research hearing path cannot treat `offline-route-safety`'s `syntheticOutputAuthorized` as an output-control signal. It is fixture metadata.

```text
Input capture (clock + underrun monitoring)
 → per-ear validated DSP / controlled gain
 → LAST independent per-ear calibrated peak/MPO protection
 → native fail-closed route/sink gate (physical silence when uncertain)
 → explicitly selected and verified wired USB headset
```

**Native route adapter contract:** isolated policy layer should ingest OS-observed physical device identity, actual routed sink, stable sample rate, fixed output volume, audio focus/interruption state, and *verified* calibration/profile/device binding. Unknown/headset-unplugged/speaker/Bluetooth/other route, background interruption, DSP failure, clock error or any stale calibration MUST cause physical output silence **before** audio could reach an unapproved sink. Preventing speaker fallback cannot rely solely on a delayed JS route event or setting a preferred output device. Do not auto-resume on reconnect; require revalidation, explicit user start and a fresh zero-to-gain ramp. Captions may continue. Fail-safe **must be proven physically on the chosen OS/hardware**, including unplug during active output, instead of assumed from platform API names.

**Calibration/MPO contract (each ear independently):** immutable binding of exact phone model/OS build, wired USB-C DAC/headphone/headset ID, output volume/route/sample rate, channel map, coupler/measurement fixture, calibration timestamp and methodology, measured level-vs-digital-input across frequency and representative signals, and a justified maximum permissible ear-level output. Measured (not inferred) left/right worst-case levels, transients, distortion and tolerance must determine *per-ear* final-stage maximum output limits. `limiterCeiling` in the current DSP is only a digital full-scale ceiling, **not** ear-level dB SPL, REAR, REIG or a validated MPO. Do not invent a universal dB SPL threshold or treat mock IDs as proof.

The independently enforceable per-ear final limiting stage must be **after all** DSP gain, crossfade, mixing and any other filters, with no bypass path; on missing calibration/limiter, neither channel may output. Stereo channel mapping must be physically verified to avoid swapped ears and crosstalk. Faults must revoke actual output, not just a future callback flag.

## D. Research exit gates — remain OPEN

| Gate | Evidence needed | Current |
|---|---|---|
| Isolated numerical callback | Exact offline Float32 parity, reuse/no-overwrite, fault/reset | Unit test implementation in Part K |
| No-alloc realtime callback | Static hot-path audit, allocation/GC & worst-case scheduling on target device | **Not established** |
| Physical wired route and no speaker fallback | OS/native routing, headset unplug and route-switch physical audio measurement | **Not implemented** |
| Hardware-enforced silence / stop latency | Verified scope/coupler trace and tested route-loss-to-silence bound | **Not implemented** |
| Per-ear measured MPO | Calibration record, independent L/R post-processing limiter and acoustic coupler sweep | **Not implemented** |
| Full hearing path | Real latency, glitch, thermal, phone lifecycle, clinical safeguards | **Blocked** |

### Follow-up technical split

**M03L:** pure adapter interface/negative-route fixtures and callback clock integration without playback; produce evidence that output cannot be released without verified hardware gate. **M04 native hardware research:** choose one Android phone + one fixed wired USB-C headset, implement mute/route and record acoustic measurement evidence before enabling actual amplified hearing output. Prefer native for critical route enforcement; browser Web Audio alone is not treated as a physical speaker fallback safety boundary.

M01 captions, Gemini broker, Pages deployment and M01 formal benchmark schedule remain unchanged.
