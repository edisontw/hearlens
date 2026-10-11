# HearLens M03 Part F — handoff 2026-10-11

Fetch the **current** GitHub main SHA at start of next work; main is the sole source of truth. Part F began from `5279b517d17ab42547892f203d9fbdd8222608a7`. See `docs/M03_DENSE_CROSSOVER_AB.md` for reproducible numbers and test interpretation.

## Project state

- M01 caption-first workflow and Gemini Live setup remain untouched; last known user-facing Web build `20261008-stop-flush1`. M01 formal 24-run benchmark still **deferred**, not passed. No new HTC/iPhone 0.5/1/2m matrix.
- M03A: local/private-by-default per-ear audiogram data model; does not transform dB HL directly into dB gain.
- M03B: per-ear synthetic research target I/O representation at nominal 50/65/80 dB SPL labels; these are *not measured SPL or clinical targets*.
- M03C: synthetic-only 6–8 band WDRC numerical renderer with final Float32 limiter.
- M03D: fixed synthetic frequency, compression, step, digital limiter report and Linux batch throughput characterization; **not** live latency.
- M03E: opt-in cosine smoothing across FFT-bin spectral band boundaries, while preserving `hard` as default.
- **M03F:** deterministic dense A/B across all 5 six-band and 7 eight-band boundaries, selected harmonic/two-tone/intermod-like sideband, click pre/post-energy and final digital limiter tests. Implementation: `packages/dsp/offline-wdrc.ab.testkit.mjs`, tests `packages/dsp/offline-wdrc.ab.test.mjs`, CLI `tools/characterize-crossover-ab.mjs`, `npm run characterize:crossover`.

## Evidence and decision

- Part F branch GitHub Actions [#38102134441](https://github.com/edisontw/hearlens/actions/runs/38102134441): 93 tests PASS.
- Smooth reduced maximum adjacent measured gain jumps for **all 12** synthetic boundaries. Worst across study: Hard 6.421 dB versus Smooth 1.577 dB. Fixture-specific; not perceptual/clinical certification.
- Two-tone 1400-Hz relative sideband is −56.685 dBc Hard vs −54.481 dBc Smooth (Smooth slightly larger). H2–H5 projections at 1410 Hz: ~0.021% for both. Click pre/post energy slightly lower Smooth; neither hearing-quality nor listening validation.
- **Decision: keep `hard` as offline default. `smooth` remains opt-in**, even though its synthetic boundary smoothness improved. Do not claim globally lower distortion or enable audio output.

## Next efficient development slice

Focus on streaming-state DSP architecture and block-boundary continuity *offline*; additionally broad two-tone/noise modulation artifacts, phase/group delay and filterbank characterization. Avoid changing M01 capture presets, STT or Pages. Do not approach M04 earphones before calibrated output limiter, per-ear gain/MPO, route/disconnect fail-safe, device test and measured end-to-end latency.

Run `npm test`, `npm run characterize:dsp`, `npm run characterize:crossover`. Machine throughput is non-gating.
