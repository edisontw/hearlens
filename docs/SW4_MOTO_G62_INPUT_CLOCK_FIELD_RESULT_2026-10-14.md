# SW4 field acceptance — moto g62 5G input clock (2026-10-14)

**Result: PASS for Android input timestamp availability and continuity on this one phone/session. Separate unresolved observation: many captured input windows were digitally all zero. NO acoustic or Bluetooth latency result and NO hearing output authorization.**

## Source and scope

- User-provided **metadata-only** report, `hearlens-sw1-input-probe-v1` envelope, generated 2026-10-14 approximately 17:42–17:44 +0800; do **not** store raw user event log or voice content in the repository.
- App identity `probe_build=20261014-sw4-input-clock-v0.4.0`; Android 13 / API33, Motorola moto g62 5G, AIR31 paired as an available Bluetooth device.
- Actual **input** while recording: `BUILTIN_MIC#15`, request `MIC` with system default preference. Client and reported device: 48 kHz, mono PCM16. `effects=0`, `client_effects=0`, `silenced=false`, `active_mic_count=1`. These flags do not prove that vendor noise gating / DSP is absent.
- User-started capture 17:43:54.443 to 17:44:22.400; exported `pcm_frames_read=1,327,680`, equivalent to **27.66 seconds of client PCM frames** at 48,000 samples/s (not physical/acoustic latency). `stop_requested=user_stop`, followed by `capture_end reason=capture_finished`; this is an ambiguous display of an otherwise explicit user stop, not an observed fault. `noPCM=true`, `noOutput=true`.

## Input-clock results

26 consecutive `SW4_input_clock` observations were recovered from the shared pasted report. Each paired with Android `AudioRecord.getTimestamp(TIMEBASE_MONOTONIC)` success (`tsStatus=0`).

| Metric | Result |
|---|---:|
| Timestamp observations | **26** |
| First baseline observations | 1 `FIRST_SAMPLE` |
| Consecutive `STABLE` observations | **25** |
| Reported `UNAVAILABLE`, `STALE`, `INVALID`, `DISCONTINUITY` | **0** |
| Timestamp age (`timestampAgeMs`) min / median / max | **1.715 / 4.829 / 9.471 ms** |
| Signed incremental frame-clock skew (`frameClockDeltaMs`) min / median / max (25 valid differences) | **−2.254 / −0.016 / +2.598 ms** |
| Input capture reported route | `BUILTIN_MIC#15` |

This satisfies the limited **SW4 input timestamp plumbing/continuity acceptance** on this one Android device. The age is how old the OS timestamp was **at time of inspection**; the pairwise frame-clock skew is a timing-consistency diagnostic. **Neither** is analog sound→mic conversion latency, STT latency, complete phone mic→Bluetooth earbud acoustic delay or jitter, nor evidence of ear-output sound pressure.

## Separate digital-silence observation — not a SW4 timestamp failure

The uploaded event record includes **26 one-second `level:` rows**; two rows were split by the user's pasted Markdown formatting and reconstructed from the adjacent text/frames, not additional trials. Of these, **20/26** show `rms_dBFS=−180.0, peak_dBFS=−180.0`, which is the code's floor for `rms=peak=0` (all captured PCM samples in the interval are zero). Six report nonzero energy:

| Approx local time | RMS dBFS | Peak dBFS |
|---|---:|---:|
| 17:43:58 | −105.8 | −63.9 |
| 17:44:02 | −105.9 | −74.7 |
| 17:44:03 | −70.6 | −44.3 |
| 17:44:09 | −101.1 | −63.9 |
| 17:44:10 | −99.4 | −74.7 |
| 17:44:17 | −131.1 | −84.3 |

Reported `clipped=0` for every sample window. This was an **ambient, non-controlled, input-only** test; no confirmed simultaneous external signal or calibrated environmental SPL. Therefore **do not** interpret all-zero windows as proof of broken microphone or of real acoustic quiet/noise suppression. Possibilities include vendor hardware/software muting or gating, environment, OS behavior, or other capture-path circumstances; the logs alone cannot distinguish them. `effects=0` and `silenced=false` do not rule out all vendor DSP. Earlier controlled SW1 phone-mic testing captured speech-associated digital energy, so repeating SW1, a distance matrix or Bluetooth headset-mic trials is **not required** to accept SW4 input-clock instrumentation. Record as **audio-amplitude observation pending only if an actual audible-speech failure arises**.

## Bluetooth route evidence — prediction only, not new acceptance

The same app reported `USAGE_MEDIA/SPEECH` and `USAGE_ASSISTANCE_ACCESSIBILITY/SPEECH` predicted future routes as `AIR31 BLUETOOTH_A2DP`. The report explicitly states `SW3_OUTPUT_ACTUAL_ROUTE=UNOBSERVABLE_NO_PLAYBACK`. This is consistent with the previously accepted [SW3 AIR31 single-button result](./SW3_NATIVE_AIR31_FIELD_RESULT_2026-10-13.md); **do not** treat it as verification of active Bluetooth output, codec delay, headset wearing state, per-ear MPO, or fail-closed speaker suppression.

## Decision

- **SW4 field input-clock diagnostic: PASS** on the tested Moto g62 Android 13 configuration. No further mandatory clock audit or speech playback required.
- **Input acoustic performance/SNR/absolute SPL: NOT MEASURED**; digital all-zero intervals remain observational and must not be auto-corrected with gain.
- **Bluetooth output delay, physical no-speaker-fallback mute, receiver-specific left/right acoustic calibration and ear MPO: NOT MEASURED** and continue to block any live hearing amplification.
- **Next true gate:** as described in the [SW4 staged nonhuman acoustic bench plan](./SW4_ANDROID_INPUT_CLOCK_AND_ACOUSTIC_BENCH_DECISION_2026-10-14.md), a properly instrumented physical latency/mute/SPL bench, and assessment of the alternate [M04 ear-local DSP feasibility](./M04A_EARBUD_LOCAL_DSP_FEASIBILITY_2026-10-12.md). If those constraints are not feasible, retain caption-only and do not substitute this input-clock PASS for a real hearing-output PASS.

Recorded from user-supplied diagnostic metadata; no raw recording, transcript or identifying handset address stored.
