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

The build generates the canonical fixture, JS oracle and manifest into Gradle-generated assets, runs the route-policy unit tests, builds the ARM64 APK and instrumentation package, verifies permissions/ABI, and runs no ADB install or stream. The offline instrumentation test compares Native Auto-FIR bytes to the unchanged JS-oracle tolerance and checks the NativeSession fault matrix without starting AAudio. For an additional local emulator-only verification, `-PtargetAbis=x86_64` builds an x86_64 test APK; the standard build and CI artifact remain ARM64-only.

## Physical validation gates

The runner requires the explicitly selected Moto g62 serial `ZY22FWGQTB`, the CI artifact ID, APK SHA-256, release archive SHA-256, exact source commit, owner authorization, and exactly one matching review record. That review record is either an independent review PASS or an explicit exact-scope owner waiver. A waiver is recorded as `OWNER_WAIVER_NO_INDEPENDENT_REVIEW`; it is never treated as independent review PASS. Exact JSON templates are in [`scripts/android/templates`](../../scripts/android/templates/). The first physical DSP-shadow run is limited to 60 seconds.

The first-run acceptance gate requires: output nonzero samples = 0; XRuns = 0; DSP deadline failures = 0; complete callback overruns = 0; route mismatch = 0; unexpected fail-stops = 0; NativeSession executed; negotiated rate = 48,000; all callbacks drained; AAudio stop and close succeeded; APK removed. If the 60-second run passes, the only next plan is one run of at most five minutes using the same frame/request configuration. The five-minute extension requires separate exact-artifact owner authorization before any stream is started; this release's runner never exceeds 60 seconds.

The physical runner does not run automatically from CI. The owner authorization must bind the exact artifact ID, APK hash, release archive hash and source commit before any device stream. See [the physical-zero lab](../android-aaudio-physical-zero-lab/README.md) for the separate ZERO_ONLY contract; its prior authorization does not apply to this DSP-shadow APK.

M01 captions remain unchanged. M03 offline tuning remains closed. M04 REAL HEARING remains **BLOCKED / DEFERRED**.
