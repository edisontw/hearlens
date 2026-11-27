# Physical Android DSP shadow AAudio callback lab

This is a separate permissionless ARM64 research APK. It is derived from the exact route guard used by the physical ZERO_ONLY APK, while its callback executes the existing C++ Auto-FIR / NativeSession over the canonical 48 kHz synthetic fixture. DSP input and scratch output remain private to the process; the DSP result is discarded. The AAudio output buffer is initialized to digital zero before DSP processing and every valid output sample is scanned afterward. The only PCM data path to AAudio is the zero-fill operation.

The existing emulator-only callback APK remains unchanged and emulator-gated. This APK has its own package, native library, UI, artifact, exact-hash authorization gate and physical runner. Building or installing it does not start a stream. No microphone, Bluetooth API, external device, nonzero output or hearing function is included.

## Physical route and lifecycle guard

The APK reuses the ZERO_ONLY route policy: `MODE_NORMAL`; API 33 MEDIA prediction must select exactly the unique built-in speaker; telephony can appear only as inventory; the selected speaker ID and route generation are published to native before open/start. AAudio is pinned to that ID. The control plane checks mode, inventory and predicted route; the native control thread checks generation and `AAudioStream_getDeviceId()` before start and during the run. Mismatch, query failure, stream disconnect, backgrounding or stale generation fail-stops without reopening. These API observations do not prove a physical hardware route.

The negotiated sample rate must be exactly 48 kHz before start. Other rates close without starting and produce no valid DSP benchmark. Callback frame count is always taken from AAudio's actual `numFrames`; no fixed callback size is requested. The initial device run is hard-capped at 60 seconds.

## Callback measurements

Each callback record includes actual frames, monotonic start and elapsed time, callback wall time, AAudio callback-thread CPU time, NativeSession DSP processing wall time, DSP control-update counts, DSP deadline budget/failure, full callback budget/overrun, zero-sample count and inter-arrival interval/jitter. The report stores all callback records plus the largest inter-arrival event and its adjacent callback records. AAudio XRun counters are sampled on the control thread every 5 ms; this is the observation resolution because AAudio does not provide per-XRun timestamps.

The callback path uses preallocated buffers and record storage. Allocation claims are source-audited only; AAudio and Bionic internal allocations are not instrumented. This is synthetic headless DSP work inside a real AAudio callback. It is not an acoustic, hearing, SPL/MPO, physical-route or user-perceived latency test.

## Build and offline verification

From the Windows repository root, with the pinned Android environment initialized:

```powershell
node .\research\detached-native-fir\auto-check.mjs "--export-portable=D:\Dev\Android\test-results\hearlens\physical-dsp-shadow\portable-fixture"
.\scripts\android\Build-PhysicalDspShadowAAudioLab.ps1
node --test .\tools\physical-aaudio-dsp-shadow-contract.test.mjs
```

The build generates the canonical fixture, JS oracle and manifest into Gradle-generated assets, runs the route-policy unit tests, builds the ARM64 APK and instrumentation package, verifies permissions/ABI, and runs no ADB install or stream. The physical research APK uses an explicit `-O2` profile while preserving `-fno-fast-math` and `-ffp-contract=off`; CI archives the compiler database, verifies the effective flags, and records their hash. The offline instrumentation test compares Native Auto-FIR bytes to the unchanged JS-oracle tolerance and checks the NativeSession fault matrix without starting AAudio. For an additional local emulator-only verification, `-PtargetAbis=x86_64` builds an x86_64 test APK; the standard build and CI artifact remain ARM64-only.

