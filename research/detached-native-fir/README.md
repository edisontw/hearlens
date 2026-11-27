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

N04 benchmarks only generated 48 kHz stereo PCM. The same fixture drives all three modes: fixed 513-tap FIR, Dynamic FIR with a sample-clock target update every 480 frames, and full Auto-FIR with both six-band detectors, 480-sample updates, target coefficient rebuilding/restart, convolution and limiter. Each block/mode gets 96,000 warmup samples and 1,536,000 measured samples per ear (2 and 32 seconds equivalent). The script also emits a separate deadline-paced mode; it is not conflated with the unpaced throughput run. In paced mode, callback execution percentiles exclude sleeping, wake lateness is reported separately, and a miss is counted when callback completion passes its absolute scheduled start plus one block period.

The earlier managed Linux 6.18.57 x86_64 KVM run used an AMD EPYC 9V74 host with 3 visible logical CPUs, 2 available CPUs and a cgroup quota of 2 CPUs; GCC 14.2.0 and Node 24.22.3. It is retained as a scheduler-sensitive local snapshot, not as the direct ARM64 comparison below. The 15 unpaced rows completed in about 0.68–0.98 wall seconds each. P50/P95/P99/max below are callback wall time. Every full Auto-FIR row had 24,000/12,000/8,000/6,000/3,200 measured callbacks respectively and zero observed callback allocations. The 64-frame full Auto-FIR row recorded 8 deadline-sized overruns; all other full Auto-FIR block sizes recorded zero.

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

### Paired GitHub x64 and ARM64 benchmark

