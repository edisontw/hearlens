# M03 Part L — offline callback clock and mock route-port seam

**No hardware, no Web Audio, no microphone, no speaker, no earbud PCM, no physical mute, no acoustic output limits.** These are unit-test fixtures, not a clinical or production hearing path. Refer to [M03K_CALLBACK_ROUTE_ARCHITECTURE.md](./M03K_CALLBACK_ROUTE_ARCHITECTURE.md) and [SAFETY.md](./SAFETY.md).

## 1. Guarded preallocated PCM inside offline research

`packages/dsp/offline-wdrc.timed.mjs` now exposes:
- `requiredOutputSamples(chunkLength)`: preflights a caller-owned output Float32 destination size.
- `processInto(startSample, samples, destination)`: does not produce a new result array. It applies the existing monotonic sample epoch and gap/overlap guards before invoking the M03K `processInto`. On failure it scrubs the provided destination (if Float32), discards DSP pending state and requires an explicit `reset`.
- `observeCaptureClock(sampleClock)` remains a **synthetic caller-supplied** monotonic clock. A caller must invoke it consistently; no audio scheduling, real microphone timestamp or soundcard clock is detected here.

Legacy `push({startSample,samples})` and `finish()` are retained for offline verification; only this new `processInto` call is intended as a standalone callback-shape numerical fixture. No actual callback, playback path, AudioWorklet, native audio client or device ownership exists. Scrubbing a JS array is not a hardware mute and cannot retract previously copied audio.

## 2. Mock-only route port with no external sink

`packages/dsp/offline-callback-port.mjs` exports `createOfflineMockHearingPort(config)`. It privately holds a temporary DSP Float32 scratch buffer and returns **only synthetic metadata** (candidate sample count and mock ramp state). It exposes NO PCM getter, sink callback, real device handle, `finish`, browser output or output scheduling API. This deliberately prevents the *fixture itself* from serving as a sound-output implementation. It is not a security boundary against unrelated application code accessing other DSP modules.

Example fixture sequence:

```js
port.connect({kind:"wired-headphones",id:"mock-usbc-1"});
port.attestMockCalibration({
  routeId:"mock-usbc-1",calibrationId:"fixture-cal",
  profileId:"fixture-profile",syntheticOnly:true
});
port.arm({
  routeId:"mock-usbc-1",calibrationId:"fixture-cal",
  profileId:"fixture-profile",explicitUserStart:true
});
const metadata=port.process({
  startSample:0,samples:syntheticFloat32,clockSample:syntheticFloat32.length,
  observedRoute:{kind:"wired-headphones",id:"mock-usbc-1"},
});
// metadata has NO audio samples, and no sound can be emitted through this port.
```

This input sequence is a **mock model**, not a proof that a wired earbud exists. A real route adapter must verify hardware identity/actual sink, volume/sample rate, independent ear calibration and hardware-forced silence; none are implemented in this slice.

## 3. Fail-stop rules and negative fixtures

- Before mock route + calibration/profile + explicit user start, candidate processing is forbidden.
- Each input chunk requires a matching **caller-supplied** mock observed route. Speaker, route ID change or missing observation faults. Delayed/disappearing real OS device events are NOT addressed.
- Any timestamp gap/overlap, invalid PCM, invalid clock, simulated underrun, simulated disconnect or interruption latches a fault and clears queued DSP state.
- An offending process call does NOT commit candidate counts or return PCM. The private scratch buffer is zeroed; the mock authorization is revoked.
- No automatic reconnect. Explicit reset, fresh mock route attestation and new start are needed; ramp restarts at zero.
- Internal count/peak reports describe only synthetic processed candidates and are **not evidence of playback, safe digital gain, calibrated ear SPL or real routing**.
- Port instances model one ear independently; they do not provide real stereo mapping, final post-mix limiter, two-ear synchronization or independent physical MPO.

Run `npm test`: includes `offline-callback-port.test.mjs`. Matrix covers 16/24/48 kHz, two ears, hard/smooth exact Float32 reference parity in the guarded buffer API and model route failure/rearm scenarios.

## 4. Evidence status and next native research boundary

| Gate | Status |
|---|---|
| Offline guarded buffer/clock seam | Implemented; CI expected |
| Mock route invalid/speaker/disconnect/rearm | Implemented as offline fixtures |
| Measured callback allocation, GC, worst-case phone deadline | Not established |
| Trustworthy physical route observation and headset identity | Not implemented |
| Synchronous hardware silence and no speaker fallback | Not implemented |
| Acoustic coupler calibrated independent L/R MPO | Not implemented |
| Live amplification | **Blocked** |

**M03M/M04 hardware planning:** choose a specific Android version/phone, USB-C wired DAC/headset, fixed volume/channel map and acoustic test fixture. Define a native audio-sink hard mute capability and a physical unplug/speaker trace that can falsify no-fallback claims. Measure and validate each ear separately before adding any hearing output. For device triggers and platform boundaries see [WEB_NATIVE_DECISION.md](./WEB_NATIVE_DECISION.md).

M01 Gemini captions, STT diagnostics, Pages and formal M01 benchmark remain untouched. No HTC/iPhone STT re-test is justified solely for this offline change.
