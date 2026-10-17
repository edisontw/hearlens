# M04-D4 — Moto g62 → AIR31 acoustic bench (nonhuman, debug-only)

**No consumer hearing assistance and no use while wearing the earphones.** This is an intentionally separate native Android APK, `org.hearlens.acousticbench`, not the existing SW4 input-only diagnostic APK and not the M01 caption website. It intentionally implements only a bounded **phone built-in microphone → fixed test gain → digital limiter → connected A2DP** stream, to establish whether ordinary Bluetooth is fast enough for the HearLens product concept.

## Scope and sound limits

- A *single* connected Bluetooth A2DP endpoint must be present. The app logs the Android product name and device ID; verify it is AIR31. Other devices or ambiguous A2DP endpoints block start.
- The AIR31 earphones must be **on a table, never worn**. On-screen confirmations are mandatory before each run. No clinician-verified output, acoustic SPL/MPO, or feedback bounds are claimed.
- Format: input PCM16/48 kHz/mono, streamed PCM16/48 kHz/stereo; each sample duplicated to L/R. **Fixed research gain 8x**, hard output sample ceiling `±384 / 32768` (roughly −38.6 dBFS before the additional AudioTrack scalar `0.15`). The physical output level depends on the Android OS media volume and AIR31 amplification, and is **not** calibrated. Start with Android media volume low. If sounds or feedback are unexpectedly loud, press Stop immediately.
- Track starts at volume zero; only after three stable observed `AudioTrack.getRoutedDevice()` A2DP checks while the track is playing *silent buffers*, and confirmation of a **built-in** microphone's actual input route, can nonzero PCM begin. Note that an actual routed-device query is **not** a hard lock against Android buffered speaker fallback.
- Foreground-only, fixed **40-second maximum**, immediate visible Stop, no app recording to file, no internet permission, no raw speech export; only metadata/text diagnostics can be shared. The existing SW4 input-only APK is not modified.

## Automatic stop behavior

The app attempts to stop new PCM production, zero the player volume, pause/flush/stop the local AudioTrack on: Android device removed, actual route switch, unexpected phone mic route, call / abnormal audio mode, lost audio focus, mic or track write error, input watchdog, leaving foreground, timeout or user Stop. **Reconnect never restarts**. These are best-effort application-level controls; already queued audio inside Android/Bluetooth may escape before a notification. The owner accepts this specific *brief phone-speaker leakage* residual risk for **off-ear testing only** (see [D3 decision](../../docs/M04D3_NONHUMAN_BLUETOOTH_BENCH_DECISION_2026-10-17.md)).

## Build and install

CI: GitHub Actions **Android M04 Off-Ear Acoustic Bench**, artifact `hearlens-m04d4-offear-bench-debug` contains `hearlens-m04d4-offear-v0.1.0-debug.apk`.

Manual build requires Java 17, Android SDK 35 and Gradle with Android Gradle Plugin 8.7.3:

```sh
gradle --no-daemon -p apps/android-acoustic-bench assembleDebug
adb install -r apps/android-acoustic-bench/app/build/outputs/apk/debug/app-debug.apk
```

Install only on the owned Moto g62 Android 13 test phone. App identity `org.hearlens.acousticbench` avoids collisions with `org.hearlens.micprobe`. Debug signing certificates on different GitHub Actions runners can differ; an existing debug build might need uninstalling *that bench APK only*. Never uninstall SW4 or change the caption site just to install the bench.

## Field test with existing hardware — one session per condition

1. iPhone is the unmodified fixed source playing `HearLens_M04_Chirp_24x40ms_48k_PCM16.wav`. Keep source phone and PC **Realtek 3.5-mm microphone** fixed. Use the existing `direct2.wav` baseline when geometry and speaker volume are unchanged.
2. With AIR31 placed on the desk and **not on anyone's ears**, connect AIR31 to Moto g62 using regular Bluetooth media/A2DP, not the headset's microphone/HFP. Start with low phone media volume.
3. Launch **HearLens M04 Off-Ear Bench** (not SW4), verify the on-screen warnings, confirm both checkboxes, and press Start. Grant microphone/Bluetooth permission. The diagnostic must show `active_route=A2DP` and `input=BUILTIN_MIC` **before** beginning the chirps. If it stops instead, share the text diagnostic; do not force a route or boost output.
4. Put AIR31 **near Realtek microphone**, without moving the iPhone source, Android phone or Realtek mic. Start Audacity mono 48 kHz PCM16 recording as before; play all 24 chirps from iPhone once; export `on.wav`. If Android stops before all 24 chirps, that test is **inconclusive**, not a negative latency measurement.
5. Move **only the earbud** relative to Realtek microphone by a measured distance (a clearly different path, preferably ≥1 m). Start a *new* manual bench session, record `moved.wav`, and stop. Keep speaker, phone, PC mic and playback volume unchanged, and record the distance differences.
6. Upload `on.wav`, `moved.wav` and the text diagnostic, plus approximate source→Moto mic, source→Realtek, near earbud→Realtek and moved earbud→Realtek distances. Do not upload raw speech conversations. Existing `direct2.wav` can be reused unless layout or acoustic environment changed; `muted.wav` is **not required**.
7. Run the [M04-D1 mono-analysis script](../../docs/M04D1_MONO_CHIRP_SMOKE_2026-10-16.md) to compare acoustic chirp timing *within each mono recording*, discount stationary echoes and check the moved earbud candidate. No synthetic clock value is Bluetooth latency.

If both test WAVs show no moving earbud-specific peak, classify `INCONCLUSIVE` and inspect diagnostics/recording level; do **not** silently increase gain or claim A2DP latency. If latency is unsuitable for open-fit daily listening, retain captions and investigate ear-local processing instead of long optimization of the wrong path.

**This is not authorization for everyday live hearing assistance.** The native bench has not yet been physically verified on the Moto g62/AIR31 merely because CI compiled it. On-device dry-run of the silent route and manual stop comes first.