`scripts/android/Test-AndroidN07NativeBenchmark.ps1` builds and compares explicit O0 and O2 profiles on an x86_64 AVD only. It checks the emulator property and ABI before installing either APK, and it refuses physical device serials. The JNI path calls the same `CallbackCore`, `NativeSession`, Auto-FIR and fixture synchronously without opening an AAudio stream. Its timings are callback-equivalent native/JNI processing measurements, not audio callback timing or ARM64 performance. The script writes timestamped APK, compile-command, instrumentation, fixture and JSON evidence under `D:\Dev\Android\test-results\hearlens\n07-first-callback\` and uninstalls both packages after the run.

## Physical validation gates

The runner requires the explicitly selected Moto g62 serial `ZY22FWGQTB`, the CI artifact ID, APK SHA-256, release archive SHA-256, exact source commit, owner authorization, and exactly one matching review record. That review record is either an independent review PASS or an explicit exact-scope owner waiver. A waiver is recorded as `OWNER_WAIVER_NO_INDEPENDENT_REVIEW`; it is never treated as independent review PASS. Exact JSON templates are in [`scripts/android/templates`](../../scripts/android/templates/). The first physical DSP-shadow run is limited to 60 seconds.

The first-run acceptance gate requires: output nonzero samples = 0; XRuns = 0; DSP deadline failures = 0; complete callback overruns = 0; route mismatch = 0; unexpected fail-stops = 0; NativeSession executed; negotiated rate = 48,000; all callbacks drained; AAudio stop and close succeeded; APK removed. If the 60-second run passes, the only next plan is one run of at most five minutes using the same frame/request configuration. The five-minute extension requires separate exact-artifact owner authorization before any stream is started; this release's runner never exceeds 60 seconds.

The physical runner does not run automatically from CI. The owner authorization must bind the exact artifact ID, APK hash, release archive hash and source commit before any device stream. See [the physical-zero lab](../android-aaudio-physical-zero-lab/README.md) for the separate ZERO_ONLY contract; its prior authorization does not apply to this DSP-shadow APK.

## First physical DSP-shadow run — 2026-11-27

One owner-authorized run used CI artifact 15198712216, source commit d17337db99c28744685151f95b1d6526a8b382a2, APK SHA-256 510daef4b2c3964d5b7e27879cf6041bc85acc7e857d43a3312b5b0cc64fdc9a, and release archive SHA-256 d87a5da39a6342f0a2be99fd7667e0d0f5751d8a987320d68856c705c26741c9 on the Moto g62 5G (ZY22FWGQTB, Android 13/API 33, arm64-v8a). The owner waived independent human review for this exact artifact; the recorded gate is OWNER_WAIVER_NO_INDEPENDENT_REVIEW, not independent review PASS.

The stream negotiated 48 kHz, 192 frames per burst, a 1,536-frame buffer, SHARED and LOW_LATENCY. Route policy selected the built-in speaker (predicted and AAudio device ID 3) in MODE_NORMAL; telephony was inventory-only. The first observed callback had 192 frames and a 4 ms budget, but DSP processing took 7.305 ms, callback wall time was 7.359 ms, and callback-thread CPU time was 6.426 ms. It fail-stopped immediately: one DSP deadline failure, one full callback overrun, one NativeSession fail-stop, zero successful DSP callbacks and zero control updates. The 60-second acceptance run therefore FAILED and did not complete.

The one callback verified 384 zero output samples and observed zero nonzero samples. XRun delta, route mismatch, callback overlap and disconnect were all zero. AAudio stop/close returned success, no callbacks remained in flight, and the runner uninstalled the APK. Because only one callback was recorded, there is no maximum inter-arrival event or adjacent callback pair to analyze. The callback timing is a single observation, not a steady-state distribution. See the [structured research report](../../research/android-aaudio-callback/physical-dsp-shadow-moto-g62-2026-11-27.md); the full device logs and their SHA-256 manifest remain in the local evidence directory recorded there.

This run does not pass the first-run gate and does not authorize a five-minute run or a retry. A new physical run requires new exact-scope owner authorization. No DSP algorithm or oracle tolerance was changed. M04 REAL HEARING remains BLOCKED / DEFERRED.

## First-callback O0/O2 diagnosis — 2026-11-27

Rebuilding the old artifact's exact source commit with the pinned toolchain showed a Debug configuration with no explicit optimization flag (effective Clang default O0). The original CI artifact did not retain its compile database, so the reconstruction cannot prove the original APK's exact compiler flags. A clean-commit no-audio O0/O2 comparison through the same JNI/native DSP path on an API 29 x86_64 emulator measured the unprofiled 192-frame first callback at 0.7668 ms / 0.1015 ms respectively; the 32-record final run had zero deadline failures in both profiles. O2 is now explicit in the research APK build. This is a plausible explanation for part of the old first-callback cost, not a reproduction of the Moto g62 ARM64 AAudio miss. No new physical AAudio stream was opened; the previous one-use authorization remains consumed. Details, stage timings and hashes are in the [N07 optimization report](../../research/android-aaudio-callback/n07-native-first-callback-optimization-2026-11-27.md).

M01 captions remain unchanged. M03 offline tuning remains closed. M04 REAL HEARING remains **BLOCKED / DEFERRED**.
