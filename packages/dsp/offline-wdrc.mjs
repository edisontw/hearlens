/**
 * HearLens M03 Part C: finite, deterministic OFFLINE WDRC research renderer.
 * Operates only on explicitly supplied synthetic PCM + synthetic level reference.
 * No device access, Web Audio, live routing, audiogram-to-gain conversion or
 * calibrated dB SPL / output safety claim.
 */
import {
  INPUT_LEVELS_DB_SPL,
  TARGET_USAGE,
  normalizePrescriptionTargets,
  targetGainAtInput,
} from "../prescription-targets/prescription-targets.mjs";

export const OFFLINE_WDRC_FRAME_SIZE = 1024;
export const OFFLINE_WDRC_HOP_SIZE = 256;
export const OFFLINE_WDRC_SAMPLE_RATES = Object.freeze([16000, 24000, 48000]);
export const OFFLINE_WDRC_MAX_SAMPLES = 65536;

function boundedNumber(value, name, low, high) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < low || value > high) {
    throw new RangeError(name + " must be finite and within [" + low + ", " + high + "]");
  }
  return value;
}

/* In-place radix-2 FFT; inverse includes 1/N scaling. No external dependency. */
function fft(real, imag, inverse = false) {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const theta = (inverse ? 2 : -2) * Math.PI / len;
    const cosine = Math.cos(theta);
    const sine = Math.sin(theta);
    for (let start = 0; start < n; start += len) {
      let wr = 1, wi = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = start + j, b = a + len / 2;
        const br = wr * real[b] - wi * imag[b];
        const bi = wr * imag[b] + wi * real[b];
        const ar = real[a], ai = imag[a];
        real[a] = ar + br; imag[a] = ai + bi;
        real[b] = ar - br; imag[b] = ai - bi;
        const nextWr = wr * cosine - wi * sine;
        wi = wr * sine + wi * cosine;
        wr = nextWr;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      real[i] /= n;
      imag[i] /= n;
    }
  }
}

/* Assign full positive-frequency bins to non-overlapping log-midpoint bands.
 * This is a simple research filterbank, not a hearing-aid-quality crossover.
 */
function frequencyBins(centers, sampleRate) {
  const boundaries = [];
  for (let j = 1; j < centers.length; j++) {
    boundaries.push(Math.sqrt(centers[j - 1] * centers[j]));
  }
  const result = new Uint8Array(OFFLINE_WDRC_FRAME_SIZE / 2 + 1);
  let band = 0;
  for (let k = 0; k < result.length; k++) {
    const hz = k * sampleRate / OFFLINE_WDRC_FRAME_SIZE;
    while (band < boundaries.length && hz >= boundaries[band]) band++;
    result[k] = band;
  }
  return result;
}

/**
 * Offline renderer. Every invocation is an independent ear/clip (no shared
 * state). The simulation reference is NOT a physical microphone calibration.
 *
 * @returns {{samples: Float32Array, diagnostics: object}}
 */
