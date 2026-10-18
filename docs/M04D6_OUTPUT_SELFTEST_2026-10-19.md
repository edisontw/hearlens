# M04-D6 — AIR31 self-generated output acoustic gate (2026-10-19)

## Why
D5 `on4_l1.wav` recorded 24/24 direct iPhone Chirps but not a separable AIR31-specific late Chirp. Moto raw mic RMS was −84.1 dBFS despite actual BUILTIN_MIC#15 and AIR31 A2DP#358 route evidence. Avoid unnecessary on/moved reruns and any L2 escalation: first isolate output audibility without microphone input.

## Implemented in separate native debug bench
- `OUTPUT_SELF_TEST` is the default mode. Generates 6 × 40 ms 900→3800 Hz windowed Chirps at 48 kHz, at 1.25, 2.05, 2.85, 3.65, 4.45, 5.25 seconds; PCM output ends at 6.5 seconds.
- Does **not** instantiate `AudioRecord`, request microphone permission, or use any Moto capture samples. Legacy `MICROPHONE_LOOP` exists separately. Both follow existing digital limiter.
- Forces L1 gain 16, ±768 PCM16 hard cap and AudioTrack 0.25, with smooth 1-second profile ramp. No auto L2 or other dynamic amplification. PCM is not saved.
- Requires both off-ear and low-volume confirmations per run, the sole named AIR31 A2DP endpoint, actual A2DP `getRoutedDevice()` three times while playing silent buffers, audio focus, foreground and normal phone mode, media volume nonzero and at most 20% (3/15 on Moto). The app rechecks actual output route and volume during writes. Manual Stop, Bluetooth disconnect, audio focus interruption, route/call/background changes or stall abort; no auto resume.
- Reports `test_mode`, `source`, `active_route`, last actual route, output L1, `digital_levels`, PCM frames, writes, media volume and latched stop reason. No SPL and no E2E latency inferred. Android/Bluetooth queued buffers may cause brief residual speaker output despite stop.
- JVM generator test + output-only route state tests + Node isolation policy checks + Android CI compile and debug APK artifact. M01/M03/SW4 untouched.

## One next physical experiment
1. AIR31 **not worn**, about 5–10 cm from Realtek; leave iPhone source silent. Audacity at 48-kHz mono.
2. Set Moto g62 AIR31 A2DP and media volume 3/15, select OUTPUT_SELF_TEST (default, L1 locked), check both protections, start Audacity then Start once.
3. Allow auto-stop after the six chirps (or press Stop on any fault). Share one `d6_selftest_l1.wav` and the diagnostic text; confirm `source=APP_GENERATED_CHIRP`, `active_route=A2DP` and `stop=self_test_complete`.
4. Six observed acoustic events: initial AIR31 output presence only; next examine Moto microphone −84.1 dBFS and digital zeros **before** E2E measurements. No observed events: investigate OS media volume, AudioTrack writes and AIR31 A2DP output **at L1**; do not repeat D5 series or escalate to L2.

The bench remains nonhuman-only research: not approved for worn earphones, uncalibrated, acoustic P50/P95/jitter unmeasured, and not a hearing aid.
