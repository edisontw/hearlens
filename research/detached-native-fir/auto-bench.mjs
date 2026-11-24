import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, cpus, platform, release, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { targets } from "../../packages/dsp/offline-auto-fir.testkit.mjs";
import { offlineFFT } from "../../packages/dsp/offline-wdrc.mjs";

const RATE = 48_000;
const TAPS = 513;
const UNIQUE_TAPS = 257;
const FFT_SIZE = 4096;
const CENTERS = [250, 500, 1000, 2000, 4000, 8000];
const WARMUP_SAMPLES = 2 * RATE;
const MEASURED_SAMPLES = 32 * RATE;
const CONTROL_INTERVAL = 480;
const ATTACK_MS = 15;
const RELEASE_MS = 400;
const MAX_GAIN_DB = 12;
const LIMITER_CEILING = 0.3;
const TRANSITION_SAMPLES = 2400;
const MAGIC = 0x34424c48;
const NATIVE_DIRECTORY = dirname(fileURLToPath(import.meta.url));

const boundaries = CENTERS.slice(1).map((value, index) =>
  Math.sqrt(value * CENTERS[index]));

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
  const spectra = Array.from({ length: 6 }, () =>
    new Float64Array(FFT_SIZE / 2 + 1));
  for (let bin = 0; bin <= FFT_SIZE / 2; bin++) {
    const weights = frequencyWeights(bin * RATE / FFT_SIZE);
    for (let band = 0; band < 6; band++) spectra[band][bin] = weights[band];
  }
  for (let band = 0; band < 6; band++) {
    real.fill(0);
    imaginary.fill(0);
    for (let bin = 0; bin <= FFT_SIZE / 2; bin++) {
      real[bin] = spectra[band][bin];
      if (bin !== 0 && bin !== FFT_SIZE / 2) {
        real[FFT_SIZE - bin] = spectra[band][bin];
      }
    }
    offlineFFT(real, imaginary, true);
    for (let tap = 0; tap < UNIQUE_TAPS; tap++) {
      const window = 0.54 - 0.46 * Math.cos(2 * Math.PI * tap / (TAPS - 1));
      basis[band][tap] =
        real[(tap - (TAPS - 1) / 2 + FFT_SIZE) % FFT_SIZE] * window;
    }
  }
  return basis;
}

const basis = designBasis();
const bandTargets = ["left", "right"].map(ear =>
  targets.ears[ear].bands.map(band => [
    band.gainDbByInputLevel[50],
    band.gainDbByInputLevel[65],
    band.gainDbByInputLevel[80],
  ]));

function syntheticPcm(sampleCount) {
  const pcm = new Float32Array(sampleCount * 2);
  const sine = (hz, sample) => Math.sin(2 * Math.PI * hz * sample / RATE);
  for (let sample = 0; sample < sampleCount; sample++) {
    const t = sample / RATE;
    let left = 0, right = 0;
    if (t >= 4 && t < 8) {
      left = 0.08 * sine(250, sample);
      right = 0.07 * sine(8000, sample);
    } else if (t >= 8 && t < 12) {
      left = 0.11 * sine(500, sample) + 0.06 * sine(2000, sample);
      right = 0.10 * sine(1000, sample) + 0.05 * sine(4000, sample);
    } else if (t >= 12 && t < 16) {
      const amplitude = t < 14 ? 0.018 : 0.62;
      left = amplitude * sine(1000, sample);
      right = amplitude * 0.82 * sine(2000, sample);
    } else if (t >= 16 && t < 20) {
      if ((sample % Math.round(0.05 * RATE)) / RATE < 0.005) {
        left = 0.82 * sine(4000, sample);
        right = 0.76 * sine(250, sample);
      }
    } else if (t >= 20 && t < 24) {
      left = 0.72 * sine(1000, sample) + 0.10 * sine(250, sample);
      right = 0.65 * sine(4000, sample) + 0.08 * sine(500, sample);
    } else if (t >= 24) {
      const phaseSeconds = 24 + ((t - 24) % 8);
      const amplitude = 0.05 + 0.78 *
        (0.5 + 0.5 * Math.sin(2 * Math.PI * (phaseSeconds - 24) / 2));
      left = amplitude * 0.85 * sine(1000, sample);
      right = amplitude * 0.72 * sine(2000, sample);
    }
    pcm[sample * 2] = left;
    pcm[sample * 2 + 1] = right;
  }
  return pcm;
}

