import assert from "node:assert/strict";
import test from "node:test";

import {
  CAMFIT_LINEAR_SCHEMA, CAMFIT_LINEAR_QUANTITY,
  CAMFIT_LINEAR_UPSTREAM_COMMIT, calculateCamfitLinearResearchTable,
} from "./camfit-linear.mjs";
import { AUDIOGRAM_SCHEMA } from "../audiogram/audiogram.mjs";

const makeEar = (thresholds) => ({
  thresholdsDbHL: Object.fromEntries(
    [250, 500, 1000, 2000, 4000, 8000].map((f, i) => [f, thresholds[i]])),
  provenance: { source: "manual", measuredOn: null },
});
const profile = (
  left = [30, 40, 50, 60, 70, 80],
  right = [30, 40, 50, 60, 70, 80],
) => ({
  schema: AUDIOGRAM_SCHEMA,
  ears: { left: left === null ? null : makeEar(left),
          right: right === null ? null : makeEar(right) },
});

test("PyClarity upstream CAMFIT-linear independent six-frequency golden sums", () => {
  // Exact reference test: ClarityChallenge clarity/enhancer/gha/
  // test_gainrule_camfit.py :: test_gainrule_camfit_linear
  // pinned source commit 9df6486fb0bddc7619b3b99f1b3a5c72c109a3ec
  // 6 bands x 6 input levels x 2 ears; max nominal output 100 dB.
  const input = profile();
  const snapshot = JSON.stringify(input);
  const out = calculateCamfitLinearResearchTable(
    input, [30, 40, 50, 60, 70, 80]);
  assert.equal(out.schema, CAMFIT_LINEAR_SCHEMA);
  assert.equal(out.quantity, CAMFIT_LINEAR_QUANTITY);
  assert.equal(out.reference.commit, CAMFIT_LINEAR_UPSTREAM_COMMIT);
  const bands = [out.ears.left, out.ears.right].flatMap(x => x.bands);
  assert.equal(bands.length, 12);
  assert.equal(
    bands.reduce((sum, b) => sum + b.insertionGainDb, 0),
    284.8,
  );
  assert(Math.abs(bands.reduce((sum, b) =>
    sum + b.levels.reduce((n, level) => n + level.targetGainDb, 0),
  0) - 1589.2) < 1e-9);
  assert.deepEqual(out.ears.left.bands.map(b => b.insertionGainDb)
    .map(v => Number(v.toFixed(1))),
  [4.4, 11.2, 24.0, 29.8, 33.6, 39.4]);
  assert.equal(JSON.stringify(input), snapshot, "must not modify original profile");
  assert(Object.isFrozen(out.ears.left.bands[0].levels));
  assert.equal(out.clinicalParityEstablished, false);
  assert.equal(out.hearingOutputAuthorized, false);
  assert.equal(out.calibratedHeadphoneOutputSPL, false);
});

test("M03 canonical 50, 65, 80 gain table respects model ceiling without treating it as ear-level MPO", () => {
  const out = calculateCamfitLinearResearchTable(profile());
  assert.deepEqual(out.inputLevelsDbSPL, [50, 65, 80]);
  const highBand = out.ears.left.bands.at(-1);
  assert.equal(highBand.insertionGainDb, 39.4);
  assert.deepEqual(highBand.levels.map(v => v.targetGainDb),
    [39.4, 35, 20]);
  for (const ear of ["left", "right"]) {
    for (const band of out.ears[ear].bands) {
      for (const row of band.levels) {
        assert(row.targetGainDb >= 0);
        assert(row.targetGainDb + row.inputLevelDbSPL <= 100);
      }
      const outputs = band.levels.map(row =>
        row.inputLevelDbSPL + row.targetGainDb);
      assert(outputs.every((v, i) => i === 0 || v >= outputs[i - 1]),
        "linear cap must not produce a decreasing arithmetic I/O curve");
    }
  }
});

test("CAMFIT output uses ear-specific hearing thresholds with zero-loss silence and monaural null", () => {
  const input = profile([20, 20, 20, 20, 20, 20], [0, 0, 0, 0, 0, 0]);
  const out = calculateCamfitLinearResearchTable(input);
  assert.deepEqual(out.ears.right.bands.map(b => b.insertionGainDb),
    [0, 0, 0, 0, 0, 0]);
  assert.deepEqual(out.ears.left.bands.map(b =>
    Number(b.insertionGainDb.toFixed(1))), [0, 1.6, 9.6, 10.6, 9.6, 10.6]);
  const monaural = calculateCamfitLinearResearchTable(profile(null, [10, 10, 10, 10, 10, 10]));
  assert.equal(monaural.ears.left, null);
  assert.equal(monaural.ears.right.bands.length, 6);
  assert.throws(() => calculateCamfitLinearResearchTable(profile(null, null)),
    /at least one measured ear/);
});

test("unknown or partial measured audiograms fail closed (no implicit 0 or extrapolation)", () => {
  const p = profile();
  delete p.ears.left.thresholdsDbHL["250"];
  assert.throws(() => calculateCamfitLinearResearchTable(p),
    /requires measured thresholds.*left\/250/);
  const p2 = profile();
  p2.ears.right.thresholdsDbHL["2000"] = null;
  assert.throws(() => calculateCamfitLinearResearchTable(p2),
    /requires measured thresholds.*right\/2000/);
  const p3 = profile();
  p3.ears.left.thresholdsDbHL["250"] = "30";
  assert.throws(() => calculateCamfitLinearResearchTable(p3));
});

test("invalid, unsorted and out-of-range input levels cannot silently enter table", () => {
  for (const values of [
    [], [65, 50], [50, 50], [49.5, Infinity], ["50", 65],
    [-1, 50], [50, 101], new Array(17).fill(0),
    "50,65,80", null, [NaN],
  ]) {
    assert.throws(() => calculateCamfitLinearResearchTable(profile(), values));
  }
  const upper = calculateCamfitLinearResearchTable(profile(), [99, 100]);
  for (const ear of ["left", "right"]) {
    for (const band of upper.ears[ear].bands) {
      assert.equal(band.levels[1].targetGainDb, 0);
    }
  }
});

test("source model stays separate from legacy nominal-gain targets and live audio", () => {
  const out = calculateCamfitLinearResearchTable(profile());
  assert.equal(out.usage, "offline-research-only");
  assert.equal(out.quantity, "camfit-linear-insertion-gain-db");
  assert.equal(out.method, "CAMFIT-linear");
  assert.equal(out.reference.referenceCondition,
    "pure-tone-audiogram-linear-gain");
  assert(!Object.hasOwn(out, "origin"),
    "must not masquerade as hearlens-prescription-targets-v1");
  assert.equal(out.hearingOutputAuthorized, false);
});
