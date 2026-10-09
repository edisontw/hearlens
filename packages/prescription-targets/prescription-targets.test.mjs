import assert from "node:assert/strict";
import test from "node:test";
import {
  PRESCRIPTION_TARGET_SCHEMA, INPUT_LEVELS_DB_SPL, TARGET_USAGE,
  normalizePrescriptionTargets, serializePrescriptionTargets,
  deserializePrescriptionTargets, targetGainAtInput,
} from "./prescription-targets.mjs";

const band = (centerHz, soft = 30, medium = 20, loud = 10) => ({
  centerHz, gainDbByInputLevel: { "50": soft, "65": medium, "80": loud },
});
const profile = () => ({
  schema: PRESCRIPTION_TARGET_SCHEMA,
  usage: TARGET_USAGE,
  origin: { kind: "synthetic-fixture", referenceId: null },
  ears: {
    left: { bands: [250, 500, 1000, 2000, 4000, 8000].map(f => band(f)) },
    right: { bands: [band(500, 10, 5, 0), band(2000, 5, 0, -5)] },
  },
});

test("golden 6-band research-only target profile with independent ears", () => {
  const original = profile();
  const canonical = normalizePrescriptionTargets(original);
  assert.deepEqual(INPUT_LEVELS_DB_SPL, [50, 65, 80]);
  assert.equal(canonical.schema, PRESCRIPTION_TARGET_SCHEMA);
  assert.equal(canonical.usage, "offline-research-only");
  assert.deepEqual(canonical.ears.left.bands.map(b => b.centerHz), [250, 500, 1000, 2000, 4000, 8000]);
  assert(Object.isFrozen(canonical.ears.left.bands[0].gainDbByInputLevel));
  assert.deepEqual(targetGainAtInput(canonical, "left", 1000, 65), {
    ear: "left", centerHz: 1000, inputLevelDbSPL: 65, targetGainDb: 20, basis: "anchor",
  });
  assert.deepEqual(targetGainAtInput(canonical, "right", 500, 65), {
    ear: "right", centerHz: 500, inputLevelDbSPL: 65, targetGainDb: 5, basis: "anchor",
  });
  assert.deepEqual(profile(), original);
});

test("golden I/O lookup: linear interpolation *in input dB SPL*, no extrapolation", () => {
  const original = profile();
  assert.deepEqual(targetGainAtInput(original, "left", 1000, 57.5), {
    ear: "left", centerHz: 1000, inputLevelDbSPL: 57.5, targetGainDb: 25,
    basis: "interpolated", anchorsDbSPL: [50, 65],
  });
  assert.deepEqual(targetGainAtInput(original, "left", 1000, 72.5), {
    ear: "left", centerHz: 1000, inputLevelDbSPL: 72.5, targetGainDb: 15,
    basis: "interpolated", anchorsDbSPL: [65, 80],
  });
  for (const input of [0, 49.999, 80.001, 140]) {
    assert.deepEqual(targetGainAtInput(original, "left", 1000, input), {
      ear: "left", centerHz: 1000, inputLevelDbSPL: input, targetGainDb: null,
      basis: "unavailable", reason: "outside-input-grid",
    });
  }
});

test("ear, missing band and missing-ear always remain unavailable", () => {
  const a = profile();
  a.ears.right = null;
  assert.equal(targetGainAtInput(a, "right", 1000, 65).reason, "ear-unavailable");
  assert.equal(targetGainAtInput(a, "left", 375, 65).reason, "band-unavailable");
  assert.equal(targetGainAtInput(a, "left", 1000, 65).targetGainDb, 20);
  a.ears.right = { bands: [band(1000, 0, 0, 0)] };
  assert.equal(targetGainAtInput(a, "right", 1000, 65).targetGainDb, 0);
  assert.equal(targetGainAtInput(a, "left", 1000, 65).targetGainDb, 20);
});

test("support eight strictly increasing bands but reject >8 or duplicates", () => {
  const a = profile();
  a.ears.left.bands = [250, 375, 500, 750, 1000, 2000, 4000, 8000].map(f => band(f));
  assert.equal(normalizePrescriptionTargets(a).ears.left.bands.length, 8);
  a.ears.left.bands.push(band(8100));
  assert.throws(() => normalizePrescriptionTargets(a));
  a.ears.left.bands = [band(250), band(250)];
  assert.throws(() => normalizePrescriptionTargets(a), /ascending/);
  a.ears.left.bands = [band(1000), band(500)];
  assert.throws(() => normalizePrescriptionTargets(a), /ascending/);
  a.ears.left.bands = [];
  assert.throws(() => normalizePrescriptionTargets(a));
});

