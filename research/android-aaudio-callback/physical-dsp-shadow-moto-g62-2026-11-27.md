# Moto g62 physical DSP-shadow callback result — 2026-11-27

## Scope and authorization

One physical run was authorized for CI artifact 15198712216 from source commit d17337db99c28744685151f95b1d6526a8b382a2. The APK SHA-256 is 510daef4b2c3964d5b7e27879cf6041bc85acc7e857d43a3312b5b0cc64fdc9a; the ARM64 release archive SHA-256 is d87a5da39a6342f0a2be99fd7667e0d0f5751d8a987320d68856c705c26741c9. The owner explicitly waived independent human safety review for this exact artifact. The recorded state is OWNER_WAIVER_NO_INDEPENDENT_REVIEW, not independent review PASS.

The target was a Moto g62 5G, serial ZY22FWGQTB, Android 13/API 33, arm64-v8a. The requested workload was DSP_SHADOW_ZERO_OUTPUT routed only to BUILTIN_SPEAKER_ONLY, once, for at most 60 seconds, with no extension.

The run used no microphone, Bluetooth API, external audio device, nonzero PCM or hearing output.

## Result

The AAudio stream opened and started, then failed closed on its first callback. The result was CALLBACK_OVERRUN / FAIL_STOP; duration_complete was false and dsp_benchmark_valid was false. One callback of 192 frames was observed. The one-run authorization is consumed. No retry or five-minute stream is authorized by it.

| Measurement | Result |
| --- | ---: |
| Negotiated sample rate | 48,000 Hz |
| Frames per burst | 192 |
| Buffer size / capacity | 1,536 / 1,536 frames |
| Performance / sharing mode | LOW_LATENCY / SHARED |
| Callback histogram | 192 × 1 |
| Callback budget | 4.000 ms |
| DSP processing wall time | 7.305416 ms |
| Full callback wall time | 7.358907 ms |
| Callback thread CPU time | 6.425888 ms |
| DSP deadline failures / callback overruns | 1 / 1 |
| NativeSession invocations / successful DSP callbacks | 1 / 0 |
| Control updates | 0 |
| XRuns / route mismatch / overlap / disconnect | 0 / 0 / 0 / 0 |
| Verified zero / nonzero output samples | 384 / 0 |

The AAudio callback used actual 192-frame input from the device; the application did not request a fixed callback size. At 48 kHz, 192 frames provide a 4 ms period. The measured DSP time alone exceeded that period. Callback-thread CPU was about 87% of callback wall time for this single observation. This points to substantial processing cost in the observed callback, but one first callback cannot establish steady-state cost or separate cold-start effects. It is not sufficient evidence to justify changing Auto-FIR or NativeSession.

The final route snapshot was MODE_NORMAL. API 33 MEDIA prediction selected only BUILTIN_SPEAKER id 3, matching AAudio's device id before start and at the end. The inventory also contained telephony id 9 as inventory-only. These are route-policy and AAudio observations, not a guarantee of the physical hardware route.

The callback verified 384 zero output samples; no DSP result had a path to the AAudio buffer. AAudio open/start/stop/close each returned success, stream stop was confirmed, and no callback remained in flight. The runner uninstalled the APK successfully. The runner recorded no XRuns, route changes or disconnects before fail-stop.

Allocation assurance is source-audited only: the callback path contains no allocation, file I/O, JNI call, mutex or sleep. AAudio and Bionic internal allocations are not instrumented by this harness.

## Inter-arrival and comparison

There is no maximum inter-arrival event or adjacent record because the run captured only one callback. The prior ZERO_ONLY run's 98.423 ms maximum inter-arrival gap therefore remains unexplained.

The prior 60.001-second ZERO_ONLY run used the same negotiated 48 kHz, SHARED, LOW_LATENCY, 192-frame burst and 1,536-frame buffer configuration. It recorded 64×936, 128×936 and 192×14,036 callbacks; 5,749,248 zero samples; and zero XRuns or deadline misses. Callback wall P50/P95/P99/max was 40.052/48.750/63.125/271.510 µs, and callback thread CPU was 29.740/34.896/37.448/210.364 µs. The DSP-shadow run added Auto-FIR/NativeSession and failed on its first 192-frame callback. That single 7.359 ms callback is about 117× the ZERO_ONLY wall P99, but it is one first-callback sample versus a 60-second distribution; it does not establish steady-state DSP cost. The earlier 98.423 ms maximum inter-arrival gap remains unexplained.

The five-minute 128-frame ARM64 headless benchmark recorded 106/112,500 deadline misses (0.0942%), up to five consecutive misses, callback wall P99/max 345.052/11,995.156 µs, callback thread CPU P99 292.864 µs, aggregate DSP-thread CPU 10.06%, and zero monitored callback allocations. It uses a synthetic non-AAudio callback path and 128-frame work, while this physical run had one real 192-frame AAudio callback. The figures are not interchangeable and cannot predict real callback capacity. Neither headless timing nor this run measures acoustic latency or hearing output.

## Evidence and status

Structured machine-readable metrics are in [physical-dsp-shadow-moto-g62-2026-11-27.json](./physical-dsp-shadow-moto-g62-2026-11-27.json). Local evidence, including the native result, complete logcat, dumpsys snapshots, install/uninstall logs and SHA-256 manifest, is stored at:

`D:\Dev\Android\test-results\hearlens\physical-dsp-shadow\20261127-211247-895-device-e94a303e`

Raw device logs were kept local and are not committed. The one-run authorization did not pass its 60-second acceptance gate, so it does not authorize another run or the five-minute stage. No DSP code or oracle tolerance was changed. M04 REAL HEARING remains **BLOCKED / DEFERRED**.
