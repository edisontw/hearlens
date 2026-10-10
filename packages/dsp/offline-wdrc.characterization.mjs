/**
 * Deterministic synthetic-only measurements of the M03C offline research DSP.
 * There are no physical SPL, acoustic latency, true-peak, or clinical claims.
 */
import { renderOfflineWDRC, OFFLINE_WDRC_FRAME_SIZE, OFFLINE_WDRC_HOP_SIZE } from "./offline-wdrc.mjs";
import { PRESCRIPTION_TARGET_SCHEMA } from "../prescription-targets/prescription-targets.mjs";

export const CHARACTERIZATION_SCHEMA = "hearlens-m03d-offline-characterization-v1";
export const CHARACTERIZATION_SAMPLE_RATE = 16000;
export const CHARACTERIZATION_CENTERS = Object.freeze([250, 500, 1000, 2000, 4000, 6000]);
const SR = CHARACTERIZATION_SAMPLE_RATE;
const N = 32768;
const REFERENCE = -37;

function round(value) {
  return Math.round(value * 1000) / 1000;
}

export function fixtureTargets(gainsByCenter = () => [0, 0, 0]) {
  const bands = CHARACTERIZATION_CENTERS.map(centerHz => {
    const gains = gainsByCenter(centerHz);
    return {
      centerHz,
      gainDbByInputLevel: { "50": gains[0], "65": gains[1], "80": gains[2] },
    };
  });
  return {
    schema: PRESCRIPTION_TARGET_SCHEMA,
    usage: "offline-research-only",
    origin: { kind: "synthetic-fixture", referenceId: null },
    ears: {
      left: { bands },
      right: { bands: bands.map(b => ({
        centerHz: b.centerHz, gainDbByInputLevel: { ...b.gainDbByInputLevel },
      })) },
    },
  };
}

export function testSine(frequencyHz, amplitude, length = N, sampleRate = SR) {
  return Float32Array.from({ length }, (_, i) =>
    amplitude * Math.sin(2 * Math.PI * frequencyHz * i / sampleRate));
}

export function testNoise(length = N) {
  let seed = 0x51483351;
  return Float32Array.from({ length }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return ((seed / 4294967296) * 2 - 1) * 0.02;
  });
}

function render(samples, targets, extra = {}) {
  return renderOfflineWDRC({
    samples, targets, ear: "left", sampleRate: SR,
    syntheticRmsDbFSAt65DbSPL: REFERENCE,
    limiterCeiling: 0.95, maxGainDb: 12,
    ...extra,
  });
}

function projectedAmplitude(samples, frequencyHz, from, to) {
  let cosine = 0, sine = 0;
  for (let i = from; i < to; i++) {
    const angle = 2 * Math.PI * frequencyHz * i / SR;
    cosine += samples[i] * Math.cos(angle);
    sine += samples[i] * Math.sin(angle);
  }
  return 2 * Math.hypot(cosine, sine) / (to - from);
}

/** Steady-state fundamental projection ratio; NOT a total-band gain measurement. */
export function projectedGainDb(input, output, frequencyHz, from, to) {
  const original = projectedAmplitude(input, frequencyHz, from, to);
  const processed = projectedAmplitude(output, frequencyHz, from, to);
  if (!(original > 1e-8) || !(processed > 0)) throw new RangeError("tone projection was too small");
  return 20 * Math.log10(processed / original);
}

function gainAtTail(frequencyHz, amplitude, targets) {
  const input = testSine(frequencyHz, amplitude);
  const response = render(input, targets);
  return round(projectedGainDb(input, response.samples, frequencyHz, N - 8192, N - 1024));
}

function maxAbsoluteDifference(a, b) {
  let max = 0;
  for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i] - b[i]));
  return max;
}

function maxPeak(samples) {
  let max = 0;
  for (const value of samples) max = Math.max(max, Math.abs(value));
  return max;
}

function envelopeStepReport() {
  const input = new Float32Array(64000);
  for (let i = 0; i < input.length; i++) {
    const amplitude = i >= SR && i < 2 * SR ? 0.12 : 0.006;
    input[i] = amplitude * Math.sin(2 * Math.PI * 1000 * i / SR);
  }
  const target = fixtureTargets(() => [12, 8, 4]);
  const output = render(input, target).samples;
  const windows = {
    softBefore: [0.65, 0.9],
    loudEarly: [1.06, 1.19],
    loudLate: [1.65, 1.9],
    softEarly: [2.06, 2.19],
    softLate: [3.4, 3.8],
  };
  return Object.fromEntries(Object.entries(windows).map(([name, [start, end]]) => [
    name, round(projectedGainDb(input, output, 1000, Math.round(start * SR), Math.round(end * SR))),
  ]));
}

