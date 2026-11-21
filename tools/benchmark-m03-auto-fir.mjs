/**
 * Node 22+, synthetic PCM only. Optional argument: absolute or relative path
 * to an unmodified Git worktree for direct-convolution A/B.
 */
import assert from "node:assert/strict";
import { cpus } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { core, makeDetector, makeFir, pcm, targets } from "../packages/dsp/offline-auto-fir.testkit.mjs";
import { createOfflineStatefulWDRC, STREAM_LOOKAHEAD_SAMPLES } from "../packages/dsp/offline-wdrc.stateful.mjs";

assert(Number(process.versions.node.split(".")[0]) >= 22 && global.gc,
  "Run with Node 22+ and --expose-gc");

const rate = 48000;
const interval = 480;
const ears = ["left", "right"];
const warmSamples = 199680; // 4.16 s, divisible by all callback sizes
const timedSamples = 32 * rate;
const sizes = [128, 480, 1024];
const memoryKeys = ["heapUsed", "arrayBuffers"];
const baseline = process.argv[2] && (await import(pathToFileURL(
  resolve(process.argv[2], "packages/dsp/offline-dynamic-fir.mjs")).href))
  .createOfflineDynamicFirResearch;

function stft(ear) {
  return createOfflineStatefulWDRC({
    sampleRate: rate, ear, targets, crossoverMode: "smooth",
    syntheticRmsDbFSAt65DbSPL: -37, maxGainDb: 12, limiterCeiling: 0.3,
    attackMs: 15, releaseMs: 400,
  });
}

// Isolated components follow Auto-FIR's segment boundaries and update clock.
// FIR-only replays the actual detector readings computed outside timing.
function component(ear, mode, replay, factory) {
  const fir = mode === "fir" ? makeFir(ear, factory) : null;
  const detector = mode === "detector" ? makeDetector() : null;
  const scratch = new Float64Array(6);
  const levels = Array(6).fill(50);
  let remaining = interval, update = 0;
  fir?.setSyntheticBandLevels(levels);
  return {
    processInto(input, output) {
      for (let pos = 0; pos < input.length;) {
        const count = Math.min(remaining, input.length - pos);
        const segment = input.subarray(pos, pos + count);
        detector?.process(segment);
        fir?.processInto(segment, output.subarray(pos, pos + count));
        pos += count;
        remaining -= count;
        if (remaining === 0) {
          if (detector) detector.readNominalLevelsInto(scratch);
          if (fir) {
            for (let band = 0; band < 6; band++) levels[band] = replay[6 * update + band];
            fir.setSyntheticBandLevels(levels);
          }
          update++;
          remaining = interval;
        }
      }
    },
  };
}

const inputs = ears.map((_, ear) => Float32Array.from({ length: warmSamples + timedSamples },
  (_, i) => pcm[(i + ear * 137) % pcm.length]));
const replays = inputs.map(input => {
  const detector = makeDetector();
  const scratch = new Float64Array(6);
  const levels = new Float64Array(6 * input.length / interval);
  for (let pos = 0; pos < input.length; pos += interval) {
    detector.process(input.subarray(pos, pos + interval));
    levels.set(detector.readNominalLevelsInto(scratch), 6 * pos / interval);
  }
  return levels;
});

function memory() {
  const usage = process.memoryUsage();
  return Object.fromEntries(memoryKeys.map(key => [key, usage[key]]));
}

