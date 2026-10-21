# M04-D6.2 — diagnostics and achievable progress (2026-10-22)

## Baseline and owner direction

Verified live main before edits: `e7d3701d088e0e46a1c6e3117a3ceaadb156334e` (PR #93, D6.1).
Owner requested analysis of existing evidence, then execution of its recommendations: improve
software diagnostics and reduce manual measurement burden before requesting more recordings.
No new physical experiment, purchase or worn hearing output is introduced here.

## Existing evidence and interpretation

- Fixed equipment: Moto g62 Android 13 built-in mic → AIR31 A2DP; iPhone stimulus;
  Windows Realtek 3.5-mm microphone. EWM1 remains phone-only optional input, not a required replacement.
- `direct_close.wav` / `on3.wav` / `on4_l1.wav` establish that the PC can capture the iPhone source;
  on4 had 24/24 source landmarks. They do not establish earbud acoustic presence.
- On4 Moto whole-run raw RMS −84.1 dBFS and peak −39.3 dBFS do not alone prove a defective or
  gated mic. Sparse test bursts, silence and noise require event/window analysis.
- L1 ±768/32768 cap is −32.6 dBFS before track scalar. Scalar 0.25 is −12.0 dB, so the nominal
  post-scalar cap is −44.6 dBFS **before** unknown Android index 3/15 and receiver transfer.
  The previous average PCM −64.1 dBFS similarly becomes nominal −76.1 dBFS. These values explain
  a credible measurability limitation, not a calibrated sound level or proven root cause.
- D6 accepted 312000 frames without proving cursor drain; second run stalled before first chirp.
  D6.1 fixes completion accounting, but no D6.1 acoustic field acceptance was supplied at this review.
- Current evidence establishes no reliable phone-mic→AIR31 acoustic latency or ear SPL.
  Findings above reuse committed field summaries; original WAVs were not reanalyzed in this change.

The owner's two deep-research reports support separating caption usefulness, offline prescription
arithmetic and physical hearing-path evidence. Their professional fixtures/SDK routes are not
mandatory tasks for this zero-purchase stage; literature estimates are not AIR31 measurements.
No universal 5/20-ms human acceptance threshold is asserted by this update.

## Implemented diagnostic changes

1. Whole-run levels remain available, with **nominal** post-track estimates and fixed attenuation
   budget. OS index is explicitly not dB; no digital value is labeled ear-level SPL.
2. Constant-memory 100-ms source RMS summaries, completed-window count, separate incomplete tail,
   exact-zero fraction and longest zero run. The strongest window is descriptive, not an SNR or
   automatic signal-detection pass. Source identity is GENERATED_CHIRP or BUILTIN_MIC.
3. Attempted/processed source frames and AudioTrack-accepted signal frames are distinct.
   D6 zero/partial writes are retries. The legacy mic loop discards an unaccepted tail: report its
   exact frame count separately instead of interpreting every old `dropped_writes` event as loss.
   It remains a legacy diagnostic path, not a validated real-time processing chain.
4. Legacy loop actual route is retained and its unobserved playback cursor is NOT_OBSERVED.
   D6 playback-head, bounded queue and drain remain unchanged.
5. Stop first mutes/stops output. Final levels/counters are emitted by the writer after cleanup,
   and restart is disabled until that report is complete, so a new run cannot reset old counters.
6. Versioned debug APK 0.3.2, JVM numerical tests in Android CI, and a single active roadmap.
   Previous roadmap retained as history, not simultaneous instructions to run old tests.

## Next decisions, bounded effort

The [active roadmap](./ROADMAP.md) owns the work order:
software diagnostics/build → output-only detectability → conditional coarse mic-loop screen.
No long direct/on/moved series, SW1–SW4 repetition, automatic L2 increase, or multidevice benchmark.
A future output check uses fixed near-mic geometry and live waveform visibility before saving one
short clip; absent signal is NOT_MEASURABLE_AT_CURRENT_SETTINGS, not silence or a latency result.
At most one justified adjustment/retest per round, then park and record the unresolved limitation.
A separate five-minute caption UX acceptance can progress without hearing-output measurements.

## Verification boundary

Java tests cover sparse-vs-whole-stream RMS, silence, zero-run/window boundaries, partial tails,
negative full scale, digital cap and nominal scalar arithmetic. Existing route/progress/generator
and Node tests remain required; Android CI compiles actual Activity integration.
These checks cannot verify real Android scheduling, physical sound, fallback isolation or worn benefit.
No request for a new recording is made until the software results and measurability are reviewed.
