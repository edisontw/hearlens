/**
 * M03 research-only CAMFIT compression model.
 *
 * Mathematical translation/independent JS implementation of the linearized
 * calculation documented in pinned Clarity/PyClarity gainrule_camfit_compr.
 * Citation and licensing/provenance are in docs/M03_CAMFIT_COMPRESSION_2026-10-14.md.
 *
 * A MODEL gain table only. Never equate the arithmetic 100 dB cap or ISO
 * free-field HL conversion with calibrated phone/headphone dB SPL or MPO.
 * No PCM, device output, or automatic conversion to DSP targets.
 */
import {
  AUDIOGRAM_FREQUENCIES_HZ,
} from "../audiogram/audiogram.mjs";
import {
  calculateCamfitLinearResearchTable,
  CAMFIT_LINEAR_UPSTREAM_COMMIT,
} from "../prescription-camfit-linear/camfit-linear.mjs";

export const CAMFIT_COMP_SCHEMA = "hearlens-camfit-compression-research-v1";
export const CAMFIT_COMP_QUANTITY = "camfit-compressive-model-gain-db";
export const CAMFIT_COMP_DEFAULT_LEVELS_DB_SPL = Object.freeze([50, 65, 80]);
export const CAMFIT_COMP_NOMINAL_OUTPUT_CEILING_DB = 100;
export const CAMFIT_COMP_MINIMA_DISTANCE_DB = 38;

// Six coherent analysis bands. Adjacent boundaries define exactly one
// overlapping LTASS integration interval per requested center frequency.
// Changing edges changes the fitted model and REQUIRES new reference vectors.
export const CAMFIT_COMP_BAND_EDGES_HZ = Object.freeze([
  177, 354, 707, 1414, 2828, 5657, 11314,
]);

// Byrne et al (1994) speech spectrum as transcribed in pinned PyClarity.
const LTASS_FREQUENCIES_HZ = Object.freeze([
  63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800,
  1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000,
  10000, 12500, 16000,
]);
const LTASS_LEVELS_DB = Object.freeze([
  38.6, 43.5, 54.4, 57.7, 56.8, 60.2, 60.3, 59.0, 62.1, 62.1,
  60.5, 56.8, 53.7, 53.0, 52.0, 48.7, 48.1, 46.8, 45.6,
  44.5, 44.3, 43.7, 43.4, 41.3, 40.7,
]);

// The explicit reference free-field values appear in pinned PyClarity isothr.
// These are research model constants, NOT calibrated earphone SPL conversions.
const ISO_HZ = Object.freeze([
  0, 20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250,
  315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500,
  3150, 4000, 5000, 6300, 8000, 10000, 12500, 14000, 16000,
  18000, 20000,
]);
const ISO_THRESHOLD_DB = Object.freeze([
  80, 78.5, 68.7, 59.5, 51.1, 44, 37.5, 31.5, 26.5, 22.1,
  17.9, 14.4, 11.4, 8.6, 6.2, 4.4, 3, 2.2, 2.4, 3.5,
  1.7, -1.3, -4.2, -6, -5.4, -1.5, 6, 12.6, 13.9, 12.3,
  18.4, 40.2, 73.2, 70,
]);

function interpolateLinear(x, xs, ys) {
  if (!Number.isFinite(x) || x < xs[0] || x > xs.at(-1)) {
    throw new RangeError("interpolation needs a value within the reference grid");
  }
  for (let i = 0; i < xs.length; i++) {
    if (x === xs[i]) return ys[i];
    if (x < xs[i]) {
      const f = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
      return ys[i - 1] + f * (ys[i] - ys[i - 1]);
    }
  }
  return ys.at(-1);
}

function overlapFraction(a, b, low, high) {
  // Identical coordinate and divisor to PyClarity's compute_proportion_overlap.
  return Math.max(0, Math.min(b, high) - Math.max(a, low)) / (high - low);
}

function calculateSpeechBandLevels() {
  const spectrumEdges = [
    0,
    ...LTASS_FREQUENCIES_HZ.slice(0, -1).map(
      (hz, i) => Math.sqrt(hz * LTASS_FREQUENCIES_HZ[i + 1])),
    16000 * Math.pow(2, 1 / 6),
  ];
  return Object.freeze(AUDIOGRAM_FREQUENCIES_HZ.map((_, band) => {
    const left = CAMFIT_COMP_BAND_EDGES_HZ[band];
    const right = CAMFIT_COMP_BAND_EDGES_HZ[band + 1];
    let intensity = 0;
    for (let i = 0; i < LTASS_FREQUENCIES_HZ.length; i++) {
      intensity += Math.pow(10, LTASS_LEVELS_DB[i] / 10) *
        overlapFraction(left, right, spectrumEdges[i], spectrumEdges[i + 1]);
    }
    if (!(intensity > 0) || !Number.isFinite(intensity)) {
      throw new RangeError("CAMFIT speech spectrum band has no positive energy");
    }
    // Published LTASS reference is at 70 dB; PyClarity subtracts 5 dB.
    return 10 * Math.log10(intensity) - 5;
  }));
}

