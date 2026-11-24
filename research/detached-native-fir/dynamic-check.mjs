import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createOfflineDynamicFirResearch } from "../../packages/dsp/offline-dynamic-fir.mjs";
import { offlineFFT } from "../../packages/dsp/offline-wdrc.mjs";
import { targets } from "../../packages/dsp/offline-auto-fir.testkit.mjs";

const RATE = 48_000;
const TAPS = 513;
const UNIQUE_TAPS = 257;
const FFT_SIZE = 4096;
const BAND_CENTERS = [250, 500, 1000, 2000, 4000, 8000];
const LIMITER_CEILING = 0.3;
const MAX_ABSOLUTE_ERROR = 1e-7;
const MAX_RMS_ERROR = 2e-8;
const SAMPLE_COUNT = 28_800;
const BLOCK_SIZES = [64, 128, 192, 256, 480];
const OUTPUT_SAMPLES_BYTES = SAMPLE_COUNT * 2 * Float32Array.BYTES_PER_ELEMENT;
const OUTPUT_STATS_BYTES = 6 * BigInt64Array.BYTES_PER_ELEMENT;
const FIXTURE_MAGIC = 0x324e4c48;
const NATIVE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const boundaries = BAND_CENTERS.slice(1).map((frequency, index) =>
  Math.sqrt(BAND_CENTERS[index] * frequency));

function frequencyWeights(hz) {
  const weights = new Float64Array(6);
  let band = 0;
  while (band < boundaries.length && hz >= boundaries[band]) band++;
  weights[band] = 1;
  if (hz === 0) return weights;
  for (let index = 0; index < boundaries.length; index++) {
    const octaves = Math.log2(hz / boundaries[index]);
    if (Math.abs(octaves) > 0.18) continue;
    const t = (octaves + 0.18) / 0.36;
    const upper = 0.5 - 0.5 * Math.cos(Math.PI * t);
    weights.fill(0);
    weights[index] = 1 - upper;
    weights[index + 1] = upper;
    break;
  }
  return weights;
}

function designBasis() {
  const basis = Array.from({ length: 6 }, () => new Float64Array(UNIQUE_TAPS));
  const real = new Float64Array(FFT_SIZE);
  const imaginary = new Float64Array(FFT_SIZE);
  const spectra = Array.from({ length: 6 }, () => new Float64Array(FFT_SIZE / 2 + 1));
  for (let bin = 0; bin <= FFT_SIZE / 2; bin++) {
    const weights = frequencyWeights(bin * RATE / FFT_SIZE);
    for (let band = 0; band < 6; band++) spectra[band][bin] = weights[band];
  }
  for (let band = 0; band < 6; band++) {
    real.fill(0);
    imaginary.fill(0);
    for (let bin = 0; bin <= FFT_SIZE / 2; bin++) {
      real[bin] = spectra[band][bin];
      if (bin !== 0 && bin !== FFT_SIZE / 2) real[FFT_SIZE - bin] = spectra[band][bin];
    }
    offlineFFT(real, imaginary, true);
    for (let tap = 0; tap < UNIQUE_TAPS; tap++) {
      const window = 0.54 - 0.46 * Math.cos(2 * Math.PI * tap / (TAPS - 1));
      basis[band][tap] = real[(tap - (TAPS - 1) / 2 + FFT_SIZE) % FFT_SIZE] * window;
    }
  }
  return basis;
}

const bandBasis = designBasis();
const bandTargets = Object.fromEntries(["left", "right"].map(ear => [
  ear,
  targets.ears[ear].bands.map(band => [
    band.gainDbByInputLevel[50],
    band.gainDbByInputLevel[65],
    band.gainDbByInputLevel[80],
  ]),
]));

const targetPatterns = [
  [80, 80, 80, 80, 80, 80],
  [80, 50, 65, 80, 65, 50],
  [50, 80, 65, 50, 80, 65],
  [65, 50, 80, 65, 50, 80],
  [72.5, 57.5, 65, 72.5, 57.5, 65],
  [50, 50, 80, 80, 65, 65],
];
const events = [{
  sampleIndex: 0,
  levels: { left: Array(6).fill(50), right: Array(6).fill(50) },
}];
for (let tick = 0; tick <= 10; tick++) {
  const left = targetPatterns[tick % targetPatterns.length];
  const right = targetPatterns[(tick + 2) % targetPatterns.length];
  events.push({
    sampleIndex: 4_800 + tick * 480,
    levels: { left: [...left], right: [...right] },
  });
}
events.push({
  sampleIndex: 14_400,
  levels: { left: Array(6).fill(65), right: [80, 72.5, 65, 57.5, 50, 65] },
});
events.push({
  sampleIndex: 19_200,
  levels: { left: [50, 65, 80, 72.5, 57.5, 65], right: Array(6).fill(80) },
});

