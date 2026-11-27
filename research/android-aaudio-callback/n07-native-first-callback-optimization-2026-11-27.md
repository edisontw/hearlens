# N07 — first-callback optimization evidence (2026-11-27)

## Finding

The previous Moto g62 DSP-shadow run stopped on its first 192-frame callback: DSP wall time was 7.305416 ms against a 4 ms period, full callback wall time was 7.358907 ms, and callback-thread CPU was 6.425888 ms. The exact artifact's original compiler database and CMake cache were not retained, so its effective flags cannot be read directly from CI evidence.

A reconstruction from the exact artifact source commit `d17337db99c28744685151f95b1d6526a8b382a2`, using the pinned Gradle 8.9, NDK 27.2.12479018 and CMake 3.22.1, produced a Debug CMake build with empty `CMAKE_CXX_FLAGS_DEBUG` and no `-O*` option. The effective compiler default was O0. The original artifact's extracted native library SHA-256 was `ad3569c82e79b43b0b7f75640376336973be8e7dbf2548b667d531aadfd82cb7`; the locally rebuilt APK SHA-256 was `f3788f27df136c07cdbfed2dcd09c0a3b6bf0ed87ba86ec518892b4fd5ce18fe`. This APK is a reconstruction, not the original CI artifact. The reconstructed compile database SHA-256 is `3d229f0bc68d8e4c4fdcc131673f9fdf54a35ea37e4474d8f7258b4490d21459`. Both configurations retained `-fno-fast-math` and `-ffp-contract=off`.

The missing optimization flag is a plausible, reproducible contributor to the first-run cost, but it does not prove the cause of the Moto measurement. The original 7.305 ms physical observation has not been repeated, and emulator timing cannot establish Android ARM64 real-time callback behavior.

## Comparison method

The exact clean source commit `3f40549d33138c18912adaa53a3ff33e54374fd6`, Android NDK shared library, canonical portable fixture, `CallbackCore` → `NativeSession` → stereo Auto-FIR path, and JNI no-audio harness were built twice with only the explicit optimization profile changed. O0 and O2 compile commands were read back and verified from `compile_commands.json`; O2 was `-O2 -fno-fast-math -ffp-contract=off`, with fast math rejected. The fixture was 48 kHz and the primary callback-equivalent size was 192 frames with the unchanged 4 ms deadline. The harness also ran new-generation and 64/128-frame variable partitions.

These runs used the API 29 x86_64 Android emulator, serial `emulator-5554`, not the Moto g62. The instrumentation invoked the same native callback core synchronously without opening AAudio. Both reports explicitly recorded `physical_stream_opened=false`, `aaudio_open_calls=0`, no DSP-to-output connection, and verified zero-only private output buffers. This is Android JNI/native DSP timing evidence, not AAudio scheduling, ARM64 performance or an audio callback benchmark.

## Final repeated run

Run directory: `D:\Dev\Android\test-results\hearlens\n07-first-callback\20261127-235144`.

| Metric | O0 | O2 |
| --- | ---: | ---: |
| Instrumentation tests | 5/5 PASS | 5/5 PASS |
| Callback records | 32 | 32 |
| Deadline failures / full callback overruns | 0 / 0 | 0 / 0 |
| Verified zero samples / nonzero samples | 11,520 / 0 | 11,520 / 0 |
| New instance, first unprofiled 192-frame wall | 0.7668 ms | 0.1015 ms |
| New instance, first profiled wall | 0.6852 ms | 0.1935 ms |
| New generation, first profiled wall | 0.8738 ms | 0.1995 ms |
| 12 steady 192-frame callbacks, unprofiled wall P50 / P95 / max | 0.9673 / 1.4544 / 1.4544 ms | 0.1020 / 0.1030 / 0.1030 ms |
| 12 steady callbacks, profiled wall P50 / P95 / max | 1.0358 / 1.8096 / 1.8096 ms | 0.1744 / 0.2381 / 0.2381 ms |
| Four variable 64/128-frame profiled callbacks, maximum wall | 0.4553 ms | 0.1525 ms |

The first unprofiled 192-frame callback was about 7.6× faster under O2 (about 87% lower wall time). In this one emulator run, the O2 first and steady callbacks were below the 2 ms research screen and well below the unchanged 4 ms deadline. These are short synchronous samples and are not statistical evidence about Moto g62 real-time scheduling.

