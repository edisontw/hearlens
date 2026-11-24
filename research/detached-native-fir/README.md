# Detached Native FIR baseline

This directory contains a standalone, synthetic-only C++17 implementation of the existing 513-tap symmetric FIR. It provides an independent fixed-coefficient numerical comparison and a host callback probe. It has no microphone, audio device, Android, playback, or route APIs. It is not the production DSP and it does not establish Android device performance.

## Reproduce

Requirements are GCC or Clang with C++17 support, GNU Make, and Node.js 22 or newer.

From this directory run:

```sh
make clean verify
```

The default compile flags are `-std=c++17 -O2 -fno-fast-math -ffp-contract=off -Wall -Wextra -Wpedantic -Werror`. Override `CXX` or `CXXFLAGS` to inspect another compiler. The workflow runs the same target on `ubuntu-24.04` with GCC and Node 24 when this directory or its workflow changes.

The target builds the deterministic baseline executable and the callback benchmark. `check.mjs` compares 16,384 samples per ear against a separately written JavaScript convolution. Its odd-denominator coefficient and PCM fixtures exercise non-exact Float32 pairing, accumulation rounding and cancellation; a deliberately premature-Float32 reference must disagree, so the precision check cannot pass vacuously. The executable encodes IEEE-754 float32 output as little-endian, interleaved left/right samples. The checker validates process status and exact output length before reading values. Unsupported float32 representations and short or failed writes exit with an error.

The independent arithmetic uses Float32 input/history, converts each paired history sample to double before adding, accumulates with double coefficients, and rounds once to Float32 output. No fast-math or fused multiply-add is enabled. In addition to numerical parity, the benchmark checks callback partitions of 64, 128, 192, 256 and 480 frames, left/right state isolation, and reset equivalence to a fresh processor.

## Allocation probe

The benchmark replaces scalar, array, nothrow and aligned global C++ allocation operators. It runs a positive control for each intercepted operator family, then checks all measured/warmup callback invocations. The result `callback_new=0` means those replacement `operator new` paths did not observe an allocation during the callback body. It does not count direct `malloc`/`free`, placement allocation, custom allocators, stack use, or allocations outside the callback.

The timing loop warms each block size for 100 callbacks and reports the next 2,000 stereo callbacks. P50/P95/P99 and maximum use nearest-rank percentiles. The deadline is `block frames / 48000` seconds for both ears. The output checksum consumes every callback result after the timed region, so the optimizer must retain the convolution work; checksum traversal is excluded from callback timing. Allocation-scope toggling and `steady_clock` boundary reads are inside the timed region. Host timing is observational and never makes the CI job fail.

## Local result

Captured on 2026-11-24 in Debian GNU/Linux 13.7, x86_64, AMD EPYC 9V74, three CPUs available to the container, GCC 14.2.0 and Node 24.22.3. Both C++ translation units compiled with warnings treated as errors.

The numerical check reported 32,768 total samples, 0 mismatches, maximum absolute error 0, and RMS error 0. Its precision-sensitivity controls reported 15,857 mismatches with Float32-paired samples, 27,754 with a Float32 accumulator, and 28,021 with both. A temporary C++ core with both operations changed to Float32 failed parity with the same 28,021 mismatches. Each callback partition matched the one-block output exactly. Stereo isolation, reset, and all allocation positive controls passed. No intercepted C++ allocation was observed in the callback. This managed local workspace reports `spawnSync ./fir EPERM` even though the child exits with status 0 and produces the complete expected binary. The checker records that launch warning but still requires a successful exit status and exact output length before parity; the GitHub Actions run independently verified ordinary Node process spawning.

| Frames per callback | Warmup callbacks | Measured callbacks | Deadline | P50 | P95 | P99 | Max | Misses |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 64 | 100 | 2,000 | 1,333.333 µs | 26.670 µs | 47.841 µs | 91.627 µs | 256.404 µs | 0 |
| 128 | 100 | 2,000 | 2,666.667 µs | 53.330 µs | 89.454 µs | 156.204 µs | 623.304 µs | 0 |
| 192 | 100 | 2,000 | 4,000.000 µs | 79.980 µs | 128.573 µs | 209.454 µs | 1,678.945 µs | 0 |
| 256 | 100 | 2,000 | 5,333.333 µs | 106.639 µs | 162.133 µs | 232.198 µs | 1,497.904 µs | 0 |
| 480 | 100 | 2,000 | 10,000.000 µs | 199.916 µs | 271.322 µs | 396.237 µs | 805.643 µs | 0 |

An earlier run on the same host recorded four deadline misses out of 2,000 64-frame callbacks, with a 2,394.293 µs maximum. Four later runs recorded no misses; their 64-frame maxima were 646.469 µs, 1,223.440 µs, 194.222 µs and 256.404 µs. The table shows the latest run. These wall-clock samples depend on host scheduling and container load. CI gates compilation, parity, partitioning, isolation, reset and allocation-monitor behavior. It does not gate timing. The measurements apply to this fixed-coefficient kernel only and are not full Auto-FIR parity, mobile performance, acoustic latency, or safe SPL evidence.
