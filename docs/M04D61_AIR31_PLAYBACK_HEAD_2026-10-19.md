# HearLens M04-D6.1 — AIR31 Android playback-head check (2026-10-19)

## Trigger
- Owner-supplied first D6 acoustic WAV was 48-kHz mono and showed **no reliably separable six-Chirp acoustic pattern**. It alone cannot prove AIR31 silence.
- Moto D6 run A: `active_route=A2DP#382`, source generated without microphone, 312,000 accepted PCM frames (6.5 sec), pre-track/OS peak −32.6 dBFS, `dropped_writes=1010`, `stop=self_test_complete`. The old counter represented non-blocking retries, **not 1,010 permanently lost samples**. Old completion was write-only, not a playback-head drain.
- Run B: `self_test_write_stalled` after 10,080 PCM frames (0.21 sec), before 1.25-sec first Chirp. It provides no acoustic output evidence.

## Changes
1. The 6 Chirps now last 160 ms each, 900→3800 Hz; same onset times, same 6.5-second PCM duration; no peak gain increase, no L2.
2. Count prime-silence frames accepted during exact A2DP route validation, then monitor `AudioTrack.getPlaybackHeadPosition()` (unsigned 32-bit frame count for a short test). Bounded outstanding queue ≤ roughly 200 ms; distinguish accepted frames, cursor-played frames, zero/partial write retries. The previous `dropped_writes` counter is retained for backwards compatibility but is **not audio-loss evidence**.
3. At 6.5-second PCM submission, enter a drain phase. `self_test_complete` requires the Android playback head to reach **all** accepted/primed frames. Progress > 1.8 s stalled or drain > 3.5 s stops with explicit error. Stop, route/focus change, phone call, foreground exit, Android volume change still fail-stop and zero/flush; no auto-resume.
4. Test playback-head logic in pure-JVM `BenchPlaybackProgressTest`, plus Node checks and standard Android debug build. Dedicated output APK v0.3.1.
5. Instrumentation is **not** actual earphone DAC or acoustic verification. Even observed Android completion and A2DP route are software evidence only; only separately recorded, matched AIR31 Chirps demonstrate acoustic presence.

## Next physical validation — one run only
- Do **not** wear AIR31. Lay the earbud speaker 5–10 cm from Realtek desktop microphone. Use no external iPhone tone and no Moto microphone capture.
- Pair AIR31 to Moto g62, Android media volume exactly 3/15 or lower but nonzero. Use D6.1 OUTPUT_SELF_TEST L1 locked. Confirm both off-ear and low-volume checkboxes.
- Start Audacity 48-kHz mono, perform exactly one ~6.5-sec D6.1 session, and export `d61_selftest_l1.wav` plus full App diagnostic.
- Verify six 160-ms sweeps and the `android_drain_confirmed` result before deciding what needs fixing. If clear sweeps are absent, **do not assume acoustic mute or raise L2**; diagnose A2DP playback path first. If present, proceed to diagnose original Moto built-in mic `−84.1 dBFS` issue.
- No calibrated ear SPL, E2E latency, wearable hearing-aid claim, or zero phone-speaker-leakage guarantee.
