# Android AAudio callback diagnostics — 2026-11-26

## Decision

The AAudio investigation remains emulator-only. The x86_64 API 29 AVD has audio input and output disabled. No Moto g62 AAudio stream was opened. The present data does not justify changing Auto-FIR, WDRC, the DSP deadline, or oracle tolerances. M04 real hearing remains **BLOCKED / DEFERRED**.

## Starting evidence

The prior five-minute-equivalent callback run requested five minutes but stopped after 273.214 s and 20,480 callbacks: one NativeSession DSP deadline failure and 83 AAudio-reported XRuns. Android had negotiated 48 kHz, 960 frames per burst, SHARED, and performance mode `NONE` despite a LOW_LATENCY request. The callback frame count varied. This remains the only long AAudio run; this diagnostic did not repeat it.

## New bounded matrix

The Windows runner was pinned to `emulator-5580` (AVD `HearLens_API29_x86_64`, API 29, x86_64, `ro.kernel.qemu=1`, audio input/output disabled). Each row has an isolated directory with requested config, full instrumentation output, full and filtered logcat, AudioFlinger/AudioPolicy/audio dumps, complete native JSON copied from app-private storage after teardown, and SHA-256 manifest. Callback frame distributions and XRun snapshots are in each native JSON. XRun timestamps are bounded by 5 ms polling; AAudio exposes only a cumulative count, not per-XRun timestamps.

| Scenario | Requested / negotiated | Duration and callbacks | DSP / callback misses | XRuns | Result |
| --- | --- | ---: | ---: | ---: | --- |
| Zero-only A/B | 48 kHz, SHARED, MEDIA, LOW_LATENCY requested; 48 kHz, 960 burst, 2306 buffer, SHARED, actual `NONE` | 20 s / 2050 | 0 / 0 | 0 | Zero-only baseline |
| NativeSession A/B | Same stream configuration | 20 s / 2049; 2004 control updates | 0 / 0 | 0 | DSP ran; wall P50/P95/P99/max 2.462/5.232/5.562/6.203 ms; callback thread CPU 26.66% |
| System-native rate | Rate unspecified; 44.1 kHz, 661 burst, 5288 buffer, SHARED, MEDIA, actual `LOW_LATENCY` | 10 s / 727 | 0 / 0 | **1** | 48 kHz fixture DSP correctly skipped; no NativeSession calls; count first observed at 41.35 ms. Wall P50/P95/P99/max 0.0088/0.0131/0.0229/0.0358 ms |
| EXCLUSIVE request | 48 kHz; requested EXCLUSIVE, actually SHARED and performance `NONE` | 10 s / 1025 | 0 / 0 | 0 | Sharing request not granted |
| GAME usage | 48 kHz; GAME granted, performance `NONE` | 10 s / 1025 | 0 / 0 | 0 | No clear benefit established |
| Two-burst buffer | 48 kHz; buffer set to 1920 frames (2 × 960), capacity 2306, performance `NONE` | 10 s / 1025 | 0 / 0 | 0 | Buffer request applied; no clear benefit established |

The 2 s safety smoke verified 195,410 output samples; all were zero. Variable frame counts were preserved rather than normalized: baseline 48 kHz callbacks ranged from 6 to 960 frames (279 distinct sizes in each 20 s A/B run); the 44.1 kHz run ranged from 9 to 661 (109 distinct sizes). The full histograms are in raw JSON. The lifecycle scenario completed normal stop/restart twice and background/disconnect injected fail-stops; each stream drained callbacks and closed. The focused native fault matrix additionally covers NaN/Inf, overrun, overlap, stale generation, stop/restart and variable frame sizes.

AudioFlinger snapshot for the 44.1 kHz scenario reported `underruns=0` for its mixer track, alongside a `partial=1` raw mixer counter. These are separate platform diagnostics from the AAudio stream's `xrun_delta=1`; the available logcat and dumpsys data do not identify an exact causal event. The 20 s A/B runs had no XRuns or deadline failures, so they did not reproduce the earlier long-run failure.