/** Machine-independent, stable fixture report; no performance timing mixed in. */
export function characterizeOfflineWDRC() {
  const identityTargets = fixtureTargets();
  const noise = testNoise();
  const impulse = new Float32Array(8192);
  impulse[0] = 0.4; impulse[3072] = -0.2; impulse[8191] = 0.3;
  const identityNoise = render(noise, identityTargets).samples;
  const identityImpulse = render(impulse, identityTargets).samples;

  const uniform = fixtureTargets(() => [6, 6, 6]);
  const uniformGain = [250, 500, 1000, 2000, 4000, 6000].map(frequencyHz => ({
    frequencyHz, gainDb: gainAtTail(frequencyHz, 0.008, uniform),
  }));

  const selective = fixtureTargets(frequencyHz => frequencyHz >= 2000 ? [9, 9, 9] : [0, 0, 0]);
  const crossover = [1200, 1300, 1380, 1400, 1410, 1420, 1430, 1450, 1500, 1600].map(frequencyHz => ({
    frequencyHz, gainDb: gainAtTail(frequencyHz, 0.008, selective),
  }));
  const jumps = crossover.slice(1).map((row, i) => Math.abs(row.gainDb - crossover[i].gainDb));

  const compressor = fixtureTargets(() => [12, 8, 4]);
  const compression = [0.006, 0.03, 0.12].map(amplitude => ({
    amplitude, inputDbFS: round(20 * Math.log10(amplitude / Math.SQRT2)),
    measuredGainDb: gainAtTail(1000, amplitude, compressor),
  }));

  const overloaded = testSine(1000, 8, 8192);
  const stressed = render(overloaded, fixtureTargets(() => [80, 80, 80]), { limiterCeiling: 0.2 });

  return Object.freeze({
    schema: CHARACTERIZATION_SCHEMA,
    researchOnly: true,
    sampleRateHz: SR,
    fftSize: OFFLINE_WDRC_FRAME_SIZE,
    hopSize: OFFLINE_WDRC_HOP_SIZE,
    identity: {
      noiseMaxError: round(maxAbsoluteDifference(identityNoise, noise)),
      impulseMaxError: round(maxAbsoluteDifference(identityImpulse, impulse)),
    },
    uniformGain,
    selectiveCrossover: {
      frequencyHz: round(Math.sqrt(1000 * 2000)),
      measurements: crossover,
      maxAdjacentJumpDb: round(Math.max(...jumps)),
      // Flag is diagnostic, not an acoustic-equivalence certification gate.
      discontinuityObserved: Math.max(...jumps) > 1,
    },
    compression,
    envelope: envelopeStepReport(),
    digitalLimiter: {
      peak: round(maxPeak(stressed.samples)),
      limitedSamples: stressed.diagnostics.limitedSamples,
      ceiling: 0.2,
    },
  });
}

/** Wall-clock benchmark is environment-specific and intentionally NOT a CI acceptance metric. */
export function benchmarkOfflineWDRC({ iterations = 3, sampleRate = 16000 } = {}) {
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 20) {
    throw new RangeError("iterations must be 1–20");
  }
  if (![16000, 24000, 48000].includes(sampleRate)) throw new RangeError("unsupported sample rate");
  const samples = testSine(1000, 0.01, sampleRate, sampleRate);
  const fixture = fixtureTargets(() => [12, 8, 4]);
  const options = {
    samples, sampleRate, targets: fixture, ear: "left",
    syntheticRmsDbFSAt65DbSPL: REFERENCE, limiterCeiling: 0.95,
  };
  // Warm up once before samples; no hard real-time guarantee is possible.
  renderOfflineWDRC(options);
  const measurementsMs = [];
  for (let i = 0; i < iterations; i++) {
    const before = performance.now();
    renderOfflineWDRC(options);
    measurementsMs.push(round(performance.now() - before));
  }
  return {
    sampleRateHz: sampleRate, clipDurationMs: 1000, measurementsMs,
    medianMs: [...measurementsMs].sort((a, b) => a - b)[Math.floor(measurementsMs.length / 2)],
    environmentDependent: true,
  };
}
