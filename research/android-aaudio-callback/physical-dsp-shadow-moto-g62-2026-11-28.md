# Moto g62 O2 physical DSP-shadow callback — 2026-11-28

## Scope and authorization

One run was authorized for CI artifact **15212874345**, source commit `54cacf1cd3b3f54e85d4253f840b7edbd0d97bfd`, on Moto g62 5G / API 33 / `arm64-v8a`, serial `ZY22FWGQTB`. Scope was `DSP_SHADOW_ZERO_OUTPUT`, `BUILTIN_SPEAKER_ONLY`, one run, maximum 60 seconds, no extension. The exact APK and release archive hashes were checked against the CI artifact and build metadata before installation. The gate was recorded as **OWNER_WAIVER_NO_INDEPENDENT_REVIEW**, not independent review PASS.

Synthetic Auto-FIR/NativeSession PCM stayed in private memory. The APK declares no permissions; the run reported no microphone use, Bluetooth API, or DSP-to-output path. Every AAudio output sample was checked.

## Result

**FAIL — CALLBACK_OVERRUN.** The stream stopped after 4.023799 seconds, so the requested 60-second duration was not completed. The single authorization is consumed; this result does not authorize another run or a five-minute test.

The optimized first 192-frame callback completed in 1.137761 ms wall time, 1.132135 ms callback-thread CPU, and 1.117552 ms DSP time. The earlier artifact's first callback was 7.358907 ms wall, 6.425888 ms thread CPU, and 7.305416 ms DSP wall. This is a substantial first-callback improvement for these two individual observations; it does not establish a steady-state or long-run improvement by itself.

## Negotiated stream and route observations

| Item | Observed |
| --- | --- |
| Sample rate / format / channels | 48,000 Hz / FLOAT / stereo |
| Sharing / performance / usage | SHARED / LOW_LATENCY / MEDIA; all requested values reported achieved |
| Frames per burst | 192 |
| Buffer size / capacity | 1,536 / 1,536 frames |
| Callback histogram | 64 × 61; 128 × 61; 192 × 910 (1,032 total) |
| Native control updates | 388 |
| Route | MODE_NORMAL; MEDIA prediction was only BUILTIN_SPEAKER id 3; AAudio id 3 before start and at end |
| Route caveat | Inventory also contained earpiece id 2 and telephony id 9 (inventory-only); device-ID/policy observations are not a hardware-route guarantee |

The DSP deadline remained 4 ms, based on `max(callback frames, framesPerBurst)`. No DSP deadline failure was reported. The separate full-callback budget is `callback frames / 48 kHz`; one callback exceeded it:

| Callback | Frames | Callback budget | Callback wall | DSP wall | Thread CPU | Result |
| ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1031 | 64 | 1.333333 ms | 1.466875 ms | 1.410938 ms | 1.028281 ms | One callback overrun; fail-stop |

By frame size, callback wall P50/P95/P99/max was:

| Frames | Count | Wall P50 | Wall P95 | Wall P99 | Wall max | Overruns |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 64 | 61 | 0.679062 ms | 1.155104 ms | 1.466875 ms | 1.466875 ms | 1 |
| 128 | 61 | 1.310312 ms | 2.017709 ms | 2.174114 ms | 2.174114 ms | 0 |
| 192 | 910 | 1.982240 ms | 3.139062 ms | 3.198073 ms | 3.371146 ms | 0 |

The overrun record's callback-thread CPU was below its wall time, but a single observation cannot distinguish scheduler preemption from device or measurement effects. The DSP deadline was not missed. The runner's acceptance gate correctly failed because it requires zero callback overruns and a complete 60-second duration.

The maximum inter-arrival gap was **159.305365 ms** at callback 8 versus 4 ms expected. The adjacent intervals were 1.973 ms (callback 6), 1.926 ms (7), 159.305 ms (8), 3.753 ms (9), and 4.036 ms (10). It occurred in the initial start window: logcat places the AAudio stream transition from state 3 to 4 at 00:19:27.893, near this event. This is a startup-time correlation, not a proven cause. XRun delta remained zero; AAudio exposes only cumulative XRun count in this harness, not per-event timestamps.

