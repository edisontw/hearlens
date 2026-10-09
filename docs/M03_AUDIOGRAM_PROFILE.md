# M03 Part A — Audiogram profile foundation

**Status:** pure offline data-domain implementation. This does **not** apply EQ, hearing-aid prescriptions, or live amplification. No audiometric profile is sent to the MN4 broker or Gemini.

## Portable module and versioned model

Import the dependency-free ES module \`packages/audiogram/audiogram.mjs\` in Node, Web or future native JS-compatible code:

\`\`\`js
import {
  AUDIOGRAM_SCHEMA,
  normalizeAudiogramProfile,
  thresholdAtFrequency,
  serializeAudiogramProfile,
  deserializeAudiogramProfile,
} from "./packages/audiogram/audiogram.mjs";

const audiogram = normalizeAudiogramProfile({
  schema: AUDIOGRAM_SCHEMA,
  ears: {
    left: {
      thresholdsDbHL: { 500: 30, 2000: 50 },
      provenance: { source: "clinical-report", measuredOn: "2024-02-29" },
    },
    right: null,
  },
});
const estimated = thresholdAtFrequency(audiogram, "left", 1000);
// { frequencyHz: 1000, thresholdDbHL: 40, basis: "interpolated", anchorsHz: [500, 2000] }
\`\`\`

- Top-level keys are precisely \`schema\` and \`ears\`. Schema must be \`hearlens-audiogram-v1\`.
- Both ear keys (\`left\`, \`right\`) are required. Each ear is independently \`null\` (no ear profile), or a record with \`thresholdsDbHL\` and \`provenance\`.
- Six supported frequencies in Hz: **250, 500, 1000, 2000, 4000, 8000**. Omitted frequency keys are normalized to explicit \`null\` (not tested). Zero means a **measured threshold of 0 dB HL**, never missing. Unknown frequencies are rejected rather than dropped. Partial audiograms are supported.
- Numeric thresholds are finite JS numbers in **[-20, 130] dB HL** (including endpoints), or \`null\`. No conversion from strings, bools, JSON invalid numeric values or rounding to 5-dB steps. This is a representation guardrail, **not** clinical assessment of validity or reliability.
- Required per-ear provenance: \`source\` is \`unknown\`, \`manual\`, \`clinical-report\` or \`import\`; \`measuredOn\` is a real calendar day in ISO \`YYYY-MM-DD\` or \`null\` when unknown. It does not prove audiometry was clinically performed or calibrated.
- Unknown fields are rejected (including identity fields). Canonical values are frozen copies with stable ear/frequency ordering; JSON round-trips through \`serializeAudiogramProfile\` / \`deserializeAudiogramProfile\`. Deserialization rejects oversized (over 16,384 characters), invalid, unversioned and schema-incompatible payloads. There is no persistence, automatic upload, cookie or network access in this slice.

## Interpolation policy (domain analysis only)

\`thresholdAtFrequency(profile, ear, frequencyHz)\` returns a new result containing \`frequencyHz\`, \`thresholdDbHL\` (number or \`null\`), and \`basis\`.

1. Query must name one ear and a finite numeric Hz value **within 250–8000**. Invalid requests throw, not extrapolate.
2. An exact **non-null** measurement returns \`basis: "measured"\`, unchanged.
3. For a gap strictly between **two measured anchors in that ear**, compute
   \`t = ln(f / fLow) / ln(fHigh / fLow)\`, then \`HL(f) = HLlow + t*(HLhigh-HLlow)\`. Return \`basis: "interpolated"\` and \`anchorsHz: [fLow, fHigh]\`. This may span unmeasured standard frequencies; no value is silently marked as measured.
4. Below the lowest or above the highest measured anchor, return \`basis: "unavailable"\`, \`thresholdDbHL: null\`, \`reason: "outside-measured-range"\` — **no flat extrapolation**.
5. For an ear with 0 or 1 measured anchor, non-exact queries return \`reason: "insufficient-anchors"\`. A wholly absent ear returns \`reason: "ear-unavailable"\`.
6. No cross-ear filling, default thresholds or extrapolation. Interpolated values are estimates of the shape between available audiometric thresholds, **not** measurements or prescription gains. All six frequency values can be reported without pretending missing anchors were tested.

## Limitations and future safety gates

This module represents **air-conduction-style hearing thresholds in dB HL** without encoding test transducer, masking, bone conduction, frequency-specific reference-equivalent threshold SPL, audiometer calibration, reliability or hearing-loss type. Provenance labels do not establish clinical suitability. It cannot diagnose conductive/sensorineural/mixed loss. Unsupported metadata is rejected rather than stored or leaked.

**Do not convert an audiogram threshold directly to matching dB EQ or dB SPL.** NAL-NL2 / DSL-like fitting, independent target gain/I-O curve generation, calibration, WDRC, per-ear max gain, final output limiter and disconnect fail-safe are separate future work requiring dedicated tests before audio output. No clinical parity is claimed.

When storage is introduced, profiles must remain local/private by default; never include audiograms in caption test-report exports or token requests. For Part A run \`npm test\` (includes deterministic golden vectors and safety-boundary cases). **No phone or playback test is required** because this code is not connected to browser microphone or speaker behavior.
