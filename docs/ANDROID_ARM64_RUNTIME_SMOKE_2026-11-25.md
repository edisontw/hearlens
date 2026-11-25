# Android ARM64 physical-device runtime verification — 2026-11-25

## Repository baseline

GitHub `main` was fetched before this work and resolved to `0e45c6ed45abb79ce525948e53aeb909ac4d3ce5`. That baseline already contains the Native DSP, portable fixture generator, JS oracle and verifier, API 29 Android NDK builder, and isolated Kotlin/JNI/C++ research lab. Earlier notes that said these components were absent referred to an older view of the repository and are corrected here.

The prior standalone ELF smoke is retained as historical evidence:

- Device: Motorola moto g62 5G, Android 13/API 33, `arm64-v8a`.
- A minimal Android NDK API 29 ELF64/AArch64 test binary used `/system/bin/linker64`; the device reported `machine=aarch64` and exited 0.
- ELF SHA-256: `6AD23C54425813BBCA8B7DFEBE10CA490C61268839DF6763F3BB7A4914B83675`.
- Captured output SHA-256: `C8575B3371CA64A4CB545D998C66620191DA11A60EF627024F4D2F0BEDE9D41D`.
- Log: `D:\Dev\Android\test-results\arm64-native-runtime-20261125\device-result.txt`.

That smoke established generic ELF execution only. The project-specific verification below is separate and does not rely on that binary.

## HearLens Native ARM64 parity

The repeatable Windows harness is `scripts/android/Test-AndroidPhysicalArm64.ps1`. It requires an explicit ADB serial, validates the attached Moto g62 / Android 13 API 33 / `arm64-v8a` identity, then builds the API 29-targeted headless ELF and isolated research APK from the repository. It uses the canonical portable fixture and existing `verify-portable-output.mjs` without changing its tolerances.

Run used GitHub main SHA `0e45c6ed45abb79ce525948e53aeb909ac4d3ce5`, the attached device, and:

```powershell
.\scripts\android\Test-AndroidPhysicalArm64.ps1 -DeviceSerial 'DEVICE_SERIAL'
```

Result: **PASS**.

- Device: Motorola moto g62 5G (`rhodec`), Android 13/API 33, primary ABI `arm64-v8a`.
- Auto-FIR output: 144,000 samples per ear, 300 control updates per ear, 1,185,812 exact output bytes.
- PCM maximum error: 0; RMS error: 0; nominal-level maximum error: `1.4210854715202004E-14`.
- Diagnostics and control indices: exact. Limiter/fail-stop and protocol requirements: accepted by the unchanged verifier.
- Native session regression: PASS, including `2000 concurrent invalidations PASS`.
- ARM64 Android instrumentation: `OK (6 tests)`.
- Route policy: `audioRoute=none`, `hearingOutputAuthorized=false`; the APK has no microphone, audio-routing, or Bluetooth permissions/APIs.
- API-target distinction: API 29-targeted ELF running on API 33 hardware. This does not boot or verify an API 29 ARM64 emulator guest.

### Build and output hashes

All SHA-256 values below correspond to the run directory listed under artifacts.

| Artifact | SHA-256 |
| --- | --- |
| `auto-check-arm64-v8a` ELF | `f22f1d911377e17265b5aadd211b9f82369550f70343f411344d34504e45e5d4` |
| `native-session-check-arm64-v8a` ELF | `a22899637166a3223506b4d79551747524f04ef737dce7422a10c382e2eacd7e` |
| `auto-fir-fixture.bin` | `40ae2cdecf7f83ef11dc12302c65315cc6382f3e193b5c4b63e15bfb98bbfe3c` |
| `auto-fir-js-oracle.bin` | `f148b30b17bab4f61f141bb37c511295574ba2983fbbb71fa10ed4673692c8c4` |
| `manifest.json` | `9f804d297f22d6b869d7ba3b98935dafdd8d44b40ef08ce524b42414275b07dc` |
| Android runtime output | `fa57d91090a8c3751a5f8a47b254ea3dfe68d3755f2b2ae608d1f23057b533e5` |
| ARM64 app APK | `badedabee1888da70357d6f0d44f704684829c39c1cbffc00d51cbeac96ace17` |
| ARM64 instrumentation APK | `09d70d8fd79669941bb31b0d8aeafa2099a3d1b3e29593d4f5191a0a145174f0` |

