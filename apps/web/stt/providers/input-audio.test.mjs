import assert from "node:assert/strict";
import test from "node:test";

import { processInputAudio } from "./input-audio.mjs";

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
