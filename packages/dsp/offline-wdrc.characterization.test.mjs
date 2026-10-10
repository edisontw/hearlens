import assert from "node:assert/strict";
import test from "node:test";
import {
  CHARACTERIZATION_SCHEMA, characterizeOfflineWDRC,
  benchmarkOfflineWDRC, fixtureTargets, projectedGainDb, testSine,
} from "./offline-wdrc.characterization.mjs";
import { renderOfflineWDRC } from "./offline-wdrc.mjs";

// One deterministic fixture suite for CI and reproducible report generation.
const report = characterizeOfflineWDRC();

test("research measurement schema, FFT configuration, identity noise/impulse", () => {
  assert.equal(report.schema, CHARACTERIZATION_SCHEMA);
  assert.equal(report.researchOnly, true);
  assert.equal(report.sampleRateHz, 16000);
  assert.equal(report.fftSize, 1024);
  assert.equal(report.hopSize, 256);
  assert(report.identity.noiseMaxError <= 0.000001);
  assert(report.identity.impulseMaxError <= 0.000001);
});

test("uniform six-band research target stays approximately frequency-flat after settling", () => {
  const gains = report.uniformGain.map(v => v.gainDb);
  const range = Math.max(...gains) - Math.min(...gains);
  assert(range < 0.6, "uniform target should be flat across tested tones: " + JSON.stringify(report.uniformGain));
  assert(gains.every(v => v > 4.5 && v < 6.3));
});

test("diagnostic crossover is reported, not falsely certified smooth", () => {
  const r = report.selectiveCrossover;
  assert.equal(r.measurements.length, 10);
  assert(r.maxAdjacentJumpDb >= 0 && r.maxAdjacentJumpDb <= 20);
  assert.equal(r.discontinuityObserved, r.maxAdjacentJumpDb > 1);
  assert(r.measurements.at(-1).gainDb > r.measurements[0].gainDb + 3);
});

test("synthetic input-level compression decreases gain with increasing amplitude", () => {
  const rows = report.compression;
  assert.deepEqual(rows.map(r => r.amplitude), [0.006, 0.03, 0.12]);
  assert(rows[0].measuredGainDb > rows[1].measuredGainDb + 0.6);
  assert(rows[1].measuredGainDb > rows[2].measuredGainDb + 0.6);
  assert(rows[0].inputDbFS + rows[0].measuredGainDb <
         rows[2].inputDbFS + rows[2].measuredGainDb);
});

test("step response shows fast gain decrease and slower recovery, with no fitted time-constant claim", () => {
  const r = report.envelope;
  assert(r.softBefore > r.loudEarly + 1, JSON.stringify(r));
  assert(r.softLate > r.softEarly + 1.5, JSON.stringify(r));
  assert(r.loudLate <= r.softLate, JSON.stringify(r));
});

test("post-synthesis digital limiter rejects heavy overload without exceeding ceiling", () => {
  assert(report.digitalLimiter.limitedSamples > 0);
  assert(report.digitalLimiter.peak <= report.digitalLimiter.ceiling);
  const opts = {
    samples: Float32Array.from({ length: 8192 }, (_, i) =>
      i % 2 === 0 ? 8 : -8),
    sampleRate: 16000, targets: fixtureTargets(() => [80, 80, 80]),
    ear: "right", syntheticRmsDbFSAt65DbSPL: -37,
    limiterCeiling: 0.05, maxGainDb: 24,
  };
  const output = renderOfflineWDRC(opts).samples;
  assert(output.every(v => Number.isFinite(v) && Math.abs(v) <= 0.05));
});

test("tone projection helper and repeatability are deterministic", () => {
  const input = testSine(1000, 0.01, 20480);
  assert(Math.abs(projectedGainDb(input, input, 1000, 4096, 16384)) < 1e-9);
  assert.deepEqual(characterizeOfflineWDRC(), report);
});

test("performance benchmark validates arguments but has no time-dependent CI pass threshold", () => {
  assert.throws(() => benchmarkOfflineWDRC({ iterations: 0 }));
  assert.throws(() => benchmarkOfflineWDRC({ sampleRate: 44100 }));
  assert.throws(() => benchmarkOfflineWDRC({ iterations: 21 }));
});
