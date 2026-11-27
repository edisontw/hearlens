# N07 — first-callback optimization evidence (2026-11-27)

## Finding

The previous Moto g62 DSP-shadow run stopped on its first 192-frame callback: DSP wall time was 7.305416 ms against a 4 ms period, full callback wall time was 7.358907 ms, and callback-thread CPU was 6.425888 ms. The exact artifact's original compiler database and CMake cache were not retained, so its effective flags cannot be read directly from CI evidence.

A reconstruction from the exact artifact source commit `d17337db99c28744685151f95b1d6526a8b382a2`, using the pinned Gradle 8.9, NDK 27.2.12479018 and CMake 3.22.1, produced a Debug CMake build with empty `CMAKE_CXX_FLAGS_DEBUG` and no `-O*` option. The effective compiler default was O0. The original artifact's extracted native library SHA-256 was `ad3569c82e79b43b0b7f75640376336973be8e7dbf2548b667d531aadfd82cb7`; the locally rebuilt APK SHA-256 was `f3788f27df136c07cdbfed2dcd09c0a3b6bf0ed87ba86ec518892b4fd5ce18fe`. This APK is a reconstruction, not the original CI artifact. The reconstructed compile database SHA-256 is `3d229f0bc68d8e4c4fdcc131673f9fdf54a35ea37e4474d8f7258b4490d21459`. Both configurations retained `-fno-fast-math` and `-ffp-contract=off`.

The missing optimization flag is a plausible, reproducible contributor to the first-run cost, but it does not prove the cause of the Moto measurement. The original 7.305 ms physical observation has not been repeated, and emulator timing cannot establish Android ARM64 real-time callback behavior.

## Comparison method

The same source tree at main `1b00d2373a5f71229c29e08b85cddaa4ac1c8a09`, Android NDK shared library, canonical portable fixture, `CallbackCore` → `NativeSession` → stereo Auto-FIR path, and JNI no-audio harness were built twice with only the explicit optimization profile changed. O0 and O2 compile commands were read back and verified from `compile_commands.json`; O2 was `-O2 -fno-fast-math -ffp-contract=off`, with fast math rejected. The fixture was 48 kHz and the primary callback-equivalent size was 192 frames with the unchanged 4 ms deadline. The harness also ran new-generation and 64/128-frame variable partitions.

These runs used the API 29 x86_64 Android emulator, serial `emulator-5554`, not the Moto g62. The instrumentation invoked the same native callback core synchronously without opening AAudio. Both reports explicitly recorded `physical_stream_opened=false`, `aaudio_open_calls=0`, no DSP-to-output connection, and verified zero-only private output buffers. This is Android JNI/native DSP timing evidence, not AAudio scheduling, ARM64 performance or an audio callback benchmark.

## Final repeated run

Run directory: `D:\Dev\Android\test-results\hearlens\n07-first-callback\20261127-233538`.

| Metric | O0 | O2 |
| --- | ---: | ---: |
| Instrumentation tests | 5/5 PASS | 5/5 PASS |
| Callback records | 32 | 32 |
| Deadline failures / full callback overruns | 0 / 0 | 0 / 0 |
| Verified zero samples / nonzero samples | 11,520 / 0 | 11,520 / 0 |
| New instance, first unprofiled 192-frame wall | 0.6347 ms | 0.0958 ms |
| New instance, first profiled wall | 0.7087 ms | 0.1989 ms |
| New generation, first profiled wall | 0.7744 ms | 0.1978 ms |
| 12 steady 192-frame callbacks, unprofiled wall P50 / P95 / max | 0.9786 / 1.2241 / 1.2241 ms | 0.1032 / 0.1065 / 0.1065 ms |
| 12 steady callbacks, profiled wall P50 / P95 / max | 1.0449 / 1.8494 / 1.8494 ms | 0.1778 / 0.2446 / 0.2446 ms |
| Four variable 64/128-frame profiled callbacks, maximum wall | 0.5829 ms | 0.1577 ms |

The first unprofiled 192-frame callback was about 6.6× faster under O2 (about 85% lower wall time). In this one emulator run, the O2 first and steady callbacks were below the 2 ms research screen and well below the unchanged 4 ms deadline. These are short synchronous samples and are not statistical evidence about Moto g62 real-time scheduling.

