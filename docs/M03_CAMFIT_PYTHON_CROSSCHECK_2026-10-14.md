# M03 Part P — Direct upstream Python CAMFIT cross-check (2026-10-14)

**Status:** Direct original-source, integrity-verified numerical parity PASS for the **specified** research CAMFIT-compressive 6-band mapping. No clinical/audiometric equivalence, hearing output, or acoustic calibration.

## Why Part P was necessary

Parts N/O implemented CAMFIT linear and compressive **research gain** calculations and checked manually reconstructed fixtures. A self-contained reference formula reproducing the same implementation can miss shared assumptions or transcription errors. Part P executes the **actual unchanged pinned Clarity/PyClarity Python modules** and compares all cells from eight materially different independent input audiograms. This is an additional direct numerical oracle, not a new gain prescription, WDRC bridge, or new mobile UI feature.

## Authenticated exact upstream code

The gated Python runner downloads only these two files from Clarity/PyClarity at immutable Git commit `9df6486fb0bddc7619b3b99f1b3a5c72c109a3ec`:

1. [`clarity/utils/audiogram.py`](https://github.com/claritychallenge/clarity/blob/9df6486fb0bddc7619b3b99f1b3a5c72c109a3ec/clarity/utils/audiogram.py): expected Git blob SHA-1 `59e7bd41beb5b2e3dd039094af052918673a690a`.
2. [`clarity/enhancer/gha/gainrule_camfit.py`](https://github.com/claritychallenge/clarity/blob/9df6486fb0bddc7619b3b99f1b3a5c72c109a3ec/clarity/enhancer/gha/gainrule_camfit.py): expected Git blob SHA-1 `5d6a0f374a6e46a9840738dade3ffcecfbabf519`.

The downloaded raw bytes are verified against their complete Git `blob <size>\\0<bytes>` digest BEFORE import. On mismatch, download error, missing dependency or bad output, the CI step **fails**, not silently skips. No source patches, custom gain oracle, stubbed Audiogram or changed algorithm are used.

Python 3.11, `numpy==1.26.4` and `scipy==1.12.0` are pinned for the dedicated CI job only; neither browser clients nor the existing Node-only `npm test` need them. License: upstream Clarity/PyClarity MIT; original openMHA derivation and attribution remain relevant, see [Part N](./M03_CAMFIT_LINEAR_RESEARCH_2026-10-14.md).

## Scope of comparisons

`tools/verify-camfit-upstream.mjs` generates eight explicit **bilateral** measured-threshold profiles:

- Pinned baseline symmetric 30/40/50/60/70/80 dB HL;
- Same baseline over 30/40/50/60/70/80 dB model input coordinates;
- Bilateral zero loss;
- Flat mild loss in one ear vs sloping in the other;
- Asymmetric sloping/high loss;
- Mid-frequency dip/peak-like loss vs uniform thresholds;
- Zero-loss ear vs moderate hearing loss in the other;
- High-level model output-cap stress case.

For each profile: **six distinct octave center frequencies** 250/500/1k/2k/4k/8k Hz with complete **7-edge** band grid 177/354/707/1414/2828/5657/11314 Hz. Each reference uses prescribed inputs (mostly 50/65/80 dB; one six-level grid and other deliberate bounded levels). Direct `gainrule_camfit_compr` is evaluated with the **same** explicit input grid, noise gate level 45, slope 1, reference `level=0`, and nominal max model output of 100 dB.

All **324 cells** (2 ears × 6 frequencies × variable levels over 8 cases) are compared against the separate HearLens JavaScript computation. Cases and expected input vectors are fixed in source, NOT generated from the JS gain output. Per-ear, per-band and per-input mismatch reports fail immediately when `abs(JS−Python)>10⁻⁶ dB`; no tolerance-driven clamping or skipped data.

## Actual measured CI evidence

In the first successful branch check [GitHub Actions run #38439857409](https://github.com/edisontw/hearlens/actions/runs/38439857409), original Python job `M03 direct pinned Python CAMFIT cross-check` completed PASS:

| Metric | Result |
|---|---:|
| Independent bilateral audiograms | 8 |
| Band-input-ear cells checked | 324 |
| Maximum absolute gain error | `3.552713678800501e-14` dB |
| Mean absolute gain error | `2.613821367852066e-15` dB |
| Numerical acceptance threshold | `1e-6` dB |
| Crosscheck | PASS |

This verifies **arithmetic parity** for those cases and explicit six-band fitting conditions only. It does not validate the upstream CAMFIT research algorithm as a clinical prescription, nor a general parameterization of all fitting conditions.

### Reproduction

In GitHub Actions, `.github/workflows/ci.yml` runs dedicated job `m03-camfit-direct-python-reference`; the standard Node-only job stays unchanged.

For local reproduction (with internet access to the pinned GitHub raw files and Python 3.11):

```sh
python -m pip install -r tools/requirements-camfit-oracle.txt
npm run verify:camfit:python
```

The Node process reports versioned JSON with case-by-case maximum error, reference SHA and non-clinical/no-output flags. The Python oracle is under `tools/camfit-python-upstream-oracle.py`; it does not need microphone permissions or an audiogram upload.

## Engineering boundaries and next decision

- `camfit-compressive-model-gain-db` remains a **model reference quantity**, NOT hearing output device gain, hearing-aid insertion-gain measurement, REIG, REAR, dB HL converted to an acoustic SPL, or digital full-scale PCM gain.
- Existing `hearlens-prescription-targets-v1` has 50/65/80 *nominal* input coordinates; numerical alignment of those labels does **not** mean calibrated environmental dB SPL. Avoid an implicit type conversion from CAMFIT research model to live WDRC gain data.
- A future offline adapter should require **an explicit, versioned physical reference mapping** (environment SPL↔mic dBFS, acoustic receiver response and L/R verified MPO) and reject any missing calibration. A synthetic-only visualization might show CAMFIT compression curves but cannot authorize output.
- The project still needs actual no-speaker-fallback physical hard mute on Bluetooth headset disconnect, real route output latency, headset identity, and independent ear-level sound pressure measurements before any amplification to a person.
- Independent NAL-NL2/DSL numerical implementation and licensed reference targets are **still not delivered**. CAMFIT arithmetic agreement does not substitute for them.
- The M01 subtitle feature remains closed. No new user phone tests are justified by this pure comparator milestone.
