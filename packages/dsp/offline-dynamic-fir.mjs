/**
 * M03 — offline, synthetic-only fixed-basis dynamic FIR research core.
 *
 * This is NOT a hearing output path. The caller must provide independently
 * simulated per-band 50..80 input-level coordinates. There is NO microphone,
 * sound device, playback sink, acoustic calibration, or automatic level detector.
 * 513-tap linear-phase FIR: fixed-gain group delay 256 samples (5.333 ms at
 * 48 kHz). Zero FUTURE-input lookahead does not mean zero sound-path latency.
 */
import { offlineFFT } from "./offline-wdrc.mjs";
import { normalizePrescriptionTargets } from "../prescription-targets/prescription-targets.mjs";

const RATE = 48000;
const TAPS = 513;
const MIDPOINT = (TAPS - 1) / 2;
const UNIQUE_TAPS = MIDPOINT + 1;
const FFT_N = 4096;
const CENTER_HZ = Object.freeze([250, 500, 1000, 2000, 4000, 8000]);
const BOUNDARIES = CENTER_HZ.slice(1).map((f, i) => Math.sqrt(CENTER_HZ[i] * f));
const valid = (x, a, b) => typeof x === "number" && Number.isFinite(x) && x >= a && x <= b;
const LIMIT_HEADROOM = 1e-7;

function researchConfig(config) {
  const required = ["usage", "targets", "ear", "sampleRate", "maxGainDb", "limiterCeiling", "transitionMs"];
  const allowed = [...required, "transitionRetargetPolicy"];
  if (config === null || typeof config !== "object" || Array.isArray(config) ||
      Object.keys(config).some(k => !allowed.includes(k)) ||
      required.some(k => !Object.hasOwn(config, k))) {
    throw new TypeError("explicit offline research configuration required (no output route)");
  }
  if (config.usage !== "offline-synthetic-test-only" || config.sampleRate !== RATE) {
    throw new TypeError("48000 Hz offline-synthetic-test-only required");
  }
  if (config.ear !== "left" && config.ear !== "right") throw new RangeError("ear must be left/right");
  if (!valid(config.maxGainDb, 0, 12) || !valid(config.limiterCeiling, 0.05, 0.8) ||
      !valid(config.transitionMs, 10, 200)) throw new RangeError("unsupported research bounds");
  const transitionRetargetPolicy = config.transitionRetargetPolicy ?? "restart";
  if (transitionRetargetPolicy !== "restart" && transitionRetargetPolicy !== "fixed-horizon") {
    throw new RangeError("transitionRetargetPolicy must be restart or fixed-horizon");
  }
  const targets = normalizePrescriptionTargets(config.targets);
  if (targets.origin.kind !== "synthetic-fixture") throw new TypeError("synthetic-fixture targets only");
  const bands = targets.ears[config.ear]?.bands;
  if (!bands || bands.length !== 6 ||
      bands.some((b, i) => b.centerHz !== CENTER_HZ[i])) {
    throw new RangeError("six octave-center bands required for selected ear");
  }
  return { bands, ear: config.ear, maxGainDb: config.maxGainDb, transitionRetargetPolicy,
    limiterCeiling: config.limiterCeiling, transitionSamples: Math.round(RATE * config.transitionMs / 1000) };
}

function frequencyWeights(hz) {
  const weights = new Float64Array(6);
  let band = 0;
  while (band < BOUNDARIES.length && hz >= BOUNDARIES[band]) band++;
  weights[band] = 1;
  if (hz === 0) return weights;
  for (let j = 0; j < BOUNDARIES.length; j++) {
    const octaves = Math.log2(hz / BOUNDARIES[j]);
    if (Math.abs(octaves) > 0.18) continue;
    const t = (octaves + 0.18) / 0.36;
    const upper = 0.5 - 0.5 * Math.cos(Math.PI * t);
    weights.fill(0);
    weights[j] = 1 - upper;
    weights[j + 1] = upper;
    break;
  }
  return weights;
}

// Fixed, shared-phase FIR basis: sum_j basis[j][tap] = delay_256[tap].
// Real, even spectra and the symmetric window give mirrored time-domain taps.
// No per-update FIR design, FFT, network, I/O or buffer allocation in processInto.
function designBasis() {
  const basis = Array.from({ length: 6 }, () => new Float64Array(UNIQUE_TAPS));
  const freqRe = new Float64Array(FFT_N), freqIm = new Float64Array(FFT_N);
  const spectra = Array.from({ length: 6 }, () => new Float64Array(FFT_N / 2 + 1));
  for (let k = 0; k <= FFT_N / 2; k++) {
    const weights = frequencyWeights(k * RATE / FFT_N);
    for (let j = 0; j < 6; j++) spectra[j][k] = weights[j];
  }
  for (let j = 0; j < 6; j++) {
    freqRe.fill(0); freqIm.fill(0);
    for (let k = 0; k <= FFT_N / 2; k++) {
      freqRe[k] = spectra[j][k];
      if (k !== 0 && k !== FFT_N / 2) freqRe[FFT_N - k] = spectra[j][k];
    }
    offlineFFT(freqRe, freqIm, true);
    for (let tap = 0; tap < UNIQUE_TAPS; tap++) {
      const window = 0.54 - 0.46 * Math.cos(2 * Math.PI * tap / (TAPS - 1));
      basis[j][tap] = freqRe[(tap - MIDPOINT + FFT_N) % FFT_N] * window;
    }
  }
  return basis;
}

let sharedBasis = null; // immutable private coefficient bank; reused across ears

