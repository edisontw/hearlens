import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  calculateCamfitCompressionResearchTable as calculate,
  CAMFIT_COMP_SCHEMA,
  CAMFIT_COMP_QUANTITY,
  CAMFIT_COMP_BAND_EDGES_HZ,
  CAMFIT_COMP_SPEECH_BAND_65_DB,
  CAMFIT_COMP_NOMINAL_OUTPUT_CEILING_DB,
} from "./camfit-compression.mjs";
import { AUDIOGRAM_SCHEMA } from "../audiogram/audiogram.mjs";

// Oracle: independent NumPy reproduction of pinned PyClarity's
// gainrule_camfit_compr math, on a COMPLETE six-band edge grid; see docs.
// Upstream's published 2140.176229 test instead uses only two edge
// endpoints for six centers, leaving five unused/zero LTASS bands.
// That under-specified compatibility case is NOT a valid product default.
const upstreamReproduction50to80 = [
  [8.300166632, 14.14047143, 25.448208542, 29.688450468, 30.804461761, 50],
  [2.246428697, 10.267599353, 20.832153685, 22.919816747, 21.521376812, 35],
  [0, 6.394727275, 16.216098828, 16.151183026, 12.238291863, 20],
];
const expectedCr = [
  1.6766779120391775, 1.3480567586184051, 1.4445376774838536,
  1.8222977196478891, 2.6237927038095648, 2.923076923076923,
];
const expectedSpeech65 = [
  59.663863898454025, 61.38872407045041, 54.70599436228603,
  49.75279457373327, 45.48285146338985, 43.57562785104349,
];
const frequencies = [250, 500, 1000, 2000, 4000, 8000];
const ear = (thresholds) => ({
  thresholdsDbHL: Object.fromEntries(
    frequencies.map((hz, i) => [hz, thresholds[i]])),
  provenance: { source: "manual", measuredOn: null },
});
const caseProfile = (
  l = [30, 40, 50, 60, 70, 80],
  r = [30, 40, 50, 60, 70, 80],
) => ({
  schema: AUDIOGRAM_SCHEMA,
  ears: { left: l === null ? null : ear(l),
          right: r === null ? null : ear(r) },
});
const almost = (actual, expected, epsilon = 1e-7) => {
  assert(Number.isFinite(actual));
  assert(Math.abs(actual - expected) <= epsilon,
    `received ${actual}; expected ${expected}`);
};

test("reference reproduction: every 50/65/80 band cell and all six CR/LTASS bands", () => {
  const profile = caseProfile();
  const original = JSON.stringify(profile);
  const result = calculate(profile);
  assert.equal(result.schema, CAMFIT_COMP_SCHEMA);
  assert.equal(result.quantity, CAMFIT_COMP_QUANTITY);
  assert.deepEqual(result.bandEdgesHz, [177,354,707,1414,2828,5657,11314]);
  assert.deepEqual(result.inputLevelsDbSPL, [50,65,80]);
  assert.equal(result.reference.commit,
    "9df6486fb0bddc7619b3b99f1b3a5c72c109a3ec");
  for (const side of ["left", "right"]) {
    for (let band = 0; band < 6; band++) {
      const info = result.ears[side].bands[band];
      almost(info.compressionRatio, expectedCr[band]);
      almost(info.speechBandLevelAt65Db, expectedSpeech65[band]);
      for (let input = 0; input < 3; input++) {
        almost(info.levels[input].targetGainDb,
          upstreamReproduction50to80[input][band]);
      }
    }
  }
  const sum = ["left","right"].reduce((n, side) =>
    n + result.ears[side].bands.reduce((a, band) =>
      a + band.levels.reduce((b, row) => b + row.targetGainDb, 0), 0), 0);
  almost(sum, 684.338870237275);
  assert.equal(JSON.stringify(profile), original, "must not mutate source audiogram");
  assert(Object.isFrozen(result.ears.left.bands[0].levels));
  assert(Object.isFrozen(CAMFIT_COMP_SPEECH_BAND_65_DB));
});

