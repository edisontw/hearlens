import assert from "node:assert/strict";
import test from "node:test";
import {
  AUDIOGRAM_SCHEMA, AUDIOGRAM_FREQUENCIES_HZ,
  normalizeAudiogramProfile, serializeAudiogramProfile,
  deserializeAudiogramProfile, thresholdAtFrequency,
} from "./audiogram.mjs";

const provenance = { source: "clinical-report", measuredOn: "2024-02-29" };
const example = () => ({
  schema: AUDIOGRAM_SCHEMA,
  ears: {
    left: { thresholdsDbHL: { 500: 30, 1000: null, 2000: 50, 8000: 70 }, provenance },
    right: { thresholdsDbHL: { 500: 10, 1000: 15, 2000: 20 }, provenance: { source: "manual", measuredOn: null } },
  },
});

test("golden canonical input: six explicit slots, missing does not equal zero", () => {
  const profile = normalizeAudiogramProfile(example());
  assert.deepEqual(AUDIOGRAM_FREQUENCIES_HZ, [250, 500, 1000, 2000, 4000, 8000]);
  assert.deepEqual(Object.keys(profile.ears.left.thresholdsDbHL), ["250", "500", "1000", "2000", "4000", "8000"]);
  assert.equal(profile.ears.left.thresholdsDbHL["250"], null);
  assert.equal(profile.ears.left.thresholdsDbHL["1000"], null);
  assert.equal(profile.ears.right.thresholdsDbHL["1000"], 15);
  assert.equal(profile.ears.left.provenance.measuredOn, "2024-02-29");
  assert(Object.isFrozen(profile.ears.left.thresholdsDbHL));
});

test("golden log midpoint across two octaves is 40 dB HL, not measured", () => {
  const a = example();
  const left1k = thresholdAtFrequency(a, "left", 1000);
  assert.deepEqual(left1k, { frequencyHz: 1000, thresholdDbHL: 40, basis: "interpolated", anchorsHz: [500, 2000] });
  const left4k = thresholdAtFrequency(a, "left", 4000);
  assert.deepEqual(left4k, { frequencyHz: 4000, thresholdDbHL: 60, basis: "interpolated", anchorsHz: [2000, 8000] });
  const left750 = thresholdAtFrequency(a, "left", 750);
  assert(Math.abs(left750.thresholdDbHL - (30 + Math.log(1.5) / Math.log(4) * 20)) < 1e-12);
});

test("exact values preserve measured status including zero and both boundary anchors", () => {
  const a = example();
  a.ears.left.thresholdsDbHL["500"] = 0;
  assert.deepEqual(thresholdAtFrequency(a, "left", 500),
    { frequencyHz: 500, thresholdDbHL: 0, basis: "measured" });
  assert.deepEqual(thresholdAtFrequency(a, "left", 8000),
    { frequencyHz: 8000, thresholdDbHL: 70, basis: "measured" });
});

test("ears are strictly independent, never cross-fill unavailable values", () => {
  const a = example();
  assert.deepEqual(thresholdAtFrequency(a, "right", 1000),
    { frequencyHz: 1000, thresholdDbHL: 15, basis: "measured" });
  assert.deepEqual(thresholdAtFrequency(a, "right", 4000),
    { frequencyHz: 4000, thresholdDbHL: null, basis: "unavailable", reason: "outside-measured-range" });
  a.ears.right = null;
  assert.deepEqual(thresholdAtFrequency(a, "right", 1000),
    { frequencyHz: 1000, thresholdDbHL: null, basis: "unavailable", reason: "ear-unavailable" });
  assert.equal(thresholdAtFrequency(a, "left", 1000).thresholdDbHL, 40);
});

