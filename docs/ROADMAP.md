# Roadmap — active plan (2026-10-22)

This page is the current work order. [Historical roadmap](./ROADMAP_HISTORY_2026-10-20.md)
preserves earlier completion details and superseded instructions; its unchecked boxes are **not** new work orders.
[Evidence review and decision gates](./M04D62_DIAGNOSTICS_AND_PROGRESS_RESET_2026-10-22.md).

## Product and equipment commitments

- Phone built-in microphone is primary; ordinary Bluetooth earphones are preferred output.
- Existing kit: Moto g62 / Android 13, AIR31 A2DP, iPhone source, Windows Realtek 3.5-mm mic.
- No purchase, mandatory external microphone, ear-canal sealing, mandatory talker-side phone placement,
  earbud microphone tests, OEM/ODM project or wired-headphone migration.
- The existing owner-approved low-level **off-ear** bench remains separate from worn hearing output.
  [SAFETY](./SAFETY.md) and the D3 exception still apply.

## Current evidence

| Area | Completed | Open |
| --- | --- | --- |
| M01 captions | Streaming Gemini, Traditional Chinese, large text, focus mode, last-final retention, recall/copy, lifecycle guards | Combined everyday-use acceptance; formal accuracy benchmark deferred |
| M03 personalization | Bilateral profile editor, CAMFIT research arithmetic including pinned upstream cross-check, offline WDRC/limiter | Device output calibration, worn benefit; no clinical prescription claim |
| Android input | Built-in mic demonstrated in SW1; route observed in live bench | Event-window signal quality in recent chirp conditions |
| AIR31 output | Actual playing A2DP route observed; D6.1 playback-head/drain implementation | Detectable earbud-specific acoustic output; D6.1/D6.2 field acceptance |
| Latency | Analysis and bench tools | **No valid phone-mic→AIR31 acoustic latency measurement** |

## Priority 1 — D6.2 diagnostic readiness (software)

- [x] Publish nominal post-track scalar levels and fixed cap budget before unknown OS/earbud volume.
- [x] Add constant-memory 100-ms source RMS windows, separate partial tail and exact-zero runs.
- [x] Separate source/attempted frames, accepted frames, retry events and legacy-loop discarded tail.
- [x] Publish final counters only after writer cleanup; prevent restart until cleanup finishes.
- [x] Preserve D6.1 playback-head/drain checks and all existing output bounds.
- [x] Java behavior tests, existing Node checks and Android APK build PASS on PR #94 code commit `e1d6e8c` ([Android run](https://github.com/edisontw/hearlens/actions/runs/39651830155)); subsequent README changes do not change APK source.
- [ ] Review resulting diagnostics before scheduling a physical trial. No new recordings requested now.

## Priority 2 — Detectable AIR31 output (conditional, one short session)

Only after Priority 1 passes and the trial's measurability is reviewed:

1. Output-only known six-chirp source, no Moto microphone or iPhone source; AIR31 off ears.
2. Use fixed near-mic geometry and existing output limits. Check live recording visibility first.
3. Save one short Realtek recording and final diagnostic only if the signal is observable.
4. A positive result requires recognizable six-event timing and absence of the same pattern in silence.
   Android acceptance/drain alone is not acoustic PASS; this is not an E2E latency measurement.
5. If not observable, label **NOT_MEASURABLE_AT_CURRENT_SETTINGS**. Diagnose level, geometry,
   endpoint and recorder; at most one explicitly justified correction/retest in this round, then park.
   No blind L2 escalation or another direct/on/moved batch.

## Priority 3 — Coarse architecture screen (conditional)

After output presence passes, inspect event-window Moto input and only then reconnect the mic loop.
Design a few longer-spaced, nonperiodic acoustic landmarks so direct source, room echoes and
replayed source cannot be confused with the next event. Compare events within a single recording,
record geometry and source identity controls. Do not subtract timestamps between independent WAVs.
This may establish a coarse delay range, with uncertainty; sparse mono data cannot establish a
validated P95/jitter, calibrated ear SPL or daily open-fit hearing suitability. Stop on ambiguous identity.
Do not assume any measured AIR31 result from Bluetooth research estimates.

## Parallel useful product acceptance — M01

One approximately five-minute everyday caption session can cover Start/Stop, readable focus layout,
last-final retention through silence, recall and manual restart after interruption. Record failure cases
with build/device metadata. This is UX/stability acceptance, not a controlled STT accuracy claim.
Do not require the 24-run formal benchmark while changing the pipeline. No new caption recording
or transcription upload is requested by this software change.

## Parked work

Further generic DSP tuning, neural denoising, ear-local SDK/ODM acquisition, new hardware,
multidevice matrices, SRT trials and absolute ear-level calibration are not the next development task.
Existing evidence should be reused; SW1–SW4 and basic microphone/pairing checks are closed.
Worn live hearing remains unvalidated and is not enabled by D6.2.
