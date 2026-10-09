/**
 * HearLens M03 Part B: OFFLINE RESEARCH TARGET DATA ONLY.
 * Independent of audiograms, browser APIs, storage, network and DSP.
 * These targets cannot authorize hearing output or assert clinical fitting.
 */
export const PRESCRIPTION_TARGET_SCHEMA = "hearlens-prescription-targets-v1";
export const INPUT_LEVELS_DB_SPL = Object.freeze([50, 65, 80]);
export const TARGET_EARS = Object.freeze(["left", "right"]);
export const TARGET_ORIGINS = Object.freeze(["synthetic-fixture", "external-unverified"]);
export const TARGET_USAGE = "offline-research-only";
export const MIN_TARGET_GAIN_DB = -40;
export const MAX_TARGET_GAIN_DB = 80;
export const MIN_CENTER_HZ = 250;
export const MAX_CENTER_HZ = 8000;
export const MAX_BANDS_PER_EAR = 8;
const INPUT_KEYS = INPUT_LEVELS_DB_SPL.map(String);
const MAX_SERIALIZED_LENGTH = 32768;

function record(value, where) {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new TypeError(where + " must be a plain object");
  }
  return value;
}

function keys(value, expected, where) {
  for (const key of Object.keys(value)) {
    if (!expected.includes(key)) throw new TypeError(where + " has unsupported field: " + key);
  }
  for (const key of expected) {
    if (!Object.hasOwn(value, key)) throw new TypeError(where + " requires field: " + key);
  }
}

function originData(raw) {
  const source = record(raw, "origin");
  keys(source, ["kind", "referenceId"], "origin");
  if (!TARGET_ORIGINS.includes(source.kind)) throw new TypeError("unsupported origin.kind");
  if (source.kind === "synthetic-fixture" && source.referenceId !== null) {
    throw new TypeError("synthetic fixtures require a null referenceId");
  }
  if (source.kind === "external-unverified" &&
      (typeof source.referenceId !== "string" ||
       !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(source.referenceId))) {
    throw new TypeError("external research targets require a short, non-identifying referenceId");
  }
  return Object.freeze({ kind: source.kind, referenceId: source.referenceId });
}

function normalizedBand(raw, ear, index) {
  const where = "ears." + ear + ".bands[" + index + "]";
  const band = record(raw, where);
  keys(band, ["centerHz", "gainDbByInputLevel"], where);
  if (typeof band.centerHz !== "number" || !Number.isInteger(band.centerHz) ||
      band.centerHz < MIN_CENTER_HZ || band.centerHz > MAX_CENTER_HZ) {
    throw new RangeError(where + ".centerHz must be an integer from 250 to 8000 Hz");
  }
  const gains = record(band.gainDbByInputLevel, where + ".gainDbByInputLevel");
  keys(gains, INPUT_KEYS, where + ".gainDbByInputLevel");
  const gainDbByInputLevel = {};
  let previousNominalOutput = -Infinity;
  for (const input of INPUT_LEVELS_DB_SPL) {
    const gain = gains[String(input)];
    if (typeof gain !== "number" || !Number.isFinite(gain) ||
        gain < MIN_TARGET_GAIN_DB || gain > MAX_TARGET_GAIN_DB) {
      throw new RangeError(where + ".gainDbByInputLevel[" + input + "] must be finite -40 to 80 dB");
    }
    // Mathematical I/O-curve consistency ONLY; not a real ear-level SPL check.
    const nominalOutput = input + gain;
    if (nominalOutput < previousNominalOutput) {
      throw new RangeError(where + " has a decreasing nominal I/O curve");
    }
    previousNominalOutput = nominalOutput;
    gainDbByInputLevel[String(input)] = gain === 0 ? 0 : gain;
  }
  return Object.freeze({ centerHz: band.centerHz, gainDbByInputLevel: Object.freeze(gainDbByInputLevel) });
}

function normalizedEar(raw, ear) {
  if (raw === null) return null;
  const obj = record(raw, "ears." + ear);
  keys(obj, ["bands"], "ears." + ear);
  if (!Array.isArray(obj.bands) || obj.bands.length < 1 || obj.bands.length > MAX_BANDS_PER_EAR) {
    throw new RangeError("ears." + ear + ".bands must contain 1–8 bands, or use null for a missing ear");
  }
  const bands = obj.bands.map((value, index) => normalizedBand(value, ear, index));
  for (let index = 1; index < bands.length; index++) {
    if (bands[index].centerHz <= bands[index - 1].centerHz) {
      throw new RangeError("ears." + ear + ".bands must be strictly ascending with no duplicates");
    }
  }
  return Object.freeze({ bands: Object.freeze(bands) });
}

