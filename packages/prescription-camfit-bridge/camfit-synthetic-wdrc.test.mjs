import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  renderCamfitSyntheticWDRC,
  CAMFIT_SYNTHETIC_TRIAL_SCHEMA,
  SYNTHETIC_INPUT_MAPPING_SCHEMA,
} from "./camfit-synthetic-wdrc.mjs";
import { AUDIOGRAM_SCHEMA } from "../audiogram/audiogram.mjs";
import { renderOfflineWDRC } from "../dsp/offline-wdrc.mjs";
import { PRESCRIPTION_TARGET_SCHEMA } from
  "../prescription-targets/prescription-targets.mjs";

const FREQUENCIES = [250, 500, 1000, 2000, 4000, 8000];
function makeEar(values) {
  return {
    thresholdsDbHL: Object.fromEntries(
      FREQUENCIES.map((hz, i) => [hz, values[i]])),
    provenance: { source: "manual", measuredOn: null },
  };
}
function audiogram(
  left = [30, 40, 50, 60, 70, 80],
  right = [30, 40, 50, 60, 70, 80],
) {
  return {
    schema: AUDIOGRAM_SCHEMA,
    ears: {
      left: left === null ? null : makeEar(left),
      right: right === null ? null : makeEar(right),
    },
  };
}
const synth = (n = 8192, f = 1000, amp = 0.004, rate = 24000) =>
  Float32Array.from({length: n}, (_, i) =>
    amp * Math.sin(2 * Math.PI * f * i / rate));

function fixture(override = {}) {
  return {
    schema: CAMFIT_SYNTHETIC_TRIAL_SCHEMA,
    usage: "offline-synthetic-test-only",
    audiogram: audiogram(),
    samples: synth(),
    sampleRate: 24000,
    ear: "left",
    syntheticInputReference: {
      schema: SYNTHETIC_INPUT_MAPPING_SCHEMA,
      rmsDbFSAtNominal65: -37,
      physicalMicCalibrated: false,
      physicalReceiverCalibrated: false,
      route: "none",
    },
    maxGainDb: 12,
    limiterCeiling: 0.8,
    crossoverMode: "smooth",
    ...override,
  };
}
const peak = data => data.reduce((n, x) => Math.max(n, Math.abs(x)), 0);
const approx = (a, b, err = 1e-7) => assert(
  Math.abs(a - b) < err,
  `got ${a}, expected ${b}`);

test("golden CAMFIT model at six frequencies projects exactly onto 50/65/80 research anchors", () => {
  const f = fixture();
  const original = Float32Array.from(f.samples);
  const rendered = renderCamfitSyntheticWDRC(f);
  assert.equal(rendered.schema, "hearlens-m03-camfit-wdrc-synthetic-result-v1");
  const targets = rendered.projectedModelTargets;
  assert.equal(targets.schema, PRESCRIPTION_TARGET_SCHEMA);
  assert.equal(targets.usage, "offline-research-only");
  assert.deepEqual(targets.origin, { kind: "synthetic-fixture", referenceId: null });
  assert.deepEqual(targets.ears.left.bands.map(b => b.centerHz), FREQUENCIES);
  assert.equal(targets.ears.left.bands.length, 6);
  assert.equal(rendered.diagnostics.quantity, "camfit-compressive-model-gain-db");
  const anchors = targets.ears.left.bands[2].gainDbByInputLevel;
  approx(anchors["50"], 25.448208542);
  approx(anchors["65"], 20.832153685);
  approx(anchors["80"], 16.216098828);
  assert(anchors["50"] > anchors["65"] && anchors["65"] > anchors["80"]);
  assert.deepEqual(f.samples, original);
  assert(Object.isFrozen(rendered));
  assert(Object.isFrozen(rendered.projectedModelTargets.ears.left.bands[2]));
  assert.equal(rendered.diagnostics.hearingOutputAuthorized, false);
  assert.equal(rendered.diagnostics.clinicalParityEstablished, false);
  assert.equal(rendered.diagnostics.physicallyCalibrated, false);
  assert.equal(rendered.diagnostics.route, "none");
});

test("end-to-end synthetic projection is bitwise equal to authoritative existing offline WDRC", () => {
  const f = fixture();
  for (const crossoverMode of ["hard", "smooth"]) {
    const projected = renderCamfitSyntheticWDRC({ ...f, crossoverMode });
    const direct = renderOfflineWDRC({
      samples: f.samples, sampleRate: f.sampleRate,
      targets: projected.projectedModelTargets, ear: f.ear,
      syntheticRmsDbFSAt65DbSPL: -37,
      maxGainDb: f.maxGainDb, limiterCeiling: f.limiterCeiling,
      crossoverMode,
    });
    assert.deepEqual(projected.samples, direct.samples);
    assert.deepEqual(projected.diagnostics.bandCentersHz, direct.diagnostics.bandCentersHz);
    assert.equal(projected.diagnostics.limitedSamples, direct.diagnostics.limitedSamples);
    assert.equal(projected.diagnostics.cappedBandFrames, direct.diagnostics.cappedBandFrames);
  }
});

