# Physical zero-only AAudio research lab

This is a separate ARM64-only research APK for one bounded Moto g62 callback experiment. Its native library contains no Auto-FIR, NativeSession, PCM fixture, microphone capture or Bluetooth API. It requests one Android built-in speaker device ID, verifies AAudio negotiated that same ID before starting, writes zero to every sample in each callback buffer, and scans the complete buffer for nonzero values.

The existing [AAudio callback lab](../android-aaudio-callback-lab/README.md) stays emulator-only. This module does not remove or bypass any of its physical-device checks. The physical runner is a separate script that requires an exact owner authorization record and a passing independent safety review record for the same APK SHA-256, source commit and device serial. The APK build alone never installs the app or opens a stream.

## Scope and stop behavior

- The only workload is `ZERO_ONLY`; this APK does not link the DSP implementation.
- The stream is output-only, stereo `PCM_FLOAT`, system-native sample rate, `MEDIA`, `SHARED`, and requests `LOW_LATENCY`. The report records negotiated values; no mode is assumed achieved.
- The app shows a visible Start control and a visible Stop control. It starts no stream on launch. The stream has a native 60-second hard cap.
- The app refuses to start if any external audio output device is present. It pins AAudio to the exact built-in speaker ID from `AudioManager` metadata and refuses to start if AAudio reports a different ID. It stops on route disappearance, leaving the foreground, a stream error, any callback deadline overrun, an XRun, callback overlap, invalid callback data, nonzero sample observation or metric capacity exhaustion.
- Normal teardown requests stop, waits up to one second for a terminal stream state and zero in-flight callbacks, closes the stream, then persists JSON from the app process. The callback itself does no file I/O, JNI, logging, locking or dynamic allocation.
- ADB recovery after a stuck app: `adb -s ZY22FWGQTB shell am force-stop org.hearlens.physicalzero`.

This experiment is not a listening test, hearing assistance, or evidence that any nonzero output is safe. Keep headphones and AIR31/Bluetooth disconnected. The callback sends only digital zero to the selected built-in speaker route; startup/shutdown acoustic transients are not measured or certified by this experiment. M04 REAL HEARING remains **BLOCKED / DEFERRED**.

## Build and host test

From a Windows checkout with the configured Android SDK/NDK:

```powershell
.\scripts\android\Test-PhysicalZeroOutputCore.ps1
.\scripts\android\Build-PhysicalZeroAAudioLab.ps1
```

The Windows build writes a unique directory under `D:\Dev\Android\test-results\hearlens\physical-zero-callback\`, including the ARM64 APK, complete Gradle log, permission inspection, build metadata, source-file hashes and APK SHA-256. It performs no ADB installation and opens no audio stream. The Android AAudio GitHub workflow also builds and publishes the permissionless ARM64 APK plus matching build metadata as `hearlens-physical-zero-aaudio-arm64-apk`; use that exact artifact for independent review and, later, the physical runner.

## Physical run gate

First review the exact APK and source commit. Fill owner and independent reviewer JSON records based on the schemas in [the physical zero-only review package](../../docs/ANDROID_AAUDIO_PHYSICAL_ZERO_ONLY_REVIEW_2026-11-26.md). The reviewer must be a person other than the owner and must record a PASS for the exact APK hash, source commit and `ZY22FWGQTB` device. The runner rejects placeholders, mismatched hashes, any different ADB serial, a non-Moto target, API/ABI mismatch, existing package installation, or any declared Android permission.

After both records exist, the exact invocation is:

```powershell
.\scripts\android\Test-AndroidPhysicalZeroAAudioLab.ps1 `
  -Serial ZY22FWGQTB `
  -ApkPath <reviewed-arm64-apk> `
  -ExpectedApkSha256 <reviewed-64-hex-sha256> `
  -BuildInfoPath <matching-build-info.json> `
  -OwnerAuthorizationRecord <owner-authorization.json> `
  -IndependentReviewRecord <independent-review.json>
```

The script uses `adb -s ZY22FWGQTB` for every device command, verifies the phone identity, installs only the reviewed permissionless package, opens the visible test screen, and activates its Start control only after the record gates pass. It then waits at most 75 seconds for a result, preserves logcat/audio diagnostics and all SHA-256 values in a fresh run directory, and force-stops the package on timeout or teardown. A nonzero output, route mismatch, XRun, callback overrun or unconfirmed stop is recorded as a failure, not a pass.

No physical AAudio stream has been started by building or testing this module. The exact APK hash and independent review are expected to change whenever the reviewed source changes; prior approval records cannot be reused for a new hash.
