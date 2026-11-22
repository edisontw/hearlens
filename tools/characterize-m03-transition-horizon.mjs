/** Compare FIR retarget timing policies using offline synthetic PCM only. */
import assert from "node:assert/strict";
import { core } from "../packages/dsp/offline-auto-fir.testkit.mjs";

const rate = 48000;
const interval = 480;
const seconds = 12;
const count = seconds * rate;
const callbacks = [1, 128, 480, 1024, 4096];
const input = Float32Array.from({ length: count }, (_, sample) => {
  const ms = 1000 * sample / rate;
  const amplitude = ms >= 4000 && ms < 6000 ? 0.08 : 0.006;
  return amplitude * Math.sin(2 * Math.PI * 1000 * sample / rate);
});

function render(ear, policy, callbackSize) {
  const processor = core(ear, undefined, { transitionRetargetPolicy: policy });
  const output = new Float32Array(input.length);
  for (let pos = 0; pos < input.length; pos += callbackSize) {
    const end = Math.min(input.length, pos + callbackSize);
    processor.processInto(input.subarray(pos, end), output.subarray(pos, end));
  }
  return { processor, output };
}

function windowGain(output, startMs) {
  const start = Math.round(startMs * rate / 1000) + 256;
  let inPower = 0, outPower = 0;
  for (let sample = start; sample < start + interval; sample++) {
    inPower += input[sample - 256] ** 2;
    outPower += output[sample] ** 2;
  }
  return 10 * Math.log10(outPower / inPower);
}

function toneResidualDb(output, startMs) {
  const start = Math.round(startMs * rate / 1000) + 256;
  let cosine = 0, sine = 0, totalPower = 0;
  for (let sample = start; sample < start + interval; sample++) {
    const value = output[sample];
    const phase = 2 * Math.PI * 1000 * (sample - 256) / rate;
    cosine += value * Math.cos(phase);
    sine += value * Math.sin(phase);
    totalPower += value * value;
  }
  const fundamentalPower = 2 * (cosine * cosine + sine * sine) / interval ** 2;
  const residualPower = Math.max(0, totalPower / interval - fundamentalPower);
  return 10 * Math.log10(Math.max(residualPower, 1e-30) / Math.max(fundamentalPower, 1e-30));
}

function summarize(ear, policy) {
  const { processor, output } = render(ear, policy, 480);
  const low = windowGain(output, 3000);
  const high = windowGain(output, 5500);
  const midpoint = (low + high) / 2;
  const gains = Array.from({ length: 800 }, (_, index) => ({
    ms: 3950 + index * 10,
    db: windowGain(output, 3950 + index * 10),
  }));
  function crossing(startMs, direction) {
    for (let ms = startMs; ms <= startMs + 2500; ms += 10) {
      const row = gains.find(value => value.ms === ms);
      if (row && (direction === "down" ? row.db <= midpoint : row.db >= midpoint)) return ms - startMs;
    }
    return null;
  }
  function trace(startMs, endMs) {
    return gains.filter(row => row.ms >= startMs && row.ms <= endMs);
  }
  function monotonicViolations(rows, direction) {
    let count = 0, largest = 0;
    for (let i = 1; i < rows.length; i++) {
      const delta = direction === "down" ? rows[i].db - rows[i - 1].db : rows[i - 1].db - rows[i].db;
      if (delta > 0.02) {
        count++;
        largest = Math.max(largest, delta);
      }
    }
    return { count, largestDb: largest };
  }
  function gainPumping(rows) {
    const values = rows.map(row => row.db);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return {
      peakToPeakDb: Math.max(...values) - Math.min(...values),
      standardDeviationDb: Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length),
    };
  }
  function distortion(startMs, endMs) {
    const values = [];
    for (let ms = startMs; ms <= endMs; ms += 10) values.push(toneResidualDb(output, ms));
    const meanPower = values.reduce((sum, value) => sum + 10 ** (value / 10), 0) / values.length;
    return {
      arithmeticMeanDb: values.reduce((sum, value) => sum + value, 0) / values.length,
      integratedMeanPowerDb: 10 * Math.log10(meanPower),
      maxDb: Math.max(...values),
    };
  }
  const attack = gains.filter(row => row.ms >= 4000 && row.ms <= 5500);
  const release = gains.filter(row => row.ms >= 6000 && row.ms <= 8500);
  const steady = gains.filter(row => row.ms >= 5000 && row.ms <= 5900);
  const attackDistortion = distortion(4000, 4300);
  const releaseDistortion = distortion(6000, 6300);
  let maxAbsOutput = 0;
  for (const sample of output) maxAbsOutput = Math.max(maxAbsOutput, Math.abs(sample));
  return {
    ear, policy, lowSteadyDb: low, highSteadyDb: high,
    attackMidpointMs: crossing(4000, "down"), releaseMidpointMs: crossing(6000, "up"),
    attackNonMonotonic: monotonicViolations(attack, "down"),
    releaseNonMonotonic: monotonicViolations(release, "up"),
    highHoldGainPumping: gainPumping(steady),
    attackTransientResidualDb: attackDistortion,
    releaseTransientResidualDb: releaseDistortion,
    limiter: {
      ceiling: 0.3,
      maxAbsOutput,
      limitedSamples: processor.diagnostics.fir.limitedSamples,
    },
    settledGains: gains.filter(row => [3950,3990,4000,4010,4050,4100,4200,4300,4500,5000,5500,5950,5990,6000,6010,6050,6100,6200,6300,6500,7000,8000].includes(row.ms)),
  };
}

const policies = ["restart", "fixed-horizon"];
const results = ["left", "right"].flatMap(ear => policies.map(policy => summarize(ear, policy)));
for (const ear of ["left", "right"]) {
  const reference = render(ear, "fixed-horizon", 480).output;
  for (const size of callbacks) {
    assert.deepEqual(render(ear, "fixed-horizon", size).output, reference,
      `fixed-horizon partition mismatch for ${ear} at ${size}`);
  }
  assert(reference.every(sample => Number.isFinite(sample) && Math.abs(sample) <= 0.3));
}
console.log(JSON.stringify({ sampleRate: rate, samples: count, callbackPartitionSizes: callbacks,
  source: "same 12 s 1 kHz signal, 0.006 peak baseline; 0.08 peak from 4 s to 6 s",
  results }, null, 2));