The first profiled callback reported zero control updates in both profiles. Separate initialization timings show the FIR coefficients were synthesized on that callback:

| First 192-frame profiled callback stage | O0 | O2 |
| --- | ---: | ---: |
| Generation reset | 7.8 µs | 5.9 µs |
| Initial FIR coefficients, left / right | 13.8 / 13.4 µs | 6.2 / 6.1 µs |
| Detector | 73.7 µs | 17.2 µs |
| FIR convolution | 480.0 µs | 65.8 µs |
| Dynamic control update | 0 µs | 0 µs |
| Scratch validation / clear | 6.6 / 5.9 µs | 5.7 / 6.0 µs |

On the first control-update callback (192 frames, control updates 0→1), profiled O0 measured 712.5 µs convolution and 28.9 µs update work; O2 measured 83.3 µs convolution and 12.5 µs update work. FIR convolution dominated the measured stages. Stage profiling adds clock reads; use unprofiled rows for overall timing comparisons.

An earlier exploratory emulator run at `D:\Dev\Android\test-results\hearlens\n07-first-callback\20261127-220144` recorded two O0 deadline failures/overruns across 19 callback records, including a 6.41 ms wall callback with about 0.87 ms thread CPU, while its O2 sample had no misses. The later clean-commit run recorded zero misses in both profiles. The earlier observation is retained as scheduling variability, not treated as an O0-only DSP cost. An intermediate repeat at `20261127-233538` was superseded: its working tree contained the candidate changes while its build-info recorded the pre-change base SHA. The primary run above uses a clean tree and the exact candidate commit.

## Build identities and evidence

Both final APKs were built from `3f40549d33138c18912adaa53a3ff33e54374fd6`. Both instrumentation runs exited 0 and reported 5/5 tests; the packages were uninstalled and verified absent from the emulator after the run.

| Profile | APK SHA-256 | Compile database SHA-256 | Benchmark JSON SHA-256 |
| --- | --- | --- | --- |
| O0 | `3641651f7a733b9a6417e937eb890c92a78c6a324ab5a4c1efecaaf80c693aa3` | `146cd90848aa0e36cfb533508e7108a962600c6c91703c63f01ce8cf0813c81a` | `56f9409db978b661ce2bf0569e78255f6ba2e79b60d0344982118e83d7322d46` |
| O2 | `546c87a91682687c9a20ff068a3c644b7692d7a2cadbe20c86f7b94cbf50d21f` | `b0c71844d06d5ef6a3480cdad98b51b62fd0049228094d8dce6787e68782b156` | `f43e3d52cc563f969dfadee94db0a9af7d1fa2330b86edb174e31e09a8ded2be` |

The canonical fixture SHA-256 is `40ae2cdecf7f83ef11dc12302c65315cc6382f3e193b5c4b63e15bfb98bbfe3c`; JS oracle SHA-256 is `f148b30b17bab4f61f141bb37c511295574ba2983fbbb71fa10ed4673692c8c4`; fixture manifest SHA-256 is `9f804d297f22d6b869d7ba3b98935dafdd8d44b40ef08ce524b42414275b07dc`.

Full Gradle and instrumentation logs, APKs, compile databases, profile verification JSON and no-audio reports are retained in the local run directory above. The old artifact reconstruction is in `D:\Dev\Android\test-results\hearlens\n07-first-callback\source-d17337-reconstruction`. Local run artifacts are not source-controlled; the report preserves their exact hashes.

## Decision and remaining limit

Make O2 explicit in the physical DSP-shadow research APK build and retain `-fno-fast-math`, `-ffp-contract=off`, the existing float precision and the existing oracle tolerance. No DSP initialization refactor is justified by the O2 emulator result. Focused native instrumentation still passes the canonical JS-oracle parity and NativeSession fault regression.

This result does not demonstrate that the original Moto g62 first callback would pass with O2. The earlier Moto run was ARM64 on an Android real-time audio callback thread; this comparison was x86_64, synchronous JNI, with no stream. Android ARM64 scheduling, callback-thread priority, thermal state and device-specific native behavior remain unmeasured. The earlier physical authorization was one-use and consumed; this work did not install an APK on the Moto or open any physical AAudio stream. Any new physical run needs a new exact-artifact authorization. M04 REAL HEARING remains **BLOCKED / DEFERRED**.
