# Moto g62 zero-only AAudio test — owner review package

**Status: SEPARATE ZERO-ONLY APK IMPLEMENTED; EXACT-APK AUTHORIZATION AND INDEPENDENT REVIEW REQUIRED; NOT RUN.** The owner replied to proceed with this task, but the test runner requires the approval record to bind the exact APK SHA-256, source commit and serial. That record and the independent review are not yet present. No physical APK has been installed and no physical AAudio stream has been opened. The emulator-only callback lab still rejects physical devices in native code, Android instrumentation and its fixed-serial PowerShell runner; those checks remain unchanged.

## Proposed bounded test

Target only the already identified Moto g62 5G: model `Moto g62 5G`, Android 13 / API 33, `arm64-v8a`, ADB serial `ZY22FWGQTB`. The physical-device test must be a separate zero-only research build and runner. It must not reuse an emulator bypass flag or mutate the existing emulator runner's serial.

1. Before installation, verify `adb -s ZY22FWGQTB get-state`, model, API, ABI, exact APK SHA-256 and that no other target serial can be selected by the invocation. Every ADB command must include `-s ZY22FWGQTB`.
2. The separate physical app declares no permissions and has no microphone capture, `AudioRecord`, Bluetooth APIs, network, production Web caption code, NativeSession, Auto-FIR or fixture. It uses output-only AAudio and read-only built-in speaker metadata from `AudioManager`.
3. This build supports only `ZERO_ONLY`. For every callback, it clears the full provided stereo output buffer to zero, scans every sample and fail-stops on invalid data or a nonzero sample. There is no DSP or synthetic PCM component in the APK.
4. Do not auto-select Bluetooth or request a Bluetooth route. The app refuses to start if any external output device appears in read-only `AudioManager` metadata. It requests the exact built-in speaker device ID, then verifies `AAudioStream_getDeviceId()` before starting. It refuses to start on any mismatch and stops if the selected built-in speaker disappears. It does not call a Bluetooth API.
5. The native session is hard capped at 60 seconds. The visible screen has Start and Stop controls; leaving the foreground requests stop, and `adb -s ZY22FWGQTB shell am force-stop org.hearlens.physicalzero` is the external recovery command. It stops on callback deadline overrun, callback overlap, invalid callback data, stream error/disconnect, unexpected route, nonzero output, XRun or metric capacity exhaustion. It requests stop, waits for terminal state and zero callbacks in flight, closes the stream, then persists evidence from the application thread.
6. The report captures requested and negotiated rate, format, route, performance/sharing modes, usage, frames per burst, buffer size/capacity, frame histogram, callback wall/thread-CPU/inter-arrival statistics, callback overruns, XRun count and observations, fail-stop reason, stop/close/drain outcomes, logcat and audio diagnostics. APK, result and log SHA-256 values are saved to a fresh timestamped directory. There is no fixture SHA because this zero-only APK contains no fixture. Runtime callback allocation monitoring is not claimed; the report gives a source-level audit and its limits.

This is a digital-zero callback experiment, not a listening test, hearing assistance, a safety proof for any future nonzero output, or a release of the M04 gate. Do not wear headphones or connect the phone to AIR31/Bluetooth for this test. The callback emits only zero-valued samples; startup/shutdown acoustic transients are not measured or certified.

## Authorization and independent review required before the phone runner can execute

The owner must explicitly approve all of the following in the test record:

- Opening an output-only AAudio stream on the named Moto g62 (serial and device identity above), including routing it to the built-in output device for up to 60 seconds.
- The exact APK SHA-256, test source commit, maximum duration and the stop/fail-stop behavior described above. This APK's only workload is ZERO_ONLY; no NativeSession workload can be selected.
- Confirmation that this is a zero-sample callback research test and does not authorize microphone use, Bluetooth APIs/routes, audible playback, headphone listening or live hearing output.

An independent reviewer must record review of the isolated build, zero-only output path, route refusal behavior, device-specific scope, permissionless manifest, timeout, visible/manual stop, background invalidation, callback path, stop/drain/close path and evidence capture. The reviewer must be a person other than the owner. `Test-AndroidPhysicalZeroAAudioLab.ps1` refuses to install or start the app until both records match the exact APK SHA-256, source commit and serial. A user response to prepare/authorize the test does not create this exact-hash record automatically.

The records stay in the local evidence directory and should not be committed with the app. Use these field shapes after reviewing the final APK:

```json
{
  "owner": "owner identity",
  "approved": true,
  "approvedAtUtc": "ISO-8601 UTC timestamp",
  "authorizationText": "I approve the zero-only, built-in-speaker AAudio callback test on Moto g62 serial ZY22FWGQTB for at most 60 seconds using this exact APK SHA-256 and source commit.",
  "deviceSerial": "ZY22FWGQTB",
  "model": "Moto g62 5G",
  "api": 33,
  "abi": "arm64-v8a",
  "testMode": "ZERO_ONLY",
  "maxDurationSeconds": 60,
  "requestedRoute": "BUILTIN_SPEAKER_ONLY",
  "apkSha256": "64 lowercase hexadecimal characters",
  "sourceCommit": "40-character commit SHA",
  "allowMicrophone": false,
  "allowBluetooth": false,
  "allowAudiblePlayback": false,
  "allowDspOutput": false
}
```

```json
{
  "reviewer": "independent reviewer identity, different from owner",
  "reviewStatus": "PASS",
  "reviewedAtUtc": "ISO-8601 UTC timestamp",
  "reviewEvidence": "PR review URL or durable review record ID",
  "deviceSerial": "ZY22FWGQTB",
  "apkSha256": "same 64-character APK SHA-256",
  "sourceCommit": "same 40-character commit SHA",
  "reviewedAreas": [
    "isolated_arm64_build",
    "permissionless_manifest",
    "zero_output_callback",
    "builtin_speaker_route_refusal",
    "fixed_device_scope",
    "hard_duration_cap",
    "visible_stop_and_background_stop",
    "callback_allocation_audit",
    "stop_drain_close",
    "evidence_capture"
  ]
}
```

The current chat response is recorded as approval to prepare/continue this work. Before a phone stream can run, the owner still needs to approve the final exact APK SHA-256 and source commit using the first record; the independent review must also PASS for those same values.

## Current state

The separate ARM64 APK and hash-gated runner are implemented. The build artifact is stored outside the repository under `D:\Dev\Android\test-results\hearlens\physical-zero-callback\`; no physical APK was installed and no physical AAudio stream was opened. The emulator matrix and its evidence are documented in [AAudio callback diagnostics](./ANDROID_AAUDIO_CALLBACK_DIAGNOSTICS_2026-11-26.md). M04 REAL HEARING remains **BLOCKED / DEFERRED**.
