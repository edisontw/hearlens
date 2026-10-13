#!/usr/bin/env node
/**
 * M03 direct external Python numerical cross-check.
 *
 * This script runs the ORIGINAL pinned Clarity/PyClarity CAMFIT implementation
 * in a subprocess (verified exact upstream Git blob SHA, source unchanged),
 * then compares each matrix cell to our JavaScript research calculation.
 * Requires Python 3.11 with numpy and scipy. NO audio or network permissions
 * for the normal HearLens Web/client process.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { calculateCamfitCompressionResearchTable } from
  "../packages/prescription-camfit-compression/camfit-compression.mjs";
import { AUDIOGRAM_SCHEMA } from "../packages/audiogram/audiogram.mjs";

const FREQ = [250, 500, 1000, 2000, 4000, 8000];
const EDGES = [177, 354, 707, 1414, 2828, 5657, 11314];
const PINNED_COMMIT = "9df6486fb0bddc7619b3b99f1b3a5c72c109a3ec";
const PINNED_BLOBS = {
  "clarity/utils/audiogram.py": "59e7bd41beb5b2e3dd039094af052918673a690a",
  "clarity/enhancer/gha/gainrule_camfit.py": "5d6a0f374a6e46a9840738dade3ffcecfbabf519",
};
// Fixed source profiles; do not derive reference outputs from JS algorithm.
const CASES = [
  {
    id: "upstream-regression-standard",
    ears: { left: [30, 40, 50, 60, 70, 80],
      right: [30, 40, 50, 60, 70, 80] },
    inputLevelsDbSPL: [50, 65, 80],
  },
  {
    id: "upstream-regression-six-input-levels",
    ears: { left: [30, 40, 50, 60, 70, 80],
      right: [30, 40, 50, 60, 70, 80] },
    inputLevelsDbSPL: [30, 40, 50, 60, 70, 80],
  },
  {
    id: "bilateral-zero-loss",
    ears: { left: [0, 0, 0, 0, 0, 0],
      right: [0, 0, 0, 0, 0, 0] },
    inputLevelsDbSPL: [50, 65, 80],
  },
  {
    id: "flat-mild-left-sloping-right",
    ears: { left: [20, 20, 20, 20, 20, 20],
      right: [10, 15, 25, 35, 45, 55] },
    inputLevelsDbSPL: [50, 65, 80],
  },
  {
    id: "asymmetric-slope-and-high-loss",
    ears: { left: [5, 10, 20, 45, 65, 80],
      right: [60, 60, 55, 50, 45, 40] },
    inputLevelsDbSPL: [45, 65, 85],
  },
  {
    id: "isolated-midfrequency-loss",
    ears: { left: [5, 10, 55, 70, 20, 10],
      right: [10, 10, 10, 10, 10, 10] },
    inputLevelsDbSPL: [20, 55, 95],
  },
  {
    id: "one-zero-ear-vs-moderate",
    ears: { left: [0, 0, 0, 0, 0, 0],
      right: [25, 35, 45, 55, 60, 65] },
    inputLevelsDbSPL: [50, 65, 80],
  },
  {
    id: "level-ceiling-and-recruitment-proxy",
    ears: { left: [65, 70, 75, 80, 85, 90],
      right: [10, 25, 40, 60, 75, 85] },
    inputLevelsDbSPL: [60, 75, 100],
  },
];

function makeAudiogram(ears) {
  const side = thresholds => ({
    thresholdsDbHL: Object.fromEntries(
      FREQ.map((hz, i) => [hz, thresholds[i]])),
    provenance: { source: "manual", measuredOn: null },
  });
  return {
    schema: AUDIOGRAM_SCHEMA,
    ears: { left: side(ears.left), right: side(ears.right) },
  };
}

function runOracle(cases) {
  const request = {
    schema: "hearlens-m03-camfit-crosscheck-request-v1",
    cases: cases.map(entry => ({
      ...entry, frequenciesHz: FREQ, bandEdgesHz: EDGES,
    })),
  };
  const result = spawnSync(
    "python3", ["tools/camfit-python-upstream-oracle.py"],
    {
      encoding: "utf8",
      input: JSON.stringify(request),
      timeout: 150000,
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error("Pinned upstream Python verification failed: " +
      (result.stderr || "exit code " + result.status));
  }
  let parsed;
  try { parsed = JSON.parse(result.stdout); } catch {
    throw new Error("Pinned Python oracle returned invalid JSON: " +
      result.stdout.slice(0, 300));
  }
  assert.equal(parsed.schema, "hearlens-m03-camfit-crosscheck-oracle-v1");
  assert.equal(parsed.upstreamCommit, PINNED_COMMIT);
  assert.deepEqual(parsed.verifiedBlobShas, PINNED_BLOBS);
  assert.equal(parsed.cases.length, cases.length);
  return parsed.cases;
}

const reference = runOracle(CASES);
let cells = 0;
let errorSum = 0;
let maxAbsoluteErrorDb = 0;
const perCase = [];
const MAX_ALLOWED_ERROR_DB = 1e-6;
for (let ci = 0; ci < CASES.length; ci++) {
  const spec = CASES[ci];
  const oracle = reference[ci];
  assert.equal(oracle.id, spec.id);
  const computed = calculateCamfitCompressionResearchTable(
    makeAudiogram(spec.ears), spec.inputLevelsDbSPL);
  assert.deepEqual(computed.bandEdgesHz, EDGES);
  assert.deepEqual(computed.inputLevelsDbSPL, spec.inputLevelsDbSPL);
  assert.equal(computed.hearingOutputAuthorized, false);
  let caseMax = 0;
  for (const [ei, ear] of ["left", "right"].entries()) {
    assert.equal(oracle.gains[ear].length, spec.inputLevelsDbSPL.length);
    for (let li = 0; li < spec.inputLevelsDbSPL.length; li++) {
      assert.equal(oracle.gains[ear][li].length, FREQ.length);
      for (let fi = 0; fi < FREQ.length; fi++) {
        const actual = computed.ears[ear].bands[fi].levels[li].targetGainDb;
        const expected = oracle.gains[ear][li][fi];
        assert(Number.isFinite(actual) && Number.isFinite(expected));
        const difference = Math.abs(actual - expected);
        cells += 1;
        errorSum += difference;
        caseMax = Math.max(caseMax, difference);
        maxAbsoluteErrorDb = Math.max(maxAbsoluteErrorDb, difference);
        assert(difference <= MAX_ALLOWED_ERROR_DB,
          `${spec.id} ${ear} ${FREQ[fi]} Hz / ${spec.inputLevelsDbSPL[li]} dB: ` +
          `JS=${actual}, pinned Python=${expected}, deviation=${difference} dB`);
      }
    }
  }
  perCase.push({ caseId: spec.id,
    checkedCells: spec.inputLevelsDbSPL.length * FREQ.length * 2,
    maxAbsoluteErrorDb: caseMax });
}
console.log(JSON.stringify({
  schema: "hearlens-m03-camfit-direct-python-crosscheck-v1",
  referenceCommit: PINNED_COMMIT,
  caseCount: CASES.length,
  checkedCells: cells,
  toleranceDb: MAX_ALLOWED_ERROR_DB,
  maxAbsoluteErrorDb,
  meanAbsoluteErrorDb: errorSum / cells,
  comparisonPassed: true,
  clinicalParityEstablished: false,
  hearingOutputAuthorized: false,
  perCase,
}, null, 2));
