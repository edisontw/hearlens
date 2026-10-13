/**
 * M03 CAMFIT linear rule, strict offline research implementation.
 *
 * Reference: Moore & Glasberg (1998), as tabulated and tested in
 * PyClarity (Clarity Challenge, MIT license), derived from openMHA.
 *
 * This is the *linear CAMFIT insertion-gain* coordinate. It is NOT
 * NAL-NL2, DSL v5, a verified REAR/REIG prescription, a calibrated
 * headphone gain, or a safe PCM audio-output control.
 *
 * The nominal 100 dB output-level cap is arithmetic in a research
 * reference coordinate, NEVER an acoustic MPO or limiter.
 */
import {
  AUDIOGRAM_FREQUENCIES_HZ,
  normalizeAudiogramProfile,
  thresholdAtFrequency,
} from "../audiogram/audiogram.mjs";

export const CAMFIT_LINEAR_SCHEMA = "hearlens-camfit-linear-research-v1";
export const CAMFIT_LINEAR_QUANTITY = "camfit-linear-insertion-gain-db";
export const CAMFIT_LINEAR_USAGE = "offline-research-only";
export const CAMFIT_LINEAR_MAX_NOMINAL_OUTPUT_DB = 100;
export const CAMFIT_LINEAR_INPUT_LEVELS_DB_SPL = Object.freeze([50, 65, 80]);
export const CAMFIT_LINEAR_UPSTREAM_COMMIT =
  "9df6486fb0bddc7619b3b99f1b3a5c72c109a3ec";

// Cambridge intercepts as described in the openMHA/PyClarity CAMFIT
// linear reference. Frequencies > 5000 Hz use the final +1 dB intercept.
const INTERCEPT_FREQUENCIES = Object.freeze([
  125, 250, 500, 750, 1000, 1500, 2000, 3000, 4000, 5000,
]);
const INTERCEPT_DB = Object.freeze([-11, -10, -8, -6, 0, -1, 1, -1, 0, 1]);

function camfitInterceptAt(frequencyHz) {
  const higher = INTERCEPT_FREQUENCIES.findIndex(hz => hz >= frequencyHz);
  if (higher < 0) return INTERCEPT_DB.at(-1);
  if (INTERCEPT_FREQUENCIES[higher] === frequencyHz) return INTERCEPT_DB[higher];
  // PyClarity Audiogram.resample uses ordinary linear-frequency interpolation
  // for these reference intercepts. Audiogram thresholds remain independently
  // log-frequency interpolated in the HearLens domain layer.
  const lower = higher - 1;
  const fraction = (frequencyHz - INTERCEPT_FREQUENCIES[lower]) /
    (INTERCEPT_FREQUENCIES[higher] - INTERCEPT_FREQUENCIES[lower]);
  return INTERCEPT_DB[lower] +
    fraction * (INTERCEPT_DB[higher] - INTERCEPT_DB[lower]);
}

function validateLevels(inputLevelsDbSPL) {
  if (!Array.isArray(inputLevelsDbSPL) ||
      inputLevelsDbSPL.length === 0 || inputLevelsDbSPL.length > 16) {
    throw new TypeError("inputLevelsDbSPL must contain 1 to 16 levels");
  }
  let prior = -Infinity;
  const levels = [];
  for (const level of inputLevelsDbSPL) {
    if (typeof level !== "number" || !Number.isFinite(level) ||
        level < 0 || level > 100 || level <= prior) {
      throw new RangeError(
        "inputLevelsDbSPL must contain ascending distinct finite 0–100 dB coordinates");
    }
    levels.push(level);
    prior = level;
  }
  return Object.freeze(levels);
}

function makeEar(audiogram, ear, inputLevelsDbSPL) {
  if (audiogram.ears[ear] === null) return null;
  // Do not extrapolate or silently turn unmeasured thresholds into zero.
  // A complete standard-frequency grid is required for the first public
  // reference parity target (PyClarity's six-frequency golden test).
  const thresholds = AUDIOGRAM_FREQUENCIES_HZ.map(frequencyHz => {
    const result = thresholdAtFrequency(audiogram, ear, frequencyHz);
    if (result.basis !== "measured") {
      throw new TypeError(
        "CAMFIT linear requires measured thresholds at all six frequencies: " +
        ear + "/" + frequencyHz + " (" + result.basis + ")");
    }
    return result.thresholdDbHL;
  });
  const flatNormal = thresholds.every(value => value === 0);
  const bands = AUDIOGRAM_FREQUENCIES_HZ.map((centerHz, index) => {
    const thresholdDbHL = thresholds[index];
    const insertionGainDb = flatNormal ? 0 :
      Math.max(0, 0.48 * thresholdDbHL + camfitInterceptAt(centerHz));
    const levels = inputLevelsDbSPL.map(inputLevelDbSPL =>
      Object.freeze({
        inputLevelDbSPL,
        // Reference rule limits arithmetic output to 100 dB in this
        // nominal model; this is NOT an actual headphone SPL ceiling.
        targetGainDb: Math.min(insertionGainDb,
          CAMFIT_LINEAR_MAX_NOMINAL_OUTPUT_DB - inputLevelDbSPL),
      }));
    return Object.freeze({
      centerHz,
      measuredThresholdDbHL: thresholdDbHL,
      insertionGainDb,
      levels: Object.freeze(levels),
    });
  });
  return Object.freeze({ bands: Object.freeze(bands) });
}

/**
 * Research table based on measured thresholds, with left/right independence.
 * Returns a different, explicitly labeled quantity from the pre-existing
 * prescription-targets-v1 schema; there is deliberately NO automatic bridge.
 */
export function calculateCamfitLinearResearchTable(
  profile, inputLevelsDbSPL = CAMFIT_LINEAR_INPUT_LEVELS_DB_SPL,
) {
  const audiogram = normalizeAudiogramProfile(profile);
  const levels = validateLevels(inputLevelsDbSPL);
  if (audiogram.ears.left === null && audiogram.ears.right === null) {
    throw new TypeError("CAMFIT requires at least one measured ear");
  }
  return Object.freeze({
    schema: CAMFIT_LINEAR_SCHEMA,
    usage: CAMFIT_LINEAR_USAGE,
    method: "CAMFIT-linear",
    quantity: CAMFIT_LINEAR_QUANTITY,
    reference: Object.freeze({
      family: "PyClarity-openMHA-CAMFIT-linear",
      commit: CAMFIT_LINEAR_UPSTREAM_COMMIT,
      referenceCondition: "pure-tone-audiogram-linear-gain",
    }),
    inputLevelsDbSPL: levels,
    maximumNominalOutputDb: CAMFIT_LINEAR_MAX_NOMINAL_OUTPUT_DB,
    calibratedInputSPL: false,
    calibratedHeadphoneOutputSPL: false,
    clinicalParityEstablished: false,
    hearingOutputAuthorized: false,
    ears: Object.freeze({
      left: makeEar(audiogram, "left", levels),
      right: makeEar(audiogram, "right", levels),
    }),
  });
}