## Interpretation and stop condition

An XRun occurred in a short run where DSP was not executed, showing that DSP load alone is not a sufficient explanation for all observed emulator XRuns. The 44.1 kHz native-rate stream also had LOW_LATENCY and a substantially larger buffer. Its result cannot be compared as a valid 48 kHz DSP benchmark: the fixture is 48 kHz, so the harness intentionally skipped NativeSession rather than silently running at a mismatched rate. Conversely, both 48 kHz NativeSession configurations reported `NONE`, and the 20 s A/B window is too short to exclude rare scheduler/backend events. The most plausible explanation remains a combination of emulator audio-backend/scheduling behavior and DSP work increasing callback cost; these experiments do not isolate their contributions conclusively.

No candidate met the predeclared long-run criteria: the EXCLUSIVE request was downgraded, the 48 kHz variants did not achieve LOW_LATENCY, and the only LOW_LATENCY candidate negotiated 44.1 kHz and could not execute this fixture. Therefore the runner correctly did not start another five-minute run. Emulator tuning stops here; do not loop configurations until the AVD reports PASS. Android's low-latency guidance recommends using the device's native rate, requesting low-latency/exclusive where suitable, and tuning buffers empirically, while noting the result depends on platform support. See [Android low-latency audio](https://developer.android.com/games/sdk/oboe/low-latency-audio).

## Reproduction record

- Baseline main: `7df3af233f9446007daa4765f38190db286b4842`.
- Formal run: `D:\Dev\Android\test-results\hearlens\aaudio-callback\20261126-183810-721-95887727`.
- Report SHA-256: `54e3e4813ab5d2f87108cee3670ceb4889ac529b07cece77958a875f6c71d713`.
- Portable fixture SHA-256: `40ae2cdecf7f83ef11dc12302c65315cc6382f3e193b5c4b63e15bfb98bbfe3c`.
- JS oracle SHA-256: `f148b30b17bab4f61f141bb37c511295574ba2983fbbb71fa10ed4673692c8c4`.
- ARM64 APK SHA-256: `714466c690ac24ee9b836ec7135d11d387b35ae30728deefcf37612452e48777`.
- x86_64 APK SHA-256: `ba05810ee13e4e8df572986c50dd5f7cdb0a67abf03ee2c456f574fea001954f`.
- All artifacts generated for this run are individually listed in `sha256.manifest`. The directory is local Windows evidence, not committed repository content.

The earlier five-minute run's full instrumentation trace had already been overwritten before this investigation. Its extracted JSON, frame histogram and partial report remain available; the missing raw trace is an evidence limitation and is not reconstructed.

## Post-change integration smoke

After separating NativeSession fail-stops from callback-core fail-stops and ensuring an overlapping callback returns before touching callback-owned metrics, the default emulator-only runner rebuilt both x86_64 and ARM64 APKs and completed its short output scan plus lifecycle injections. In the 2 s scan, all 188,160 checked output samples were zero; there were no DSP deadline failures or XRuns. One 6-frame callback took 189 µs against its 125 µs callback budget; its 20 ms DSP burst budget was not missed. This is one callback-overrun observation in a short smoke, not a sustained failure or a completed benchmark. All four streams in the lifecycle group confirmed stop/drain/close with no callback left in flight. Report SHA-256: `f665608c15c4f79fe5b0dd4fd13c5eea5d0e94e817951997118832304f221de5`; manifest SHA-256: `a91d0b2577978dbbf39a09c6eb6be33b37260f7be64c55491e98e805f4954c44`.

The callback-core fault-matrix executable passed on the API 29 x86_64 emulator. Its x86_64 executable SHA-256 is `ddf85167f6276a31cbc00d748c79edc577b6fdbb7045324c9e6ba79760791294`; the separately built ARM64 executable SHA-256 is `eaae14d2790e2ec0220d9dd8c51299bd00193abf174d5f5fc63eb0e5d8b49eca`. The ARM64 executable was cross-built and architecture-inspected, not run on the phone.