Workflow run [#28](https://github.com/edisontw/hearlens/actions/runs/45441634883) measured the same exported fixture bytes on both Linux architectures. The fixture includes the synthesized stereo PCM and six-band FIR basis; SHA-256 was `6a10a38e8c5e8cb3c7960bc7f94223a061674b7bc0ad56967332b3ecb7069a87` in both reports. Each of the 15 fixed/Dynamic/full rows used 2 seconds of warmup and 32 seconds equivalent PCM per ear. Both reports recorded zero deadline misses and zero callback allocations in all 15 rows.

The x64 runner reported Intel Xeon 6975P-C, 4 logical CPUs, GCC 13.3.0 and Node 24.22.3. The ARM64 runner reported Linux ARM64, 4 logical CPUs, GCC 13.3.0 and Node 24.22.3; its CPU model was not exposed. The detailed source reports retain all three modes, host metadata, checksums and update/no-update timings: [x64 run](./results/n04-github-x64-run-28-2026-11-24.json) and [ARM64 run](./results/n04-github-arm64-run-28-2026-11-24.json).

Full Auto-FIR callback timing and throughput on those paired runners:

| Frames | Deadline | x64 P50/P95/P99/max (µs) | ARM64 P50/P95/P99/max (µs) | Thread CPU x64 / ARM64 | RTF x64 / ARM64 | Misses x64 / ARM64 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 64 | 1,333.333 µs | 28.621 / 32.631 / 36.539 / 111.224 | 59.708 / 62.620 / 64.068 / 145.759 | 0.701 / 1.444 s | 45.64× / 22.16× | 0 / 24,000 each |
| 128 | 2,666.667 µs | 56.778 / 63.794 / 66.455 / 140.460 | 119.025 / 122.169 / 123.785 / 147.367 | 0.695 / 1.435 s | 46.06× / 22.30× | 0 / 12,000 each |
| 192 | 4,000.000 µs | 85.574 / 92.406 / 95.011 / 161.061 | 179.022 / 182.070 / 183.846 / 263.321 | 0.691 / 1.433 s | 46.30× / 22.33× | 0 / 8,000 each |
| 256 | 5,333.333 µs | 114.113 / 121.656 / 124.753 / 198.233 | 238.491 / 241.754 / 243.690 / 295.168 | 0.690 / 1.431 s | 46.37× / 22.35× | 0 / 6,000 each |
| 480 | 10,000.000 µs | 213.109 / 221.542 / 225.831 / 351.278 | 446.278 / 449.887 / 452.142 / 475.077 | 0.689 / 1.429 s | 46.43× / 22.40× | 0 / 3,200 each |

The x64 benchmark process peak RSS was 34,144,256 bytes (32.56 MiB); ARM64 was 31,096,832 bytes (29.66 MiB). These are process-level peak RSS measurements, not per-callback buffer sizes. At 128 frames the ARM64 callback P99 was 1.86× x64, and at 480 frames it was 2.00×; full-mode thread CPU time was about 2.05–2.09× across the five block sizes. This is a meaningful same-input architecture comparison for these two hosted Linux runners. It cannot be extrapolated as a phone performance guarantee: the ARM64 CPU model, Android runtime, phone power limits, thermal behavior and device scheduling were not measured.

These rows are short unpaced throughput observations, not wall-clock audio playback, mobile performance, or thermal stability. Unpaced misses compare processing time with the theoretical callback deadline while running back-to-back; this shared VM does not support reliable attribution to algorithm vs host scheduling. The normal 7-second paced smoke traversed synthetic level changes and completed 700 control updates with zero misses and allocations. A fault-injection control then inserted a 500 ms scheduling stall after callback 100: the corrected absolute-deadline calculation reported 193 misses in 2,625 callbacks and 497,717.9 µs maximum wake lateness on the latest run. A prior smoke run reported 196 misses, showing that the recovery count varies with host scheduling. The test confirms that scheduler stalls are visible while callback execution timing remains separately reported. A 5-minute run was not executed because the available shared KVM has a 2-CPU quota and no meaningful target-device thermal state. To run it on a dedicated, thermally representative Linux host, from this directory use:

```sh
make auto-bench
node auto-bench.mjs --paced-seconds=300 --paced-block=128 --output=results/paced-128-5min.json
```

Linux AArch64 cross-compile, native ARM64 parity/benchmark and API 29 `arm64-v8a` Android NDK build all passed in workflow run [#28](https://github.com/edisontw/hearlens/actions/runs/45441634883); the full repository CI passed in [run #1448](https://github.com/edisontw/hearlens/actions/runs/45441635128). The x64 job generates and verifies one portable 128-frame JS-oracle fixture. The ARM64 runtime job downloads and executes those exact fixture bytes, and the Android artifact packages the same fixture with its ELF executable. The packaged fixture SHA-256 is `40ae2cdecf7f83ef11dc12302c65315cc6382f3e193b5c4b63e15bfb98bbfe3c`; its JS oracle SHA-256 is `f148b30b17bab4f61f141bb37c511295574ba2983fbbb71fa10ed4673692c8c4`. `build-android.sh /tmp/hearlens-android` records ABI, API level, compiler flags, dependencies and binary SHA-256, and rejects audio output dependencies. The API 29 `arm64-v8a` ELF64 AArch64 binary links only `libm.so`, `libdl.so` and `libc.so`. Android physical-device execution is now recorded below; it uses an API 29-targeted ELF on an API 33 Moto g62, not an API 29 ARM64 guest.

```sh
adb push hearlens-auto-check-arm64-v8a /data/local/tmp/hearlens-auto-check
adb push portable-fixture/auto-fir-fixture.bin /data/local/tmp/auto-fir-fixture.bin
adb exec-out /data/local/tmp/hearlens-auto-check /data/local/tmp/auto-fir-fixture.bin > native.bin
node verify-portable-output.mjs portable-fixture/manifest.json \
  portable-fixture/auto-fir-fixture.bin \
  portable-fixture/auto-fir-js-oracle.bin native.bin
```

This executable only consumes synthetic PCM; no audio route or playback is present. The Windows physical-device harness below is the repeatable project-specific route for Android headless parity, Native session regression and synthetic paced timing. These Native results cannot establish SPL, acoustic MPO, real routing, Android audio-callback timing, acoustic latency or safe hearing output.

### Android ARM64 physical-device headless run (2026-11-25)

The repository already contained the Native Auto-FIR implementation, portable fixture generator, JS oracle, verifier and Android research APK at main `0e45c6ed45abb79ce525948e53aeb909ac4d3ce5`. The earlier Windows smoke note incorrectly stated these were absent; its standalone ELF smoke is preserved in [the corrected runtime report](../../docs/ANDROID_ARM64_RUNTIME_SMOKE_2026-11-25.md).

On a Motorola moto g62 5G running Android 13/API 33 (`arm64-v8a`), the API 29-targeted Android NDK `auto-check-arm64-v8a` and `native-session-check-arm64-v8a` ELFs ran headlessly. Portable parity passed for 144,000 samples per ear and 300 control updates per ear with zero PCM error, exact diagnostics/control indices, and no authorized route. Native session regression passed, as did all six ARM64 instrumentation tests. The exact fixture, JS oracle, output and ELFs are retained outside the repository in `D:\Dev\Android\test-results\hearlens\arm64-physical-20261125-224941`; see its `build-info.json`, `manifest.json`, `android-arm64-device-report.json`, `oracle-parity.json`, device logs and SHA-256 values.

The five-minute 128-frame **synthetic headless shell-thread** benchmark, not an Android audio callback, measured 112,500 callbacks and 30,000 control updates, 0.0942% deadline misses (106 total, at most five consecutive), zero monitored callback allocations, and 10.06% DSP-thread CPU. Callback wall-time P50/P95/P99/max was 272.031/310.990/345.052/11,995.156 µs; thread-CPU time was 266.667/286.354/292.864/1,887.084 µs. Maximum scheduled wake lateness was 13,287.840 µs against a 2,666.667 µs period.

After the short-run frame sweep showed its highest miss rate at 64 frames, a five-minute 64-frame run recorded 473/225,000 misses (0.2102%, maximum 17 consecutive), zero monitored callback allocations and 9.916% DSP-thread CPU. Wall P50/P95/P99/max was 131.406/171.459/233.698/15,372.188 µs; thread CPU P50/P95/P99/max was 130.417/139.896/155.938/1,002.967 µs; maximum wake lateness was 16,181.253 µs against a 1,333.333 µs period. Thirty-second 192/256/480-frame runs recorded 6/2/0 misses, respectively, with zero monitored allocations at every size. Across the five-minute runs, CPU maxima stayed below the callback period, while intermittent wake and wall-time outliers account for the observed missed deadlines under the benchmark's absolute-deadline rule. This is consistent with scheduler/wakeup delay, but the experiment cannot determine root cause or predict real-time Android audio behavior. No DSP rewrite or broad parameter search followed. Per-size results, thermal artifacts and hashes are in [the runtime report](../../docs/ANDROID_ARM64_RUNTIME_SMOKE_2026-11-25.md). Thermal service reported status 0 and a 30°C sensor named `test sensor`; battery temperature was 25°C after the 128-frame run and 26°C after the 64-frame run. The sensor label does not establish a SoC or surface temperature.

For reproduction from the Windows repository root, authorize the phone in ADB and pass its serial explicitly:

```powershell
& $env:ANDROID_ADB devices -l
.\scripts\android\Test-AndroidPhysicalArm64.ps1 -DeviceSerial 'YOUR_DEVICE_SERIAL' -BenchmarkSeconds 300 -BenchmarkFrames 128
```

The script checks device identity, generates the canonical fixture, builds the API 29 ARM64 ELF and no-permission research APK, executes the existing verifier unchanged, records hashes and thermal/battery telemetry, then removes only its own package installs and device temp directory. M04 AIR31/A2DP real hearing remains **BLOCKED / DEFERRED**. No microphone, speaker, Bluetooth output, or actual Android audio callback is exercised.

## Reproduction commands

```sh
make clean verify
make sanitize-check
node auto-bench.mjs --output=results/current-host.json
# Five-minute paced run is an independent experiment and has not been run here.
node auto-bench.mjs --paced-seconds=300 --paced-block=128 --output=results/paced-128-5min.json
```
