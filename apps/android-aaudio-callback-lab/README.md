# HearLens Android AAudio callback lab

This is a separate, debug-only research APK for Android's real AAudio output callback. It does not modify `android-native-dsp-lab`, whose no-audio/no-permissions contract remains intact. It records requested and negotiated sample rate, sharing mode, usage, performance mode, buffer size and capacity. Requests for exclusive sharing or low latency are experimental; the report states whether Android granted them. It does not request microphone, Bluetooth, or audio-settings permissions.

The portable synthetic fixture is parsed before stream start. Two workloads are available: `ZERO_ONLY` clears the output and skips NativeSession, while `NATIVE_SESSION` processes the fixture through the existing C++ Auto-FIR/NativeSession in private preallocated memory and discards the result. At callback entry the system output buffer is filled with zero, and DSP never receives its pointer. The test APK can scan each output buffer and verify every sample is zero. It does not capture microphone input, query or select Bluetooth routes, or play nonzero audio.

The AAudio callback accepts its actual variable `numFrames`; it does not ask the builder to pin callback frame size. It contains no file I/O, JNI/UI calls, blocking mutexes, sleeps, or explicit allocation. Metrics buffers are allocated before opening the stream. Android's AAudio/Bionic internal allocations are not observable by this harness, so the report labels allocation monitoring as a callback source-path audit rather than a measured zero-allocation result.

The report distinguishes NativeSession DSP deadline failures from complete-callback overruns and platform XRun counts. Each overrun record includes callback frames, its two time budgets, and control-update counts. XRun counter changes are timestamped from control-thread snapshots every 5 ms; AAudio provides a cumulative count rather than per-event timestamps. The report also includes callback frame histogram, wall/thread-CPU time percentiles, inter-arrival jitter, buffer capacity, AudioManager's output-rate properties, zero verification, and stop/restart/fault-injection outcomes. If the system-native negotiated rate differs from the 48 kHz fixture, DSP is skipped and the run is explicitly ineligible as a DSP benchmark.

## Windows reproduction

From the repository root in PowerShell:

```powershell
# Builds x86_64 and ARM64 APKs, then runs only on emulator-5580.
.\scripts\android\Test-AndroidAAudioCallbackLab.ps1

# Baseline zero-only / NativeSession A/B plus four one-factor short comparisons.
# Runs at most one five-minute case, only if a candidate meets the recorded criteria.
.\scripts\android\Test-AndroidAAudioCallbackLab.ps1 -DiagnosticMatrix
```

The script verifies the dedicated `HearLens_API29_x86_64` AVD, API 29, x86_64 ABI, and disabled audio input/output. Every device operation uses the explicit `emulator-5580` serial; it never installs or starts the stream on an attached phone. Instrumentation refuses non-emulators and emits `NOT_RUN` if AAudio starts without delivering data callbacks; no timer thread substitutes for an AAudio callback.

The diagnostic matrix first performs a scanned zero-output smoke, then runs zero-only and NativeSession workloads with the same baseline stream configuration. It changes one setting at a time: unspecified/system-native sample rate, exclusive sharing, GAME usage, or a two-burst buffer. Defaults are 20 seconds for A/B and 10 seconds per variant; these can be adjusted with `-BaselineDurationMs` and `-VariantDurationMs`. Performance runs skip the sample scan after the scanned smoke to avoid charging its instrumentation overhead to the callback. With scanning disabled, zero counters mean “not scanned,” not a measured zero-sample count.

The matrix selects no more than one five-minute run. A variant must complete, retain fixture-compatible DSP rate, achieve requested LOW_LATENCY/sharing/usage, have zero DSP deadline failures, and show fewer XRuns or callback overruns or at least 20% lower wall P99 without more XRuns. If no candidate meets those conditions, no five-minute run is started. A five-minute run still uses AAudio's observed callback sizes; “128-frame equivalent” is only an elapsed-time reference. Any fail-stop remains an incomplete run, never a pass.

The 2026-11-26 bounded matrix did not qualify a long run. Its 20-second zero-only/NativeSession A/B had no XRuns or misses; a separate 10-second 44.1 kHz system-rate run skipped the 48 kHz DSP fixture and recorded one XRun. The cause of the earlier five-minute-equivalent fail-stop remains undetermined, so emulator tuning stops at this matrix. See [the complete findings and artifact hashes](../../docs/ANDROID_AAUDIO_CALLBACK_DIAGNOSTICS_2026-11-26.md).

Historical baseline: the first five-minute-equivalent emulator run stopped at 273.214 seconds after one callback exceeded its 20 ms negotiated-burst deadline. It recorded 20,480 callbacks, one DSP deadline failure, 83 platform XRuns, and actual performance mode `NONE` (request `LOW_LATENCY`). Wall P50/P95/P99/max was 4.017/5.556/5.968/25.878 ms. This was an early fail-stop, not a completed five-minute benchmark or physical-device performance result. Its extracted record remains at `D:\Dev\Android\test-results\hearlens\aaudio-callback\aaudio-callback-5min-partial-report.json`.

Each script invocation creates a timestamped directory under `D:\Dev\Android\test-results\hearlens\aaudio-callback\`. Each scenario keeps its requested config, full instrumentation log, full and filtered logcat, AudioFlinger/AudioPolicy dumps, complete JSON pulled from app-private storage after stream teardown, and a SHA-256 manifest. Later runs do not overwrite earlier evidence. The existing AAudio lab continues to run only on the audio-disabled x86_64 API 29 emulator; these measurements do not characterize physical-device audio performance.

## Device authorization boundary

The automation is intentionally emulator-only. Do not install or invoke this harness on the Moto g62 or another physical device until the owner separately authorizes a zero-only stream and the independent safety review is recorded. The [Moto g62 owner-review package](../../docs/ANDROID_AAUDIO_PHYSICAL_ZERO_ONLY_REVIEW_2026-11-26.md) defines the proposed bounded test and required approvals; it is not an authorization. Physical AAudio timing, actual route state, and all M04 real-hearing gates remain unverified; M04 remains **BLOCKED / DEFERRED**.
