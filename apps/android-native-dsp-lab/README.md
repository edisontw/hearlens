# HearLens Native DSP Lab (research only)

This small Kotlin/JNI/C++17 app runs the detached stereo Auto-FIR and generation-bound `NativeSession` against synthetic PCM. It contains no microphone, route, Bluetooth, speaker or audio-output API. It has no Android permissions. Native results are metadata or in-memory test bytes; nothing is played or written to an audio device.

The app is a research harness, not a hearing aid or product APK. M04 AIR31/A2DP real hearing remains **BLOCKED**. A digital limiter and emulator results do not establish SPL, MPO, acoustic latency, device routing or a physical mute.

## Build

Use JDK 17, Android SDK Platform 35, Build Tools 35.0.0, Android NDK 27.2.12479018, CMake 3.22.1 and the checked-in Gradle 8.9 Wrapper. From PowerShell at the repository root:

```powershell
.\scripts\android\Setup-AndroidEnvironment.ps1 -PersistUserEnvironment
.\scripts\android\New-HearLensAvd.ps1
.\scripts\android\Test-AndroidLab.ps1
```

On a new machine that still needs Android SDK license acceptance, add `-AcceptLicenses` to the setup command.

The test command creates the portable fixture from `research/detached-native-fir/auto-check.mjs`, builds separate x86_64 and arm64-v8a debug APKs, installs only the x86_64 APK on the dedicated API 29 AOSP emulator, runs instrumentation and headless ELF checks, verifies the result with `verify-portable-output.mjs`, and stops only its own emulator serial if it started it. Use `-KeepEmulator` to leave that emulator running.

The standalone Windows NDK cross-build is:

```powershell
.\research\detached-native-fir\build-android.ps1
```

All SDK, NDK, AVD, Gradle cache, fixture, APK and report files stay under `D:\Dev\Android`; generated binaries are not tracked in Git.

For the installed host paths, pinned SDK packages, emulator setup and day-to-day commands, see the [Windows environment guide](../../docs/ANDROID_NATIVE_DSP_LAB_WINDOWS.md).

## Test coverage

- JNI loads on the API 29 x86_64 emulator and passes the same portable protocol, threshold, PCM parity, control update, limiter diagnostic, reset/fail-stop and fixture-hash checks against the JavaScript Auto-FIR oracle. JNI marks its allocation-probe field unavailable because the app build does not override process-wide `operator new`; allocation measurement is performed only by the headless executable and sanitizer runs.
- Native session checks cover explicit start, generation invalidation, route metadata change, fault/overrun, queue overflow, two in-flight invalidations and 2,000 concurrent invalidations.
- Instrumentation covers no requested permissions, JNI fixture parity, session fault matrix, NaN/Inf fail-stop, invalid buffer handling, reset without reauthorization, activity recreation, background invalidation and no automatic resume.
- ADB smoke checks exercise app process termination and relaunch.
- `Test-AndroidLab.ps1` also builds and runs the existing Auto-FIR and Native session C++ checks with Android NDK AddressSanitizer and UndefinedBehaviorSanitizer. Leak checks are disabled because Android's shell runtime does not support the host leak-sanitizer flow. UBSan `vptr` is excluded because NDK libc++ reports an invalid virtual-base cast from its own `ostreambuf_iterator` implementation; all other enabled address and undefined-behavior checks remain active. ThreadSanitizer is **NOT RUN** on the Android runtime.
- `arm64-v8a` is built and packaged separately. The API 29-targeted Native Auto-FIR and Native-session ELFs have passed portable JavaScript oracle parity and session regression on the physical Moto g62 5G / Android 13 API 33 (`arm64-v8a`); see the [physical ARM64 runtime report](../../docs/ANDROID_ARM64_RUNTIME_SMOKE_2026-11-25.md). This is headless synthetic runtime evidence, not an Android audio callback test.
- The separate [`android-aaudio-callback-lab`](../android-aaudio-callback-lab/README.md) opens an output-only zero stream only on the isolated audio-disabled API 29 x86_64 emulator. It does not add audio APIs or permissions to this DSP Lab. Physical ARM64 AAudio callback behavior remains **NOT RUN** pending owner authorization and separate review.

Every automation command pins `emulator-5580` and verifies that the device is the HearLens AVD. It does not operate on any other ADB device.
