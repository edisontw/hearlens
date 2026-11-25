# Native session and Web/Android integration

M04 AIR31/A2DP real hearing remains **BLOCKED**. The detached Native session accepts synthetic stereo PCM and returns candidate frame counts with a generation ticket. The scratch PCM is private and cleared in the callback. The session has no audio device or sink dependency.

## P2 session contract

- The existing [SW3 Bluetooth model](./SW3_BLUETOOTH_OUTPUT_FAIL_CLOSED_MODEL_2026-10-13.md) owns synthetic route and start policy. The [M03L seam](./M03L_CALLBACK_PORT_MODEL.md) remains a wired-only offline model. NativeSession receives a fresh accepted route stamp from the synthetic caller. The stamp binds route and profile identity; use zero when observation is missing, stale or rejected. The stamp stays stable only within a single accepted route/profile generation.
- A muted generation requires a matching explicit synthetic start. Stop, reset, profile changes and settings changes advance the generation. Route loss, route change, interruption and queue overflow invalidate the affected ticket. Stop independent of ticket identity when the source of a safety-critical control event cannot be attributed to a generation. A stale callback or delayed ticket-scoped failure cannot revoke a newer session.
- One callback owns the mutable stereo Auto-FIR state. Callback overlap fails closed and revokes the incoming active generation. This seam has no internal queue. An upstream queue must revoke its ticket on overflow and discard any buffered data tagged with a retired ticket.
- Input shape, finite PCM and DSP faults, mismatched route stamps and deadline misses reject the entire stereo block. The existing Auto-FIR wrapper handles both ears as one unit. Each generation resets both processors before accepting frames. Settings are immutable for an instance. Retire it, drain callbacks, discard its tickets and create a replacement when DSP parameters change. The caller must keep each instance alive until its users have drained.
- The final generation check is the candidate metadata commit point. Invalidation before that point prevents a candidate. Invalidation after that point revokes existing candidates. Check `isCurrent` when consuming metadata. A future physical sink would need its own indivisible authorization and output boundary. An atomic software load cannot quiet hardware or retract samples already queued elsewhere.
- Deadlines use a single caller-supplied absolute steady-clock point. Synthetic tests inject the clock to prove post-processing deadline failure and pause before the final generation check for stop/restart and contention. Callback timing on Android remains a separate evidence requirement.

Run locally with no devices:

```sh
make -C research/detached-native-fir session-check session-sanitize-check
make -C research/detached-native-fir session-tsan-check
node --test tools/m04-output-safety-gate.test.mjs
```

## P4 integration decision

Keep the Web path caption-first with Gemini Live as the default. Web remains suitable for captions, profile authoring and offline DSP reference fixtures. Its browser route and latency hints cannot establish a protected hearing path.

Keep the C++17 stereo Auto-FIR, generated JS oracle, portable fixtures and session gate in detached Native research. A future Android harness can reuse the exact N04 headless ELF and oracle to test runtime numerical parity when an authorized isolated runtime exists. Target-device integration would place lifecycle and trusted route observation on the Android control plane, pass a generation-bound snapshot into the Native processor and propagate fail-stop back to the control plane. Device ownership, callback/clock contracts and independently verifiable containment of queued output require separate acceptance before any physical sink extension.

Autonomous work is limited to harness and parity runs in isolated runtimes, synthetic PCM, metadata, fault injection and offline artifact checks. Target Android callback traces, input SPL, per-ear acoustic output and MPO, actual Bluetooth routing and hard mute, acoustic latency, and direct/delayed coexistence require separate physical evidence. The [M04-D2 manifest](./M04D2_PHYSICAL_OUTPUT_EVIDENCE_GATE_2026-10-16.md) defines the evidence and artifact contract. Completing it leads to independent review only. No owner measurement is requested now.

## Android research harness

[`apps/android-native-dsp-lab`](../apps/android-native-dsp-lab/README.md) is the isolated Kotlin/JNI/C++17 integration. Its JNI portable-fixture entry point invokes the existing `auto_check.cpp` parser and `StereoAutoFirResearch`; the Android build disables only the host executable's global allocation-operator overrides so the JNI library cannot replace allocation behavior for the whole app process. JNI marks its allocation protocol field unavailable rather than claiming a zero; the standalone headless executable retains the canonical allocation probe. Native DSP sources and the JavaScript oracle remain shared with the existing headless checks.

The app has no declared permissions and no audio device APIs. Activity pause invalidates its synthetic session; activity recreation retains the Native owner but requires an explicit new start. Instrumentation runs the canonical portable fixture and Native fault matrix. On Windows, `scripts/android/Test-AndroidLab.ps1` runs the x86_64 headless executable on the dedicated API 29 AOSP emulator, while `scripts/android/Test-AndroidPhysicalArm64.ps1` runs the API 29-targeted `arm64-v8a` headless ELFs and research instrumentation on the explicitly selected Moto g62 5G / Android 13 API 33 physical device. This proves headless Android ARM64 runtime parity on that device, not an API 29 ARM64 guest or Android audio-callback behavior. No audio route is opened; actual physical hearing remains blocked.
