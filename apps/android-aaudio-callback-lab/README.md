# HearLens Android AAudio callback lab

This is a separate, debug-only research APK for Android's real AAudio output callback. It does not modify `android-native-dsp-lab`, whose no-audio/no-permissions contract remains intact. The callback requests a shared output stream, asks for low-latency mode, requests the fixture's 48 kHz rate, and records the values Android actually negotiated. It does not request microphone, Bluetooth, or audio-settings permissions.

The portable synthetic fixture is parsed before stream start. Its PCM feeds the existing C++ `NativeSession` and Auto-FIR in private preallocated memory. DSP candidate samples are discarded. At callback entry the system output buffer is filled with zero, and the DSP core never receives its pointer. The test APK can scan each output buffer and verify every sample is zero. It does not capture microphone input, query or select Bluetooth routes, or play nonzero audio.

The AAudio callback accepts its actual variable `numFrames`; it does not ask the builder to pin callback frame size. It contains no file I/O, JNI/UI calls, blocking mutexes, sleeps, or explicit allocation. Metrics buffers are allocated before opening the stream. Android's AAudio/Bionic internal allocations are not observable by this harness, so the report labels allocation monitoring as a callback source-path audit rather than a measured zero-allocation result.

The callback report includes negotiated rate, frames per burst, buffer size, actual performance/sharing modes, frame-count histogram, callback wall/thread-CPU time percentiles, inter-arrival jitter, deadline overruns, platform-reported XRun count, DSP fail-stop and overlap counts, sample-by-sample zero verification, and stop/restart/fault-injection outcome. DSP sample rate remains 48 kHz; the report explicitly identifies a negotiated rate mismatch.

## Windows reproduction

From the repository root in PowerShell:

```powershell
# Builds x86_64 and ARM64 APKs, then runs only on emulator-5580.
.\scripts\android\Test-AndroidAAudioCallbackLab.ps1

# Five-minute 128-frame-equivalent elapsed-time run; do a short zero-scan run first.
.\scripts\android\Test-AndroidAAudioCallbackLab.ps1 -DurationMs 300000 -SkipZeroScan
```

The script verifies the dedicated `HearLens_API29_x86_64` AVD, API 29, x86_64 ABI, and disabled audio input/output. It always passes `-s emulator-5580` to ADB. Instrumentation refuses non-emulators and emits `NOT_RUN` if AAudio starts without delivering data callbacks; no timer thread substitutes for an AAudio callback.

The five-minute case requests five minutes of actual Android callback time; 128 frames is an elapsed-time reference only. AAudio's negotiated callback frames and observed distribution determine the workload. A safety fail-stop can end the run early; the JSON then records `EARLY_FAIL_STOP` and marks `duration_complete` false. The sample-by-sample verification run includes an extra scan cost; use `-SkipZeroScan` for performance measurement after a verified short run. With scanning disabled, zero counters mean “not scanned,” not a measured zero-sample count.

The first five-minute-equivalent emulator run stopped at 273.214 seconds after one callback exceeded its 20 ms negotiated-burst deadline. It recorded 20,480 callbacks, one deadline miss, 83 platform XRuns, and actual performance mode `NONE` (the request was `LOW_LATENCY`). The callback wall P50/P95/P99/max was 4.017/5.556/5.968/25.878 ms. This is a recorded early fail-stop, not a completed five-minute benchmark or physical-device performance result. See `D:\Dev\Android\test-results\hearlens\aaudio-callback\aaudio-callback-5min-partial-report.json` for the captured metrics.

Artifacts are written under `D:\Dev\Android\test-results\hearlens\aaudio-callback\`, including fixture, APKs, instrumentation/logcat output, and JSON metrics. The initial validated run was on the audio-disabled x86_64 API 29 emulator; it is synthetic callback evidence only.

## Device authorization boundary

The automation is intentionally emulator-only. Do not install or invoke this harness on the Moto g62 or another physical device until the owner separately authorizes a zero-only stream and the independent safety review is recorded. Physical AAudio timing, actual route state, and all M04 real-hearing gates remain unverified; M04 remains **BLOCKED / DEFERRED**.