function benchmark(size, mode, factory) {
  const views = inputs.map(input => Array.from({ length: input.length / size }, (_, i) =>
    input.subarray(i * size, (i + 1) * size)));
  const outputs = ears.map(() => new Float32Array(size + 256));
  const times = new Float64Array(timedSamples / size);
  global.gc();
  const beforeCreate = memory();
  const processors = ears.map((ear, i) => {
    if (mode === "stft") return stft(ear);
    if (mode === "auto") return core(ear, factory);
    return component(ear, mode, replays[i], factory);
  });
  function processCallback(i) {
    for (let ear = 0; ear < ears.length; ear++) {
      processors[ear].processInto(views[ear][i], outputs[ear]);
    }
  }
  const warmCallbacks = warmSamples / size;
  for (let i = 0; i < warmCallbacks; i++) processCallback(i);
  global.gc();
  const startMemory = memory();
  const sampledPeak = { ...startMemory };
  const beforeCpu = process.cpuUsage();
  let total = 0, misses = 0;
  const deadlineMs = size * 1000 / rate;
  for (let i = 0; i < times.length; i++) {
    const start = performance.now();
    processCallback(warmCallbacks + i);
    const elapsed = performance.now() - start;
    times[i] = elapsed;
    total += elapsed;
    if (elapsed > deadlineMs) misses++;
    if (i % 64 === 0 || i === times.length - 1) {
      const sample = memory();
      for (const key of memoryKeys) sampledPeak[key] = Math.max(sampledPeak[key], sample[key]);
    }
  }
  const cpu = process.cpuUsage(beforeCpu);
  const endMemory = memory();
  global.gc();
  const afterGc = memory();
  times.sort();
  const percentile = p => times[Math.ceil(times.length * p) - 1];
  return {
    size, mode, callbacks: times.length, deadlineMs, meanMs: total / times.length,
    p95Ms: percentile(0.95), p99Ms: percentile(0.99), maxMs: times.at(-1),
    rtf: total / (timedSamples * 1000 / rate), misses, cpuMs: (cpu.user + cpu.system) / 1000,
    memoryBytes: { beforeCreate, startMemory, sampledPeak, endMemory, afterGc },
  };
}

function render(processor, input, size) {
  const temp = new Float32Array(size + 256);
  const output = new Float32Array(input.length);
  let written = 0;
  for (let i = 0; i < input.length; i += size) {
    const count = processor.processInto(input.subarray(i, i + size), temp);
    output.set(temp.subarray(0, count), written);
    written += count;
  }
  return output.subarray(0, written);
}

const tone = Float32Array.from({ length: 3 * rate }, (_, i) =>
  (i >= rate && i < 2 * rate ? 0.08 : 0.006) * Math.sin(2 * Math.PI * 1000 * i / rate));
const windowsMs = [900, 1000, 1010, 1030, 1050, 1100, 1900, 2000, 2050, 2100, 2250, 2500, 2900];
function gainAt(output, startMs, delay) {
  const start = startMs * rate / 1000;
  let inputPower = 0, outputPower = 0;
  for (let i = start; i < start + interval; i++) {
    inputPower += tone[i] ** 2;
    outputPower += output[i + delay] ** 2;
  }
  return 10 * Math.log10(outputPower / inputPower);
}

const dynamics = ears.map(ear => {
  const auto = render(core(ear), tone, 480);
  const reference = render(stft(ear), tone, 480);
  return {
    ear,
    gainDb: windowsMs.map(startMs => ({
      startMs, auto: gainAt(auto, startMs, 256), stft: gainAt(reference, startMs, 0),
    })),
  };
});

const equivalence = baseline ? ears.flatMap(ear => [pcm, tone].map(input => {
  const reference = render(core(ear, baseline), input, 480);
  const actual = render(core(ear), input, 480);
  for (const size of sizes) assert.deepEqual(render(core(ear), input, size), actual);
  let maxAbs = 0, squares = 0;
  for (let i = 0; i < actual.length; i++) {
    const error = actual[i] - reference[i];
    maxAbs = Math.max(maxAbs, Math.abs(error));
    squares += error ** 2;
  }
  assert(maxAbs <= 3e-8, "Direct and symmetric output differ by more than one Float32 ULP at ceiling");
  return { ear, samples: input.length, maxAbs, rms: Math.sqrt(squares / actual.length) };
})) : null;

const measurements = [];
for (const size of sizes) {
  for (const mode of ["detector", "fir", "auto", "stft"]) {
    measurements.push(benchmark(size, mode));
    if (baseline && (mode === "fir" || mode === "auto")) {
      measurements.push({ ...benchmark(size, mode, baseline), mode: mode + "-direct" });
    }
  }
}

console.log(JSON.stringify({
  node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
  rate, warmSamples, timedSamples, channels: ears.length, measurements, equivalence,
  latencySamples: { autoInputLookahead: 0, autoFrozenGainGroupDelay: 256,
    stftHopRelativeLookahead: STREAM_LOOKAHEAD_SAMPLES,
    stftFirstOutputAvailability: STREAM_LOOKAHEAD_SAMPLES + 256 },
  dynamics,
}, null, 2));
