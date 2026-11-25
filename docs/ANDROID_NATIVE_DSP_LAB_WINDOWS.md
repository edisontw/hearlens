# Windows Android Native DSP Lab

The Windows harness and research APK are isolated from the HearLens production audio path. They use synthetic PCM, metadata-only route simulation and an AOSP emulator with audio input/output disabled. M04 AIR31/A2DP real hearing remains **BLOCKED**; emulator results do not establish physical SPL, MPO, latency, routing or mute behavior.

## Installed D-drive environment

This setup uses the clean checkout at `D:\Dev\hearlens-android`; the existing `D:\Dev\hearlens` checkout contained user changes and was left untouched. SDK and test data are kept outside Git:

| Component | Location / pinned version |
| --- | --- |
| Android SDK | `D:\Dev\Android\sdk` |
| AVD and Android user data | `D:\Dev\Android\avd`, `D:\Dev\Android\user-home` |
| JDK | `D:\Dev\Android\jdk\17.0.21`, Temurin 17.0.21.1+2 |
| Gradle cache | `D:\Dev\Android\gradle-cache` |
| Results and APKs | `D:\Dev\Android\test-results\hearlens` |
| Android command-line tools | 22.0 |
| Platform tools / ADB | 37.0.3 |
| Emulator | 37.3.10 |
| Android SDK Platform / Build Tools | API 35 / 35.0.0 |
| Android NDK / CMake | 27.2.12479018 / 3.22.1 |
| Gradle / Android Gradle Plugin / Kotlin | 8.9 / 8.7.3 / 2.0.21 |
| Test image | API 29 AOSP default x86_64; no Play Store |

The host is Windows 11 x64 with Ryzen 5 7600X (12 logical processors), SVM enabled and 31.2 GiB RAM. `emulator -accel-check` reports WHPX installed and usable. The dedicated AVD `HearLens_API29_x86_64` uses 4 vCPU and 4096 MiB RAM, has both audio input and output disabled, and runs on fixed serial `emulator-5580`. The setup reported 387.3 GiB free on D: after installation and test builds. An elevated Windows feature query was unavailable, so the WHPX emulator acceleration check is the direct verification.

User-level environment values set by setup are `ANDROID_HOME`, `ANDROID_SDK_ROOT`, `ANDROID_AVD_HOME`, `ANDROID_USER_HOME`, `ANDROID_NDK_HOME`, `JAVA_HOME`, and `GRADLE_USER_HOME`. No SDK path, AVD data, local.properties, Gradle cache or generated binary is committed.

## Commands

From the repository root in PowerShell:

```powershell
# Inspect the pinned toolchain and WHPX acceleration.
.\scripts\android\Test-AndroidEnvironment.ps1

# First-time setup only. License acceptance is optional if already accepted.
.\scripts\android\Setup-AndroidEnvironment.ps1 -PersistUserEnvironment
.\scripts\android\New-HearLensAvd.ps1

# Build the canonical JS fixture, both APK ABIs and both headless ELF ABIs;
# run the dedicated emulator, instrumentation, parity, sanitizer and lifecycle checks.
.\scripts\android\Test-AndroidLab.ps1

# Explicit emulator lifecycle when working interactively.
.\scripts\android\Start-HearLensEmulator.ps1
.\scripts\android\Stop-HearLensEmulator.ps1

# Cross-build just the headless API 29 x86_64 and arm64-v8a executables.
.\research\detached-native-fir\build-android.ps1
```

`Test-AndroidLab.ps1` only addresses `emulator-5580`, verifies the expected AVD/API/ABI, and stops the emulator only when it started that instance. Pass `-KeepEmulator` to leave it running after a full test. It does not use a physical Android device or host microphone.

## Test scope and limits

- API 29 x86_64 Android emulator runtime: the existing C++17 Auto-FIR executable processes the canonical synthetic fixture. `verify-portable-output.mjs` checks the complete protocol and authoritative thresholds: 144,000 samples per ear, 300 control updates per ear, exact diagnostics and control indices, zero PCM error, limiter/reset/fail-stop behavior, SHA-256 and no authorized output route.
- Android instrumentation: five tests cover JNI loading, fixture parity, session lifecycle/fault handling, reset without reauthorization, activity recreation and background invalidation. The APK requests no permissions and includes no microphone or output API.
- C++ sanitizers: Android NDK AddressSanitizer and UndefinedBehaviorSanitizer run on the Auto-FIR and Native session executables. Leak detection is disabled for the shell runtime; UBSan `vptr` is excluded because NDK libc++ reports an internal `ostreambuf_iterator` virtual-base cast when using `std::cout`. Other ASan and UBSan checks remain enabled. ThreadSanitizer is not run on this Android runtime.
- `arm64-v8a`: the headless executable and app APK are cross-built and ABI-checked. No isolated Android ARM64 runtime was available, so ARM64 runtime correctness is **NOT RUN**.
- Physical phone performance, acoustic output, SPL/MPO, latency, Bluetooth routing and physical hard-mute evidence remain **NOT RUN**. M04 remains blocked.
