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


## Native six-band detector and complete Auto-FIR (N03)

`six_band_level_core.hpp` ports the live `packages/dsp/offline-six-band-level.mjs` arithmetic to an independent C++17 detector: six centers at 250/500/1000/2000/4000/8000 Hz, two constant-peak-gain biquads per band at Q=1.5, Float64 filter/power/envelope state, 12 ms power averaging, the existing `expm1` smoothing constants and operation order, a `1e-10` RMS floor, and the existing nominal mapping from -37 dBFS to 65 clipped to 50–80. Attack and release retain the JS parameter ranges. These levels are synthetic coordinates, not SPL.

`auto_fir_core.hpp` composes that detector with the existing N02 `DynamicFir`. It initializes all six targets at nominal 50 and splits input by sample clock at each control boundary. It processes the same segment through detector and FIR first, then reads levels and retargets for the next segment. The default 480-sample interval is validated within 128–2048; the existing 50 ms raised-cosine restart transition, 12 dB gain cap and limiter remain in `DynamicFir`. Every ear owns independent detector/FIR state. The Native stereo wrapper prevalidates both channels; a bad channel zeros the full callback and fail-stops both ears until reset. This is an added stereo protection contract; the JS oracle is single-ear and is not claimed to provide atomic binaural failure semantics.

`auto-check.mjs` generates deterministic synthetic silence, tones, multitone, level steps, short pulses, overload and release-tail PCM, then compares the Native executable directly against `createOfflineSixBandLevelResearch`, `createOfflineDynamicFirResearch`, and `createOfflineAutoFirResearch`. The three-second, 48 kHz stereo fixture uses distinct left/right inputs and existing independent target curves. It also compares every nominal level and control sample index. Callback partitions include the standard 64/128/192/256/480 frames plus 73/511 and the 2048/4096 maximum-block cases. Sample counts 479/480/481 and 959/960/961 check both sides of control boundaries. A deliberate 481-sample Native control interval is rejected by the 480-sample JS oracle.

The Native and JS Float32 outputs were bit-identical for 144,000 samples per ear at every partition: max error 0, RMS error 0, and 0 samples over the predeclared `1e-7` maximum / `2e-8` RMS thresholds. The largest six-band nominal-level error was `1.4210854715202004e-14` (threshold `1e-8`). Each partition processed 300 control updates at samples 480, 960, …, 144,000, with one initial FIR target and therefore 301 FIR installs. Limiter counts were 23,098 left and 27,696 right, matching the JS oracle. Callback instrumentation observed zero calls through the intercepted C++ allocation operators. Reset equivalence, stereo isolation, overlapping-buffer rejection, NaN/Inf/out-of-range rejection, fail-stop/recovery, and detector/configuration boundary checks passed.

Validation on the available x86_64 host: `make clean verify`, `make sanitize-check` (AddressSanitizer and UndefinedBehaviorSanitizer), and the four focused JS detector/dynamic-FIR/Auto-FIR tests all passed. The local managed environment reports `spawnSync ... EPERM` for Node-launched child binaries while still returning status 0 and complete output; ordinary shell execution and GitHub Actions are used as independent process-launch checks. N03 establishes host-side implementation parity only. It does not establish ARM64 or Android runtime behavior, target-phone performance, audio route, SPL, MPO, acoustic latency, or safe hearing output.

## Native ARM64 and Android probe (N04)

N04 benchmarks only generated 48 kHz stereo PCM. The same fixture drives all three modes: fixed 513-tap FIR, Dynamic FIR with a sample-clock target update every 480 frames, and full Auto-FIR with both six-band detectors, 480-sample updates, target coefficient rebuilding/restart, convolution and limiter. Each block/mode gets 96,000 warmup samples and 1,536,000 measured samples per ear (2 and 32 seconds equivalent). The script also emits a separate deadline-paced mode; it is not conflated with the unpaced throughput run.

Captured on 2026-11-24 on the managed Linux 6.18.57 x86_64 KVM host: AMD EPYC 9V74, 3 visible logical CPUs, 2 available CPUs and a cgroup quota of 2 CPUs; GCC 14.2.0, Node 24.22.3. The 15 unpaced rows completed in about 0.68–0.98 wall seconds each. P50/P95/P99/max below are callback wall time. Every full Auto-FIR row had 24,000/12,000/8,000/6,000/3,200 measured callbacks respectively and zero observed callback allocations. The 64-frame full Auto-FIR row recorded 3 deadline-sized overruns; all other full Auto-FIR block sizes recorded zero.

