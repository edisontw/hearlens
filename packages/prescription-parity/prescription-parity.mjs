/**
 * M03 research-only prescription target parity harness.
 *
 * IMPORTANT: this module NEVER derives clinical gain from dB HL and never
 * authorizes PCM playback. Published REAR, REIG, and insertion gain are NOT
 * interchangeable with the nominal target-gain coordinate used here.
 */
import {
  normalizeAudiogramProfile,
  thresholdAtFrequency,
} from "../audiogram/audiogram.mjs";
import {
  normalizePrescriptionTargets,
  INPUT_LEVELS_DB_SPL,
} from "../prescription-targets/prescription-targets.mjs";

export const PARITY_CASE_SCHEMA = "hearlens-prescription-parity-case-v1";
export const PARITY_METRIC = "nominal-band-target-gain-db";
export const PARITY_METHODS = Object.freeze([
  "software-export", "published-reference-table", "synthetic-fixture",
]);

function record(raw, name) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw) ||
      (Object.getPrototypeOf(raw) !== Object.prototype &&
       Object.getPrototypeOf(raw) !== null)) {
    throw new TypeError(name + " must be a plain object");
  }
  return raw;
}

function exactKeys(raw, required, name) {
  record(raw, name);
  const actual = Object.keys(raw);
  if (actual.some(k => !required.includes(k)) ||
      required.some(k => !Object.hasOwn(raw, k))) {
    throw new TypeError(name + " must have exactly: " + required.join(", "));
  }
}

function safeLabel(raw, name) {
  if (typeof raw !== "string" || raw.length < 1 || raw.length > 120 ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(raw)) {
    throw new TypeError(name + " must be a short non-identifying identifier");
  }
  return raw;
}

function safeUrl(raw) {
  if (typeof raw !== "string" || raw.length > 600) {
    throw new TypeError("referenceProtocol.sourceUrl must be an https URL");
  }
  let url;
  try { url = new URL(raw); } catch {
    throw new TypeError("referenceProtocol.sourceUrl must be an https URL");
  }
  if (url.protocol !== "https:" || !url.hostname || url.username ||
      url.password || url.search || url.hash) {
    throw new TypeError("referenceProtocol.sourceUrl must be a clean https source URL");
  }
  return raw;
}

/**
 * Conditions are required so a target from a different software version,
 * source signal, coupling, or target metric is never silently called parity.
 * These identifiers describe the reference; they are NOT an attestation
 * that the reference is genuine or clinically verified.
 */
export function normalizeReferenceProtocol(input) {
  exactKeys(input, [
    "caseId", "method", "sourceId", "sourceUrl", "sourceVersion",
    "prescriptionId", "targetMetric", "inputSignalId",
    "transducerId", "couplingId", "fittingConditionId",
  ], "referenceProtocol");
  const method = input.method;
  if (!PARITY_METHODS.includes(method)) {
    throw new TypeError("unsupported referenceProtocol.method");
  }
  if (input.targetMetric !== PARITY_METRIC) {
    throw new TypeError("REAR/REIG/SPL measurements cannot be compared as nominal gain targets");
  }
  const sourceUrl = method === "synthetic-fixture"
    ? (input.sourceUrl === null ? null : (() => { throw new TypeError("synthetic sourceUrl must be null"); })())
    : safeUrl(input.sourceUrl);
  return Object.freeze({
    caseId: safeLabel(input.caseId, "caseId"),
    method,
    sourceId: safeLabel(input.sourceId, "sourceId"),
    sourceUrl,
    sourceVersion: safeLabel(input.sourceVersion, "sourceVersion"),
    prescriptionId: safeLabel(input.prescriptionId, "prescriptionId"),
    targetMetric: PARITY_METRIC,
    inputSignalId: safeLabel(input.inputSignalId, "inputSignalId"),
    transducerId: safeLabel(input.transducerId, "transducerId"),
    couplingId: safeLabel(input.couplingId, "couplingId"),
    fittingConditionId: safeLabel(input.fittingConditionId, "fittingConditionId"),
  });
}

export function normalizePrescriptionParityCase(input) {
  exactKeys(input, ["schema", "audiogram", "referenceTargets", "referenceProtocol"],
    "parityCase");
  if (input.schema !== PARITY_CASE_SCHEMA) throw new TypeError("unsupported parityCase schema");
  const audiogram = normalizeAudiogramProfile(input.audiogram);
  const referenceTargets = normalizePrescriptionTargets(input.referenceTargets);
  const referenceProtocol = normalizeReferenceProtocol(input.referenceProtocol);
  const synthetic = referenceProtocol.method === "synthetic-fixture";
  const expectedKind = synthetic ? "synthetic-fixture" : "external-unverified";
  if (referenceTargets.origin.kind !== expectedKind ||
      referenceTargets.origin.referenceId !== (synthetic ? null : referenceProtocol.sourceId)) {
    throw new TypeError("reference target origin and protocol source must agree");
  }
  let count = 0;
  for (const ear of ["left", "right"]) {
    const side = referenceTargets.ears[ear];
    if (side === null) continue;
    if (audiogram.ears[ear] === null) {
      throw new TypeError("reference ear lacks its own audiogram: " + ear);
    }
    for (const band of side.bands) {
      const threshold = thresholdAtFrequency(audiogram, ear, band.centerHz);
      if (threshold.thresholdDbHL === null) {
        throw new TypeError("reference band lacks measured/interpolated hearing threshold: " +
          ear + "/" + band.centerHz + " (" + threshold.reason + ")");
      }
      count += 1;
    }
  }
  if (count === 0) {
    throw new TypeError("parity case needs at least one ear/band");
  }
  return Object.freeze({
    schema: PARITY_CASE_SCHEMA,
    audiogram,
    referenceTargets,
    referenceProtocol,
  });
}

