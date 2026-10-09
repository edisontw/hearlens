/**
 * HearLens M03 Part A: audiometric thresholds only (dB HL).
 * This module does not calculate gains or drive an audio output.
 * Pure ES module; no Node.js, browser, network or storage dependencies.
 */
export const AUDIOGRAM_SCHEMA = "hearlens-audiogram-v1";
export const AUDIOGRAM_FREQUENCIES_HZ = Object.freeze([250, 500, 1000, 2000, 4000, 8000]);
export const AUDIOGRAM_EARS = Object.freeze(["left", "right"]);
export const PROVENANCE_SOURCES = Object.freeze(["unknown", "manual", "clinical-report", "import"]);
export const MIN_THRESHOLD_DB_HL = -20;
export const MAX_THRESHOLD_DB_HL = 130;

const FREQUENCY_KEYS = AUDIOGRAM_FREQUENCIES_HZ.map(String);
const MAX_SERIALIZED_LENGTH = 16384;

function objectRecord(value, path) {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new TypeError(path + " must be a plain object");
  }
  return value;
}

function exactKeys(value, allowed, path, required = allowed) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new TypeError(path + " has unsupported field: " + key);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) throw new TypeError(path + " requires field: " + key);
  }
}

function validateDate(date) {
  if (date === null) return null;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new TypeError("provenance.measuredOn must be YYYY-MM-DD or null");
  }
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (year < 100 || parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day) {
    throw new RangeError("provenance.measuredOn is not a calendar date");
  }
  return date;
}

function normalizeEar(ear, side) {
  if (ear === null) return null;
  objectRecord(ear, "ears." + side);
  exactKeys(ear, ["thresholdsDbHL", "provenance"], "ears." + side);
  const supplied = objectRecord(ear.thresholdsDbHL, side + ".thresholdsDbHL");
  exactKeys(supplied, FREQUENCY_KEYS, side + ".thresholdsDbHL", []);
  const thresholdsDbHL = {};
  for (const frequency of FREQUENCY_KEYS) {
    const value = Object.hasOwn(supplied, frequency) ? supplied[frequency] : null;
    if (value !== null && (typeof value !== "number" || !Number.isFinite(value) ||
        value < MIN_THRESHOLD_DB_HL || value > MAX_THRESHOLD_DB_HL)) {
      throw new RangeError(side + ".thresholdsDbHL[" + frequency + "] must be a finite number from -20 to 130 dB HL, or null");
    }
    thresholdsDbHL[frequency] = value === 0 ? 0 : value;
  }
  const provenance = objectRecord(ear.provenance, side + ".provenance");
  exactKeys(provenance, ["source", "measuredOn"], side + ".provenance");
  if (!PROVENANCE_SOURCES.includes(provenance.source)) {
    throw new TypeError(side + ".provenance.source is not supported");
  }
  return Object.freeze({
    thresholdsDbHL: Object.freeze(thresholdsDbHL),
    provenance: Object.freeze({
      source: provenance.source,
      measuredOn: validateDate(provenance.measuredOn),
    }),
  });
}

/**
 * Validate and canonicalize a versioned per-ear profile.
 * An absent ear is null. An unmeasured frequency is null (never zero).
 * All six frequency keys are materialized in ascending order.
 */
export function normalizeAudiogramProfile(input) {
  objectRecord(input, "audiogram");
  exactKeys(input, ["schema", "ears"], "audiogram");
  if (input.schema !== AUDIOGRAM_SCHEMA) throw new TypeError("unsupported audiogram schema");
  objectRecord(input.ears, "ears");
  exactKeys(input.ears, AUDIOGRAM_EARS, "ears");
  return Object.freeze({
    schema: AUDIOGRAM_SCHEMA,
    ears: Object.freeze({
      left: normalizeEar(input.ears.left, "left"),
      right: normalizeEar(input.ears.right, "right"),
    }),
  });
}

export function serializeAudiogramProfile(profile) {
  return JSON.stringify(normalizeAudiogramProfile(profile));
}

export function deserializeAudiogramProfile(json) {
  if (typeof json !== "string" || json.length > MAX_SERIALIZED_LENGTH) {
    throw new TypeError("audiogram JSON must be a string at most 16384 characters long");
  }
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new TypeError("invalid audiogram JSON");
  }
  return normalizeAudiogramProfile(parsed);
}

function result(frequencyHz, thresholdDbHL, basis, extra = {}) {
  return Object.freeze({ frequencyHz, thresholdDbHL, basis, ...extra });
}

/**
 * Returns an exact measurement, a log-frequency estimate or an unavailable result.
 * Only interpolate strictly between measured anchors. Never extrapolate or
 * turn a missing ear / missing measurement into a zero-dB measurement.
 */
export function thresholdAtFrequency(profile, ear, frequencyHz) {
  if (!AUDIOGRAM_EARS.includes(ear)) throw new RangeError("ear must be left or right");
  if (typeof frequencyHz !== "number" || !Number.isFinite(frequencyHz) ||
      frequencyHz < AUDIOGRAM_FREQUENCIES_HZ[0] ||
      frequencyHz > AUDIOGRAM_FREQUENCIES_HZ.at(-1)) {
    throw new RangeError("frequencyHz must be finite and between 250 and 8000");
  }
  const normalized = normalizeAudiogramProfile(profile);
  const side = normalized.ears[ear];
  if (side === null) return result(frequencyHz, null, "unavailable", { reason: "ear-unavailable" });

  const anchors = AUDIOGRAM_FREQUENCIES_HZ
    .filter(f => side.thresholdsDbHL[String(f)] !== null);
  if (anchors.includes(frequencyHz)) {
    return result(frequencyHz, side.thresholdsDbHL[String(frequencyHz)], "measured");
  }
  if (anchors.length < 2) {
    return result(frequencyHz, null, "unavailable", { reason: "insufficient-anchors" });
  }
  if (frequencyHz < anchors[0] || frequencyHz > anchors.at(-1)) {
    return result(frequencyHz, null, "unavailable", { reason: "outside-measured-range" });
  }
  const higherIndex = anchors.findIndex(f => f > frequencyHz);
  const lowerHz = anchors[higherIndex - 1];
  const upperHz = anchors[higherIndex];
  const lower = side.thresholdsDbHL[String(lowerHz)];
  const upper = side.thresholdsDbHL[String(upperHz)];
  const fraction = Math.log(frequencyHz / lowerHz) / Math.log(upperHz / lowerHz);
  return result(
    frequencyHz,
    lower + fraction * (upper - lower),
    "interpolated",
    { anchorsHz: Object.freeze([lowerHz, upperHz]) },
  );
}
