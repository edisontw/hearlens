import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createOfflineAutoFirResearch } from "../../packages/dsp/offline-auto-fir.mjs";
import { createOfflineDynamicFirResearch } from "../../packages/dsp/offline-dynamic-fir.mjs";
import { createOfflineSixBandLevelResearch } from "../../packages/dsp/offline-six-band-level.mjs";
import { offlineFFT } from "../../packages/dsp/offline-wdrc.mjs";
import { targets } from "../../packages/dsp/offline-auto-fir.testkit.mjs";

const RATE = 48_000;
const TAPS = 513;
const UNIQUE_TAPS = 257;
const FFT_SIZE = 4096;
const BAND_CENTERS = [250, 500, 1000, 2000, 4000, 8000];
const CONTROL_INTERVAL = 480;
const ATTACK_MS = 15;
const RELEASE_MS = 400;
const MAX_GAIN_DB = 12;
const LIMITER_CEILING = 0.3;
const TRANSITION_SAMPLES = 2400;
const MAX_ABSOLUTE_ERROR = 1e-7;
const MAX_RMS_ERROR = 2e-8;
const MAX_LEVEL_ERROR = 1e-8;
const SAMPLE_COUNT = 3 * RATE;
const BLOCK_SIZES = [64, 128, 192, 256, 480, 73, 511, 2048, 4096];
const FIXTURE_MAGIC = 0x334e4c48;
const OUTPUT_MAGIC = 0x334f4c48;
const NATIVE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const boundaries = BAND_CENTERS.slice(1).map((frequency, index) =>
  Math.sqrt(frequency * BAND_CENTERS[index]));

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
const bandTargets = ["left", "right"].map(ear =>
  targets.ears[ear].bands.map(band => [
    band.gainDbByInputLevel[50],
    band.gainDbByInputLevel[65],
    band.gainDbByInputLevel[80],
  ]));

function makeSyntheticPcm(sampleCount = SAMPLE_COUNT) {
  const pcm = new Float32Array(sampleCount * 2);
  const sine = (hz, n) => Math.sin(2 * Math.PI * hz * n / RATE);
  for (let n = 0; n < sampleCount; n++) {
    const seconds = n / RATE;
    let left = 0, right = 0;
    if (seconds >= 0.25 && seconds < 0.60) {
      left = 0.12 * sine(250, n);
      right = 0.10 * sine(8000, n);
    } else if (seconds >= 0.60 && seconds < 0.95) {
      left = 0.12 * sine(500, n) + 0.07 * sine(2000, n);
      right = 0.10 * sine(1000, n) + 0.06 * sine(4000, n);
    } else if (seconds >= 0.95 && seconds < 1.45) {
      const amplitude = seconds < 1.15 ? 0.012 : 0.62;
      left = amplitude * sine(1000, n);
      right = amplitude * 0.82 * sine(2000, n);
    } else if (seconds >= 1.45 && seconds < 1.75) {
      const pulsePhase = (n % Math.round(0.05 * RATE)) / RATE;
      if (pulsePhase < 0.005) {
        left = 0.82 * sine(4000, n);
        right = 0.76 * sine(250, n);
      }
    } else if (seconds >= 1.75 && seconds < 2.0) {
      left = 0.96 * sine(1000, n);
      right = 0.92 * sine(2000, n);
    }
    pcm[2 * n] = left;
    pcm[2 * n + 1] = right;
  }
  return pcm;
}

const sourcePcm = makeSyntheticPcm();

function captureDynamicFir(sampleIndices, capturedLevels) {
  return config => {
    const processor = createOfflineDynamicFirResearch(config);
    return {
      processInto: processor.processInto,
      reset: processor.reset,
      setSyntheticBandLevels(levels) {
        sampleIndices.push(processor.diagnostics.acceptedSamples);
        capturedLevels.push(Array.from(levels));
        return processor.setSyntheticBandLevels(levels);
      },
      get diagnostics() { return processor.diagnostics; },
    };
  };
}

