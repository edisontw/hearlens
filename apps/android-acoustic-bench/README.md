# M04-D6.1 — AIR31 output playback-head verification (off-ear, v0.3.1)

**D6.1 is the next single diagnostic test.** Review of the first D6 desktop recording and Moto diagnostics established: (a) 312,000 application-generated frames were accepted by AudioTrack but six acoustic Chirps were not reliably detected; (b) a second run stalled before the first Chirp. The earlier `self_test_complete` did **not** wait for the Android playback cursor. This change fixes that diagnostic ambiguity; it does **not** prove physical AIR31 speaker output.

The **OUTPUT_SELF_TEST** mode remains microphone-free and generates six Hann-windowed **160-ms** 900–3800-Hz Chirps at 48 kHz, at 1.25, 2.05, 2.85, 3.65, 4.45 and 5.25 seconds. The PCM stream remains 6.5 seconds; 160 ms is 4× the former pulse duration with **unchanged 64-unit raw peak**, same L1 gain 16, PCM16 hard cap ±768, AudioTrack scalar 0.25 and Moto media-volume ceiling 3/15. It increases integrated energy and visual identifiability **without raising the peak ceiling**. No L2 and no wearing the earphones.

The D6.1 worker paces `AudioTrack.write(WRITE_NON_BLOCKING)` using `getPlaybackHeadPosition()`, restricts outstanding AudioTrack PCM to roughly 200 ms, separately logs zero and partial write retries, and **only** records `stop=self_test_complete` after the Android playback head catches up with all accepted PCM (including silent route-validation buffers). A stalled playback head, unavailable routing, interrupted focus, foreground exit, route loss or volume change stops the session. The playback cursor can still reflect OS/driver consumption rather than actual RF arrival or acoustic sound: `android_drain_confirmed=true` is **not** `acoustic_output_verified=true`. If a device fails to advance the Android playback cursor correctly, report the new stop reason rather than infer output. Normal drain is bounded to 3.5 seconds; playback progress stall watchdog is 1.8 seconds. Stop/route-loss immediately mute and flush.

**Only next owner field test:** AIR31 off-ear, 5–10 cm from PC Realtek microphone; no iPhone playback or Moto microphone input. Audacity 48 kHz mono, Moto A2DP at 3/15, both mandatory safety confirmations, D6.1 L1 only, run once. Export one `d61_selftest_l1.wav` and the entire diagnostic text, including `track_submitted_frames`, `track_played_frames`, `android_drain_confirmed`, `write_retry_zero`, `write_retry_partial` and stop reason. If acoustic chirps are identified and confirmed as AIR31, proceed to investigate weak Moto microphone input; otherwise analyze playback route / Android buffering at **L1**, no repetitive D5 trials.

CI **Android M04 Off-Ear Acoustic Bench** packages `hearlens-m04d61-offear-bench-debug` containing `hearlens-m04d61-offear-v0.3.1-debug.apk`. Debug signing may require uninstalling the **bench only**, never SW4. M01 captions, M03 DSP, and D5 legacy mode are unchanged.

See [D6.1 playback troubleshooting](../../docs/M04D61_AIR31_PLAYBACK_HEAD_2026-10-19.md) and the earlier [D6 research record](../../docs/M04D6_OUTPUT_SELFTEST_2026-10-19.md).

---

## Previous M04-D6 implementation (historical)


**NEW default mode: OUTPUT_SELF_TEST.** The App directly generates six known, Hann-windowed 40-ms 900–3800-Hz Chirps at 48 kHz, beginning 1.25 seconds after output begins, at 800-ms intervals; total PCM playback is 6.5 seconds. This mode **does not open or read a microphone**. The former M04-D5 `MICROPHONE_LOOP` remains available as a separate labeled mode but is **not** required for the next test.

D6 forces **L1_MEASURE** only (16× processing, ±768 PCM16 limiter, AudioTrack 0.25 scalar), with existing one-second smooth ramp. L0 and L2 cannot be selected for D6. It requires manual off-ear and low-volume confirmations, exactly one identifiable AIR31 A2DP output, actual AudioTrack A2DP routing on silent buffers, and **nonzero Android media volume ≤20% of maximum** (Moto g62 3/15 is accepted). Changing route, focus, volume, phone mode or foreground state triggers fail-stop. Stop manually at any time. No reconnect autorestart. Software cannot guarantee zero queued phone-speaker sound or physical safe SPL.

