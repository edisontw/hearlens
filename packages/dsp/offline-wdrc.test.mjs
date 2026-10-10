import assert from "node:assert/strict";
import test from "node:test";
import {
  renderOfflineWDRC, OFFLINE_WDRC_FRAME_SIZE, OFFLINE_WDRC_HOP_SIZE,
} from "./offline-wdrc.mjs";
import { PRESCRIPTION_TARGET_SCHEMA } from "../prescription-targets/prescription-targets.mjs";

const CENTERS = [250, 500, 1000, 2000, 4000, 6000];
const createTargets = ({ centers = CENTERS, leftGain = [0, 0, 0], rightGain = [0, 0, 0] } = {}) => {
  const makeEar = gains => ({
    bands: centers.map(centerHz => ({
      centerHz, gainDbByInputLevel: { "50": gains[0], "65": gains[1], "80": gains[2] },
    })),
  });
  return {
    schema: PRESCRIPTION_TARGET_SCHEMA, usage: "offline-research-only",
    origin: { kind: "synthetic-fixture", referenceId: null },
    ears: { left: makeEar(leftGain), right: makeEar(rightGain) },
  };
};
const sine = (n = 8192, frequencyHz = 1000, sampleRate = 16000, amplitude = 0.02) =>
  Float32Array.from({ length: n }, (_, i) =>
    amplitude * Math.sin(2 * Math.PI * frequencyHz * i / sampleRate));
const args = (extra = {}) => ({
  samples: sine(), sampleRate: 16000, targets: createTargets(), ear: "left",
  syntheticRmsDbFSAt65DbSPL: -37, ...extra,
});
const peak = samples => samples.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);

test("golden: six-band zero targets reconstruct synthetic sine without bypass or gain", () => {
  const input = sine();
  const rendered = renderOfflineWDRC(args({ samples: input }));
  assert.equal(OFFLINE_WDRC_FRAME_SIZE, 1024);
  assert.equal(OFFLINE_WDRC_HOP_SIZE, 256);
  assert.equal(rendered.samples.length, input.length);
  assert.equal(rendered.diagnostics.limitedSamples, 0);
  assert.equal(rendered.diagnostics.kind, "offline-synthetic-only");
  assert.deepEqual(rendered.diagnostics.bandCentersHz, CENTERS);
  assert(Object.isFrozen(rendered.diagnostics));
  let maxError = 0;
  for (let i = 0; i < input.length; i++) {
    maxError = Math.max(maxError, Math.abs(rendered.samples[i] - input[i]));
  }
  assert(maxError < 0.00001, "zero-gain overlap-add must reconstruct input: " + maxError);
});

test("golden: deterministic output and no source mutation", () => {
  const supplied = args({
    targets: createTargets({ leftGain: [20, 10, 0] }),
  });
  const original = Float32Array.from(supplied.samples);
  const first = renderOfflineWDRC(supplied);
  const second = renderOfflineWDRC(supplied);
  assert.deepEqual(first.samples, second.samples);
  assert.deepEqual(first.diagnostics, second.diagnostics);
  assert.deepEqual(supplied.samples, original);
});

test("left/right independence: different supplied target gains change output", () => {
  const targets = createTargets({ leftGain: [0, 0, 0], rightGain: [18, 12, 6] });
  const input = sine(16000, 1000, 16000, 0.01);
  const left = renderOfflineWDRC(args({ samples: input, targets, ear: "left" }));
  const right = renderOfflineWDRC(args({ samples: input, targets, ear: "right" }));
  assert(peak(right.samples) > 1.1 * peak(left.samples));
  assert.equal(left.diagnostics.ear, "left");
  assert.equal(right.diagnostics.ear, "right");
});

