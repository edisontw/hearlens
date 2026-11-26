# Physical zero-only AAudio research lab

This is a separate ARM64-only research APK for one bounded Moto g62 callback experiment. Its native library contains no Auto-FIR, NativeSession, PCM fixture, microphone capture or Bluetooth API. The route policy requires `MODE_NORMAL`, a successful API 33 `USAGE_MEDIA` predicted route containing exactly the same single built-in speaker ID selected from the output inventory, and no unknown or external sink. The inventory may identify `TYPE_TELEPHONY` as a system communication endpoint, but it can never be the predicted route or AAudio target. AAudio is pinned to the speaker ID and the control thread checks the reported ID before start and during the run. The callback writes zero to every sample and scans the complete buffer for nonzero values.

The existing [AAudio callback lab](../android-aaudio-callback-lab/README.md) stays emulator-only. This module does not remove or bypass any of its physical-device checks. The physical runner is a separate script that requires an exact owner authorization record and a passing independent safety review record for the same APK SHA-256, source commit and device serial. The APK build alone never installs the app or opens a stream.

## Scope and stop behavior

- The only workload is `ZERO_ONLY`; this APK does not link the DSP implementation.
- The stream is output-only, stereo `PCM_FLOAT`, system-native sample rate, `MEDIA`, `SHARED`, and requests `LOW_LATENCY`. The report records negotiated values; no mode is assumed achieved.
- The app shows a visible Start control and a visible Stop control. It starts no stream on launch. The stream has a native 60-second hard cap.
- Before start, the app reads `AudioManager.getMode()` on both sides of route queries and requires `MODE_NORMAL`. On API 33+, `getAudioDevicesForAttributes(USAGE_MEDIA)` must return exactly one `TYPE_BUILTIN_SPEAKER`, and that ID must match the sole inventory speaker. Empty, multiple, telephony, earpiece, external, unknown or failed predictions are refused. Inventory may contain a built-in earpiece and a system `TYPE_TELEPHONY` endpoint; telephony is inventory-only and never selected. Bluetooth, USB, wired, virtual, duplicate-ID and other output endpoints remain refused.
- During a run, an API 31+ audio-mode listener and a 100 ms control-thread poll watch mode, inventory and MEDIA prediction. Device changes, mode changes, query failures, unexpected snapshots and lifecycle invalidation request fail-stop; the Native control thread checks the route generation around open/start and polls `AAudioStream_getDeviceId()` every 5 ms. The callback does no route query or JNI call. Stop, drain and close outcomes and monotonic detection timestamps are recorded. The app never reopens automatically.
- These checks observe Android policy and the AAudio-reported ID. They do not guarantee the physical hardware route or exclude undocumented vendor behavior. AAudio's API 33 single-device ID observation cannot enumerate every possible actual route.
- Normal teardown requests stop, waits up to one second for a terminal stream state and zero in-flight callbacks, closes the stream, then persists JSON from the app process. The callback itself does no file I/O, JNI, logging, locking or dynamic allocation.
- ADB recovery after a stuck app: `adb -s ZY22FWGQTB shell am force-stop org.hearlens.physicalzero`.

This experiment is not a listening test, hearing assistance, or evidence that any nonzero output is safe. Keep headphones and AIR31/Bluetooth disconnected. The callback sends only digital zero to the selected built-in speaker route; startup/shutdown acoustic transients are not measured or certified by this experiment. M04 REAL HEARING remains **BLOCKED / DEFERRED**.

## Build and host test

From a Windows checkout with the configured Android SDK/NDK:

```powershell
.\scripts\android\Test-PhysicalZeroOutputCore.ps1
.\scripts\android\Build-PhysicalZeroAAudioLab.ps1
.\apps\android-native-dsp-lab\gradlew.bat --no-daemon `
  --project-dir .\apps\android-aaudio-physical-zero-lab `
  :app:testDebugUnitTest
```

The Windows build writes a unique directory under `D:\Dev\Android\test-results\hearlens\physical-zero-callback\`, including the ARM64 APK, complete Gradle log, permission inspection, build metadata, source-file hashes and APK SHA-256. It performs no ADB installation and opens no audio stream. The Android AAudio GitHub workflow also builds and publishes the permissionless ARM64 APK plus matching build metadata as `hearlens-physical-zero-aaudio-arm64-apk`; use that exact artifact for owner authorization and the physical runner.

## Physical run gate

Bind all records to the exact APK hash, source commit and `ZY22FWGQTB` device. The runner accepts either a PASS from an independent reviewer who is a person other than the owner, or an explicit owner review-waiver record for the same zero-only scope. The waiver is recorded as a waiver, never as an independent review. Both paths retain the device, permission, route, stop, duration and zero-output checks. The runner rejects placeholders, mismatched hashes, any different ADB serial, a non-Moto target, API/ABI mismatch, existing package installation, or any declared Android permission.

After the exact-APK owner authorization and either a matching independent review or matching owner waiver exist, the exact invocation is:

```powershell
.\scripts\android\Test-AndroidPhysicalZeroAAudioLab.ps1 `
  -Serial ZY22FWGQTB `
  -ApkPath <reviewed-arm64-apk> `
  -ExpectedApkSha256 <reviewed-64-hex-sha256> `
  -BuildInfoPath <matching-build-info.json> `
  -OwnerAuthorizationRecord <owner-authorization.json> `
  -OwnerReviewWaiverRecord <owner-review-waiver.json>
```

The script uses `adb -s ZY22FWGQTB` for every device command, verifies the phone identity, installs only the exact-hash permissionless package, opens the visible test screen, and activates its Start control only after the record gates pass. It then waits at most 75 seconds for a result, preserves logcat/audio diagnostics and all SHA-256 values in a fresh run directory, and force-stops the package on timeout or teardown. A nonzero output, route mismatch, XRun, callback overrun or unconfirmed stop is recorded as a failure, not a pass.

Building this module does not start a physical AAudio stream. The exact APK hash, owner authorization and review-or-waiver record are bound to the source commit and device; prior records cannot be reused for a different artifact.
