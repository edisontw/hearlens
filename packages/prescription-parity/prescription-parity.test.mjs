import assert from "node:assert/strict";
import test from "node:test";
import {
  PARITY_CASE_SCHEMA, PARITY_METRIC, comparePrescriptionParity,
  normalizePrescriptionParityCase, normalizeReferenceProtocol,
} from "./prescription-parity.mjs";
import { AUDIOGRAM_SCHEMA } from "../audiogram/audiogram.mjs";
import {
  PRESCRIPTION_TARGET_SCHEMA, TARGET_USAGE,
} from "../prescription-targets/prescription-targets.mjs";

const band = (centerHz, soft, medium, loud) => ({
  centerHz,
  gainDbByInputLevel: { "50": soft, "65": medium, "80": loud },
});
const audiogram = () => ({
  schema: AUDIOGRAM_SCHEMA,
  ears: {
    left: {
      thresholdsDbHL: { 500: 35, 1000: 50 },
      provenance: { source: "manual", measuredOn: null },
    },
    right: {
      thresholdsDbHL: { 500: 20, 2000: 30 },
      provenance: { source: "manual", measuredOn: null },
    },
  },
});
const targets = () => ({
  schema: PRESCRIPTION_TARGET_SCHEMA,
  usage: TARGET_USAGE,
  origin: { kind: "synthetic-fixture", referenceId: null },
  ears: {
    left: { bands: [band(500, 25, 15, 5), band(750, 20, 12, 6)] },
    right: { bands: [band(1000, 12, 9, 5)] },
  },
});
const protocol = () => ({
  caseId: "synthetic-case-A",
  method: "synthetic-fixture",
  sourceId: "test-vector-A",
  sourceUrl: null,
  sourceVersion: "v1",
  prescriptionId: "research-synthetic",
  targetMetric: PARITY_METRIC,
  inputSignalId: "fixture-speech-anchors",
  transducerId: "fixture-none",
  couplingId: "fixture-none",
  fittingConditionId: "fixture-adult-bilateral",
});
const parityCase = () => ({
  schema: PARITY_CASE_SCHEMA,
  audiogram: audiogram(),
  referenceTargets: targets(),
  referenceProtocol: protocol(),
});

test("each ear, three input anchors and log-interpolated audiogram support exact reference arithmetic", () => {
  const c = parityCase();
  const prior = structuredClone(c);
  const candidate = targets();
  const out = comparePrescriptionParity(c, candidate);
  assert.equal(out.schema, "hearlens-prescription-parity-report-v1");
  assert.equal(out.cells, 9);
  assert.equal(out.maxAbsErrorDb, 0);
  assert.equal(out.meanAbsErrorDb, 0);
  assert.equal(out.rmseDb, 0);
  assert.equal(out.withinExplorationTolerance, true);
  assert.equal(out.clinicalParityEstablished, false);
  assert.equal(out.hearingOutputAuthorized, false);
  assert.equal(out.evidenceLevel, "synthetic-arithmetic-only");
  assert.deepEqual(out.ears.left, {
    cells: 6, maxAbsErrorDb: 0, meanAbsErrorDb: 0, withinTolerance: true,
  });
  assert.equal(out.ears.right.cells, 3);
  const interpolated = out.rows.find(x => x.centerHz === 750 && x.ear === "left");
  assert.equal(interpolated.audiogramBasis, "interpolated");
  assert(interpolated.audiogramThresholdDbHL > 35 &&
    interpolated.audiogramThresholdDbHL < 50);
  assert.equal(out.rows.find(x => x.ear === "right").audiogramThresholdDbHL, 25);
  assert.equal(JSON.stringify(c), JSON.stringify(prior), "comparison must not modify sources");
  assert(Object.isFrozen(out.rows));
  assert(Object.isFrozen(out.rows[0]));
});

test("large mismatch is reported rather than clamped, concealed or called clinical parity", () => {
  const candidate = targets();
  // Left 500 Hz: target 25/15/5; candidate 25/15/13 remains monotonic I/O.
  candidate.ears.left.bands[0].gainDbByInputLevel["80"] = 13;
  const out = comparePrescriptionParity(parityCase(), candidate, 5);
  assert.equal(out.withinExplorationTolerance, false);
  assert.equal(out.maxAbsErrorDb, 8);
  assert.equal(out.meanAbsErrorDb, 8 / 9);
  assert.equal(out.rmseDb, 8 / 3);
  assert.equal(out.rows.find(x => x.ear === "left" && x.centerHz === 500 &&
    x.inputLevelDbSPL === 80).errorDb, 8);
  assert.equal(out.ears.left.withinTolerance, false);
  assert.equal(out.ears.right.withinTolerance, true);
  assert.equal(out.hearingOutputAuthorized, false);
});

