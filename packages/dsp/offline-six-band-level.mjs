/**
 * M03: 48-kHz synthetic PCM six-band level observation only.
 * No microphone, playback, audio route, acoustic SPL calibration or hearing output.
 * Levels use an arbitrary test coordinate: -37 dBFS band RMS -> nominal 65;
 * they MUST NOT be interpreted as real input dB SPL.
 */
const RATE = 48000;
const CENTER_HZ = Object.freeze([250, 500, 1000, 2000, 4000, 8000]);
const Q = 1.5;
const REF_DBFS = -37;
const REF_NOMINAL = 65;
const FLOOR_RMS = 1e-10;
// Symmetric power averaging suppresses carrier-cycle ripple before asymmetrical
// envelope smoothing; otherwise slow release biases low-frequency tones high.
const POWER_AVERAGE_MS = 12;
const good = (v, lo, hi) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;

// Two constant-peak-gain band-pass sections per center. Their internal state is
// independent, and coefficients are calculated once, never inside process().
const FILTERS = CENTER_HZ.map(hz => {
  const omega = 2 * Math.PI * hz / RATE;
  const alpha = Math.sin(omega) / (2 * Q);
  const invA0 = 1 / (1 + alpha);
  return Object.freeze({
    b0: alpha * invA0, b2: -alpha * invA0,
    a1: -2 * Math.cos(omega) * invA0, a2: (1 - alpha) * invA0,
  });
});

export function createOfflineSixBandLevelResearch(config) {
  const keys = ["usage", "sampleRate", "attackMs", "releaseMs"];
  if (!config || typeof config !== "object" || Array.isArray(config) ||
      Object.keys(config).some(key => !keys.includes(key)) ||
      keys.some(key => !Object.hasOwn(config, key)) ||
      config.usage !== "offline-synthetic-test-only" || config.sampleRate !== RATE ||
      !good(config.attackMs, 5, 100) || !good(config.releaseMs, 100, 2000) ||
      config.releaseMs < config.attackMs) {
    throw new TypeError("explicit 48kHz synthetic-only detector configuration required");
  }
  const attack = -Math.expm1(-1 / (RATE * config.attackMs / 1000));
  const release = -Math.expm1(-1 / (RATE * config.releaseMs / 1000));
  const powerAlpha = -Math.expm1(-1 / (RATE * POWER_AVERAGE_MS / 1000));
  const z1a = new Float64Array(6), z2a = new Float64Array(6);
  const z1b = new Float64Array(6), z2b = new Float64Array(6);
  const energy = new Float64Array(6), smoothPower = new Float64Array(6);
  let acceptedSamples = 0, faulted = false;

  function process(input) {
    if (faulted) throw new Error("offline level detector faulted; reset required");
    if (!(input instanceof Float32Array) || input.length < 1 || input.length > 4096 ||
        input.some(sample => !good(sample, -16, 16))) {
      faulted = true;
      throw new TypeError("finite bounded synthetic Float32 PCM required; reset required");
    }
    try {
      for (let i = 0; i < input.length; i++) {
        const x = input[i];
        for (let j = 0; j < 6; j++) {
          const c = FILTERS[j];
          const a = c.b0 * x + z1a[j];
          z1a[j] = -c.a1 * a + z2a[j];
          z2a[j] = c.b2 * x - c.a2 * a;
          const b = c.b0 * a + z1b[j];
          z1b[j] = -c.a1 * b + z2b[j];
          z2b[j] = c.b2 * a - c.a2 * b;
          smoothPower[j] += powerAlpha * (b * b - smoothPower[j]);
          const alpha = smoothPower[j] > energy[j] ? attack : release;
          energy[j] += alpha * (smoothPower[j] - energy[j]);
          if (!Number.isFinite(energy[j])) throw new Error("nonfinite level estimate");
        }
      }
      acceptedSamples += input.length;
      return input.length;
    } catch (error) {
      faulted = true;
      throw error;
    }
  }

  function readNominalLevelsInto(output) {
    if (faulted) throw new Error("offline level detector faulted; reset required");
    if (!(output instanceof Float32Array || output instanceof Float64Array) || output.length !== 6) {
      throw new TypeError("six-element independent level output array required");
    }
    for (let j = 0; j < 6; j++) {
      const dbfs = 20 * Math.log10(Math.max(Math.sqrt(energy[j]), FLOOR_RMS));
      output[j] = Math.max(50, Math.min(80, REF_NOMINAL + dbfs - REF_DBFS));
    }
    return output;
  }

  function reset() {
    z1a.fill(0); z2a.fill(0); z1b.fill(0); z2b.fill(0); energy.fill(0); smoothPower.fill(0);
    acceptedSamples = 0; faulted = false;
  }

  return Object.freeze({
    process, readNominalLevelsInto, reset,
    get diagnostics() {
      return Object.freeze({
        kind: "offline-synthetic-six-band-level-only", sampleRate: RATE,
        bandsHz: CENTER_HZ, bandpassSectionsPerBand: 2, powerAverageMs: POWER_AVERAGE_MS,
        referenceBandRmsDbfs: REF_DBFS, referenceNominalInputLevel: REF_NOMINAL,
        syntheticMappingOnly: true, physicalMicCalibrated: false,
        acousticMpoMeasured: false, hearingOutputAuthorized: false,
        audioRoute: "none", acceptedSamples, faulted,
      });
    },
  });
}