/**
 * Compare a candidate algorithm's exact band/anchor gains to an independently
 * supplied reference. +/-5 dB can be an exploration tolerance, but an in-range
 * numeric result is NOT a clinical fitting claim or evidence of reference
 * authenticity, physical SPL calibration, or hearing benefit.
 */
export function comparePrescriptionParity(parityCase, candidateTargets, toleranceDb = 5) {
  if (typeof toleranceDb !== "number" || !Number.isFinite(toleranceDb) ||
      toleranceDb < 0 || toleranceDb > 20) {
    throw new RangeError("toleranceDb must be finite from 0 to 20");
  }
  const referenceCase = normalizePrescriptionParityCase(parityCase);
  const candidate = normalizePrescriptionTargets(candidateTargets);
  const rows = [];
  for (const ear of ["left", "right"]) {
    const referenceEar = referenceCase.referenceTargets.ears[ear];
    const candidateEar = candidate.ears[ear];
    if ((referenceEar === null) !== (candidateEar === null)) {
      throw new TypeError("candidate ear availability differs from reference: " + ear);
    }
    if (referenceEar === null) continue;
    const referenceBands = referenceEar.bands;
    const candidateBands = candidateEar.bands;
    if (referenceBands.length !== candidateBands.length ||
        referenceBands.some((band, i) => band.centerHz !== candidateBands[i]?.centerHz)) {
      throw new TypeError("candidate band grid must exactly match reference: " + ear);
    }
    for (let i = 0; i < referenceBands.length; i++) {
      const refBand = referenceBands[i];
      const proposedBand = candidateBands[i];
      const threshold = thresholdAtFrequency(
        referenceCase.audiogram, ear, refBand.centerHz);
      for (const inputLevelDbSPL of INPUT_LEVELS_DB_SPL) {
        const key = String(inputLevelDbSPL);
        const referenceGainDb = refBand.gainDbByInputLevel[key];
        const candidateGainDb = proposedBand.gainDbByInputLevel[key];
        const errorDb = candidateGainDb - referenceGainDb;
        rows.push(Object.freeze({
          ear, centerHz: refBand.centerHz, inputLevelDbSPL,
          audiogramThresholdDbHL: threshold.thresholdDbHL,
          audiogramBasis: threshold.basis,
          referenceGainDb, candidateGainDb,
          errorDb, absoluteErrorDb: Math.abs(errorDb),
          withinTolerance: Math.abs(errorDb) <= toleranceDb,
        }));
      }
    }
  }
  const ears = {};
  for (const ear of ["left", "right"]) {
    const earRows = rows.filter(row => row.ear === ear);
    ears[ear] = earRows.length ? Object.freeze({
      cells: earRows.length,
      maxAbsErrorDb: Math.max(...earRows.map(r => r.absoluteErrorDb)),
      meanAbsErrorDb: earRows.reduce((n, r) => n + r.absoluteErrorDb, 0) / earRows.length,
      withinTolerance: earRows.every(r => r.withinTolerance),
    }) : null;
  }
  const maxAbsErrorDb = Math.max(...rows.map(r => r.absoluteErrorDb));
  const meanAbsErrorDb = rows.reduce((n, r) => n + r.absoluteErrorDb, 0) / rows.length;
  const rmseDb = Math.sqrt(rows.reduce((n, r) => n + r.errorDb ** 2, 0) / rows.length);
  return Object.freeze({
    schema: "hearlens-prescription-parity-report-v1",
    caseId: referenceCase.referenceProtocol.caseId,
    referenceMethod: referenceCase.referenceProtocol.method,
    sourceId: referenceCase.referenceProtocol.sourceId,
    evidenceLevel: referenceCase.referenceProtocol.method === "synthetic-fixture"
      ? "synthetic-arithmetic-only" : "external-supplied-not-independently-verified",
    toleranceDb,
    cells: rows.length,
    maxAbsErrorDb,
    meanAbsErrorDb,
    rmseDb,
    withinExplorationTolerance: rows.every(r => r.withinTolerance),
    clinicalParityEstablished: false,
    hearingOutputAuthorized: false,
    ears: Object.freeze(ears),
    rows: Object.freeze(rows),
  });
}
