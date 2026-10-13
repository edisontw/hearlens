# M03 Part N — CAMFIT linear audiogram-to-gain research baseline (2026-10-14)

**Implemented:** a real, numerical audiogram-to-linear-research-gain algorithm with a publicly published upstream test vector. **Not implemented:** NAL-NL2, DSL v5, nonlinear CAMFIT compression, clinically validated patient fitting, device-specific acoustics or any live hearing output.

## Why this branch exists

After [M03 Part M](./M03_PRESCRIPTION_REFERENCE_PARITY_2026-10-14.md), merely adding more data validation would not move the product toward individualized compensation. The full **NAL-NL2** and **DSLmio 5** formula engines are third-party licensed components, not free source files inside openMHA:

- openMHA [repository README, Proprietary fitting rules](https://github.com/HoerTech-gGmbH/openMHA#proprietary-fitting-rules)
- National Acoustic Laboratories [NAL-NL2 product/licensing](https://www.nal.gov.au/nal-products/)

Instead, [PyClarity / Clarity Challenge](https://github.com/claritychallenge/clarity) publishes reference implementations of CAMFIT and NAL-R. This milestone intentionally chooses **CAMFIT linear** as an open, checkable audiogram-to-research-target arithmetic baseline. It must not be called equivalent to NAL-NL2, DSL v5, or compressive CAMFIT.

## Primary reference and provenance

The linear CAMFIT relationship comes from Moore & Glasberg (1998), *Use of a loudness model for hearing-aid fitting. I. Linear hearing aids*, as exposed in [PyClarity `gainrule_camfit_linear`](https://github.com/claritychallenge/clarity/blob/9df6486fb0bddc7619b3b99f1b3a5c72c109a3ec/clarity/enhancer/gha/gainrule_camfit.py) (Clarity/PyClarity, MIT license) derived from openMHA original implementation. OpenMHA is AGPL-3.0, and its copyright and attribution must be reviewed before shipping any direct translation commercially. This independent research implementation cites the algorithm and tabulated constants; it does **not** vendor in their original source.

Reference test: [`test_gainrule_camfit_linear`](https://github.com/claritychallenge/clarity/blob/9df6486fb0bddc7619b3b99f1b3a5c72c109a3ec/tests/enhancer/gha/test_gainrule_camfit.py), pinned to upstream commit `9df6486fb0bddc7619b3b99f1b3a5c72c109a3ec`.

Upstream golden vector:

- **Audiogram (both ears):** threshold 30/40/50/60/70/80 dB HL at 250/500/1k/2k/4k/8k Hz.
- **Reference input levels:** 30,40,50,60,70,80 dB SPL.
- **Reference max nominal output:** 100 dB (model coordinate, NOT calibrated ear MPO).
- **Reference expected sum of insertion gains:** 284.8 dB across both six-band arrays (not a physically meaningful combined level).
- **Reference expected sum of all table gains:** 1589.2 dB across six levels × six bands × two ears (test checksum, NOT SPL).
- The HearLens golden test matches these numeric checksums and verifies the individual insertion-gain vector **[4.4,11.2,24.0,29.8,33.6,39.4] dB** per ear.

A scalar checksum match is **not** a full independent parity evaluation across fitting conditions or patients. It is enough to verify this tightly scoped software calculation, not clinical equivalence. Further PyClarity/openMHA comparisons with different losses and band grids remain future work.

## Implemented API

`packages/prescription-camfit-linear/camfit-linear.mjs` exports `calculateCamfitLinearResearchTable(audiogram, inputLevelsDbSPL?)`.

Input uses the existing `hearlens-audiogram-v1` data model; it requires six **measured**, not extrapolated or interpolated, octave-threshold values per available ear, with either ear allowed to be explicitly missing (`null`). It rejects an audiogram with neither ear.

For each ear and each standard frequency, calculate a **linear-rule insertion-gain coordinate**, not a digital PCM gain:

- `G_linear(f) = max(0, 0.48 * HL(f) + intercept(f))` for a non-all-zero measured ear;
- when the entire measured ear audiogram is exactly 0 dB HL, `G_linear(f) = 0` at every band per the upstream implementation;
- Cambridge reference intercepts at these octave frequencies: 250Hz=−10, 500Hz=−8, 1k=0, 2k=+1, 4k=0, 8k=+1 dB (last +1 extended beyond 5k);
- for any requested (strictly ascending) model input level between 0 and 100: `G_table(f,L)=min(G_linear(f),100-L)`.

The default output includes input-level coordinates **50/65/80** dB SPL (numerically comparable in layout to M03 B) but the output quantity is **`camfit-linear-insertion-gain-db`** — NOT `hearlens-prescription-targets-v1` nominal-band target gain. There is **intentionally no converter/bridge** into the WDRC processor or the previous Part M comparator. That integration requires explicit physical, reference-field and unit matching. The 100 dB model cap is **not a physical acoustic limiter**.

Output carries schema `hearlens-camfit-linear-research-v1`, method, quantity, source family and exact pinned upstream commit, left/right independently, threshold/insertion gain/input rows, and mandatory false flags for calibrated-input-SPL, calibrated-headphone-SPL, clinical parity and hearing-output authorization.

## Tests and engineering limits

- Test crosschecks upstream exact scalar sums 284.8/1589.2 and octave-gain vector.
- Independent ears, exactly flat 0-dB loss, absent ear, partial/unmeasured frequency rejection and profile immutability.
- Every output arithmetic input+gain no greater than 100 model dB, nonnegative gain, nondecreasing model I/O across levels.
- Reject invalid type, nonfinite/duplicate/unordered input levels, or sample metadata outside existing audiogram model.
- CI: `npm test`, including all prior M01/M03/SW2/SW3 checks.

A linear formula does not model loudness recruitment or dynamic compression; it cannot represent nonlinear 50/65/80 target gain curves except for *nominal arithmetic cap*. Fitting adults with hearing loss, particularly asymmetric, conductive/mixed, severe or recruitment features, is NOT supported by this module.

## Next engineering decision

Prioritize reproducing **PyClarity compressive CAMFIT** with independent upstream multi-case numerical tests, preserving distinct reference quantities and checking prescription input signal/band-edge assumptions. This offers a research route to actual level-dependent fitting without pretending to possess proprietary NAL-NL2. Separately explore a legitimately licensed NAL-NL2 reference for a clinical numerical benchmark. Do not connect calculated insertion gains to live microphone->Bluetooth headphone audio until physical route/mute safety, device-specific SPL and per-ear MPO gates are independently passed.

M01 captions remain concluded and untouched; M04 ordinary Bluetooth compatibility stays the preferred final direction.