The builder recorded NDK `27.2.12479018`, Android API 29, Windows x86_64 NDK host tools, Clang 18.0.3, and `-O2 -fno-fast-math -ffp-contract=off -Wall -Wextra -Wpedantic -Werror -static-libstdc++ -pthread`. The complete ABI/compiler metadata, including the x86_64 comparison build, is in the external `headless/build-info.json`.

## Five-minute synthetic headless performance

After parity passed, the existing paced Auto-FIR benchmark ran on-device for 300 seconds at 128 frames/callback. Its benchmark loop is a synthetic shell thread paced against absolute monotonic deadlines. It is **not an Android audio callback**.

| Measure | Result |
| --- | ---: |
| Sample rate / period | 48 kHz / 2,666.667 µs |
| Callbacks / control updates | 112,500 / 30,000 |
| Callback wall time P50 / P95 / P99 / max | 272.031 / 310.990 / 345.052 / 11,995.156 µs |
| DSP-thread CPU P50 / P95 / P99 / max | 266.667 / 286.354 / 292.864 / 1,887.084 µs |
| DSP-thread CPU as benchmark wall time | 10.056% |
| Deadline misses | 106 / 112,500 = 0.094222%; max consecutive 5 |
| Maximum deadline overrun | 10,815.184 µs |
| Scheduled wake lateness P50 / P95 / P99 / P99.9 / max | 97.164 / 714.030 / 875.189 / 2,035.988 / 13,287.840 µs |
| Monitored callback allocations | 0; allocation-probe positive controls passed |
| Output | finite; limiter remained bounded |

The maximum measured DSP-thread CPU time (1,887.084 µs) stayed below the 2,666.667 µs period, while rare wall-time and wake-lateness outliers exceeded it. This pattern is consistent with occasional scheduler/wakeup delay, but the experiment does not establish root cause. It is not evidence that an Android audio callback would miss or meet its deadline. No DSP rewrite or broad parameter search was started from this result.

Thermal service reported status 0 and a 30°C temperature named `test sensor`, unchanged before and after. This is the device's reported thermal telemetry and does not establish a SoC or surface temperature. The five-minute 128-frame run reported battery 25°C/100% charge; the five-minute 64-frame run reported 26°C and charge-complete status after the run.

### Callback-size sweep

The five-minute 128-frame run was the initial priority. Based on its low CPU cost but nonzero deadline misses, all requested sizes received 30-second paced runs. The 64-frame run showed the highest short-run miss rate, so it received an additional five-minute run. These are synthetic shell-thread results; durations are wall-clock benchmark durations.

| Frames | Period (µs) | Duration / callbacks | Wall P50 / P95 / P99 / max (µs) | Thread CPU P99 / max (µs) | Deadline misses | Max consecutive | CPU / wall | Allocations |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 64 | 1,333.333 | 300 s / 225,000 | 131.406 / 171.459 / 233.698 / 15,372.188 | 155.938 / 1,002.967 | 473 (0.2102%) | 17 | 9.916% | 0 |
| 128 | 2,666.667 | 300 s / 112,500 | 272.031 / 310.990 / 345.052 / 11,995.156 | 292.864 / 1,887.084 | 106 (0.0942%) | 5 | 10.056% | 0 |
| 192 | 4,000 | 30 s / 7,499 | 404.896 / 422.552 / 425.937 / 1,192.395 | 421.771 / 815.417 | 6 (0.0800%) | 2 | 10.112% | 0 |
| 256 | 5,333.333 | 30 s / 5,625 | 541.979 / 593.802 / 660.156 / 3,241.458 | 564.687 / 2,605.728 | 2 (0.0356%) | 2 | 9.992% | 0 |
| 480 | 10,000 | 30 s / 2,999 | 1,013.906 / 1,050.625 / 1,132.656 / 7,423.386 | 1,029.740 / 1,403.438 | 0 (0%) | 0 | 9.972% | 0 |