const input = new Float32Array(SAMPLE_COUNT * 2);
for (let sample = 0; sample < SAMPLE_COUNT; sample++) {
  let left = 0.025 * Math.sin(sample * 0.173) + 0.006 * Math.cos(sample * 0.041);
  let right = 0.013 * Math.sin(sample * 0.217) + 0.004 * Math.cos(sample * 0.053);
  if (sample >= 12_000 && sample < 12_960) {
    left += 0.95 * Math.sin(2 * Math.PI * 1400 * sample / RATE);
    right += 0.72 * Math.sin(2 * Math.PI * 2100 * sample / RATE);
  }
  input[sample * 2] = left;
  input[sample * 2 + 1] = right;
}

function renderReference(callbackFrames) {
  const output = new Float32Array(input.length);
  const processors = Object.fromEntries(["left", "right"].map(ear => [
    ear,
    createOfflineDynamicFirResearch({
      usage: "offline-synthetic-test-only",
      targets,
      ear,
      sampleRate: RATE,
      maxGainDb: 12,
      limiterCeiling: LIMITER_CEILING,
      transitionMs: 50,
    }),
  ]));
  const earInput = {
    left: Float32Array.from({ length: SAMPLE_COUNT }, (_, i) => input[i * 2]),
    right: Float32Array.from({ length: SAMPLE_COUNT }, (_, i) => input[i * 2 + 1]),
  };
  const earOutput = {
    left: new Float32Array(SAMPLE_COUNT),
    right: new Float32Array(SAMPLE_COUNT),
  };
  let position = 0;
  let eventIndex = 0;
  while (position < SAMPLE_COUNT) {
    if (events[eventIndex]?.sampleIndex === position) {
      for (const ear of ["left", "right"]) {
        processors[ear].setSyntheticBandLevels(events[eventIndex].levels[ear]);
      }
      eventIndex++;
    }
    const nextEvent = events[eventIndex]?.sampleIndex ?? SAMPLE_COUNT;
    const frames = Math.min(callbackFrames, SAMPLE_COUNT - position, nextEvent - position, 4096);
    assert(frames > 0, `reference schedule stalled at sample ${position}`);
    for (const ear of ["left", "right"]) {
      const start = position;
      processors[ear].processInto(
        earInput[ear].subarray(start, start + frames),
        earOutput[ear].subarray(start, start + frames),
      );
    }
    position += frames;
  }
  assert.equal(eventIndex, events.length);
  for (let sample = 0; sample < SAMPLE_COUNT; sample++) {
    output[sample * 2] = earOutput.left[sample];
    output[sample * 2 + 1] = earOutput.right[sample];
  }
  return {
    output,
    diagnostics: {
      left: processors.left.diagnostics,
      right: processors.right.diagnostics,
    },
  };
}

function makeFixture(callbackFrames) {
  const headerBytes = 4 * 4 + 2 * Float64Array.BYTES_PER_ELEMENT;
  const basisBytes = 6 * UNIQUE_TAPS * Float64Array.BYTES_PER_ELEMENT;
  const targetsBytes = 2 * 6 * 3 * Float64Array.BYTES_PER_ELEMENT;
  const eventsBytes = 4 + events.length * (4 + 2 * 6 * Float64Array.BYTES_PER_ELEMENT);
  const inputBytes = input.length * Float32Array.BYTES_PER_ELEMENT;
  const buffer = Buffer.alloc(headerBytes + basisBytes + targetsBytes + eventsBytes + inputBytes);
  let offset = 0;
  buffer.writeUInt32LE(FIXTURE_MAGIC, offset); offset += 4;
  buffer.writeUInt32LE(SAMPLE_COUNT, offset); offset += 4;
  buffer.writeUInt32LE(callbackFrames, offset); offset += 4;
  buffer.writeUInt32LE(2400, offset); offset += 4;
  buffer.writeDoubleLE(12, offset); offset += Float64Array.BYTES_PER_ELEMENT;
  buffer.writeDoubleLE(LIMITER_CEILING, offset); offset += Float64Array.BYTES_PER_ELEMENT;
  for (const band of bandBasis) {
    for (const coefficient of band) {
      buffer.writeDoubleLE(coefficient, offset);
      offset += Float64Array.BYTES_PER_ELEMENT;
    }
  }
  for (const ear of ["left", "right"]) {
    for (const anchors of bandTargets[ear]) {
      for (const gain of anchors) {
        buffer.writeDoubleLE(gain, offset);
        offset += Float64Array.BYTES_PER_ELEMENT;
      }
    }
  }
  buffer.writeUInt32LE(events.length, offset); offset += 4;
  for (const event of events) {
    buffer.writeUInt32LE(event.sampleIndex, offset); offset += 4;
    for (const ear of ["left", "right"]) {
      for (const level of event.levels[ear]) {
        buffer.writeDoubleLE(level, offset);
        offset += Float64Array.BYTES_PER_ELEMENT;
      }
    }
  }
  for (const sample of input) {
    buffer.writeFloatLE(sample, offset);
    offset += Float32Array.BYTES_PER_ELEMENT;
  }
  assert.equal(offset, buffer.length);
  return buffer;
}