export const CAMFIT_COMP_SPEECH_BAND_65_DB = calculateSpeechBandLevels();

function makeEar(linearEar, levels) {
  if (linearEar === null) return null;
  const entirelyZero = linearEar.bands.every(b => b.measuredThresholdDbHL === 0);
  const bands = linearEar.bands.map((linearBand, i) => {
    const centerHz = linearBand.centerHz;
    const speechBandLevelAt65Db = CAMFIT_COMP_SPEECH_BAND_65_DB[i];
    const speechMinimumDb = speechBandLevelAt65Db - CAMFIT_COMP_MINIMA_DISTANCE_DB;
    const thresholdDbHL = linearBand.measuredThresholdDbHL;
    const isoFreeFieldReferenceDb = interpolateLinear(
      centerHz, ISO_HZ, ISO_THRESHOLD_DB);
    const gainAtSpeechMinimumDb =
      thresholdDbHL + isoFreeFieldReferenceDb - speechMinimumDb;
    // PyClarity: cr = max(1, 38/max(13, Lmid + Glinear - Lmin - Gmin)).
    const denominator = Math.max(13,
      speechBandLevelAt65Db + linearBand.insertionGainDb -
      speechMinimumDb - gainAtSpeechMinimumDb);
    const compressionRatio = Math.max(1,
      CAMFIT_COMP_MINIMA_DISTANCE_DB / denominator);
    const gains = levels.map(inputLevelDbSPL => {
      // Straight line through (Lmin, Lmin + Gmin) with inverse CR slope.
      const uncappedGainDb =
        gainAtSpeechMinimumDb + (inputLevelDbSPL - speechMinimumDb) *
        (1 / compressionRatio - 1);
      const targetGainDb = entirelyZero ? 0 :
        Math.min(Math.max(0, uncappedGainDb),
          CAMFIT_COMP_NOMINAL_OUTPUT_CEILING_DB - inputLevelDbSPL);
      return Object.freeze({ inputLevelDbSPL, targetGainDb });
    });
    return Object.freeze({
      centerHz,
      measuredThresholdDbHL: thresholdDbHL,
      linearInsertionGainDb: linearBand.insertionGainDb,
      isoFreeFieldReferenceDb,
      speechBandLevelAt65Db,
      speechMinimumDb,
      compressionRatio,
      levels: Object.freeze(gains),
    });
  });
  return Object.freeze({ bands: Object.freeze(bands) });
}

/**
 * Six measured octave audiogram thresholds per included ear, exactly as
 * required by the previously verified CAMFIT linear implementation.
 *
 * This model computes level-dependent gain numbers but deliberately DOES NOT
 * produce WDRC targets or an output-authorizing calibration profile.
 */
export function calculateCamfitCompressionResearchTable(
  audiogram, inputLevelsDbSPL = CAMFIT_COMP_DEFAULT_LEVELS_DB_SPL,
) {
  // Reuses the exact six-frequency measured-threshold and level validation,
  // preventing subtle divergence in missing-data semantics.
  const linear = calculateCamfitLinearResearchTable(
    audiogram, inputLevelsDbSPL);
  return Object.freeze({
    schema: CAMFIT_COMP_SCHEMA,
    usage: "offline-research-only",
    method: "CAMFIT-compressive",
    quantity: CAMFIT_COMP_QUANTITY,
    reference: Object.freeze({
      family: "PyClarity-openMHA-CAMFIT-compressive",
      commit: CAMFIT_LINEAR_UPSTREAM_COMMIT,
      condition: "6-band-coherent-octave-centers-and-Byrne-1994-LTASS",
      formulaVersion: "Moore-et-al-1999-research",
      upstreamNumericParity: "reference-reproduction-bounded-fixtures",
    }),
    frequenciesHz: AUDIOGRAM_FREQUENCIES_HZ,
    bandEdgesHz: CAMFIT_COMP_BAND_EDGES_HZ,
    inputLevelsDbSPL: linear.inputLevelsDbSPL,
    maximumNominalOutputDb: CAMFIT_COMP_NOMINAL_OUTPUT_CEILING_DB,
    noisegateLevelDb: 45,
    noisegateSlope: 1,
    // Important: these are model constants, not physical output protections.
    inputSPLCalibrated: false,
    outputSPLCalibrated: false,
    clinicalParityEstablished: false,
    hearingOutputAuthorized: false,
    ears: Object.freeze({
      left: makeEar(linear.ears.left, linear.inputLevelsDbSPL),
      right: makeEar(linear.ears.right, linear.inputLevelsDbSPL),
    }),
  });
}