test("no extrapolation and no single-anchor interpolation", () => {
  const a = example();
  assert.deepEqual(thresholdAtFrequency(a, "left", 250),
    { frequencyHz: 250, thresholdDbHL: null, basis: "unavailable", reason: "outside-measured-range" });
  a.ears.left.thresholdsDbHL = { "1000": 35 };
  assert.deepEqual(thresholdAtFrequency(a, "left", 1000),
    { frequencyHz: 1000, thresholdDbHL: 35, basis: "measured" });
  assert.deepEqual(thresholdAtFrequency(a, "left", 2000),
    { frequencyHz: 2000, thresholdDbHL: null, basis: "unavailable", reason: "insufficient-anchors" });
  a.ears.left.thresholdsDbHL = {};
  assert.equal(thresholdAtFrequency(a, "left", 1000).basis, "unavailable");
});

test("serialization round-trip is canonical, deterministic and doesn't mutate input", () => {
  const input = example();
  const original = structuredClone(input);
  const encoded = serializeAudiogramProfile(input);
  assert.deepEqual(input, original);
  assert.equal(encoded, serializeAudiogramProfile(deserializeAudiogramProfile(encoded)));
  assert.deepEqual(JSON.parse(encoded).ears.left.thresholdsDbHL, {
    250: null, 500: 30, 1000: null, 2000: 50, 4000: null, 8000: 70,
  });
  assert(Object.isFrozen(deserializeAudiogramProfile(encoded).ears.right));
  assert(!encoded.includes("undefined"));
});

test("reject malformed, unversioned, unknown frequency, unsupported metadata and coercions", () => {
  for (const bad of [
    null, [], { ears: example().ears },
    { schema: "hearlens-audiogram-v2", ears: example().ears },
    { ...example(), nickname: "identifying-data" },
    { ...example(), ears: { left: example().ears.left } },
    { ...example(), ears: { ...example().ears, other: null } },
  ]) assert.throws(() => normalizeAudiogramProfile(bad));

  for (const [key, value] of [
    ["125", 5], ["1000", "40"], ["1000", true], ["1000", NaN],
    ["1000", Infinity], ["1000", -21], ["1000", 131],
    ["1000", undefined],
  ]) {
    const a = example();
    a.ears.left.thresholdsDbHL[key] = value;
    assert.throws(() => normalizeAudiogramProfile(a), key + " / " + String(value));
  }
  for (const bad of [
    { source: "not-listed", measuredOn: null },
    { source: "clinical-report", measuredOn: "2026-02-29" },
    { source: "clinical-report", measuredOn: "2024-13-01" },
    { source: "clinical-report", measuredOn: "2024-01-01T00:00:00Z" },
    { source: "manual", measuredOn: null, patientName: "X" },
  ]) {
    const a = example();
    a.ears.left.provenance = bad;
    assert.throws(() => normalizeAudiogramProfile(a));
  }
});

test("reject invalid query frequencies/ear names; never invent a value outside domain", () => {
  const a = example();
  for (const f of [0, 249, 8001, Infinity, NaN, "1000"]) {
    assert.throws(() => thresholdAtFrequency(a, "left", f));
  }
  for (const ear of ["both", "", null]) assert.throws(() => thresholdAtFrequency(a, ear, 1000));
});

test("reject prototype-pollution keys, malformed JSON and unbounded payloads", () => {
  const encoded = serializeAudiogramProfile(example());
  assert.throws(() => deserializeAudiogramProfile("{broken"));
  assert.throws(() => deserializeAudiogramProfile(12));
  assert.throws(() => deserializeAudiogramProfile(" ".repeat(16385)));
  assert.throws(() => deserializeAudiogramProfile(encoded.replace('"schema":', '"__proto__":{},"schema":')));
  assert.equal({}.polluted, undefined);
});

test("per-ear ranges include -20 and 130 dB HL, without claiming output gain", () => {
  const a = example();
  a.ears.left.thresholdsDbHL["250"] = -20;
  a.ears.right.thresholdsDbHL["8000"] = 130;
  assert.equal(thresholdAtFrequency(a, "left", 250).thresholdDbHL, -20);
  assert.equal(thresholdAtFrequency(a, "right", 8000).thresholdDbHL, 130);
});
