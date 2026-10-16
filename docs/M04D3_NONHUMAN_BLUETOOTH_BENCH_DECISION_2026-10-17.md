# M04-D3 — Owner-approved practical Bluetooth test risk boundary (2026-10-17)

**Decision:** The owner explicitly accepts that, during an **off-ear, low-level, nonhuman acoustic experiment**, stock Android 13 may briefly leak already-queued audio to the phone speaker before the application receives a Bluetooth route change. Do not let an impossible software-only proof of *zero* speaker fallback hold up the next engineering experiment.

This **changes the M04 nonhuman test entry criteria**, not the claims of a final hearing aid. Normal/worn hearing amplification still has unresolved ear-level SPL/MPO, feedback, bilateral calibration, clinical fit and long-term route-safety requirements. This document supersedes M04-D2's absolute physical-interlock requirement **only for the controlled off-ear bench**. D2 remains a truthful evidence audit of what has not been physically proven.

## Two gates, not one

| Scenario | Status | Minimum conditions |
| --- | --- | --- |
| SW1–SW4 input and route-prediction observations | Completed; no repeat | Existing accepted evidence |
| Controlled, off-ear Moto g62 → AIR31 Bluetooth test stream | **Conditional GO for implementation and supervised nonhuman bench**, not yet executable | Actual native app, explicit manual start, low fixed digital output cap, limiter, active A2DP route check, route-loss interrupt, abort on app background/call/focus loss, watchdog/time limit, manual Stop, no auto-restart |
| Earbuds worn by a person as live hearing amplification | **Not authorized / not verified** | Independent real-path L/R output constraints, measured acoustic SPL/MPO, feedback response, validated fitting and additional route-risk acceptance |
| Clinical or consumer hearing aid claim | **Not authorized** | Further validation beyond an experimental app |

The accepted **residual risk** is *brief unintended sound from a phone speaker* when A2DP fails after some PCM has been queued. The app must reduce its likelihood and duration with stopping, muting and flushing, but must **not** claim hard isolation or zero leaked samples. If the phone emits unexpected sound during a controlled off-ear test, stop and log the observation. This risk acceptance does not mean ignoring a confirmed defect indefinitely.

## Next implementation: separate off-ear debug APK, not the caption website

Build a standalone, foreground-only Android 13 debug APK, distinct from the existing SW4 **input-only** app, with these characteristics:

1. Source: Moto g62 **built-in microphone**, 48 kHz mono PCM16, no AIR31 headset microphone or HFP/SCO. Destination: connected **AIR31 A2DP**, verified against `AudioTrack.getRoutedDevice()` **after** starting a silent output track. `setPreferredDevice` is only a request; neither it nor the passive SW3 observation proves the actual route.
2. Before user confirmation, generate **no real nonzero PCM playback**. Require explicit "earbuds removed from ears" acknowledgement; headphones on desk; iPhone acts as fixed chirp source. Limit the per-sample digital output and track volume independently, start with a gain ramp, and never use automatic volume enhancement. Digital limits are not calibrated dB SPL.
3. If AIR31 disconnects, actual route changes, HFP/call/focus change occurs, background/permission/microphone failure occurs, or a timer/watchdog expires: latch STOP, set track volume to zero, stop new PCM, `pause/flush/stop` playback, discard any queued app buffers. A Bluetooth reconnect **never auto-resumes**; user must manually restart from a clean session.
4. A bounded 40-second manual session, permanent visible Stop and diagnostic report of route identity, first routed-device observation, start/stop reason, underruns and overflows, with no raw speech saved or sent to a server. Prefer no internet permission. Ensure no callback can revive a stopped session.
5. Use a **simple bounded passthrough** as the first transport feasibility test, not the full nonlinear CAMFIT/WDRC. If physical latency is unsuitable for face-to-face open-fit use, stop investing in the phone→A2DP hearing loop and retain captions/consider device-local processing.

## Test protocol after APK CI and code review

No new equipment and no repeated baseline recordings are required by default. Existing `direct2.wav` (iPhone→Realtek) is a preliminary reference. With AIR31 **not worn**, place the earbud near Realtek PC microphone, keep iPhone source fixed and record `on.wav` while the Android test route runs, then move *only* the earbud by a measured distance and record `moved.wav` in a new manually started session. Use the same 24-event chirp WAV. The M04-D1 mono analysis compares arrival differences **within each recording**, not absolute timestamps across phones, and checks movement against room echoes. If the new room/speaker/mic position changes appreciably, redo a single `direct.wav` baseline; `muted.wav` remains optional. No human wearing or audiogram amplification in the first bench.

## Engineering acceptance vs proof

- **PASS to implement:** consent, fixed low-cap digital stream, actual routed A2DP observation, route-stop event matrix, manual stop, lifecycle/call/focus fail-stop, no auto-resume, CI native APK compile.
- **PASS to run the off-ear bench:** compiled APK and protections visibly functional, low OS volume, headphones physically not worn, and manual stop available. Owner knows speaker-leak residual risk is not eliminated.
- **PASS to claim acoustic latency:** PC mono recordings isolate an earbud-specific moving signal from stationary reflections with valid geometry. Report P50/P95/jitter and unresolved events; do not invent timing from SW4 software clock.
- **NOT a PASS:** successful metadata tests, a stable predicted route, or an off-ear low-volume clip do not prove output safety for daily wearable hearing assistance.

Implementation work remains outstanding. This approval removes only the impossible zero-leak **precondition** to the nonhuman test, not the requirement to code and test a working native route-loss stop.
