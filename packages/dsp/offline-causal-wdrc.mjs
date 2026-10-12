/**
 * HearLens SW2: synthetic-only, causal per-ear PCM comparison baseline.
 *
 * No microphone/device APIs, no sink, no speech recording, no audiogram fitting,
 * no dBHL/dBSPL conversion and NO safe hearing-output claim.
 *
 * Filterbank: one-pole recursive low-pass/residual splits; telescoping sum
 * reconstructs identity when all bands have unity gain. This is NOT an
 * audiology-grade crossover or validated minimum-phase prescription system.
 *
 * "0 lookahead samples" means no future INPUT PCM is required, NOT zero phase
 * delay, BT presentation delay, ADC buffering, or acoustic end-to-end latency.
 */
export const CAUSAL_RESEARCH_SAMPLE_RATES = Object.freeze([16000, 24000, 48000]);
export const CAUSAL_RESEARCH_DEFAULT_CROSSOVERS = Object.freeze([350, 700, 1400, 2800, 5600]);

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const validNumber = (value, name, min, max) => {
  if (!finite(value) || value < min || value > max) {
    throw new RangeError(name + " must be finite within [" + min + "," + max + "]");
  }
  return value;
};
const isFloat32 = value => value instanceof Float32Array;

export function createOfflineCausalResearchDSP({
  sampleRate = 48000,
  ear = "left",
  crossoversHz = CAUSAL_RESEARCH_DEFAULT_CROSSOVERS,
  baseGainsDb,
  ratios,
  thresholdDbfs = -44,
  attackMs = 10,
  releaseMs = 160,
  limiterCeiling = 0.8,
} = {}) {
  if (!CAUSAL_RESEARCH_SAMPLE_RATES.includes(sampleRate)) {
    throw new RangeError("sampleRate requires 16000, 24000 or 48000");
  }
  if (!["left", "right"].includes(ear)) throw new RangeError("ear requires left or right");
  if (!Array.isArray(crossoversHz) || ![5, 7].includes(crossoversHz.length)) {
    throw new RangeError("crossoversHz requires exactly 5 or 7 ordered boundaries");
  }
  const boundaries = [...crossoversHz];
  let previous = 0;
  for (const [i, hz] of boundaries.entries()) {
    validNumber(hz, "crossoversHz[" + i + "]", 100, sampleRate * 0.4);
    if (hz <= previous) throw new RangeError("crossoversHz must strictly increase");
    previous = hz;
  }
  const bands = boundaries.length + 1;
  const gains = baseGainsDb ?? Array(bands).fill(0);
  const compression = ratios ?? Array(bands).fill(1);
  if (!Array.isArray(gains) || gains.length !== bands ||
      !Array.isArray(compression) || compression.length !== bands) {
    throw new RangeError("baseGainsDb and ratios require one value for each band");
  }
  gains.forEach((v, i) => validNumber(v, "baseGainsDb[" + i + "]", -12, 12));
  compression.forEach((v, i) => validNumber(v, "ratios[" + i + "]", 1, 4));
  validNumber(thresholdDbfs, "thresholdDbfs", -90, -10);
  validNumber(attackMs, "attackMs", 2, 100);
  validNumber(releaseMs, "releaseMs", 20, 2000);
  validNumber(limiterCeiling, "limiterCeiling", 0.05, 0.95);
  const coefficients = Float64Array.from(boundaries,
    hz => Math.exp(-2 * Math.PI * hz / sampleRate));
  const initialGainsDb = Float64Array.from(gains);
  const ratiosCopy = Float64Array.from(compression);
  const lpf = new Float64Array(boundaries.length);
  const envelopes = new Float64Array(bands);
  const gainStateDb = Float64Array.from(initialGainsDb);
  const attackAlpha = Math.exp(-1 / (sampleRate * attackMs / 1000));
  const releaseAlpha = Math.exp(-1 / (sampleRate * releaseMs / 1000));
  const quantizationSafeCeiling = limiterCeiling - 1e-7;
  let faulted = false, acceptedSamples = 0, emittedSamples = 0;
  let limitedSamples = 0, maxAbsOutput = 0;

  const diagnostics = () => Object.freeze({
    kind: "offline-synthetic-causal-research-only",
    ear, sampleRate, bands,
    algorithmicLookaheadSamples: 0,
    algorithmicLookaheadMs: 0,
    phaseGroupDelayMeasured: false,
    bluetoothE2eMeasured: false,
    acousticMpoMeasured: false,
    acceptedSamples, emittedSamples, limitedSamples, maxAbsOutput, faulted,
  });

  function processInto(input, destination) {
    if (faulted) throw new Error("causal research instance faulted; reset required");
    try {
      if (!isFloat32(input) || !isFloat32(destination) ||
          !input.length || destination.length < input.length ||
          input.buffer === destination.buffer) {
        throw new TypeError("independent Float32 PCM source/destination required with full capacity");
      }
      // Prevalidate entire chunk before any state mutation or destination write.
      for (let i = 0; i < input.length; i++) {
        if (!finite(input[i]) || Math.abs(input[i]) > 16) {
          throw new RangeError("invalid synthetic PCM");
        }
      }
      for (let i = 0; i < input.length; i++) {
        let residue = input[i], mixed = 0;
        for (let b = 0; b < bands; b++) {
          let component;
          if (b < bands - 1) {
            const a = coefficients[b];
            const low = (1 - a) * residue + a * lpf[b];
            lpf[b] = low;
            component = low;
            residue -= low;
          } else {
            component = residue;
          }
          const absolute = Math.abs(component);
          const alpha = absolute > envelopes[b] ? attackAlpha : releaseAlpha;
          envelopes[b] = alpha * envelopes[b] + (1 - alpha) * absolute;
          const levelDbfs = 20 * Math.log10(Math.max(envelopes[b], 1e-9));
          // Synthetic downward compression; no microphone-to-SPL mapping.
          const reductionDb = Math.max(0, levelDbfs - thresholdDbfs) *
            (1 - 1 / ratiosCopy[b]);
          const desiredDb = Math.max(-24, initialGainsDb[b] - reductionDb);
          const gainAlpha = desiredDb < gainStateDb[b] ? attackAlpha : releaseAlpha;
          gainStateDb[b] = gainAlpha * gainStateDb[b] + (1 - gainAlpha) * desiredDb;
          mixed += component * Math.pow(10, gainStateDb[b] / 20);
        }
        if (!finite(mixed)) throw new Error("non-finite synthetic filter output");
        if (Math.abs(mixed) > limiterCeiling) limitedSamples++;
        const value = Math.max(-quantizationSafeCeiling,
          Math.min(quantizationSafeCeiling, mixed));
        destination[i] = value;
        maxAbsOutput = Math.max(maxAbsOutput, Math.abs(destination[i]));
      }
      acceptedSamples += input.length;
      emittedSamples += input.length;
      return input.length; // same number of samples now, no FIFO or lookahead
    } catch (error) {
      // The caller must discard destination after a fault. No output sink exists.
      faulted = true;
      throw error;
    }
  }

  function reset() {
    lpf.fill(0);
    envelopes.fill(0);
    gainStateDb.set(initialGainsDb);
    acceptedSamples = 0;
    emittedSamples = 0;
    limitedSamples = 0;
    maxAbsOutput = 0;
    faulted = false;
  }

  return Object.freeze({
    processInto, reset, get diagnostics() { return diagnostics(); },
    researchSyntheticOnly: true,
  });
}