const reference = renderReference(128);
const alternateReference = renderReference(480);
assert.deepEqual(alternateReference.output, reference.output,
  "JavaScript oracle must be callback-partition independent");
assert.equal(reference.diagnostics.left.limitedSamples > 0, true,
  "left synthetic overload pulse must exercise the limiter");
assert.equal(reference.diagnostics.right.limitedSamples > 0, true,
  "right synthetic overload pulse must exercise the limiter");

let firstNativeOutput = null;
const rows = [];
for (const blockFrames of BLOCK_SIZES) {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "hearlens-native-dynamic-"));
  try {
    const fixturePath = join(temporaryDirectory, `fixture-${blockFrames}.bin`);
    writeFileSync(fixturePath, makeFixture(blockFrames));
    const result = spawnSync("./dynamic-check", [fixturePath], {
      cwd: NATIVE_DIRECTORY,
      maxBuffer: OUTPUT_SAMPLES_BYTES + OUTPUT_STATS_BYTES + 1024,
    });
    if (result.signal !== null || result.status !== 0) {
      throw new Error(`native dynamic FIR failed: status=${result.status}, signal=${result.signal}, error=${result.error?.message ?? "none"}, stderr=${result.stderr?.toString("utf8")}`);
    }
    const expectedBytes = OUTPUT_SAMPLES_BYTES + OUTPUT_STATS_BYTES;
    assert.equal(result.stdout.length, expectedBytes,
      `expected ${expectedBytes} native output bytes, received ${result.stdout.length}`);

  let maxAbsoluteError = 0;
  let squaredError = 0;
  let mismatches = 0;
  const outputBytes = result.stdout.subarray(0, OUTPUT_SAMPLES_BYTES);
  for (let index = 0; index < input.length; index++) {
    const actual = outputBytes.readFloatLE(index * Float32Array.BYTES_PER_ELEMENT);
    const expected = reference.output[index];
    const error = Math.abs(actual - expected);
    maxAbsoluteError = Math.max(maxAbsoluteError, error);
    squaredError += error * error;
    if (error > MAX_ABSOLUTE_ERROR) mismatches++;
    assert(Number.isFinite(actual), `nonfinite Native sample ${index}`);
    assert(Math.abs(actual) <= LIMITER_CEILING,
      `Native sample ${index} bypassed the digital ceiling: ${actual}`);
  }
  const rmsError = Math.sqrt(squaredError / input.length);
  assert.equal(mismatches, 0,
    `${blockFrames}-frame Native output exceeded ${MAX_ABSOLUTE_ERROR} absolute error`);
  assert(rmsError <= MAX_RMS_ERROR,
    `${blockFrames}-frame Native RMS error ${rmsError} exceeded ${MAX_RMS_ERROR}`);

  if (firstNativeOutput === null) firstNativeOutput = Buffer.from(outputBytes);
  else assert.deepEqual(outputBytes, firstNativeOutput,
    `${blockFrames}-frame Native output depends on callback partitioning`);

  const statsOffset = OUTPUT_SAMPLES_BYTES;
  const nativeStats = Array.from({ length: 6 }, (_, index) =>
    result.stdout.readBigUInt64LE(statsOffset + index * BigInt64Array.BYTES_PER_ELEMENT));
  assert.equal(nativeStats[0], BigInt(SAMPLE_COUNT), "left accepted sample count");
  assert.equal(nativeStats[1], BigInt(SAMPLE_COUNT), "right accepted sample count");
  assert(nativeStats[2] > 0n && nativeStats[3] > 0n, "both Native ears must exercise the limiter");
  assert.equal(nativeStats[4], BigInt(events.length), "left target update count");
  assert.equal(nativeStats[5], BigInt(events.length), "right target update count");
    rows.push({
      blockFrames,
      samplesPerEar: SAMPLE_COUNT,
      maxAbsoluteError,
      rmsError,
      outputMismatchesOverTolerance: mismatches,
      launchWarning: result.error?.message ?? null,
      nativeLimitedSamples: [nativeStats[2].toString(), nativeStats[3].toString()],
      jsLimitedSamples: [reference.diagnostics.left.limitedSamples,
        reference.diagnostics.right.limitedSamples],
    });
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

console.log(JSON.stringify({
  result: "PASS",
  reference: "packages/dsp/offline-dynamic-fir.mjs",
  callbackPartitionIndependent: true,
  restartRetargetEvents: events.length,
  transitionSamples: 2400,
  transitionPolicy: "restart with raised-cosine coefficient interpolation",
  maxAbsoluteErrorThreshold: MAX_ABSOLUTE_ERROR,
  rmsErrorThreshold: MAX_RMS_ERROR,
  rows,
  safety: "synthetic PCM only; no audio device or playback",
}));
