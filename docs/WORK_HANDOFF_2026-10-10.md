# HearLens development handoff — 2026-10-10 (M03 Part D)

GitHub `main` is the only source of truth. **Fetch current main SHA before every new change**. This handoff is written from the Part D feature branch, based on pre-change main `ef792a90e08e6ae8759170200ee672e1cc61c43e`; do not mistake that for a guaranteed future main SHA.

## Product and completed work

- M01 caption-first prototype deployed, last known Web build `20261008-stop-flush1`; Gemini Live through MN4 ephemeral-token broker; M01 formal 24-run distance benchmark stays deferred. No new HTC retesting on exploratory mismatched acoustics.
- M03 Part A: offline versioned left/right dB HL audiogram + bounded log-frequency interpolation and provenance; no direct threshold-to-gain conversion.
- M03 Part B: separate versioned per-ear research target I/O profile, nominal 50/65/80 dB SPL labels, strict origin and interpolation bounds. No NAL-NL2/DSL parity claim.
- M03 Part C: synthetic-only 6–8 band 1024-point FFT WDRC offline renderer; final post-sum digital limiter. No live route, calibrated output or clinical safety.
- **M03 Part D**: deterministic synthetic-only DSP characterization module and tests, CLI report, GitHub CI output of stable metrics plus optional non-gating batch CPU timings. See `docs/M03_DSP_CHARACTERIZATION.md`.

## Part D evidence and conclusion

- Reference GitHub Actions: run `38045801520` (numerical report) and `38045889899` (repeat + throughput).
- Root test suite at Part D feature branch: **80/80 PASS** including eight new characterization checks.
- Uniform +6 dB fixture settled at 5.828 dB at all six measured test tones; compression gain at 1000 Hz falls 10.479 → 6.860 → 3.889 dB across the three amplitude fixtures.
- Envelope direction and post-mix digital ceiling checks PASS; no statement of clinical calibration or true peak.
- **Blocking discovery**: hard FFT bin partition produces ~3.618 dB change over just 10 Hz (1410 → 1420 Hz) at the 1000/2000 Hz band crossover in a deliberately selective-gain fixture. This is *not* acceptable evidence of a smooth filterbank. No core DSP change was made in Part D merely to hide this defect.
- Linux runner optional batch throughput median: 11.289/18.008/32.630 ms per 1 s mono clip at 16/24/48 kHz. **Not live microphone-to-earphone latency or phone performance.**

## Next development priority

Do **M03 Part E — mitigate discontinuous crossovers** through matched A/B synthetic measurements, then characterize full-spectrum artifacts. Preserve the zero-gain reconstruction and final post-sum limiter safety gates. Do not begin live amplification; M04 calibrated wired input/output, per-ear MPO, ramping, routing/disconnect fail-closed and acoustic latency remain future prerequisites. Keep M01 capture/normalization and STT untouched, and avoid re-running the deferred phone distance benchmark.

## Key paths

- `packages/dsp/offline-wdrc.mjs`, `packages/dsp/offline-wdrc.test.mjs`
- `packages/dsp/offline-wdrc.characterization.mjs`, `packages/dsp/offline-wdrc.characterization.test.mjs`
- `tools/characterize-offline-wdrc.mjs`
- `docs/M03_OFFLINE_WDRC.md`, `docs/M03_DSP_CHARACTERIZATION.md`
- `docs/ROADMAP.md`, `docs/AUDIOGRAM_FITTING.md`, `docs/SAFETY.md`
- Run `npm test`, `npm run characterize:dsp`; optionally `npm run characterize:dsp -- --benchmark`.

## Safety/decision boundary

Synthetic named SPL reference levels are labels, not measured ear or environmental SPL. Digital limiter only constrains Float32 PCM values. NAL-NL2, DSL, prescription output, clinical fitting, device calibration and all ear-level safety assertions remain unavailable. Keep audiogram local/private by default. Browser/native hearing output is not authorized.