The first profiled callback reported zero control updates in both profiles. Separate initialization timings show the FIR coefficients were synthesized on that callback:

| First 192-frame profiled callback stage | O0 | O2 |
| --- | ---: | ---: |
| Generation reset | 8.3 µs | 6.3 µs |
| Initial FIR coefficients, left / right | 14.2 / 13.9 µs | 6.4 / 6.4 µs |
| Detector | 76.2 µs | 17.7 µs |
| FIR convolution | 494.3 µs | 66.6 µs |
| Dynamic control update | 0 µs | 0 µs |
| Scratch validation / clear | 6.9 / 6.1 µs | 6.0 / 5.9 µs |

On the first control-update callback (192 frames, control updates 0→1), profiled O0 measured 704.0 µs convolution and 29.6 µs update work; O2 measured 84.2 µs convolution and 12.9 µs update work. FIR convolution dominated the measured stages. Stage profiling adds clock reads; use unprofiled rows for overall timing comparisons.

An earlier exploratory emulator run at `D:\Dev\Android\test-results\hearlens\n07-first-callback\20261127-220144` recorded two O0 deadline failures/overruns across 19 callback records, including a 6.41 ms wall callback with about 0.87 ms thread CPU, while its O2 sample had no misses. A repeated run was used for the table above and recorded zero misses in both profiles. The earlier observation is retained as scheduling variability, not treated as an O0-only DSP cost.

## Build identities and evidence

Both final APKs were built from `1b00d2373a5f71229c29e08b85cddaa4ac1c8a09` and use the same instrumentation APK SHA-256 `eec5895db93e9cb9b0dc550bb5d09f1a8660e879c125becafdbba73eff340bef`.

| Profile | APK SHA-256 | Compile database SHA-256 | Benchmark JSON SHA-256 |
| --- | --- | --- | --- |
| O0 | `fd2d61a1b3c0c4858ae5b927146c278e6fa67cba97d945034896967e5c3a13a6` | `146cd90848aa0e36cfb533508e7108a962600c6c91703c63f01ce8cf0813c81a` | `358d87d82ce17e057567c607942934aaf8ad7e4f8317e03aa96b9fda02c3cd19` |
| O2 | `0c540720a20cebc0b06056d401f8588531effff2fff994fe06787d2eeac8ede6` | `b0c71844d06d5ef6a3480cdad98b51b62fd0049228094d8dce6787e68782b156` | `f62b0eeb7fc4cf26c330764ef12326522123caece835710282424421c50b5117` |

The canonical fixture SHA-256 is `40ae2cdecf7f83ef11dc12302c65315cc6382f3e193b5c4b63e15bfb98bbfe3c`; JS oracle SHA-256 is `f148b30b17bab4f61f141bb37c511295574ba2983fbbb71fa10ed4673692c8c4`; fixture manifest SHA-256 is `9f804d297f22d6b869d7ba3b98935dafdd8d44b40ef08ce524b42414275b07dc`.

Full Gradle and instrumentation logs, APKs, compile databases, profile verification JSON and no-audio reports are retained in the local run directory above. The old artifact reconstruction is in `D:\Dev\Android\test-results\hearlens\n07-first-callback\source-d17337-reconstruction`. Local run artifacts are not source-controlled; the report preserves their exact hashes.

## Decision and remaining limit

Make O2 explicit in the physical DSP-shadow research APK build and retain `-fno-fast-math`, `-ffp-contract=off`, the existing float precision and the existing oracle tolerance. No DSP initialization refactor is justified by the O2 emulator result. Focused native instrumentation still passes the canonical JS-oracle parity and NativeSession fault regression.

This result does not demonstrate that the original Moto g62 first callback would pass with O2. The earlier Moto run was ARM64 on an Android real-time audio callback thread; this comparison was x86_64, synchronous JNI, with no stream. Android ARM64 scheduling, callback-thread priority, thermal state and device-specific native behavior remain unmeasured. The earlier physical authorization was one-use and consumed; this work did not install an APK on the Moto or open any physical AAudio stream. Any new physical run needs a new exact-artifact authorization. M04 REAL HEARING remains **BLOCKED / DEFERRED**.
