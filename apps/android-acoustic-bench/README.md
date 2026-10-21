# HearLens Android off-ear acoustic bench — D6.2

Separate debug APK for Moto g62 Android 13 + AIR31 A2DP. Default OUTPUT_SELF_TEST generates
six 160-ms chirps over 6.5 seconds **without microphone input**. MICROPHONE_LOOP is a separate
legacy 40-second experiment. Neither is a hearing aid or permission for worn amplification.

Current work order: [active roadmap](../../docs/ROADMAP.md).
[D6.2 evidence review](../../docs/M04D62_DIAGNOSTICS_AND_PROGRESS_RESET_2026-10-22.md).
Older D4/D5 direct/on/moved instructions are historical; do not repeat that series.

## Current software task — no new recording requested

D6.2 adds diagnostic visibility; it does not increase gain, PCM cap, track scalar, system-volume
allowance or test duration. OUTPUT_SELF_TEST remains L1 only: gain 16, PCM16 ±768,
track scalar 0.25, nonzero Android media volume at most 20% (Moto 3/15).

- Before start: off-ear + low-volume confirmations, exactly one named AIR31 A2DP endpoint.
- Before nonzero samples: observe actual playing A2DP route during silent priming.
- Stop on route/Bluetooth/focus/call/foreground faults or watchdog; manual Stop and no auto-resume.
- D6.1 playback cursor, bounded queue and drain remain active. Cursor consumption is not earbud sound.
- Output is uncalibrated; Android may briefly reroute queued audio to its speaker on failure.
  The owner accepted this residual risk for low-level off-ear research only.
- No network, raw PCM files, audiogram fitting, earbud mic or changes to the caption site/SW4 probe.

## Diagnostic interpretation

| Fields | Meaning |
| --- | --- |
| `raw_*`, `out_pcm_*` | Whole-stream source and generated PCM statistics before track scalar |
| `source_strongest_window_rms_dbfs`, `source_tail_*` | Strongest complete 100-ms source window and separately reported incomplete tail |
| `source_zero_pct`, `source_longest_zero_run_*` | Exact digital zeros; generated chirps intentionally have silence; not proof of mic gating |
| `track_scalar_db`, `nominal_post_track_*` | Scalar arithmetic, before unknown OS/earbud gain; not measured SPL |
| `attempted_pcm_frames`, `accepted_signal_frames` | Source processed versus accepted signal stereo frames (one frame = L+R) |
| `write_retry_*`, `write_counter_scope` | D6 retries do not mean audio loss; legacy loop write attempts can discard a tail |
| `loop_unsubmitted_frames` | Processed but unaccepted legacy-loop frames (including interrupted final buffer); no inference about audible dropout |
| `track_submitted_frames`, `track_priming_frames` | D6 total including priming; legacy loop submitted count excludes uncounted silent priming |
| `track_played_frames`, `android_drain_confirmed` | D6 Android cursor only; legacy loop reports NOT_OBSERVED and false |
| `missed_reads` | Nonblocking zero-return polls, not lost packets |
| `acoustic_output_verified=false` | No app metric proves recorded earbud output or acoustic latency |

Final counters appear after audio-thread cleanup. Start stays disabled until that summary is ready.
L1 cap after nominal 0.25 scalar is approximately **−44.6 dBFS**, before system media volume.
Quiet whole-file RMS alone cannot diagnose microphone failure or identify a chirp above noise.

## Build

GitHub Actions **Android M04 Off-Ear Acoustic Bench**, artifact `hearlens-m04d62-offear-bench-debug`,
APK `hearlens-m04d62-offear-v0.3.2-debug.apk`. Application ID remains `org.hearlens.acousticbench`.
Java 17, Android SDK 35, Gradle/Android Gradle Plugin 8.7.3 are required:

```sh
gradle --no-daemon -p apps/android-acoustic-bench assembleDebug
```

Do not install another APK or collect a new WAV merely because a build passes. First review
readiness under the active roadmap. If a later output-presence check is unmeasurable, diagnose
settings/geometry, allow at most one justified correction/retest, then park this round.
No blind output increase, new hardware or long mic→BT batch is part of this change.
