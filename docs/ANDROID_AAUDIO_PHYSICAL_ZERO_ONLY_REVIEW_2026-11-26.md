# Moto g62 zero-only AAudio test — owner review package

**Status: PREPARED, NOT APPROVED, NOT RUN.** This document does not authorize an AAudio stream. The emulator-only callback lab still rejects physical devices in native code, Android instrumentation, and the fixed-serial PowerShell runner. Do not remove those checks to perform a phone test.

## Proposed bounded test

Target only the already identified Moto g62 5G: model `Moto g62 5G`, Android 13 / API 33, `arm64-v8a`, ADB serial `ZY22FWGQTB`. The physical-device test must be a separate zero-only research build and runner. It must not reuse an emulator bypass flag or mutate the existing emulator runner's serial.

1. Before installation, verify `adb -s ZY22FWGQTB get-state`, model, API, ABI, exact APK SHA-256 and that no other target serial can be selected by the invocation. Every ADB command must include `-s ZY22FWGQTB`.
2. The app declares no permissions. It must not use microphone capture, `AudioRecord`, Bluetooth APIs, network, or production Web caption code. It may use output-only AAudio and read-only `AudioManager` capability diagnostics.
3. Run a zero-only output callback first, then (only if separately included in the approved APK and signed test record) a synthetic NativeSession workload whose PCM scratch is private and discarded. For every callback, clear the entire provided output buffer to zero before validation or work. Never pass the output-buffer pointer to DSP or copy DSP scratch into it. Scan all output samples and stop/fail-stop if any sample is nonzero.
4. Do not auto-select Bluetooth or request a Bluetooth route. Record AAudio device ID and Android output-device type using platform audio-device metadata only; refuse to start if the route is Bluetooth, wired/unrecognized, or cannot be identified as the owner-approved built-in route. Do not call a Bluetooth API to make this decision.
5. Hard cap the session at 60 seconds, with an owner-approved shorter maximum if requested. Provide an explicit visible Stop action and external `am force-stop` recovery command. Stop on NaN/Inf, NativeSession failure, deadline overrun, callback overlap, stream error/disconnect, lifecycle/background invalidation, unexpected route, nonzero output, timeout or missing callback. Stop, drain callbacks, close the stream, then persist evidence outside the callback.
6. Capture requested and negotiated rate, performance/sharing modes, usage, frames per burst, buffer size/capacity, frame histogram, callback wall/thread-CPU/inter-arrival statistics, DSP misses versus complete-callback overruns, XRun count, fail-stop reason, stop/close/drain outcomes, logcat and audio diagnostics. Record APK, fixture, result and log SHA-256 in a fresh timestamped directory. Do not claim Android callback allocations are zero; report the source-level allocation audit and its blind spots.

This is a silent-output callback experiment, not listening, hearing assistance, a safety proof for any future nonzero output, or a release of the M04 gate. Do not wear headphones or connect the phone to AIR31/Bluetooth for this test. The synthetic DSP result must never reach any physical output path.

## Approval required before implementation is enabled on the phone

The owner must explicitly approve all of the following in the test record:

- Opening an output-only AAudio stream on the named Moto g62 (serial and device identity above), including routing it to the built-in output device for up to 60 seconds.
- Whether the run includes only ZERO_ONLY or also the full private-scratch NativeSession workload.
- The exact APK SHA-256, fixture SHA-256, test source commit, maximum duration and the stop/fail-stop behavior described above.
- Confirmation that this is a zero-sample callback research test and does not authorize microphone use, Bluetooth APIs/routes, audible playback, headphone listening, or live hearing output.

An independent reviewer must then record review of the isolated build, the zero-only output path, route refusal behavior, device-specific scope, timeout, stop/drain/close path, and evidence capture. The test runner must refuse to invoke the device until both owner authorization and independent review are recorded for the exact APK and serial. Neither approval has been granted by this preparation work.

## Current state

No physical APK was installed and no physical AAudio stream was opened during this task. The emulator matrix and its evidence are documented in [AAudio callback diagnostics](./ANDROID_AAUDIO_CALLBACK_DIAGNOSTICS_2026-11-26.md). M04 REAL HEARING remains **BLOCKED / DEFERRED**.