export function renderOfflineWDRC({
  samples,
  sampleRate,
  targets,
  ear,
  syntheticRmsDbFSAt65DbSPL,
  maxGainDb = 12,
  limiterCeiling = 0.8,
  attackMs = 15,
  releaseMs = 500,
}) {
  if (!(samples instanceof Float32Array) || samples.length < 1 ||
      samples.length > OFFLINE_WDRC_MAX_SAMPLES) {
    throw new TypeError("samples must be a nonempty Float32Array up to 65536 samples");
  }
  for (const sample of samples) {
    if (!Number.isFinite(sample) || Math.abs(sample) > 16) {
      throw new RangeError("synthetic PCM must contain finite samples with magnitude <= 16");
    }
  }
  if (!OFFLINE_WDRC_SAMPLE_RATES.includes(sampleRate)) {
    throw new RangeError("sampleRate must be 16000, 24000 or 48000");
  }
  if (ear !== "left" && ear !== "right") throw new RangeError("ear must be left or right");
  boundedNumber(syntheticRmsDbFSAt65DbSPL, "syntheticRmsDbFSAt65DbSPL", -90, -3);
  boundedNumber(maxGainDb, "maxGainDb", 0, 24);
  boundedNumber(limiterCeiling, "limiterCeiling", 0.05, 0.95);
  boundedNumber(attackMs, "attackMs", 5, 100);
  boundedNumber(releaseMs, "releaseMs", 100, 2000);

  const normalized = normalizePrescriptionTargets(targets);
  if (normalized.usage !== TARGET_USAGE || normalized.origin.kind !== "synthetic-fixture") {
    throw new TypeError("offline renderer requires synthetic-fixture research targets");
  }
  const side = normalized.ears[ear];
  if (!side || side.bands.length < 6 || side.bands.length > 8) {
    throw new RangeError("offline renderer requires 6 to 8 explicit target bands for the chosen ear");
  }
  const centers = side.bands.map(b => b.centerHz);
  if (centers.at(-1) >= sampleRate / 2) {
    throw new RangeError("highest target center must be below Nyquist");
  }

  const n = OFFLINE_WDRC_FRAME_SIZE;
  const hop = OFFLINE_WDRC_HOP_SIZE;
  const bins = frequencyBins(centers, sampleRate);
  const window = Float64Array.from({ length: n }, (_, i) =>
    0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 0.5) / n));
  const windowPower = window.reduce((sum, w) => sum + w * w, 0);
  const overlap = new Float64Array(samples.length);
  const weights = new Float64Array(samples.length);
  const smoothedDb = new Float64Array(centers.length);
  const attackAlpha = Math.exp(-hop / (sampleRate * attackMs / 1000));
  const releaseAlpha = Math.exp(-hop / (sampleRate * releaseMs / 1000));
  let cappedBandFrames = 0;
  let frames = 0;

  for (let start = -n + hop; start < samples.length; start += hop) {
    const real = new Float64Array(n);
    const imag = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const index = start + i;
      if (index >= 0 && index < samples.length) {
        real[i] = samples[index] * window[i];
      }
    }
    fft(real, imag);

    // Parseval energy partition, adjusted for the analysis-window power.
    const energy = new Float64Array(centers.length);
    for (let k = 0; k <= n / 2; k++) {
      const factor = (k === 0 || k === n / 2) ? 1 : 2;
      energy[bins[k]] += factor * (real[k] * real[k] + imag[k] * imag[k]);
    }
    const gains = new Float64Array(centers.length);
    for (let b = 0; b < centers.length; b++) {
      const rms = Math.sqrt(energy[b] / (n * windowPower));
      const dbfs = 20 * Math.log10(Math.max(rms, 1e-12));
      const nominal = Math.max(INPUT_LEVELS_DB_SPL[0], Math.min(INPUT_LEVELS_DB_SPL.at(-1),
        65 + dbfs - syntheticRmsDbFSAt65DbSPL));
      const lookup = targetGainAtInput(normalized, ear, centers[b], nominal);
      if (lookup.targetGainDb === null) throw new Error("internal research target lookup unavailable");
      if (lookup.targetGainDb > maxGainDb) cappedBandFrames++;
      const requestedDb = Math.min(lookup.targetGainDb, maxGainDb);
      // Gain falls quickly (loud onset), rises slowly (avoid sudden boost).
      const alpha = requestedDb < smoothedDb[b] ? attackAlpha : releaseAlpha;
      smoothedDb[b] = alpha * smoothedDb[b] + (1 - alpha) * requestedDb;
      gains[b] = Math.pow(10, smoothedDb[b] / 20);
    }

    for (let k = 0; k <= n / 2; k++) {
      const gain = gains[bins[k]];
      real[k] *= gain; imag[k] *= gain;
      if (k > 0 && k < n / 2) {
        real[n - k] *= gain;
        imag[n - k] *= gain;
      }
    }
    fft(real, imag, true);
    for (let i = 0; i < n; i++) {
      const index = start + i;
      if (index >= 0 && index < samples.length) {
        overlap[index] += real[i] * window[i];
        weights[index] += window[i] * window[i];
      }
    }
    frames++;
  }

  const output = new Float32Array(samples.length);
  let limitedSamples = 0;
  let maxAbsOutput = 0;
  for (let i = 0; i < output.length; i++) {
    // The FINAL limiter is deliberately after *all* bands and overlap-add.
    const preLimiter = weights[i] > 0 ? overlap[i] / weights[i] : 0;
    if (!Number.isFinite(preLimiter)) throw new Error("non-finite DSP output (fail closed)");
    if (Math.abs(preLimiter) > limiterCeiling) limitedSamples++;
    // Leave one ULP-sized headroom so Float32 rounding cannot exceed the
    // user-specified digital ceiling (including non-exact decimal ceilings).
    const quantizationSafeCeiling = limiterCeiling - 1e-7;
    const limited = Math.max(-quantizationSafeCeiling, Math.min(quantizationSafeCeiling, preLimiter));
    output[i] = limited;
    maxAbsOutput = Math.max(maxAbsOutput, Math.abs(output[i]));
  }
  return Object.freeze({
    samples: output,
    diagnostics: Object.freeze({
      kind: "offline-synthetic-only",
      ear,
      bandCentersHz: Object.freeze([...centers]),
      frames,
      limitedSamples,
      cappedBandFrames,
      maxAbsOutput,
      limiterCeiling,
    }),
  });
}