**Next physical test: only D6**. Place AIR31 off-ear within 5–10 cm of Windows Realtek mic; **do not play any iPhone chirps**. Start Audacity 48-kHz mono recording, then run D6 with Moto media volume 3/15 and both confirmations. The app auto-stops after approximately 6.5 seconds. Export `d6_selftest_l1.wav` and the diagnostic text. Search for the six App-generated Chirps. If detected, AIR31 output audibility is provisionally established; investigate Moto mic −84.1 dBFS next. If absent, inspect volume, A2DP route and PCM writes **without escalating to L2 or rerunning D5 on/moved**. Do not interpret this as E2E latency, SPL, or clinical-use evidence.

CI workflow **Android M04 Off-Ear Acoustic Bench** publishes `hearlens-m04d6-offear-bench-debug` containing `hearlens-m04d6-offear-v0.3.0-debug.apk`. Install on owned Moto g62 only using `adb install -r`; distinct app ID remains `org.hearlens.acousticbench`. Its debug signature may require uninstalling the prior **bench only**, not SW4. Nothing records audio; diagnostics report mode, L1, digital RMS/peak/limiter, actual route, Android volume, PCM writes and stop reason. See [D6 technical handoff](../../docs/M04D6_OUTPUT_SELFTEST_2026-10-19.md).

---

## Historical M04-D5 procedure (do not repeat for D6)


**No consumer hearing assistance and no use while wearing the earphones.** This is an intentionally separate native Android APK, `org.hearlens.acousticbench`, not the existing SW4 input-only diagnostic APK and not the M01 caption website. It intentionally implements only a bounded **phone built-in microphone → selected fixed measurement gain → digital limiter → connected A2DP** stream, to establish whether ordinary Bluetooth is fast enough for the HearLens product concept.

## Scope and sound limits

- A *single* connected Bluetooth A2DP endpoint must be present. The app logs the Android product name and device ID; verify it is AIR31. Other devices or ambiguous A2DP endpoints block start.
- The AIR31 earphones must be **on a table, never worn**. On-screen confirmations are mandatory before each run. No clinician-verified output, acoustic SPL/MPO, or feedback bounds are claimed.
- Format: input PCM16/48 kHz/mono, streamed PCM16/48 kHz/stereo; each sample duplicated to L/R. **Output is a three-level, pre-start selection only**, not calibrated ear loudness, audiogram amplification or general volume control:

| Level | App gain | Hard cap (PCM16) | AudioTrack scalar | Absolute pre-OS numerical ceiling (at full-scale input) |
| --- | ---: | ---: | ---: | ---: |
| **L0 baseline (default)** | 8× | ±384 | 0.15 | about −55.1 dBFS |
| **L1 measurement (next trial)** | 16× | ±768 | 0.25 | about −44.6 dBFS |
| **L2 measurement (only if L1 remains inconclusive)** | 24× | ±1536 | 0.35 | about −35.7 dBFS |

These calculated ceilings apply **before** Android's media-volume control and AIR31's acoustic transfer. They do not imply any verified dB SPL output or zero speaker leakage. Profile cannot be changed during playback. Each new session requires both off-ear and low-OS-volume checkboxes again; do not jump to L2 without first inspecting L1. Fixed one-second software ramp is applied to all modes.
- At manual/automatic stop the app reports `digital_levels` including `raw_rms_dbfs`, `raw_peak_dbfs`, `out_pcm_rms_dbfs`, `out_pcm_peak_dbfs`, `limited_pct`, attempted PCM frames, chosen tier and Android media-volume step. These are **metadata of digital PCM attempted before AudioTrack/OS output**, not an earbud-microphone SPL measurement, recording of speech, or proof of which samples reached the receiver. A tiny `raw_rms_dbfs` can explain why increasing the app level has limited benefit. Stopping during the test still logs the attempted sample summary.

