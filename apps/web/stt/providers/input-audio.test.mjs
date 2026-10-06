import assert from "node:assert/strict";
import test from "node:test";

import { AdaptiveInputNormalizer, processInputAudio } from "./input-audio.mjs";

test("gain=1 preserves normal PCM samples", () => {
  const input = new Float32Array([0.1, -0.2, 0.3]);
  const result = processInputAudio(input, 1);

  assert.deepEqual(
    Array.from(result.samples).map((v) => Number(v.toFixed(4))),
    [0.1, -0.2, 0.3],
  );
  assert.equal(result.clippedPercent, 0);
});

test("software preamp applies gain and limits peaks", () => {
  const input = new Float32Array([0.1, -0.2, 0.5]);
  const result = processInputAudio(input, 3);

  assert.deepEqual(
    Array.from(result.samples).map((v) => Number(v.toFixed(2))),
    [0.3, -0.6, 0.98],
  );
  assert.ok(result.clippedPercent > 0);
  assert.ok(Number.isFinite(result.rawRmsDbfs));
  assert.ok(Number.isFinite(result.rawPeakDbfs));
  assert.ok(Number.isFinite(result.outputPeakDbfs));
});

test("gain is bounded to the safe experiment range", () => {
  const input = new Float32Array([0.05]);
  const result = processInputAudio(input, 100);

  assert.equal(Number(result.samples[0].toFixed(2)), 0.4);
});


test("adaptive normalizer raises weak speech without exceeding max gain", () => {
  const normalizer = new AdaptiveInputNormalizer();
  const weakSpeech = new Float32Array(1600).fill(0.0004);
  let result;

  for (let i = 0; i < 20; i += 1) {
    result = normalizer.process(weakSpeech, 16000);
  }

  assert.equal(result.speechActive, true);
  assert.ok(result.adaptiveGain > 6);
  assert.ok(result.adaptiveGain <= 8);
  assert.ok(result.outputPeakDbfs > result.rawPeakDbfs);
});


test("adaptive normalizer backs off when speech approaches the target level", () => {
  const normalizer = new AdaptiveInputNormalizer();
  const distantSpeech = new Float32Array(1600).fill(0.0004);

  for (let i = 0; i < 20; i += 1) {
    normalizer.process(distantSpeech, 16000);
  }

  const nearSpeech = new Float32Array(1600).fill(0.004);
  let result;
  for (let i = 0; i < 5; i += 1) {
    result = normalizer.process(nearSpeech, 16000);
  }

  assert.equal(result.speechActive, true);
  assert.ok(result.adaptiveGain < 2);
  assert.ok(result.adaptiveGain >= 1);
  assert.equal(result.limiterGain, 1);
});

test("adaptive limiter protects the ceiling while gain backs off", () => {
  const normalizer = new AdaptiveInputNormalizer();
  const weakSpeech = new Float32Array(1600).fill(0.0004);

  for (let i = 0; i < 20; i += 1) {
    normalizer.process(weakSpeech, 16000);
  }

  const loudSpeech = new Float32Array(1600).fill(0.8);
  const result = normalizer.process(loudSpeech, 16000);

  assert.ok(result.limiterGain < 1);
  assert.ok(result.outputPeakDbfs <= 20 * Math.log10(0.95) + 0.01);
  assert.ok(result.adaptiveGain < 8);
});

test("adaptive normalizer tracks quiet noise without treating it as speech", () => {
  const normalizer = new AdaptiveInputNormalizer();
  const quietNoise = new Float32Array(1600).fill(0.0001);
  let result;

  for (let i = 0; i < 10; i += 1) {
    result = normalizer.process(quietNoise, 16000);
  }

  assert.equal(result.speechActive, false);
  assert.equal(Number(result.adaptiveGain.toFixed(2)), 1);
  assert.ok(result.noiseFloorDbfs < -75);
});