function makeReference(callbackFrames, sampleCount = SAMPLE_COUNT, pcm = sourcePcm) {
  const input = pcm.subarray(0, 2 * sampleCount);
  const output = new Float32Array(input.length);
  const ears = [];
  for (const earIndex of [0, 1]) {
    const earInput = new Float32Array(sampleCount);
    const earOutput = new Float32Array(sampleCount);
    for (let sample = 0; sample < sampleCount; sample++) {
      earInput[sample] = input[2 * sample + earIndex];
    }
    const capturedLevels = [];
    const capturedSampleIndices = [];
    const fir = captureDynamicFir(capturedSampleIndices, capturedLevels)({
      usage: "offline-synthetic-test-only",
      targets,
      ear: earIndex === 0 ? "left" : "right",
      sampleRate: RATE,
      maxGainDb: MAX_GAIN_DB,
      limiterCeiling: LIMITER_CEILING,
      transitionMs: 50,
    });
    const processor = createOfflineAutoFirResearch({
      usage: "offline-synthetic-test-only",
      fir,
      detector: createOfflineSixBandLevelResearch({
        usage: "offline-synthetic-test-only",
        sampleRate: RATE,
        attackMs: ATTACK_MS,
        releaseMs: RELEASE_MS,
      }),
      controlIntervalSamples: CONTROL_INTERVAL,
    });
    for (let position = 0; position < sampleCount; position += callbackFrames) {
      const frames = Math.min(callbackFrames, sampleCount - position);
      processor.processInto(earInput.subarray(position, position + frames),
        earOutput.subarray(position, position + frames));
    }
    for (let sample = 0; sample < sampleCount; sample++) {
      output[2 * sample + earIndex] = earOutput[sample];
    }
    ears.push({ processor, capturedLevels, capturedSampleIndices });
  }
  return { input, output, ears };
}

function makeFixture(callbackFrames, options = {}) {
  const sampleCount = options.sampleCount ?? SAMPLE_COUNT;
  const pcm = options.pcm ?? sourcePcm;
  const controlInterval = options.controlInterval ?? CONTROL_INTERVAL;
  const attackMs = options.attackMs ?? ATTACK_MS;
  const releaseMs = options.releaseMs ?? RELEASE_MS;
  const logCapacity = Math.floor(sampleCount / controlInterval) + 2;
  const headerBytes = 5 * 4 + 4 * Float64Array.BYTES_PER_ELEMENT + 4;
  const basisBytes = 6 * UNIQUE_TAPS * Float64Array.BYTES_PER_ELEMENT;
  const targetBytes = 2 * 6 * 3 * Float64Array.BYTES_PER_ELEMENT;
  const inputBytes = 2 * sampleCount * Float32Array.BYTES_PER_ELEMENT;
  const buffer = Buffer.alloc(headerBytes + basisBytes + targetBytes + inputBytes);
  let offset = 0;
  buffer.writeUInt32LE(FIXTURE_MAGIC, offset); offset += 4;
  buffer.writeUInt32LE(sampleCount, offset); offset += 4;
  buffer.writeUInt32LE(callbackFrames, offset); offset += 4;
  buffer.writeUInt32LE(controlInterval, offset); offset += 4;
  buffer.writeUInt32LE(logCapacity, offset); offset += 4;
  buffer.writeDoubleLE(attackMs, offset); offset += 8;
  buffer.writeDoubleLE(releaseMs, offset); offset += 8;
  buffer.writeDoubleLE(MAX_GAIN_DB, offset); offset += 8;
  buffer.writeDoubleLE(LIMITER_CEILING, offset); offset += 8;
  buffer.writeUInt32LE(TRANSITION_SAMPLES, offset); offset += 4;
  for (const band of bandBasis) {
    for (const coefficient of band) {
      buffer.writeDoubleLE(coefficient, offset); offset += 8;
    }
  }
  for (const ear of bandTargets) {
    for (const anchors of ear) {
      for (const gain of anchors) {
        buffer.writeDoubleLE(gain, offset); offset += 8;
      }
    }
  }
  for (let sample = 0; sample < 2 * sampleCount; sample++) {
    buffer.writeFloatLE(pcm[sample], offset); offset += 4;
  }
  assert.equal(offset, buffer.length);
  return buffer;
}