## Output, fail-stop, and teardown

The output scan verified **372,864 zero samples** and **0 nonzero samples**. AAudio open/start/stop/close returned success; stop was confirmed, no callback remained in flight, and the runner uninstalled the APK. XRun start/end/delta were 0/0/0. Route mismatch, stream disconnect, overlap, and DSP fail-stop counters were zero; one wrapper-level callback overrun triggered the early stop.

The callback wall/thread-CPU interval includes NativeSession processing, zero scan, frame histogram, record/jitter and budget bookkeeping. It ends before the final overrun classification and callback-return tail, so it is a close callback-body measurement rather than an exact timestamp of return. The allocation statement is a static source-path audit; AAudio/Bionic internal allocations and a runtime allocation count are unavailable. Thermal information was not captured.

Logcat also records Qualcomm HAL messages for `vi-feedback`, `fluence nn capture state`, and `spkr-vi-record` during speaker-output startup. In AOSP Qualcomm code, `spkr-vi-record` is named as `USECASE_AUDIO_SPKR_CALIB_TX`, using an input `PCM_CAPTURE` / `SND_DEVICE_IN_CAPTURE_VI_FEEDBACK` path ([AOSP use-case mapping](https://android.googlesource.com/platform/hardware/qcom/audio/+/refs/heads/android13-qpr3-s10-release/hal/audio_hw.c), [AOSP speaker-protection path](https://android.googlesource.com/platform/hardware/qcom/audio/+/master/hal/audio_extn/spkr_protection.c)). That generic AOSP implementation does not prove the exact Motorola firmware behavior. The APK itself opened only an output AAudio stream and has no microphone permission, but the vendor HAL route's device-specific meaning remains unresolved; this is recorded as a limitation before any future stream authorization.

## Comparison and evidence

- **ZERO_ONLY physical baseline:** prior 60-second run used the same negotiated 48 kHz / SHARED / LOW_LATENCY / 192-frame burst / 1,536-frame buffer. Its callback wall P99/max was 63.125/271.510 µs with no XRuns or overruns. The DSP-shadow workload has a different callback cost and this 4-second fail-stopped run is not a comparable long-run distribution.
- **ARM64 headless:** the existing five-minute synthetic benchmark had 106/112,500 deadline misses (0.0942%) and used no AAudio. Its timings do not predict physical callback timing.
- **Current conclusion:** O2 resolves the previous first-callback-sized spike in this sample, but the real callback acceptance gate remains **FAIL** because of a 64-frame overrun. No DSP algorithm, deadline, or oracle tolerance was changed. M04 REAL HEARING remains **BLOCKED / DEFERRED**.

CI artifact hashes: Actions ZIP `c61c2c765d61dcd3d9e5422a857c3dd035d64fc2e9dd884555a6869c0a65da40`; release archive `f13e5c2047c2d2320f66e715402fd9b8bc27d37135d99e73a4e1d80405fbb5bd`; APK `5a22327567ea7562f77224b7b630ad1605e57348ad7acdf39dcd3b58f13ce516`; fixture `40ae2cdecf7f83ef11dc12302c65315cc6382f3e193b5c4b63e15bfb98bbfe3c`; JS oracle `f148b30b17bab4f61f141bb37c511295574ba2983fbbb71fa10ed4673692c8c4`.

Raw evidence (native result, full logcat, dumpsys snapshots, install/uninstall logs and SHA-256 manifest) remains local at:

`D:\Dev\Android\test-results\hearlens\physical-dsp-shadow\20261128-001915-252-device-358c47ae`

Native result SHA-256: `9e5b34c9e4f05fab2cab08252885d9b7d38e6da970c5fb65a1d2ff199a506748`. The corresponding machine-readable summary is [physical-dsp-shadow-moto-g62-2026-11-28.json](./physical-dsp-shadow-moto-g62-2026-11-28.json).
