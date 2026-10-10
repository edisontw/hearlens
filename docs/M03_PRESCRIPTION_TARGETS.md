# M03 Part B — Offline prescription target / I/O representation

**Status:** reusable, dependency-free ES module. Stores **supplied research target numbers**; it does **not** generate hearing-aid prescriptions, accept dB HL as gain, process PCM samples, claim NAL-NL2 / DSL numerical equivalence, or allow audio output. See [AUDIOGRAM_FITTING.md](./AUDIOGRAM_FITTING.md) and [SAFETY.md](./SAFETY.md).

## Schema and example

`packages/prescription-targets/prescription-targets.mjs` exports `PRESCRIPTION_TARGET_SCHEMA`, `normalizePrescriptionTargets`, `targetGainAtInput`, `serializePrescriptionTargets` and `deserializePrescriptionTargets`.

```js
const targets = {
  schema: "hearlens-prescription-targets-v1",
  usage: "offline-research-only",
  origin: { kind: "synthetic-fixture", referenceId: null },
  ears: {
    left: {
      bands: [
        { centerHz: 500, gainDbByInputLevel: { "50": 30, "65": 20, "80": 10 } },
        { centerHz: 1000, gainDbByInputLevel: { "50": 25, "65": 15, "80": 5 } },
      ],
    },
    right: null,
  },
};
// normalizePrescriptionTargets(targets) then targetGainAtInput(targets, "left", 500, 57.5)
// -> { ear: "left", centerHz: 500, inputLevelDbSPL: 57.5,
//      targetGainDb: 25, basis: "interpolated", anchorsDbSPL: [50, 65] }
```

All numbers above are **illustrative synthetic fixtures**, NOT recommendations for a patient or safe digital output settings.

- `usage` must be precisely `offline-research-only`. No certified/calibrated/live option exists in this schema.
- `origin.kind` is only `synthetic-fixture` (`referenceId: null`) or `external-unverified` (nonempty, short, non-identifying `referenceId`). An identifier is a traceability token, not evidence of parity with a fitting system.
- `ears.left` and `ears.right` are independent. Each is `null` (absent) or contains `bands`, an ordered list of **1 to 8** distinct integer center frequencies within **250–8000 Hz**; no empty ear object. One or two bands are allowed for focused fixtures, **not** as a deployable WDRC configuration.
- Each band contains precisely `centerHz` and `gainDbByInputLevel`, with mandatory **50, 65 and 80 dB SPL** *nominal input labels*. Every target gain is a finite number in **[-40, 80] dB**. This range is a parsing guard, **not** a safe maximum gain, MPO or real-ear constraint.
- Complete 3-knot curves are required for each supplied band. Missing ears/bands are explicitly `unavailable`; missing gain knots must be rejected rather than being silently treated as 0 dB.
- A nominal I/O curve must be non-decreasing: for consecutive anchors, `inputLevelDbSPL + targetGainDb` cannot decrease. This is a *mathematical consistency check only*, not a check of ear-level SPL or an output limiter.
- Unknown attributes, non-finite gain, duplicates, out-of-order center frequencies, unknown versions, unexpected level labels, and malformed JSON are rejected. Frozen canonical copies and deterministic JSON serialization; JSON input cap 32,768 characters. No storage/network/browser dependencies.

## Lookup and interpolation policy

`targetGainAtInput(profile, ear, centerHz, inputLevelDbSPL)`:

1. Requires a valid explicit ear, integer center Hz in 250–8000, and finite numeric nominal input level.
2. Queries only a **listed exact band**. There is **no frequency-domain interpolation**, channel sharing or guessed band gain.
3. At exactly **50/65/80**, returns `basis: "anchor"` and the unchanged supplied research target.
4. Strictly between adjacent input anchors, returns `basis: "interpolated"` using linear interpolation **in dB SPL input-level coordinates**. For 57.5 between 50 and 65: `g(57.5) = g(50) + 0.5 * (g(65) - g(50))`. The returned gain is a *target*, never applied to audio.
5. Missing ear/band, or query outside 50–80: returns `basis: "unavailable"` with `targetGainDb: null` and a reason (`ear-unavailable`, `band-unavailable`, `outside-input-grid`). **No extrapolation or default zero gain.**

The dB SPL input labels here are prescription reference coordinates. They are **not** a measured live phone-microphone SPL reading. dB gain targets do not correspond automatically to digital PCM gain, REIG, REAR, ear-canal output, or clinical targets.

## Acceptance gates not yet satisfied

This data-model-only slice passes when tests cover exact anchor values, piecewise interpolation, both ears, absent bands, malformed/rejected inputs, curve consistency, and JSON round-trips. Run `npm test` in CI; no physical playback test is justified.

The following remain **explicitly unimplemented**:

1. Independently verified prescription algorithm and numerical parity against trusted reference target tables, including defined transducer/test condition, hearing-loss category and prescription assumptions.
2. Validated interface between the audiogram's dB HL representation and those reference targets. **Never use `threshold dB HL = prescribed dB gain`.**
3. Calibrated environmental input SPL to ADC dBFS and calibrated headphone/coupler output, including gain reference semantics.
4. Production WDRC validation, calibrated per-ear maximum gain and start/reconnect ramp, **a physically verified final hearing-output limiter**, and no-bypass regression for the eventual hardware path. The synthetic-only offline STFT renderer and digital no-bypass tests in [M03_OFFLINE_WDRC.md](./M03_OFFLINE_WDRC.md) are an exploratory algorithm foundation, **not** satisfaction of these production requirements.
5. Physical route state, disconnect immediate mute, prevention of fallback to the phone speaker, supported device profiles, clipping/underrun logging and latency checks.

**Fail closed:** even mathematically valid curves cannot make hearing output safe or clinically fitted. Keep audiogram/profile data private/local by default in later storage integrations. M01 captions remain fully separate. No new HTC/iPhone distance matrix is requested for Part B.
