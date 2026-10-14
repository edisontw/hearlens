/**
 * M03 Part Q — isolated synthetic CAMFIT→STFT WDRC trial.
 *
 * Explicitly projects CAMFIT MODEL gains into the research-only Part B data
 * shape for ONE call of the existing offline synthetic renderer. This is a
 * numeric simulation coordinate, never a phone-mic/SPL calibration, a
 * validated acoustic insertion gain, NAL-NL2/DSL or a hearing output route.
 *
 * This module has no device, Web Audio, microphone, network or PCM sink API.
 */
import {
  calculateCamfitCompressionResearchTable,
  CAMFIT_COMP_QUANTITY,
} from "../prescription-camfit-compression/camfit-compression.mjs";
import {
  PRESCRIPTION_TARGET_SCHEMA,
  TARGET_USAGE,
  normalizePrescriptionTargets,
} from "../prescription-targets/prescription-targets.mjs";
import { renderOfflineWDRC } from "../dsp/offline-wdrc.mjs";

export const CAMFIT_SYNTHETIC_TRIAL_SCHEMA =
  "hearlens-m03-camfit-synthetic-wdrc-trial-v1";
export const SYNTHETIC_INPUT_MAPPING_SCHEMA =
  "hearlens-m03-fictional-65dbspl-to-dbfs-v1";
const MODEL_LEVELS = Object.freeze([50, 65, 80]);

function exactObject(value, keys, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype &&
       Object.getPrototypeOf(value) !== null) ||
      Object.keys(value).some(key => !keys.includes(key)) ||
      keys.some(key => !Object.hasOwn(value, key))) {
    throw new TypeError(name + " must have exactly: " + keys.join(", "));
  }
}

function syntheticReference(input) {
  exactObject(input, [
    "schema", "rmsDbFSAtNominal65", "physicalMicCalibrated",
    "physicalReceiverCalibrated", "route",
  ], "syntheticInputReference");
  if (input.schema !== SYNTHETIC_INPUT_MAPPING_SCHEMA ||
      input.physicalMicCalibrated !== false ||
      input.physicalReceiverCalibrated !== false ||
      input.route !== "none") {
    throw new TypeError("only fictional, uncalibrated, no-route input mappings are supported");
  }
  const value = input.rmsDbFSAtNominal65;
  if (typeof value !== "number" || !Number.isFinite(value) ||
      value < -90 || value > -3) {
    throw new RangeError("fictional rmsDbFSAtNominal65 must be -90 to -3");
  }
  return value;
}

function projectModel(model) {
  if (model.quantity !== CAMFIT_COMP_QUANTITY ||
      model.hearingOutputAuthorized !== false ||
      model.inputSPLCalibrated !== false ||
      model.outputSPLCalibrated !== false ||
      model.clinicalParityEstablished !== false ||
      model.inputLevelsDbSPL.length !== MODEL_LEVELS.length ||
      model.inputLevelsDbSPL.some((v, i) => v !== MODEL_LEVELS[i])) {
    throw new Error("CAMFIT model quantity/input grid or research-only contract changed");
  }
  const convert = side => side === null ? null : ({
    bands: side.bands.map(b => {
      if (b.levels.length !== MODEL_LEVELS.length ||
          b.levels.some((x, i) => x.inputLevelDbSPL !== MODEL_LEVELS[i])) {
        throw new Error("CAMFIT level grid unexpectedly changed");
      }
      return {
        centerHz: b.centerHz,
        gainDbByInputLevel: Object.fromEntries(
          b.levels.map(x => [String(x.inputLevelDbSPL), x.targetGainDb])),
      };
    }),
  });
  // This is deliberately a **synthetic fixture projection**. No
  // published/clinical target has been generated, imported, certified
  // or numerically transformed into real microphone/headphone gain.
  return normalizePrescriptionTargets({
    schema: PRESCRIPTION_TARGET_SCHEMA,
    usage: TARGET_USAGE,
    origin: { kind: "synthetic-fixture", referenceId: null },
    ears: {
      left: convert(model.ears.left),
      right: convert(model.ears.right),
    },
  });
}

/**
 * Strictly standalone, one-ear synthetic analysis/render fixture.
 *
 * All config keys required: there is no permissive object spreading into
 * a renderer or option to specify an authorized output route.
 * PCM returns in memory exclusively; the caller must not play it.
 */
export function renderCamfitSyntheticWDRC(config) {
  exactObject(config, [
    "schema", "usage", "audiogram", "samples", "sampleRate", "ear",
    "syntheticInputReference", "maxGainDb", "limiterCeiling", "crossoverMode",
  ], "CAMFIT synthetic trial");
  if (config.schema !== CAMFIT_SYNTHETIC_TRIAL_SCHEMA ||
      config.usage !== "offline-synthetic-test-only") {
    throw new TypeError("explicit offline synthetic trial declaration required");
  }
  if (config.ear !== "left" && config.ear !== "right") {
    throw new RangeError("ear must be left or right");
  }
  if (config.sampleRate !== 24000 && config.sampleRate !== 48000) {
    // CAMFIT includes a center at 8000Hz; 16kHz puts it at Nyquist.
    throw new RangeError("six-octave CAMFIT trial requires 24000 or 48000 Hz");
  }
  const rmsReference = syntheticReference(config.syntheticInputReference);
  if (typeof config.maxGainDb !== "number" ||
      !Number.isFinite(config.maxGainDb) ||
      config.maxGainDb < 0 || config.maxGainDb > 12) {
    throw new RangeError("synthetic trial maxGainDb must be 0..12");
  }
  if (typeof config.limiterCeiling !== "number" ||
      !Number.isFinite(config.limiterCeiling) ||
      config.limiterCeiling < 0.05 || config.limiterCeiling > 0.8) {
    throw new RangeError("synthetic trial limiterCeiling must be 0.05..0.8");
  }
  if (config.crossoverMode !== "hard" && config.crossoverMode !== "smooth") {
    throw new RangeError("crossoverMode must be hard or smooth");
  }

  const model = calculateCamfitCompressionResearchTable(
    config.audiogram, MODEL_LEVELS);
  if (model.ears[config.ear] === null) {
    throw new RangeError("requested ear has no measured audiogram");
  }
  const targets = projectModel(model);
  // Explicitly pass individual fields: never allow consumer-supplied target
  // overrides, hidden calibrated-device claims, or output callbacks.
  const rendered = renderOfflineWDRC({
    samples: config.samples,
    sampleRate: config.sampleRate,
    targets,
    ear: config.ear,
    syntheticRmsDbFSAt65DbSPL: rmsReference,
    maxGainDb: config.maxGainDb,
    limiterCeiling: config.limiterCeiling,
    crossoverMode: config.crossoverMode,
  });
  return Object.freeze({
    schema: "hearlens-m03-camfit-wdrc-synthetic-result-v1",
    samples: rendered.samples,
    // Diagnostic source values only; NEVER feed them to a live DSP
    // or a normal prescription engine without verified calibration.
    projectedModelTargets: targets,
    diagnostics: Object.freeze({
      ...rendered.diagnostics,
      kind: "m03-camfit-to-wdrc-synthetic-only",
      quantity: CAMFIT_COMP_QUANTITY,
      sourceCommit: model.reference.commit,
      inputReferenceKind: SYNTHETIC_INPUT_MAPPING_SCHEMA,
      fictionalRmsDbFSAtNominal65: rmsReference,
      maxGainDb: config.maxGainDb,
      physicallyCalibrated: false,
      clinicalParityEstablished: false,
      hearingOutputAuthorized: false,
      route: "none",
    }),
  });
}