test("reject non-physical descending nominal I/O vectors and malformed gains", () => {
  const a = profile();
  a.ears.left.bands[0] = band(250, 30, 0, -40);
  assert.throws(() => normalizePrescriptionTargets(a), /decreasing nominal I\/O/);
  for (const bad of [null, undefined, true, "20", NaN, Infinity, -41, 81]) {
    const b = profile();
    b.ears.left.bands[0].gainDbByInputLevel["50"] = bad;
    assert.throws(() => normalizePrescriptionTargets(b), String(bad));
  }
  for (const center of [0, 249, 8001, 1000.1, NaN, "1000"]) {
    const b = profile();
    b.ears.left.bands[0].centerHz = center;
    assert.throws(() => normalizePrescriptionTargets(b), String(center));
  }
});

test("canonical round-trip, stable ordering and no external storage", () => {
  const source = profile();
  const prior = structuredClone(source);
  const json = serializePrescriptionTargets(source);
  const decoded = deserializePrescriptionTargets(json);
  assert.equal(serializePrescriptionTargets(decoded), json);
  assert.deepEqual(source, prior);
  assert.deepEqual(Object.keys(decoded.ears.left.bands[0].gainDbByInputLevel), ["50", "65", "80"]);
  assert(Object.isFrozen(decoded.ears.right.bands));
  assert(!json.includes("undefined"));
});

test("negative and zero gain are valid research targets, never an implied safe level", () => {
  const a = profile();
  a.ears.left.bands = [band(500, 0, 0, 0), band(8000, -40, -40, -40)];
  assert.equal(targetGainAtInput(a, "left", 8000, 50).targetGainDb, -40);
  assert.equal(targetGainAtInput(a, "left", 500, 65).targetGainDb, 0);
  a.ears.left.bands = [band(500, 80, 65, 50)];
  assert.equal(targetGainAtInput(a, "left", 500, 50).targetGainDb, 80);
});

test("strict version, usage, origin and reference identifier are not safety override flags", () => {
  const a = profile();
  for (const [key, value] of [
    ["schema", "hearlens-prescription-targets-v2"],
    ["usage", "calibrated-output"],
    ["patientName", "PRIVATE"],
  ]) {
    const b = profile(); b[key] = value;
    assert.throws(() => normalizePrescriptionTargets(b));
  }
  for (const kind of ["NAL-NL2-certified", "DSL-verified", "clinical", undefined]) {
    const b = profile(); b.origin.kind = kind;
    assert.throws(() => normalizePrescriptionTargets(b));
  }
  for (const ref of ["", "has spaces", "../../file", "A".repeat(121), null, 4]) {
    const b = profile(); b.origin = { kind: "external-unverified", referenceId: ref };
    assert.throws(() => normalizePrescriptionTargets(b));
  }
  a.origin = { kind: "external-unverified", referenceId: "study-fig-01" };
  assert.equal(normalizePrescriptionTargets(a).origin.referenceId, "study-fig-01");
});

test("reject omitted or additional keys, unknown input level and invalid query inputs", () => {
  for (const malformed of [null, [], {}, { ...profile(), ears: { left: null } },
    { ...profile(), origin: { kind: "synthetic-fixture", referenceId: null, name: "PRIVATE" } },
    { ...profile(), ears: { ...profile().ears, both: null } },
  ]) assert.throws(() => normalizePrescriptionTargets(malformed));
  for (const entries of [
    { "50": 30, "65": 20 },
    { "50": 30, "65": 20, "80": 10, "90": 0 },
  ]) {
    const a = profile(); a.ears.left.bands[0].gainDbByInputLevel = entries;
    assert.throws(() => normalizePrescriptionTargets(a));
  }
  for (const ear of [null, "both", "LEFT"]) assert.throws(() => targetGainAtInput(profile(), ear, 500, 65));
  for (const center of [NaN, 0, 1000.5, "500"]) assert.throws(() => targetGainAtInput(profile(), "left", center, 65));
  for (const level of ["65", NaN, Infinity, null]) assert.throws(() => targetGainAtInput(profile(), "left", 500, level));
  for (const bad of ["{", " ".repeat(32769), 0,
    serializePrescriptionTargets(profile()).replace('"schema":', '"__proto__":{},"schema":')]) {
    assert.throws(() => deserializePrescriptionTargets(bad));
  }
  assert.equal({}.polluted, undefined);
});