test("final limiter always runs after multiband synthesis: extreme synthetic PCM", () => {
  const high = createTargets({ leftGain: [80, 80, 80], rightGain: [80, 80, 80] });
  const samples = Float32Array.from({ length: 8192 }, (_, i) =>
    8 * (Math.sin(2 * Math.PI * 500 * i / 16000) + Math.sin(2 * Math.PI * 3500 * i / 16000)) / 2);
  for (const ear of ["left", "right"]) {
    for (const ceiling of [0.1, 0.8, 0.95]) {
      const out = renderOfflineWDRC(args({ samples, targets: high, ear, limiterCeiling: ceiling }));
      assert(out.diagnostics.limitedSamples > 0);
      assert(out.diagnostics.cappedBandFrames > 0);
      assert(peak(out.samples) <= ceiling, "Float32 quantization may not bypass limiter");
      assert(out.samples.every(Number.isFinite));
      assert(out.diagnostics.maxAbsOutput <= ceiling);
    }
  }
});

test("silence stays exactly silent even with high research target curves", () => {
  const out = renderOfflineWDRC(args({
    samples: new Float32Array(4096),
    targets: createTargets({ leftGain: [80, 80, 80] }),
  }));
  assert.equal(peak(out.samples), 0);
  assert.equal(out.diagnostics.limitedSamples, 0);
});

test("8-band synthetic fixture works without deriving dB HL or clinical gain", () => {
  const centers = [250, 375, 500, 750, 1000, 2000, 4000, 6000];
  const r = renderOfflineWDRC(args({
    targets: createTargets({ centers, leftGain: [15, 10, 5] }),
  }));
  assert.equal(r.diagnostics.bandCentersHz.length, 8);
  assert(r.samples.every(Number.isFinite));
  assert(peak(r.samples) < 0.8);
});

test("reject missing ears, underfilled bands, external targets and invalid provenance", () => {
  const withoutEar = createTargets(); withoutEar.ears.left = null;
  assert.throws(() => renderOfflineWDRC(args({ targets: withoutEar })), /6 to 8/);
  const tooFewBands = createTargets({ centers: [500, 1000, 2000] });
  assert.throws(() => renderOfflineWDRC(args({ targets: tooFewBands })), /6 to 8/);
  const external = createTargets();
  external.origin = { kind: "external-unverified", referenceId: "study-01" };
  assert.throws(() => renderOfflineWDRC(args({ targets: external })), /synthetic-fixture/);
  const switched = createTargets(); switched.usage = "live";
  assert.throws(() => renderOfflineWDRC(args({ targets: switched })));
});

test("reject invalid stream/config upfront and fail closed without producing samples", () => {
  for (const samples of [[], [1, 2], new Float32Array(0),
    new Float32Array(65537), Float32Array.of(NaN), Float32Array.of(Infinity),
    Float32Array.of(17)]) {
    assert.throws(() => renderOfflineWDRC(args({ samples })));
  }
  for (const sampleRate of [44100, 0, "16000"]) {
    assert.throws(() => renderOfflineWDRC(args({ sampleRate })));
  }
  for (const ear of ["both", null]) assert.throws(() => renderOfflineWDRC(args({ ear })));
  for (const value of [null, undefined, NaN, -91, -2]) {
    assert.throws(() => renderOfflineWDRC(args({ syntheticRmsDbFSAt65DbSPL: value })));
  }
  for (const [field, values] of Object.entries({
    maxGainDb: [-1, 25, NaN, null],
    limiterCeiling: [0, 1, 0.049, 0.951, NaN],
    attackMs: [0, 101, Infinity],
    releaseMs: [0, 2001, NaN],
  })) {
    for (const value of values) assert.throws(() => renderOfflineWDRC(args({ [field]: value })));
  }
});

test("reject center frequency at Nyquist; no processing under undefined high band", () => {
  const target = createTargets({ centers: [250, 500, 1000, 2000, 4000, 8000] });
  assert.throws(() => renderOfflineWDRC(args({ targets: target })), /Nyquist/);
  const accepted = renderOfflineWDRC(args({
    targets: target, sampleRate: 48000,
    samples: sine(4096, 1000, 48000),
  }));
  assert.equal(accepted.samples.length, 4096);
});