test("left/right are isolated and a flat-zero-loss ear gets zero model gain", () => {
  const ag = audiogram(
    [0, 0, 0, 0, 0, 0],
    [20, 30, 40, 50, 60, 70],
  );
  const f = fixture({audiogram: ag});
  const left = renderCamfitSyntheticWDRC({ ...f, ear: "left" });
  const right = renderCamfitSyntheticWDRC({ ...f, ear: "right" });
  assert(left.projectedModelTargets.ears.left.bands.every(b =>
    Object.values(b.gainDbByInputLevel).every(g => g === 0)));
  assert(right.projectedModelTargets.ears.right.bands.some(b =>
    b.gainDbByInputLevel["65"] > 0));
  assert(peak(right.samples) > peak(left.samples) * 1.05,
    "right research model produces independent gain on identical synthetic clip");
  assert.equal(right.diagnostics.ear, "right");
  assert.equal(left.diagnostics.ear, "left");
});

test("post-mix digital limiter still bounds extreme synthesized output for either ear", () => {
  const f = fixture({
    samples: synth(4096, 1000, 4, 24000),
    limiterCeiling: 0.06,
  });
  for (const ear of ["left", "right"]) {
    const out = renderCamfitSyntheticWDRC({ ...f, ear });
    assert(out.samples.every(Number.isFinite));
    assert(out.diagnostics.limitedSamples > 0);
    assert(out.diagnostics.cappedBandFrames > 0);
    assert(peak(out.samples) <= 0.06);
    assert(out.diagnostics.maxAbsOutput <= 0.06);
    assert.equal(out.diagnostics.hearingOutputAuthorized, false);
  }
});

test("no signal leakage from missing ear or invalid/missing measured threshold", () => {
  const leftOnly = fixture({ audiogram: audiogram([30,40,50,60,70,80], null) });
  const r = renderCamfitSyntheticWDRC(leftOnly);
  assert.equal(r.projectedModelTargets.ears.right, null);
  assert.throws(() => renderCamfitSyntheticWDRC({ ...leftOnly, ear: "right" }),
    /no measured audiogram/);
  const missing = audiogram();
  missing.ears.left.thresholdsDbHL[1000] = null;
  assert.throws(() => renderCamfitSyntheticWDRC(fixture({audiogram: missing})),
    /requires measured thresholds/);
});

test("reject any calibration, output-route, silent-default or unknown-option claim", () => {
  const b = fixture();
  for (const bad of [
    { ...b, usage: "live" },
    { ...b, schema: "v2" },
    { ...b, outputAuthorized: true },
    { ...b, targets: {kind: "external"} },
    { ...b, ear: "both" },
    { ...b, sampleRate: 16000 },
    { ...b, sampleRate: 44100 },
    { ...b, syntheticInputReference: null },
    { ...b, syntheticInputReference: {
      ...b.syntheticInputReference, physicalMicCalibrated: true } },
    { ...b, syntheticInputReference: {
      ...b.syntheticInputReference, physicalReceiverCalibrated: true } },
    { ...b, syntheticInputReference: {
      ...b.syntheticInputReference, route: "headphones" } },
    { ...b, syntheticInputReference: {
      ...b.syntheticInputReference, realDeviceId: "PRIVATE" } },
    { ...b, syntheticInputReference: {
      ...b.syntheticInputReference, rmsDbFSAtNominal65: NaN } },
    { ...b, maxGainDb: 24 },
    { ...b, maxGainDb: -1 },
    { ...b, limiterCeiling: 1 },
    { ...b, crossoverMode: "native" },
  ]) assert.throws(() => renderCamfitSyntheticWDRC(bad));
  const omitted = fixture();
  delete omitted.syntheticInputReference;
  assert.throws(() => renderCamfitSyntheticWDRC(omitted));
  const noSamples = fixture({samples: new Float32Array(0)});
  assert.throws(() => renderCamfitSyntheticWDRC(noSamples));
  assert.throws(() => renderCamfitSyntheticWDRC(fixture({
    samples: Float32Array.of(0, NaN)})));
});

test("synthetic-only bridge code has no browser, sound-device, network or output sink", () => {
  const source = readFileSync(
    "packages/prescription-camfit-bridge/camfit-synthetic-wdrc.mjs", "utf8");
  assert.doesNotMatch(source,
    /navigator\.|AudioContext|AudioTrack|AudioRecord|AudioOutput|WebSocket|fetch\(|\.play\(|speaker|bluetooth\./i);
  assert.match(source, /hearingOutputAuthorized: false/);
  assert.match(source, /route: "none"/);
});