function makeFixture() {
  const totalSamples = WARMUP_SAMPLES + MEASURED_SAMPLES;
  const pcm = syntheticPcm(totalSamples);
  const headerBytes = 7 * 4 + 4 * Float64Array.BYTES_PER_ELEMENT;
  const basisBytes = 6 * UNIQUE_TAPS * Float64Array.BYTES_PER_ELEMENT;
  const targetBytes = 2 * 6 * 3 * Float64Array.BYTES_PER_ELEMENT;
  const pcmBytes = pcm.length * Float32Array.BYTES_PER_ELEMENT;
  const buffer = Buffer.alloc(headerBytes + basisBytes + targetBytes + pcmBytes);
  let offset = 0;
  for (const value of [MAGIC, totalSamples, WARMUP_SAMPLES, MEASURED_SAMPLES,
    CONTROL_INTERVAL, TRANSITION_SAMPLES, RATE]) {
    buffer.writeUInt32LE(value, offset); offset += 4;
  }
  for (const value of [ATTACK_MS, RELEASE_MS, MAX_GAIN_DB, LIMITER_CEILING]) {
    buffer.writeDoubleLE(value, offset); offset += 8;
  }
  for (const band of basis) {
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
  for (const sample of pcm) {
    buffer.writeFloatLE(sample, offset); offset += 4;
  }
  assert.equal(offset, buffer.length);
  return buffer;
}

const outputArgument = process.argv.find(arg => arg.startsWith("--output="));
const pacedSecondsArgument = process.argv.find(arg => arg.startsWith("--paced-seconds="));
const pacedBlockArgument = process.argv.find(arg => arg.startsWith("--paced-block="));
const pacedSeconds = pacedSecondsArgument
  ? Number(pacedSecondsArgument.slice("--paced-seconds=".length)) : 0;
const pacedBlock = pacedBlockArgument
  ? Number(pacedBlockArgument.slice("--paced-block=".length)) : 128;
assert.equal(Boolean(pacedSecondsArgument), Boolean(pacedBlockArgument),
  "paced mode requires both --paced-seconds and --paced-block");
if (pacedSecondsArgument) {
  assert(Number.isSafeInteger(pacedSeconds) && pacedSeconds > 0 && pacedSeconds <= 3_600);
  assert([64, 128, 192, 240, 256, 480].includes(pacedBlock));
}
const fixture = makeFixture();
const fixtureHash = createHash("sha256").update(fixture).digest("hex");
const temporaryDirectory = mkdtempSync(join(tmpdir(), "hearlens-autofir-bench-"));
try {
  const fixturePath = join(temporaryDirectory, "synthetic-auto-fir.bin");
  writeFileSync(fixturePath, fixture);
  const binary = process.env.NATIVE_AUTO_BENCH_BINARY ?? "./auto-bench";
  const nativeArguments = [fixturePath];
  if (pacedSecondsArgument) {
    nativeArguments.push("--paced-seconds=" + pacedSeconds,
      "--paced-block=" + pacedBlock);
  }
  const result = spawnSync(binary, nativeArguments, {
    cwd: NATIVE_DIRECTORY,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.status !== 0 || result.signal !== null) {
    throw new Error("Native benchmark failed: status=" + result.status +
      ", signal=" + result.signal + ", error=" +
      (result.error?.message ?? "none") + ", stderr=" +
      result.stderr?.toString("utf8"));
  }
  const native = JSON.parse(result.stdout.toString("utf8"));
  if (pacedSecondsArgument) {
    assert.equal(native.mode, "paced-complete-auto-fir");
    assert.equal(native.blockFrames, pacedBlock);
    assert.equal(native.requestedSeconds, pacedSeconds);
    assert.equal(native.allocationCount, 0);
    assert.equal(native.allocationProbePositiveControls, true);
    assert.equal(native.finiteOutput, true);
    assert(Number.isFinite(native.checksum));
  } else {
    assert.equal(native.sampleRate, RATE);
    assert.equal(native.warmupSamplesPerEar, WARMUP_SAMPLES);
    assert.equal(native.measuredSamplesPerEar, MEASURED_SAMPLES);
    assert.equal(native.allocationProbePositiveControls, true);
    assert.equal(native.rows.length, 15);
    for (const row of native.rows) {
      assert.equal(row.allocationCount, 0);
      assert.equal(row.finiteOutput, true);
      assert(Number.isFinite(row.checksum));
    }
  }
  const cpuLimit = (() => {
    try { return readFileSync("/sys/fs/cgroup/cpu.max", "utf8").trim(); }
    catch { return null; }
  })();
  const report = {
    result: "PASS",
    mode: pacedSecondsArgument
      ? "paced deadline callback; sleeping to absolute monotonic sample deadlines"
      : "unpaced-throughput; callbacks are processed back-to-back",
    capturedAt: new Date().toISOString(),
    host: {
      platform: platform(),
      release: release(),
      architecture: process.arch,
      cpuModel: cpus()[0]?.model ?? "unknown",
      logicalCpus: cpus().length,
      availableParallelism: availableParallelism(),
      cgroupCpuMax: cpuLimit,
    },
    node: process.version,
    compiler: native.compiler,
    compilerFlags: process.env.CXXFLAGS ??
      "-std=c++17 -O2 -fno-fast-math -ffp-contract=off -Wall -Wextra -Wpedantic -Werror",
    fixture: {
      sampleRate: RATE,
      warmupSecondsPerEar: WARMUP_SAMPLES / RATE,
      measuredSecondsPerEar: MEASURED_SAMPLES / RATE,
      controlIntervalSamples: CONTROL_INTERVAL,
      attackMs: ATTACK_MS,
      releaseMs: RELEASE_MS,
      transitionSamples: TRANSITION_SAMPLES,
      sha256: fixtureHash,
      scenarios: ["silence", "single tones", "multitone", "level step",
        "short pulse train", "sustained overload", "modulated tone"],
    },
    ...(pacedSecondsArgument ? {
      paced: { requestedSeconds: pacedSeconds, blockFrames: pacedBlock,
        sampleRate: RATE, syntheticInputLoops: true },
    } : {}),
    native,
    limitations: [
      "32 seconds equivalent PCM is throughput work, not a 32-second wall-clock heat test.",
      "Deadline misses are observational in an unpaced shared container and are not algorithm-only evidence.",
      "Digital limiter output is not an SPL or acoustic MPO measurement.",
    ],
  };
  const json = JSON.stringify(report, null, 2) + "\n";
  if (outputArgument) {
    writeFileSync(outputArgument.slice("--output=".length), json);
    console.log(JSON.stringify({ result: "PASS", output: outputArgument.slice(9),
      rows: native.rows?.length ?? 1, mode: native.mode ?? "unpaced-throughput",
      fixtureSha256: fixtureHash }));
  } else {
    process.stdout.write(json);
  }
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