test("independent six-input-level reference reproduction and physically distinct quantity", () => {
  const result = calculate(caseProfile(), [30,40,50,60,70,80]);
  const total = ["left","right"].reduce((n, side) =>
    n + result.ears[side].bands.reduce((a, b) =>
      a + b.levels.reduce((c, row) => c + row.targetGainDb, 0), 0), 0);
  almost(total, 1725.8181903097243);
  assert.equal(result.usage, "offline-research-only");
  assert.equal(result.maximumNominalOutputDb, 100);
  assert.equal(CAMFIT_COMP_NOMINAL_OUTPUT_CEILING_DB, 100);
  assert.equal(result.inputSPLCalibrated, false);
  assert.equal(result.outputSPLCalibrated, false);
  assert.equal(result.clinicalParityEstablished, false);
  assert.equal(result.hearingOutputAuthorized, false);
  assert(!Object.hasOwn(result, "origin"), "no implicit bridge into prescription-targets-v1");
});

test("soft input usually receives more gain than loud input, without model I/O reversal", () => {
  const result = calculate(caseProfile());
  const band = result.ears.left.bands[2]; // 1 kHz
  assert(band.levels[0].targetGainDb > band.levels[1].targetGainDb);
  assert(band.levels[1].targetGainDb > band.levels[2].targetGainDb);
  for (const side of ["left","right"]) {
    for (const b of result.ears[side].bands) {
      const rows = b.levels;
      assert(b.compressionRatio >= 1 && Number.isFinite(b.compressionRatio));
      for (const [i, row] of rows.entries()) {
        assert(row.targetGainDb >= 0);
        assert(row.inputLevelDbSPL + row.targetGainDb <= 100 + 1e-10);
        if (i) assert(rows[i - 1].targetGainDb + rows[i - 1].inputLevelDbSPL
          <= row.inputLevelDbSPL + row.targetGainDb + 1e-10);
      }
    }
  }
});

test("left/right audiograms remain independent; flat zero and absent ear fail safely", () => {
  const p = caseProfile(
    [30,40,50,60,70,80], [0,0,0,0,0,0]);
  const r = calculate(p);
  assert(r.ears.left.bands[2].levels[0].targetGainDb > 0);
  for (const band of r.ears.right.bands) {
    assert(band.levels.every(row => row.targetGainDb === 0));
  }
  assert.equal(calculate(caseProfile(null, [30,40,50,60,70,80])).ears.left, null);
  assert.throws(() => calculate(caseProfile(null, null)), /at least one measured ear/);
  const asymmetric = calculate(caseProfile(
    [10,20,30,40,50,60], [30,40,50,60,70,80]));
  assert.notEqual(asymmetric.ears.left.bands[4].levels[1].targetGainDb,
    asymmetric.ears.right.bands[4].levels[1].targetGainDb);
});

test("no invented thresholds, null extrapolation, unknown level or numeric corruption", () => {
  const missing = caseProfile();
  missing.ears.left.thresholdsDbHL[8000] = null;
  assert.throws(() => calculate(missing), /requires measured thresholds/);
  const missing2 = caseProfile();
  delete missing2.ears.right.thresholdsDbHL[250];
  assert.throws(() => calculate(missing2), /requires measured thresholds/);
  const invalid = caseProfile();
  invalid.ears.left.thresholdsDbHL[1000] = Number.NaN;
  assert.throws(() => calculate(invalid));
  for (const levels of [[],[50,50],[65,50],[50,101],[-1,65],
    [NaN,65],["50",65],Array(17).fill(50),null,"50,65,80"]) {
    assert.throws(() => calculate(caseProfile(), levels));
  }
});

test("source stays independent from live mic/audio routing and clinical format", () => {
  const source = readFileSync(
    "packages/prescription-camfit-compression/camfit-compression.mjs", "utf8");
  assert.doesNotMatch(source, /new\s+AudioTrack|AudioRecord|createMediaStreamDestination/);
  assert.doesNotMatch(source, /navigator\.mediaDevices|navigator\.bluetooth/);
  assert.match(source, /hearingOutputAuthorized: false/);
  assert.match(source, /clinicalParityEstablished: false/);
});
