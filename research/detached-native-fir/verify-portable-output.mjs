import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

if (process.argv.length !== 6) {
  throw new Error("usage: node verify-portable-output.mjs MANIFEST FIXTURE ORACLE ACTUAL");
}

const [, , manifestPath, fixturePath, oraclePath, actualPath] = process.argv;
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
assert.equal(manifest.audioRoute, "none", "fixture must have no audio route");
assert.equal(manifest.hearingOutputAuthorized, false,
  "fixture must not authorize hearing output");
const fixture = readFileSync(fixturePath);
const oracle = readFileSync(oraclePath);
const actual = readFileSync(actualPath);
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
assert.equal(sha256(fixture), manifest.sha256.fixture, "fixture SHA-256");
assert.equal(sha256(oracle), manifest.sha256.jsOracleResult, "JS oracle SHA-256");
assert.equal(actual.length, oracle.length, "Native result length");
assert.equal(actual.readUInt32LE(0), 0x334f4c48, "Native result magic");
assert.equal(actual.readUInt32LE(4), manifest.samplesPerEar, "Native sample count");
assert.equal(actual.readUInt32LE(8), manifest.controlUpdatesPerEar,
  "Native control update count");
const sampleCount = manifest.samplesPerEar;
const pcmStart = 12;
const pcmCount = 2 * sampleCount;
let maxPcmError = 0;
let sumSquaredPcmError = 0;
for (let index = 0; index < pcmCount; index++) {
  const expected = oracle.readFloatLE(pcmStart + index * 4);
  const actualValue = actual.readFloatLE(pcmStart + index * 4);
  assert.ok(Number.isFinite(actualValue), "Native output must be finite");
  assert.ok(Math.abs(actualValue) <= manifest.limiterCeiling,
    "Native digital ceiling exceeded at sample " + Math.floor(index / 2));
  const error = Math.abs(actualValue - expected);
  maxPcmError = Math.max(maxPcmError, error);
  sumSquaredPcmError += error * error;
}
const rmsPcmError = Math.sqrt(sumSquaredPcmError / pcmCount);
assert.ok(maxPcmError <= manifest.pcmMaxErrorThreshold,
  "PCM max error " + maxPcmError + " exceeds threshold");
assert.ok(rmsPcmError <= manifest.pcmRmsErrorThreshold,
  "PCM RMS error " + rmsPcmError + " exceeds threshold");

let offset = pcmStart + pcmCount * 4;
const expectedUpdates = manifest.controlUpdatesPerEar;
for (let ear = 0; ear < 2; ear++) {
  for (let field = 0; field < 11; field++) {
    assert.equal(actual.readBigUInt64LE(offset), oracle.readBigUInt64LE(offset),
      "Native diagnostics ear " + ear + " field " + field);
    offset += 8;
  }
  const expectedPeak = oracle.readDoubleLE(offset);
  const actualPeak = actual.readDoubleLE(offset);
  assert.ok(Math.abs(actualPeak - expectedPeak) <= manifest.pcmMaxErrorThreshold,
    "Native max-output diagnostic ear " + ear);
  offset += 8;
}
assert.equal(actual.readBigUInt64LE(offset), 0n,
  "Native callback allocation count");
assert.equal(oracle.readBigUInt64LE(offset), 0n,
  "oracle callback allocation count");
offset += 8;
let maxLevelError = 0;
for (let ear = 0; ear < 2; ear++) {
  for (let event = 0; event < expectedUpdates; event++) {
    assert.equal(actual.readBigUInt64LE(offset), oracle.readBigUInt64LE(offset),
      "Native control sample index ear " + ear + " event " + event);
    offset += 8;
    for (let band = 0; band < 6; band++) {
      const expected = oracle.readDoubleLE(offset);
      const actualValue = actual.readDoubleLE(offset);
      maxLevelError = Math.max(maxLevelError, Math.abs(actualValue - expected));
      offset += 8;
    }
  }
}
assert.equal(offset, actual.length, "Native output protocol length");
assert.ok(maxLevelError <= manifest.nominalLevelMaxErrorThreshold,
  "nominal-level max error " + maxLevelError + " exceeds threshold");
console.log(JSON.stringify({
  result: "PASS",
  testScope: "Native output protocol and parity against the JS oracle",
  samplesPerEar: manifest.samplesPerEar,
  controlUpdatesPerEar: manifest.controlUpdatesPerEar,
  exactBytes: actual.length,
  maxPcmError,
  rmsPcmError,
  maxNominalLevelError: maxLevelError,
  diagnosticsAndControlIndicesExact: true,
  audioRoute: manifest.audioRoute,
  hearingOutputAuthorized: manifest.hearingOutputAuthorized,
  actualSha256: sha256(actual),
}));