function interpolateGains(bands, nominalLevels, maxGainDb) {
  if (!Array.isArray(nominalLevels) || nominalLevels.length !== 6 ||
      nominalLevels.some(x => !valid(x, 50, 80))) {
    throw new RangeError("six synthetic per-band nominal levels must be 50..80");
  }
  return bands.map((band, i) => {
    const level = nominalLevels[i];
    const g = band.gainDbByInputLevel;
    const lower = level <= 65 ? 50 : 65, upper = level <= 65 ? 65 : 80;
    const requested = g[String(lower)] + (level - lower) / (upper - lower) *
      (g[String(upper)] - g[String(lower)]);
    return Math.min(requested, maxGainDb);
  });
}

export function createOfflineDynamicFirResearch(config) {
  const { bands, ear, maxGainDb, limiterCeiling, transitionSamples, transitionRetargetPolicy } = researchConfig(config);
  const basis = sharedBasis ?? (sharedBasis = designBasis());
  // Duplicate the ring so both mirrored reads stay contiguous across wrap.
  const history = new Float32Array(2 * TAPS);
  const from = new Float64Array(UNIQUE_TAPS), to = new Float64Array(UNIQUE_TAPS);
  let write = 0, ready = false, faulted = false, fade = transitionSamples;
  let acceptedSamples = 0, limitedSamples = 0, updates = 0, maxAbsOutput = 0;
  let targetGainsDb = Object.freeze([]);
  const ceiling = limiterCeiling - LIMIT_HEADROOM;

  function progress() {
    if (fade >= transitionSamples) return 1;
    const t = fade / transitionSamples;
    return 0.5 - 0.5 * Math.cos(Math.PI * t);
  }

  function setSyntheticBandLevels(levels) {
    if (faulted) throw new Error("research DSP faulted; reset required");
    let gains;
    try { gains = interpolateGains(bands, levels, maxGainDb); }
    catch (error) { faulted = true; throw error; }
    const wasTransitioning = ready && fade < transitionSamples;
    const weight = ready ? progress() : 1;
    const amplitudes = gains.map(db => Math.pow(10, db / 20));
    for (let tap = 0; tap < UNIQUE_TAPS; tap++) {
      if (ready && (transitionRetargetPolicy === "restart" || !wasTransitioning)) {
        from[tap] += (to[tap] - from[tap]) * weight;
      }
      let result = 0;
      for (let band = 0; band < 6; band++) {
        result += basis[band][tap] * amplitudes[band];
      }
      to[tap] = result;
      if (!ready) from[tap] = result;
    }
    ready = true;
    if (updates === 0) fade = transitionSamples;
    // The study mode lets the first active fade finish at its original horizon
    // while replacing its destination with the newest detector target.
    else if (transitionRetargetPolicy === "restart" || !wasTransitioning) fade = 0;
    targetGainsDb = Object.freeze(gains);
    updates++;
    return targetGainsDb;
  }

  function processInto(input, dest) {
    if (faulted || !ready) throw new Error("research DSP not initialized or faulted; reset required");
    if (!(input instanceof Float32Array) || !(dest instanceof Float32Array) ||
        input.length < 1 || input.length > 4096 || dest.length < input.length ||
        input.buffer === dest.buffer ||
        input.some(x => !valid(x, -16, 16))) {
      faulted = true;
      throw new TypeError("independent, finite, bounded synthetic PCM buffers required; reset required");
    }
    try {
      for (let i = 0; i < input.length; i++) {
        history[write] = history[write + TAPS] = input[i];
        const weight = progress();
        const newest = write + TAPS;
        const oldest = newest - (TAPS - 1);
        const transitioning = fade < transitionSamples;
        let value = 0;
        for (let tap = 0; tap < MIDPOINT; tap++) {
          const coeff = transitioning ? from[tap] + (to[tap] - from[tap]) * weight : to[tap];
          value += coeff * (history[newest - tap] + history[oldest + tap]);
        }
        const center = transitioning ?
          from[MIDPOINT] + (to[MIDPOINT] - from[MIDPOINT]) * weight : to[MIDPOINT];
        value += center * history[newest - MIDPOINT];
        if (!Number.isFinite(value)) throw new Error("nonfinite FIR result");
        if (Math.abs(value) > limiterCeiling) limitedSamples++;
        dest[i] = Math.max(-ceiling, Math.min(ceiling, value));
        maxAbsOutput = Math.max(maxAbsOutput, Math.abs(dest[i]));
        if (++write === TAPS) write = 0;
        if (fade < transitionSamples) fade++;
      }
      acceptedSamples += input.length;
      return input.length;
    } catch (e) {
      dest.fill(0); faulted = true; throw e;
    }
  }
  function reset() {
    history.fill(0); from.fill(0); to.fill(0);
    write = 0; ready = false; faulted = false; fade = transitionSamples;
    acceptedSamples = limitedSamples = updates = maxAbsOutput = 0;
    targetGainsDb = Object.freeze([]);
  }
  return Object.freeze({
    setSyntheticBandLevels, processInto, reset,
    get diagnostics() {
      return Object.freeze({
        kind: "offline-synthetic-dynamic-fir-research-only", ear, sampleRate: RATE,
        transitionRetargetPolicy,
        firTaps: TAPS, basisBands: 6, algorithmicFutureLookaheadSamples: 0,
        frozenGainLinearPhaseDelaySamples: MIDPOINT,
        nominalSyntheticInputOnly: true, physicalMicCalibrated: false,
        physicalReceiverCalibrated: false, acousticMpoMeasured: false,
        hearingOutputAuthorized: false, audioRoute: "none",
        acceptedSamples, limitedSamples, updates, maxAbsOutput, faulted, ready,
        transitionRemainingSamples: Math.max(0, transitionSamples - fade),
        lastTargetGainsDb: targetGainsDb,
      });
    },
  });
}