test("tolerance boundary is inclusive but never a clinical verification flag", () => {
  const c = targets();
  c.ears.right.bands[0].gainDbByInputLevel["80"] += 5;
  const out = comparePrescriptionParity(parityCase(), c, 5);
  assert.equal(out.maxAbsErrorDb, 5);
  assert.equal(out.withinExplorationTolerance, true);
  assert.equal(out.clinicalParityEstablished, false);
});

test("missing ear remains unavailable, never substituted with the opposite ear", () => {
  const c = parityCase();
  c.referenceTargets.ears.right = null;
  c.audiogram.ears.right = null;
  const candidate = targets();
  candidate.ears.right = null;
  const result = comparePrescriptionParity(c, candidate);
  assert.equal(result.cells, 6);
  assert.equal(result.ears.right, null);
  candidate.ears.right = { bands: [band(1000, 12, 9, 5)] };
  assert.throws(() => comparePrescriptionParity(c, candidate), /ear availability/);
});

test("reject mismatched frequencies or swapped-ear reference grids even if values look similar", () => {
  const c = parityCase();
  const shifted = targets();
  shifted.ears.left.bands[1].centerHz = 800;
  assert.throws(() => comparePrescriptionParity(c, shifted), /band grid/);
  const extra = targets();
  extra.ears.left.bands.push(band(1000, 12, 8, 3));
  assert.throws(() => comparePrescriptionParity(c, extra), /band grid/);
  const wrongSide = targets();
  wrongSide.ears.right.bands[0].centerHz = 500;
  assert.throws(() => comparePrescriptionParity(c, wrongSide), /band grid/);
});

test("reject missing measured range, absent ear or empty paired references", () => {
  const c = parityCase();
  c.audiogram.ears.left.thresholdsDbHL = { 500: 35 };
  assert.throws(() => normalizePrescriptionParityCase(c), /reference band lacks/);
  const c2 = parityCase();
  c2.audiogram.ears.right = null;
  assert.throws(() => normalizePrescriptionParityCase(c2), /reference ear lacks/);
  const c3 = parityCase();
  c3.referenceTargets.ears.left = null;
  c3.referenceTargets.ears.right = null;
  assert.throws(() => normalizePrescriptionParityCase(c3), /at least one/);
});

test("reference source provenance must match supplied gain targets", () => {
  const c = parityCase();
  c.referenceProtocol.method = "software-export";
  c.referenceProtocol.sourceUrl = "https://example.org/reference";
  c.referenceProtocol.prescriptionId = "NAL-NL2";
  c.referenceTargets.origin = {
    kind: "external-unverified", referenceId: "test-vector-A",
  };
  const result = comparePrescriptionParity(c, targets());
  assert.equal(result.evidenceLevel, "external-supplied-not-independently-verified");
  assert.equal(result.clinicalParityEstablished, false);
  c.referenceTargets.origin.referenceId = "different-source";
  assert.throws(() => comparePrescriptionParity(c, targets()), /origin and protocol/);
  c.referenceTargets.origin = { kind: "synthetic-fixture", referenceId: null };
  assert.throws(() => comparePrescriptionParity(c, targets()), /origin and protocol/);
});

test("REAR/REIG or vague fitting conditions cannot be passed off as nominal gain", () => {
  for (const metric of ["REAR-dB-SPL", "REIG", "insertion-gain-db", "output-spl"]) {
    const p = protocol();
    p.targetMetric = metric;
    assert.throws(() => normalizeReferenceProtocol(p), /REAR\/REIG\/SPL/);
  }
  const p = protocol();
  delete p.fittingConditionId;
  assert.throws(() => normalizeReferenceProtocol(p), /exactly/);
  for (const value of ["", "not identified", "../secret", 234, "a".repeat(121)]) {
    const q = protocol();
    q.inputSignalId = value;
    assert.throws(() => normalizeReferenceProtocol(q), /identifier/);
  }
  const q = protocol();
  q.method = "software-export";
  q.sourceUrl = "http://example.org/ref";
  assert.throws(() => normalizeReferenceProtocol(q), /https/);
  q.sourceUrl = "https://user:pw@example.org/ref";
  assert.throws(() => normalizeReferenceProtocol(q), /https/);
  q.sourceUrl = "https://example.org/ref?patient=PRIVATE";
  assert.throws(() => normalizeReferenceProtocol(q), /https/);
});

test("invalid tolerance and malformed records fail before they can claim numeric agreement", () => {
  for (const value of [NaN, Infinity, -1, 21, "5", null]) {
    assert.throws(() => comparePrescriptionParity(parityCase(), targets(), value),
      /toleranceDb/);
  }
  const c = parityCase();
  c.patientName = "PRIVATE";
  assert.throws(() => normalizePrescriptionParityCase(c), /exactly/);
  const c2 = parityCase();
  c2.schema = "v2";
  assert.throws(() => normalizePrescriptionParityCase(c2), /schema/);
  const c3 = parityCase();
  c3.referenceTargets.ears.left.bands[0].gainDbByInputLevel["65"] = NaN;
  assert.throws(() => normalizePrescriptionParityCase(c3));
});