- Track starts at volume zero; only after three stable observed `AudioTrack.getRoutedDevice()` A2DP checks while the track is playing *silent buffers*, and confirmation of a **built-in** microphone's actual input route, can nonzero PCM begin. Note that an actual routed-device query is **not** a hard lock against Android buffered speaker fallback.
- Foreground-only, fixed **40-second maximum**, immediate visible Stop, no app recording to file, no internet permission, no raw speech export; only metadata/text diagnostics can be shared. The existing SW4 input-only APK is not modified.

## Automatic stop behavior

The app attempts to stop new PCM production, zero the player volume, pause/flush/stop the local AudioTrack on: Android device removed, actual route switch, unexpected phone mic route, call / abnormal audio mode, lost audio focus, mic or track write error, input watchdog, leaving foreground, timeout or user Stop. **Reconnect never restarts**. These are best-effort application-level controls; already queued audio inside Android/Bluetooth may escape before a notification. The owner accepts this specific *brief phone-speaker leakage* residual risk for **off-ear testing only** (see [D3 decision](../../docs/M04D3_NONHUMAN_BLUETOOTH_BENCH_DECISION_2026-10-17.md)).

## Build and install

CI: GitHub Actions **Android M04 Off-Ear Acoustic Bench**, artifact `hearlens-m04d5-offear-bench-debug` contains `hearlens-m04d5-offear-v0.2.0-debug.apk`.

Manual build requires Java 17, Android SDK 35 and Gradle with Android Gradle Plugin 8.7.3:

```sh
gradle --no-daemon -p apps/android-acoustic-bench assembleDebug
adb install -r apps/android-acoustic-bench/app/build/outputs/apk/debug/app-debug.apk
```

Install only on the owned Moto g62 Android 13 test phone. App identity `org.hearlens.acousticbench` avoids collisions with `org.hearlens.micprobe`. Debug signing certificates on different GitHub Actions runners can differ; an existing debug build might need uninstalling *that bench APK only*. Never uninstall SW4 or change the caption site just to install the bench.

## Immediate M04-D5 acoustic next step (after M04-D4 on3)

Previous `on3.wav` showed **24/24 clear iPhone direct-source chirps** with iPhone 10 cm from Realtek, and verified AIR31 A2DP/phone mic routing, but no separated **late AIR31 chirp**. Thus the only next field trial should be **L1**, not a repeat of SW1–SW4 or an automatic second-position recording.

1. Keep the successful **on3 geometry**: iPhone speaker about **10 cm from Realtek**, Moto g62 built-in mic about **10–20 cm from iPhone speaker**, AIR31 both earphones placed **5–10 cm from Realtek** and **not worn**. The three devices other than AIR31 stay stationary. Do not obstruct the direct iPhone→Realtek line.
2. Pair AIR31 to Moto over **A2DP media**; phone media volume initially low, fixed for the run. Open the **new M04-D5 v0.2.0** Android bench. Select **L1 測量** (NOT L2); reconfirm both safety checkboxes.
3. Start Audacity on Windows/Realtek at 48-kHz mono. Press Start on Moto, wait for `active_route=A2DP`, and then play the **same boosted -20 dBFS, 25.5-second, 24×40 ms iPhone Chirp** used in successful on3. Ensure *actual physical speaker playback* and keep everything still until completion.
4. Stop within 40 seconds. Export exactly one `on4_l1.wav`, and share **the full M04-D5 diagnostic text including `digital_levels`**. Do **not** make `moved` yet. Compare same-recording early direct-source chirps versus any delayed candidate after the track volume is raised one step.
5. If direct 24/24 remains detectable but no AIR31 candidate emerges, diagnose `raw_rms_dbfs` / `out_pcm_rms_dbfs` / `limited_pct` and source→Moto positioning before deciding whether a single **L2** run is warranted. Avoid changing iPhone source or Windows recording levels between controlled comparisons. If AIR31 produces an identifiable delayed component, only then perform a single moved-earbud recording at the **same level** for source-motion confirmation.

The `direct_close.wav` near-source baseline (18 consecutive events) and `on3.wav` (24/24 direct events) already establish capture; **do not repeat baseline** unless the room geometry changes appreciably. A digital PCM level change alone does not prove AIR31's actual acoustic latency.

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
