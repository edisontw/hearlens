# M03 Part M — Audiogram-to-reference prescription parity gate (2026-10-14)

**Status: research-only numerical validation infrastructure; NOT a validated prescription formula and NOT clinical NAL-NL2/DSL equivalence. No sound output.**

## Why this is the next step

M03 Part A already stores independent measured (dB HL) audiograms with nullable frequencies and bounded log-frequency interpolation. M03 Part B already represents **externally supplied** three-level nominal gain targets at 50/65/80 dB SPL input, with independent ears and nondecreasing I/O curves. Neither converts hearing loss to usable acoustic gain.

The missing critical link is a *trusted audiogram + fitting conditions + reference target* pair and an exact comparison of any future candidate algorithm with that reference, before numerical claims are made. The existing public literature and HearLens background research identify NAL-NL2/DSL v5 as **nonlinear** procedures involving conditions beyond simply reading a few dB HL thresholds. Fitting reference numbers may be REAR, REIG, coupler output or software target gain, and **these are not interchangeable**.

Source orientation:

- National Acoustic Laboratories, [NAL products](https://www.nal.gov.au/nal-products/) (NAL-NL2 fitting algorithm is licensed; a paper description is not automatically an exact public reference implementation).
- Keidser et al., [NAL-NL2 empirical adjustments](https://pmc.ncbi.nlm.nih.gov/articles/PMC4040825/) (including user experience, age/population adaptations and fitting assumptions).
- [Common Configurations of Real-Ear Aided Response Targets Prescribed by NAL-NL2](https://pmc.ncbi.nlm.nih.gov/articles/PMC7842845/) (published groups use **55/65/75 dB SPL** and **REAR**, so must NOT be silently inserted into HearLens's **50/65/80 nominal target gain** schema).
- [Research hearing aid evaluation](https://doi.org/10.1080/14992027.2024.2431830) (uses 50/65/80 ISTS REIG checks and ±5 dB fit-to-target tolerance as a research example; that tolerance is **not proof of identical algorithms**, calibration, clinical eligibility or patient safety).

## Implemented

`packages/prescription-parity/prescription-parity.mjs` exposes:

- `normalizeReferenceProtocol(protocol)`: **required** case ID, method, source ID and HTTPS source URL (for non-synthetic fixtures), version, prescription label, input signal ID, test transducer, coupling, fitting conditions, and exact target metric `nominal-band-target-gain-db`. Rejects unknown keys and REAR/REIG/output-SPL labels. These provenance tokens are traceability claims supplied by the caller, not certification.
- `normalizePrescriptionParityCase(case)`: combines the existing immutable `hearlens-audiogram-v1` and `hearlens-prescription-targets-v1` with a reference protocol under `hearlens-prescription-parity-case-v1`. Rejects absent ear, missing/extrapolated audiogram range at reference frequency, empty cases, or disagreement between source identifiers and existing `synthetic-fixture` / `external-unverified` origins. Interpolation basis is carried as *estimated*, never measured.
- `comparePrescriptionParity(case, candidate, toleranceDb=5)`: demands exact left/right ear availability and identical per-ear band grids. For every band × 50/65/80 anchor, emits signed and absolute gain error, `withinTolerance`, threshold/basis, per-ear maximum absolute error/MAE and total MAE/RMSE, with `withinExplorationTolerance`.
- Results **always** include `clinicalParityEstablished:false` and `hearingOutputAuthorized:false`. Even an exact match to externally supplied data remains `external-supplied-not-independently-verified` until a separately reviewed provenance + source-matched clinical protocol is completed. Synthetic matched vectors are labeled `synthetic-arithmetic-only`.
- Candidate profiles retain existing rigorous input normalization, 1–8 bands, gain-range guard and nondecreasing nominal I/O validation. No clamp/substitution can quietly hide a candidate mismatch.
- No fetch, microphone input, persistent storage, personal identifiers, PCM renderer, calibration, Bluetooth connection or acoustic output in the new module.

Run the complete repository checks with `npm test`. The added synthetic golden/negative cases exercise exact matches, >tolerance, threshold boundary, log-frequency interpolation, ear isolation, extra/missing frequencies, no measured anchor, untrusted source IDs, invalid source metrics and wrong conditions.

## Reference data needed for the actual *prescription* milestone

To implement/test a genuine adult NAL-NL2 or DSL v5 prescription generator later, obtain (licensed clinical software export or suitably published, fully specified reference) **several paired cases**, with:

1. **Audiogram**: per-ear octave thresholds at 250/500/1k/2k/4k/8k Hz and measured vs absent frequencies, plus fitting population and bone-/air-conduction/sensorineural assumptions.
2. **Prescription conditions**: exact fitting formula/version, adult age and hearing-aid experience assumptions, sex/other formula selectors where relevant, bilateral/unilateral fitting, transducer/coupling, RECD/venting, hearing instrument settings and stimulus (e.g., ISTS).
3. **Numerical target table**: gain per ear × supported center frequency × **each input level 50, 65, 80 dB SPL**, with units defined clearly as nominal software target gain in the compatible reference coordinate. **Do not convert measured REAR/REIG to a gain target by simple subtraction**: acoustic reference and stimulus frequency calibration are required.
4. **Source traceability and permission**: reference screenshot/export/table, citation/license and generation settings. Use anonymized synthetic audiograms or appropriately deidentified clinical examples, never patient identifiers in repo.

Missing reference values currently mean **no independently verified NAL-NL2/DSL parity can be claimed** and the roadmap's `independent audiogram-to-target prescription generation` item remains **unchecked**. A ±5 dB *exploration tolerance* is reported numerically but is not an automatic regulatory/clinical acceptance threshold. Avoid extrapolating reference values across frequencies or levels and reject reference cases with unmatched coordinates.

## Future action, not silently implemented

Once traceable reference exports are available, implement a separate independent prescription formula under an explicit version, compare across complete paired test vectors, report signed per-ear/band/level deviation, and review assumptions. Only then consider connecting research targets to a native offline DSP candidate; **no live hearing output** until physical no-speaker-fallback route/mute and per-ear acoustic MPO safety gates in [SAFETY.md](./SAFETY.md) are satisfied.

The previous M01 caption work is closed and not touched by this patch.