Every size had thread-CPU P99 and maximum below its callback period. Runs with misses also showed large wake-lateness or wall-time outliers; the five-minute 64-frame run reached 16,181.253 µs maximum wake lateness and 15,081.385 µs maximum overrun. This is consistent with intermittent process scheduling/wakeup delay, though these data cannot identify kernel root cause. The 64-frame misses are real in this non-real-time shell-thread experiment and are frequent enough to retain as an explicit limitation; they do not justify changing DSP computation based on these results. Actual Android audio-callback scheduling may differ substantially.

All benchmark JSON, each fixture, ELF, and device report are retained under the run-specific directories in `D:\Dev\Android\test-results\hearlens\`. The benchmark result SHA-256 values are:

- 64 frames / five minutes: `73fdadd88ef8e7b28e5df82c00668251617fc0df79bb53dd7684911808809bdf`.
- 128 frames / five minutes: `0fc81ab0779b7db00d007dc30c2baf1bb94fb7c7078ca741c499800a552389b6`.
- 192 frames / 30 seconds: `9041e9e923003f7cf3bc0d366bfbc7c453dd215de809c5185706fd3733dab80e`.
- 256 frames / 30 seconds: `7074fad9626f5d1c81a60e9d3847dccd675942ba91916c9261bc8dbccf7d43d3`.
- 480 frames / 30 seconds: `0ba04dccd614c7736c396942267fe7f2ea3eef640e7715680b53b5e23efee236`.

The 192-frame loop schedules deadlines with an exclusive stop boundary, so a run may record one fewer callback than the ideal rate-times-duration count. The physical runner checks actual elapsed duration and tolerates this single boundary callback; an initial 192-frame attempt was rejected by its former exact-count assertion and then rerun successfully with the corrected check.

| Benchmark artifact | SHA-256 |
| --- | --- |
| Synthetic benchmark fixture | `6a10a38e8c5e8cb3c7960bc7f94223a061674b7bc0ad56967332b3ecb7069a87` |
| Android AArch64 benchmark ELF | `75439603e64553ed8ec3a40de24f428debf2818a3b92f09192ce201765a949f0` |
| Benchmark result JSON | `0fc81ab0779b7db00d007dc30c2baf1bb94fb7c7078ca741c499800a552389b6` |

## Artifact location and limits

Full, reproducible run artifacts are kept outside Git at:

`D:\Dev\Android\test-results\hearlens\arm64-physical-20261125-224941`

The 128-frame primary run is `arm64-physical-20261125-224941`; other successful benchmark directories are `arm64-physical-20261125-frames64-5min`, `arm64-physical-20261125-frames192-30s-rerun`, `arm64-physical-20261125-frames256-30s`, and `arm64-physical-20261125-frames480-30s`. Each contains the canonical fixture and oracle, manifest, API 29 build metadata, headless ELFs, portable result and verifier output, benchmark fixture/result, APKs, instrumentation and Native session logs, device metadata, and before/after thermal and battery dumps. The repeatable command is documented in [the Windows Android lab guide](./ANDROID_NATIVE_DSP_LAB_WINDOWS.md).

No microphone was accessed; no audio was recorded or played; no audio route was authorized; AIR31/A2DP output was not used. Real Android audio-callback behavior, Bluetooth route behavior, acoustic latency, SPL/MPO, and physical mute/speaker-fallback evidence remain untested. **M04 AIR31/A2DP REAL HEARING stays BLOCKED / DEFERRED.**