function runNative(fixtureBuffer, label) {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "hearlens-native-auto-"));
  try {
    const fixturePath = join(temporaryDirectory, label + ".bin");
    writeFileSync(fixturePath, fixtureBuffer);
    const binary = process.env.NATIVE_AUTO_BINARY ?? "./auto-check";
    const result = spawnSync(binary, [fixturePath], {
      cwd: NATIVE_DIRECTORY,
      maxBuffer: fixtureBuffer.length * 4 + 4096,
    });
    if (result.signal !== null || result.status !== 0) {
      throw new Error("Native Auto-FIR failed: status=" + result.status +
        ", signal=" + result.signal + ", error=" +
        (result.error?.message ?? "none") + ", stderr=" +
        result.stderr?.toString("utf8"));
    }
    const bytes = result.stdout;
    assert(bytes.length >= 12, "Native Auto-FIR output header");
    assert.equal(bytes.readUInt32LE(0), OUTPUT_MAGIC, "Native output magic");
    const sampleCount = bytes.readUInt32LE(4);
    const logCount = bytes.readUInt32LE(8);
    const statsBytes = 2 * (11 * 8 + 8);
    const expectedBytes = 12 + sampleCount * 2 * 4 + statsBytes + 8 +
      logCount * 2 * (8 + 6 * 8);
    assert.equal(bytes.length, expectedBytes,
      "expected " + expectedBytes + " output bytes, received " + bytes.length);
    let offset = 12;
    const output = new Float32Array(sampleCount * 2);
    for (let index = 0; index < output.length; index++) {
      output[index] = bytes.readFloatLE(offset); offset += 4;
    }
    const stats = [];
    for (let ear = 0; ear < 2; ear++) {
      const values = Array.from({ length: 11 }, () => {
        const value = bytes.readBigUInt64LE(offset); offset += 8;
        return Number(value);
      });
      const maxAbsOutput = bytes.readDoubleLE(offset); offset += 8;
      stats.push({ values, maxAbsOutput });
    }
    const callbackAllocations = Number(bytes.readBigUInt64LE(offset)); offset += 8;
    const logs = [];
    for (let ear = 0; ear < 2; ear++) {
      const entries = [];
      for (let event = 0; event < logCount; event++) {
        const sampleIndex = Number(bytes.readBigUInt64LE(offset)); offset += 8;
        const levels = [];
        for (let band = 0; band < 6; band++) {
          levels.push(bytes.readDoubleLE(offset)); offset += 8;
        }
        entries.push({ sampleIndex, levels });
      }
      logs.push(entries);
    }
    assert.equal(offset, bytes.length);
    return { output, sampleCount, logCount, stats, logs, callbackAllocations,
      launchWarning: result.error?.message ?? null };
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function compare(reference, native, controlInterval = CONTROL_INTERVAL) {
  assert.equal(native.sampleCount, reference.output.length / 2);
  let maxAbsoluteError = 0, sumSquaredError = 0, mismatches = 0;
  for (let index = 0; index < reference.output.length; index++) {
    const actual = native.output[index];
    const expected = reference.output[index];
    assert(Number.isFinite(actual), "nonfinite Native PCM at " + index);
    assert(Math.abs(actual) <= LIMITER_CEILING,
      "Native digital ceiling exceeded at " + index);
    const error = Math.abs(actual - expected);
    maxAbsoluteError = Math.max(maxAbsoluteError, error);
    sumSquaredError += error * error;
    if (error > MAX_ABSOLUTE_ERROR) mismatches++;
  }
  const rmsError = Math.sqrt(sumSquaredError / reference.output.length);
  assert.equal(mismatches, 0, "PCM mismatch count " + mismatches);
  assert(rmsError <= MAX_RMS_ERROR, "PCM RMS error " + rmsError);

  const sampleCount = reference.output.length / 2;
  const expectedUpdates = Math.floor(sampleCount / controlInterval);
  assert.equal(native.logCount, expectedUpdates);
  assert.equal(native.callbackAllocations, 0,
    "callback allocation monitor must see no intercepted C++ allocation");
  const diagnostics = [];
  let maxLevelError = 0, sumSquaredLevelError = 0, levelCount = 0;
  for (let ear = 0; ear < 2; ear++) {
    const js = reference.ears[ear];
    const expectedControlIndices = js.capturedSampleIndices.slice(1);
    const expectedControlLevels = js.capturedLevels.slice(1);
    assert.equal(expectedControlIndices.length, expectedUpdates);
    assert.equal(native.logs[ear].length, expectedUpdates);
    for (let event = 0; event < expectedUpdates; event++) {
      assert.equal(native.logs[ear][event].sampleIndex, expectedControlIndices[event],
        "ear " + ear + " control sample index " + event);
      for (let band = 0; band < 6; band++) {
        const error = Math.abs(native.logs[ear][event].levels[band] -
          expectedControlLevels[event][band]);
        maxLevelError = Math.max(maxLevelError, error);
        sumSquaredLevelError += error * error;
        levelCount++;
      }
    }
    const jsDiag = js.processor.diagnostics;
    const v = native.stats[ear].values;
    assert.equal(v[0], sampleCount, "ear " + ear + " accepted samples");
    assert.equal(v[1], sampleCount % controlInterval, "ear " + ear + " sinceUpdate");
    assert.equal(v[2], expectedUpdates, "ear " + ear + " updates");
    assert.equal(v[3], 1, "ear " + ear + " initialized");
    assert.equal(v[4], 0, "ear " + ear + " not faulted");
    assert.equal(v[5], sampleCount, "ear " + ear + " detector accepted");
    assert.equal(v[6], 0, "ear " + ear + " detector not faulted");
    assert.equal(v[7], sampleCount, "ear " + ear + " FIR accepted");
    assert.equal(v[8], expectedUpdates + 1, "ear " + ear + " FIR update count");
    assert.equal(v[9], jsDiag.fir.limitedSamples, "ear " + ear + " limiter count");
    assert.equal(v[10], jsDiag.fir.transitionRemainingSamples,
      "ear " + ear + " transition remaining");
    assert.equal(native.stats[ear].maxAbsOutput, jsDiag.fir.maxAbsOutput,
      "ear " + ear + " max output");
    diagnostics.push({
      acceptedSamples: v[0], sinceUpdate: v[1], updates: v[2],
      initialized: Boolean(v[3]), faulted: Boolean(v[4]),
      detectorAcceptedSamples: v[5], detectorFaulted: Boolean(v[6]),
      firAcceptedSamples: v[7], firUpdates: v[8], limitedSamples: v[9],
      transitionRemainingSamples: v[10],
    });
  }
  const rmsLevelError = levelCount === 0
    ? 0 : Math.sqrt(sumSquaredLevelError / levelCount);
  assert(maxLevelError <= MAX_LEVEL_ERROR,
    "nominal level max error " + maxLevelError + " exceeded " + MAX_LEVEL_ERROR);
  assert(rmsLevelError <= MAX_LEVEL_ERROR,
    "nominal level RMS error " + rmsLevelError + " exceeded " + MAX_LEVEL_ERROR);
  return { maxAbsoluteError, rmsError, pcmMismatches: mismatches,
    maxLevelError, rmsLevelError, diagnostics };
}

const baselineReference = makeReference(480);
const portableExport = process.argv.find(argument =>
  argument.startsWith("--export-portable="));
if (portableExport) {
  const outputDirectory = portableExport.slice("--export-portable=".length);
  mkdirSync(outputDirectory, { recursive: true });
  const reference = makeReference(128);
  const fixture = makeFixture(128);
  const sampleCount = reference.output.length / 2;
  const logCount = Math.floor(sampleCount / CONTROL_INTERVAL);
  const expectedBytes = Buffer.alloc(12 + reference.output.length * 4 +
    2 * (11 * 8 + 8) + 8 + logCount * 2 * (8 + 6 * 8));
  let offset = 0;
  expectedBytes.writeUInt32LE(OUTPUT_MAGIC, offset); offset += 4;
  expectedBytes.writeUInt32LE(sampleCount, offset); offset += 4;
  expectedBytes.writeUInt32LE(logCount, offset); offset += 4;
  for (const sample of reference.output) {
    expectedBytes.writeFloatLE(sample, offset); offset += 4;
  }
  for (let ear = 0; ear < 2; ear++) {
    const diagnostics = reference.ears[ear].processor.diagnostics;
    const detector = diagnostics.detector;
    const fir = diagnostics.fir;
    const values = [diagnostics.acceptedSamples, diagnostics.sinceUpdate,
      diagnostics.updates, diagnostics.initialized ? 1 : 0,
      diagnostics.faulted ? 1 : 0, detector.acceptedSamples,
      detector.faulted ? 1 : 0, fir.acceptedSamples, fir.updates,
      fir.limitedSamples, fir.transitionRemainingSamples];
    for (const value of values) {
      expectedBytes.writeBigUInt64LE(BigInt(value), offset); offset += 8;
    }
    expectedBytes.writeDoubleLE(fir.maxAbsOutput, offset); offset += 8;
  }
  expectedBytes.writeBigUInt64LE(0n, offset); offset += 8;
  for (let ear = 0; ear < 2; ear++) {
    const indices = reference.ears[ear].capturedSampleIndices.slice(1);
    const levels = reference.ears[ear].capturedLevels.slice(1);
    for (let event = 0; event < logCount; event++) {
      expectedBytes.writeBigUInt64LE(BigInt(indices[event]), offset); offset += 8;
      for (const level of levels[event]) {
        expectedBytes.writeDoubleLE(level, offset); offset += 8;
      }
    }
  }
  assert.equal(offset, expectedBytes.length);
  const fixturePath = join(outputDirectory, "auto-fir-fixture.bin");
  const oraclePath = join(outputDirectory, "auto-fir-js-oracle.bin");
  writeFileSync(fixturePath, fixture);
  writeFileSync(oraclePath, expectedBytes);
  const hashFile = path => createHash("sha256").update(readFileSync(path)).digest("hex");
  const manifest = {
    format: "HearLens Native Auto-FIR v3 little-endian fixture/result",
    generatedBy: "live JS offline-six-band-level + offline-auto-fir + offline-dynamic-fir references",
    sampleRate: RATE,
    limiterCeiling: LIMITER_CEILING,
    callbackFrames: 128,
    samplesPerEar: sampleCount,
    controlIntervalSamples: CONTROL_INTERVAL,
    controlUpdatesPerEar: logCount,
    expectedControlIndices: "480, 960, ... 144000",
    limiterCountsLR: reference.ears.map(ear => ear.processor.diagnostics.fir.limitedSamples),
    pcmMaxErrorThreshold: MAX_ABSOLUTE_ERROR,
    pcmRmsErrorThreshold: MAX_RMS_ERROR,
    nominalLevelMaxErrorThreshold: MAX_LEVEL_ERROR,
    audioRoute: "none",
    hearingOutputAuthorized: false,
    sha256: {
      fixture: hashFile(fixturePath),
      jsOracleResult: hashFile(oraclePath),
    },
  };
  const manifestPath = join(outputDirectory, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(JSON.stringify({ result: "PASS", fixture: fixturePath,
    oracle: oraclePath, manifest: manifestPath, samplesPerEar: sampleCount,
    updatesPerEar: logCount }));
  process.exit(0);
}
const rows = [];
let firstNative = null;
for (const blockFrames of BLOCK_SIZES) {
  const reference = blockFrames === 480 ? baselineReference : makeReference(blockFrames);
  assert.deepEqual(reference.output, baselineReference.output,
    "JS Auto-FIR oracle depends on " + blockFrames + "-frame partition");
  const native = runNative(makeFixture(blockFrames), "block-" + blockFrames);
  const comparison = compare(reference, native);
  if (firstNative === null) firstNative = native.output;
  else assert.deepEqual(native.output, firstNative,
    "Native Auto-FIR depends on " + blockFrames + "-frame partition");
  rows.push({ blockFrames, sampleCount: native.sampleCount,
    logCount: native.logCount, ...comparison,
    limiterCountsLR: native.stats.map(stat => stat.values[9]),
    callbackAllocations: native.callbackAllocations,
    launchWarning: native.launchWarning });
}

// Probe one sample before, at, and after each 480-sample control boundary.
function makeBoundaryPcm(sampleCount) {
  const pcm = new Float32Array(sampleCount * 2);
  for (let sample = 0; sample < sampleCount; sample++) {
    pcm[2 * sample] = 0.18 * Math.sin(2 * Math.PI * 1000 * sample / RATE);
    pcm[2 * sample + 1] = 0.11 * Math.sin(2 * Math.PI * 2000 * sample / RATE);
  }
  return pcm;
}

const boundaryCases = [];
for (const sampleCount of [479, 480, 481, 959, 960, 961]) {
  const pcm = makeBoundaryPcm(sampleCount);
  const reference = makeReference(73, sampleCount, pcm);
  const native = runNative(makeFixture(73, { sampleCount, pcm }),
    "boundary-" + sampleCount);
  const comparison = compare(reference, native);
  assert.deepEqual(native.output, reference.output,
    "sample-adjacent boundary output differs at " + sampleCount);
  boundaryCases.push({ sampleCount,
    expectedUpdates: Math.floor(sampleCount / CONTROL_INTERVAL),
    expectedSinceUpdate: sampleCount % CONTROL_INTERVAL,
    actualUpdatesPerEar: native.stats.map(stat => stat.values[2]),
    actualSinceUpdatePerEar: native.stats.map(stat => stat.values[1]),
    maxAbsoluteError: comparison.maxAbsoluteError,
    callbackAllocations: native.callbackAllocations });
}

// Negative control: move the native control boundary by one sample. The JS
// oracle and declared interval remain at 480 and must reject the mutation.
const negative = runNative(
  makeFixture(128, { sampleCount: 10_000, controlInterval: 481 }),
  "negative-control-interval-481");
const expectedFirstUpdate = CONTROL_INTERVAL;
const actualFirstUpdate = negative.logs[0][0]?.sampleIndex;
assert.equal(actualFirstUpdate, 481);
assert.notEqual(actualFirstUpdate, expectedFirstUpdate,
  "negative control must fail the JS control-boundary oracle");
const negativeReference = makeReference(128, 10_000);
assert.throws(() => compare(negativeReference, negative),
  /Native update count|control sample index/,
  "the full parity comparison must reject the shifted-boundary mutation");

console.log(JSON.stringify({
  result: "PASS",
  reference: [
    "createOfflineSixBandLevelResearch",
    "createOfflineDynamicFirResearch",
    "createOfflineAutoFirResearch",
  ],
  sampleRate: RATE,
  samplesPerEar: SAMPLE_COUNT,
  attackMs: ATTACK_MS,
  releaseMs: RELEASE_MS,
  powerAverageMs: 12,
  controlIntervalSamples: CONTROL_INTERVAL,
  transitionSamples: TRANSITION_SAMPLES,
  nominalLevelMaxErrorThreshold: MAX_LEVEL_ERROR,
  pcmMaxErrorThreshold: MAX_ABSOLUTE_ERROR,
  pcmRmsErrorThreshold: MAX_RMS_ERROR,
  callbackPartitionIndependent: true,
  stereoAtomicFailStopAndReset: true,
  allocationProbe: "global C++ new/new[] counters; callback allocations must be zero",
  negativeControl: {
    changedControlIntervalSamples: 481,
    expectedFirstUpdate,
    actualFirstUpdate,
    rejected: true,
  },
  sampleAdjacentBoundaries: boundaryCases,
  rows,
  safety: "synthetic PCM only; audioRoute=none; hearingOutputAuthorized=false",
}));
