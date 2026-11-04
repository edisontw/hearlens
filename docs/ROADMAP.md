# Roadmap — active plan (2026-11-02)

This page is the current work order. [Historical roadmap](./ROADMAP_HISTORY_2026-10-20.md)
preserves earlier completion details and superseded instructions; its unchecked boxes are **not** new work orders.
[Evidence review and decision gates](./M04D62_DIAGNOSTICS_AND_PROGRESS_RESET_2026-10-22.md).
[Hourly delivery policy](./CONTINUOUS_DELIVERY_PLAN_2026-11-02.md).
[First 12-round delivery review](./DELIVERY_REVIEW_ROUND12_2026-11-02.md) (merged outcomes, avoidable work and next evidence-gated slices).

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

## Active delivery order — 2026-11-02

The [hourly continuous-delivery plan](./CONTINUOUS_DELIVERY_PLAN_2026-11-02.md) defines the current priority and evidence gates. **M01 caption-first usability is the primary delivery lane (~60%)**, M04 measurable Bluetooth feasibility is conditional (~25%), and M03 offline research/safety regressions are parallel (~15%). Verified safety, privacy or CI regressions override the percentages.

- **Android caption field fix (2026-11-04):** Auto selects OS voice capture on Android based on current field observations (raw/Auto no text, far/voice transcribes); non-Android defaults remain raw; explicit raw URL override stays research-only. No in-session auto-switch or claimed scene recognition. A passive warning requires transmitted audio, multiple speech-active reports and 15 s without text. See [decision note](./M01_ANDROID_AUTO_VOICE_2026-11-04.md).
- **Next M01 slice:** audit primary Gemini 3.5 Transcribe Live/MN4 token startup, expiry, network interruption and actionable manual recovery. #96–#103/#105 already cover several Stop, review and optional-provider failures; fix only a new reproducible gap. The formal 24-run recognition matrix remains deferred.
- **Next M03 slice:** investigate one concrete offline left/right, CAMFIT/WDRC or final digital-limiter numerical/fail-closed defect; add deterministic regression only if the current suite misses it. No uncalibrated live playback.
- **Next M04 slice (conditional):** #104 provides an offline six-chirp presence screen, **not** measured AIR31 output. Review existing D6.2 evidence and any available original WAV first. Without earbud-specific acoustic evidence, park the physical gate and continue M01/M03; no recurring recording request.
- **Hourly workflow:** fresh `main` SHA and CI/Pages review → one testable change → branch/PR → verified CI → safe merge → verify `main`; every 12 rounds reassess delivered value. No artificial docs-only commits or repeated SW1–SW4 tests.

## Primary lane A — M01 everyday caption acceptance

One approximately five-minute everyday caption session can cover Start/Stop, readable focus layout,
last-final retention through silence, recall and manual restart after interruption. Record failure cases
with build/device metadata. This is UX/stability acceptance, not a controlled STT accuracy claim.
Do not require the 24-run formal benchmark while changing the pipeline. No new caption recording
or transcription upload is requested by this software change.

## Conditional lane B — D6.2 diagnostic readiness (software)

- [x] Publish nominal post-track scalar levels and fixed cap budget before unknown OS/earbud volume.
- [x] Add constant-memory 100-ms source RMS windows, separate partial tail and exact-zero runs.
- [x] Separate source/attempted frames, accepted frames, retry events and legacy-loop discarded tail.
- [x] Publish final counters only after writer cleanup; prevent restart until cleanup finishes.
- [x] Preserve D6.1 playback-head/drain checks and all existing output bounds.
- [x] Java behavior tests, existing Node checks and Android APK build PASS on PR #94 code commit `e1d6e8c` ([Android run](https://github.com/edisontw/hearlens/actions/runs/39651830155)); subsequent README changes do not change APK source.
- [ ] Review resulting diagnostics before scheduling a physical trial. No new recordings requested now.

## Conditional lane B — Detectable AIR31 output (one short session)

Only after the D6.2 software-readiness review passes and the trial's measurability is established:

1. Output-only known six-chirp source, no Moto microphone or iPhone source; AIR31 off ears.
2. Use fixed near-mic geometry and existing output limits. Check live recording visibility first.
3. Save one short Realtek recording and final diagnostic only if the signal is observable.
4. A positive result requires recognizable six-event timing and absence of the same pattern in silence.
   Android acceptance/drain alone is not acoustic PASS; this is not an E2E latency measurement.
5. If not observable, label **NOT_MEASURABLE_AT_CURRENT_SETTINGS**. Diagnose level, geometry,
   endpoint and recorder; at most one explicitly justified correction/retest in this round, then park.
   No blind L2 escalation or another direct/on/moved batch.

## Conditional lane B — Coarse architecture screen

After output presence passes, inspect event-window Moto input and only then reconnect the mic loop.
Design a few longer-spaced, nonperiodic acoustic landmarks so direct source, room echoes and
replayed source cannot be confused with the next event. Compare events within a single recording,
record geometry and source identity controls. Do not subtract timestamps between independent WAVs.
This may establish a coarse delay range, with uncertainty; sparse mono data cannot establish a
validated P95/jitter, calibrated ear SPL or daily open-fit hearing suitability. Stop on ambiguous identity.
Do not assume any measured AIR31 result from Bluetooth research estimates.

## Parked work

Further generic DSP tuning, neural denoising, ear-local SDK/ODM acquisition, new hardware,
multidevice matrices, SRT trials and absolute ear-level calibration are not the next development task.
Existing evidence should be reused; SW1–SW4 and basic microphone/pairing checks are closed.
Worn live hearing remains unvalidated and is not enabled by D6.2.