/** A canonical, frozen copy. Does not generate gains from a dB HL audiogram. */
export function normalizePrescriptionTargets(input) {
  const source = record(input, "prescriptionTargets");
  keys(source, ["schema", "usage", "origin", "ears"], "prescriptionTargets");
  if (source.schema !== PRESCRIPTION_TARGET_SCHEMA) throw new TypeError("unsupported prescription target schema");
  if (source.usage !== TARGET_USAGE) throw new TypeError("prescription targets must remain offline-research-only");
  const ears = record(source.ears, "ears");
  keys(ears, TARGET_EARS, "ears");
  return Object.freeze({
    schema: PRESCRIPTION_TARGET_SCHEMA,
    usage: TARGET_USAGE,
    origin: originData(source.origin),
    ears: Object.freeze({
      left: normalizedEar(ears.left, "left"),
      right: normalizedEar(ears.right, "right"),
    }),
  });
}

export function serializePrescriptionTargets(targets) {
  return JSON.stringify(normalizePrescriptionTargets(targets));
}

export function deserializePrescriptionTargets(json) {
  if (typeof json !== "string" || json.length > MAX_SERIALIZED_LENGTH) {
    throw new TypeError("target JSON must be a string of at most 32768 characters");
  }
  let input;
  try {
    input = JSON.parse(json);
  } catch {
    throw new TypeError("invalid target JSON");
  }
  return normalizePrescriptionTargets(input);
}

function result(ear, centerHz, inputLevelDbSPL, targetGainDb, basis, extra = {}) {
  return Object.freeze({ ear, centerHz, inputLevelDbSPL, targetGainDb, basis, ...extra });
}

/**
 * Query one *explicitly supplied* band. Exact anchors or linear interpolation
 * between 50/65/80 dB SPL nominal input labels only. No extrapolation,
 * frequency-band interpolation, hearing-aid fitting, calibration or DSP.
 */
export function targetGainAtInput(profile, ear, centerHz, inputLevelDbSPL) {
  if (!TARGET_EARS.includes(ear)) throw new RangeError("ear must be left or right");
  if (typeof centerHz !== "number" || !Number.isInteger(centerHz) ||
      centerHz < MIN_CENTER_HZ || centerHz > MAX_CENTER_HZ) {
    throw new RangeError("centerHz must be an integer between 250 and 8000");
  }
  if (typeof inputLevelDbSPL !== "number" || !Number.isFinite(inputLevelDbSPL)) {
    throw new TypeError("inputLevelDbSPL must be a finite number");
  }
  const normalized = normalizePrescriptionTargets(profile);
  const side = normalized.ears[ear];
  if (side === null) return result(ear, centerHz, inputLevelDbSPL, null, "unavailable", { reason: "ear-unavailable" });
  const band = side.bands.find(entry => entry.centerHz === centerHz);
  if (band === undefined) return result(ear, centerHz, inputLevelDbSPL, null, "unavailable", { reason: "band-unavailable" });
  if (inputLevelDbSPL < INPUT_LEVELS_DB_SPL[0] || inputLevelDbSPL > INPUT_LEVELS_DB_SPL.at(-1)) {
    return result(ear, centerHz, inputLevelDbSPL, null, "unavailable", { reason: "outside-input-grid" });
  }
  if (INPUT_LEVELS_DB_SPL.includes(inputLevelDbSPL)) {
    return result(ear, centerHz, inputLevelDbSPL, band.gainDbByInputLevel[String(inputLevelDbSPL)], "anchor");
  }
  const upperIndex = INPUT_LEVELS_DB_SPL.findIndex(v => v > inputLevelDbSPL);
  const lower = INPUT_LEVELS_DB_SPL[upperIndex - 1];
  const upper = INPUT_LEVELS_DB_SPL[upperIndex];
  const lowGain = band.gainDbByInputLevel[String(lower)];
  const highGain = band.gainDbByInputLevel[String(upper)];
  const gain = lowGain + (inputLevelDbSPL - lower) / (upper - lower) * (highGain - lowGain);
  return result(ear, centerHz, inputLevelDbSPL, gain, "interpolated", {
    anchorsDbSPL: Object.freeze([lower, upper]),
  });
}