| Frames | Deadline | P50 | P95 | P99 | Max | Deadline misses | Thread CPU | Real-time factor |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 64 | 1,333.333 µs | 35.493 µs | 63.967 µs | 141.723 µs | 3,007.630 µs | 8 / 24,000 | 0.997 s | 32.08× |
| 128 | 2,666.667 µs | 71.217 µs | 115.915 µs | 179.329 µs | 2,483.544 µs | 0 / 12,000 | 0.936 s | 34.20× |
| 192 | 4,000.000 µs | 106.781 µs | 157.137 µs | 253.340 µs | 2,479.979 µs | 0 / 8,000 | 0.928 s | 34.46× |
| 256 | 5,333.333 µs | 142.384 µs | 201.302 µs | 299.740 µs | 883.278 µs | 0 / 6,000 | 0.916 s | 34.93× |
| 480 | 10,000.000 µs | 272.167 µs | 382.142 µs | 501.441 µs | 1,270.231 µs | 0 / 3,200 | 0.930 s | 34.40× |

The largest full Auto-FIR P99 deadline utilization was 10.63% (64 frames), below the exploratory 50% target on this host. Across all 15 rows, the C++ allocation probe recorded zero callback allocations; all allocation operator positive controls passed. The C++ process peak RSS was 33,079,296 bytes (31.55 MiB) for the complete benchmark process. The fixture, compiler flags, CPU quota, all percentiles, update/no-update breakdowns, checksums and per-mode results are retained in [`results/n04-host-x64-2026-11-24.json`](./results/n04-host-x64-2026-11-24.json).

The fixed/Dynamic/full P99 cost attribution is:

| Frames | Fixed FIR P99 / CPU / misses | Dynamic FIR P99 / CPU / misses | Full Auto-FIR P99 / CPU / misses |
| ---: | ---: | ---: | ---: |
| 64 | 60.902 µs / 0.690 s / 2 | 117.397 µs / 0.893 s / 2 | 141.723 µs / 0.997 s / 8 |
| 128 | 116.435 µs / 0.679 s / 0 | 155.874 µs / 0.846 s / 1 | 179.329 µs / 0.936 s / 0 |
| 192 | 255.164 µs / 0.727 s / 0 | 242.444 µs / 0.851 s / 0 | 253.340 µs / 0.928 s / 0 |
| 256 | 229.755 µs / 0.688 s / 0 | 283.676 µs / 0.843 s / 0 | 299.740 µs / 0.916 s / 0 |
| 480 | 406.181 µs / 0.691 s / 0 | 545.897 µs / 0.887 s / 0 | 501.441 µs / 0.930 s / 0 |

These rows are short unpaced throughput observations, not wall-clock audio playback, mobile performance, or thermal stability. Misses are per-call execution times compared with the theoretical callback deadline while processing back-to-back; this shared VM does not support reliable attribution to algorithm vs host scheduling. The separate paced path completed a 7-second smoke run with synthetic level changes, 700 control updates, zero deadline misses and zero callback allocations. A 5-minute run was not executed because the available shared KVM has a 2-CPU quota and no meaningful target-device thermal state. To run it on a dedicated, thermally representative Linux host, from this directory use:

```sh
make auto-bench
node auto-bench.mjs --paced-seconds=300 --paced-block=128 --output=results/paced-128-5min.json
```

Linux AArch64 cross-compile, native ARM64 parity/benchmark, and API 29 `arm64-v8a` Android NDK build are independent CI jobs using standard public GitHub-hosted runners; benchmark timings do not gate CI. The Android artifact includes an ELF executable plus a reproducible 128-frame JS-oracle fixture. `build-android.sh /tmp/hearlens-android` records ABI, API level, compiler flags, dependencies and binary SHA-256, and rejects audio output dependencies. NDK cross-compile is not Android runtime evidence. For a later authorized headless runtime check, copy the artifact directory from CI, then:

```sh
adb push hearlens-auto-check-arm64-v8a /data/local/tmp/hearlens-auto-check
adb push portable-fixture/auto-fir-fixture.bin /data/local/tmp/auto-fir-fixture.bin
adb exec-out /data/local/tmp/hearlens-auto-check /data/local/tmp/auto-fir-fixture.bin > native.bin
node verify-portable-output.mjs portable-fixture/manifest.json \
  portable-fixture/auto-fir-fixture.bin \
  portable-fixture/auto-fir-js-oracle.bin native.bin
```

This executable only consumes synthetic PCM; no audio route or playback is present. Until CI supplies its architecture-specific evidence, status is pending. Android runtime and target-phone performance remain untested/deferred. These Native results cannot establish SPL, acoustic MPO, real routing, acoustic latency or safe hearing output.

## Reproduction commands

```sh
make clean verify
make sanitize-check
node auto-bench.mjs --output=results/current-host.json
# Five-minute paced run is an independent experiment and has not been run here.
node auto-bench.mjs --paced-seconds=300 --paced-block=128 --output=results/paced-128-5min.json
```
