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
| 64 | 100 | 2,000 | 1,333.333 µs | 26.670 µs | 56.395 µs | 226.429 µs | 3,072.369 µs | 8 |
| 128 | 100 | 2,000 | 2,666.667 µs | 51.658 µs | 99.209 µs | 199.259 µs | 2,296.415 µs | 0 |
| 192 | 100 | 2,000 | 4,000.000 µs | 79.960 µs | 165.638 µs | 319.760 µs | 2,536.334 µs | 0 |
| 256 | 100 | 2,000 | 5,333.333 µs | 106.610 µs | 211.768 µs | 341.662 µs | 1,705.458 µs | 0 |
| 480 | 100 | 2,000 | 10,000.000 µs | 202.764 µs | 386.079 µs | 1,648.944 µs | 2,998.178 µs | 0 |

Earlier runs on the same host recorded 0 and 4 misses out of 2,000 64-frame callbacks. The latest run after the shared convolution core was generalized for N02 recorded 8/2,000 misses, with a 3,072.369 µs maximum; tail latency varied across runs. These wall-clock samples depend on host scheduling and container load and do not identify a specific cause. CI gates compilation, parity, partitioning, isolation, reset and allocation-monitor behavior. It does not gate timing. The measurements apply to this fixed-coefficient kernel only and are not full Auto-FIR parity, mobile performance, acoustic latency, or safe SPL evidence.

## Native dynamic FIR (N02 research)

`dynamic_fir_core.hpp` reuses the N01 `Fir::stepDouble` symmetric-history and accumulation path. It adds the existing synthetic six-band 50/65/80 target interpolation, a 12 dB maximum gain cap, 50 ms (2,400 sample) raised-cosine coefficient interpolation, restart-on-retarget behavior, and the existing digital limiter with 1e-7 headroom. Each ear has its own FIR history, target and transition state. Inputs and targets are validated before state changes; invalid PCM stops processing until an explicit reset.

`dynamic-check.mjs` uses `packages/dsp/offline-dynamic-fir.mjs` as the output oracle and the existing synthetic target fixture. Its precomputed six-band basis mirrors the JS reference's fixed basis creation; it does not change the gain law or install a detector. A 28,800-sample-per-ear, 48 kHz fixture includes 14 target events (13 retargets after initialization, several 10 ms apart during active transitions) and a synthetic overload pulse. The Node harness tests 64/128/192/256/480-frame Native callback partitions against the same JS stream.

| Callback frames | Samples per ear | Max absolute error | RMS error | Samples over 1e-7 tolerance | Limited samples L/R (Native / JS) |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 64 | 28,800 | 0 | 0 | 0 | 837 / 846 (same) |
| 128 | 28,800 | 0 | 0 | 0 | 837 / 846 (same) |
| 192 | 28,800 | 0 | 0 | 0 | 837 / 846 (same) |
| 256 | 28,800 | 0 | 0 | 0 | 837 / 846 (same) |
| 480 | 28,800 | 0 | 0 | 0 | 837 / 846 (same) |

The predeclared parity thresholds are 1e-7 maximum absolute error and 2e-8 RMS error; this host produced exact Float32 output for all samples. The checks also cover gain-cap behavior, left/right state isolation, callback partition independence, limiter bounds, no partial write on invalid input, fail-stop, and reset equivalence. The managed workspace reports `spawnSync ./dynamic-check EPERM` with exit status 0 and the complete expected output for each partition; GitHub Actions independently verifies normal Node spawning. This is a dynamic FIR kernel comparison only: there is no automatic detector, complete Auto-FIR adapter, Android callback timing, mobile memory/performance evidence, audio route, or acoustic safety evidence.
