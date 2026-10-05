const FLOOR = 1e-8;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function dbfs(value) {
  return 20 * Math.log10(Math.max(FLOOR, value));
}

function timeConstantWeight(durationMs, timeConstantMs) {
  if (!Number.isFinite(timeConstantMs) || timeConstantMs <= 0) return 1;
  return 1 - Math.exp(-Math.max(0, durationMs) / timeConstantMs);
}

function measureInput(input) {
  let sumSquares = 0;
  let peak = 0;

  for (let i = 0; i < input.length; i += 1) {
    const sample = Number.isFinite(input[i]) ? input[i] : 0;
    sumSquares += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }

  const rms = input.length ? Math.sqrt(sumSquares / input.length) : 0;
  return {
    rms,
    peak,
    rmsDbfs: dbfs(rms),
    peakDbfs: dbfs(peak),
  };
}

export const DEFAULT_ADAPTIVE_INPUT_CONFIG = Object.freeze({
  targetRmsDbfs: -30,
  minGain: 1,
  maxGain: 8,
  gainUpMs: 350,
  gainDownMs: 120,
  limiterCeiling: 0.95,
  initialNoiseFloorDbfs: -75,
  noiseMarginDb: 8,
  noiseFloorRiseMs: 5000,
  noiseFloorFallMs: 600,
  speechLevelMs: 600,
});

export class AdaptiveInputNormalizer {
  constructor(config = {}) {
    this.config = {
      ...DEFAULT_ADAPTIVE_INPUT_CONFIG,
      ...config,
    };

    this.config.minGain = Math.max(0.25, Number(this.config.minGain) || 1);
    this.config.maxGain = Math.max(
      this.config.minGain,
      Number(this.config.maxGain) || this.config.minGain,
    );
    this.config.limiterCeiling = clamp(
      Number(this.config.limiterCeiling) || 0.95,
      0.5,
      0.99,
    );
    this.config.noiseMarginDb = clamp(
      Number(this.config.noiseMarginDb) || 8,
      3,
      20,
    );

    this.reset();
  }

  reset() {
    this.currentGain = this.config.minGain;
    this.noiseFloorDbfs = this.config.initialNoiseFloorDbfs;
    this.speechLevelDbfs = null;
  }

  getProfile() {
    return {
      mode: "adaptive",
      ...this.config,
    };
  }

  process(input, sampleRate = 16_000) {
    const measured = measureInput(input);
    const durationMs =
      sampleRate > 0 ? (input.length / sampleRate) * 1000 : 0;

    if (measured.rmsDbfs < this.noiseFloorDbfs) {
      const weight = timeConstantWeight(
        durationMs,
        this.config.noiseFloorFallMs,
      );
      this.noiseFloorDbfs +=
        (measured.rmsDbfs - this.noiseFloorDbfs) * weight;
    } else if (
      measured.rmsDbfs <
      this.noiseFloorDbfs + this.config.noiseMarginDb
    ) {
      const weight = timeConstantWeight(
        durationMs,
        this.config.noiseFloorRiseMs,
      );
      this.noiseFloorDbfs +=
        (measured.rmsDbfs - this.noiseFloorDbfs) * weight;
    }

    this.noiseFloorDbfs = clamp(this.noiseFloorDbfs, -100, -20);

    const speechActive =
      measured.rmsDbfs >=
      this.noiseFloorDbfs + this.config.noiseMarginDb;

    let desiredGain = this.currentGain;
    if (speechActive) {
      const speechWeight = timeConstantWeight(
        durationMs,
        this.config.speechLevelMs,
      );
      this.speechLevelDbfs =
        this.speechLevelDbfs === null
          ? measured.rmsDbfs
          : this.speechLevelDbfs +
            (measured.rmsDbfs - this.speechLevelDbfs) * speechWeight;

      const requiredGainDb = this.config.targetRmsDbfs - measured.rmsDbfs;
      desiredGain = clamp(
        10 ** (requiredGainDb / 20),
        this.config.minGain,
        this.config.maxGain,
      );
    }

    const gainTimeConstant =
      desiredGain < this.currentGain
        ? this.config.gainDownMs
        : this.config.gainUpMs;
    const gainWeight = timeConstantWeight(durationMs, gainTimeConstant);
    this.currentGain += (desiredGain - this.currentGain) * gainWeight;
    this.currentGain = clamp(
      this.currentGain,
      this.config.minGain,
      this.config.maxGain,
    );

    const preLimiterPeak = measured.peak * this.currentGain;
    const limiterGain =
      preLimiterPeak > this.config.limiterCeiling && preLimiterPeak > 0
        ? this.config.limiterCeiling / preLimiterPeak
        : 1;
    const effectiveGain = this.currentGain * limiterGain;

    const output = new Float32Array(input.length);
    let outputPeak = 0;
    let limitedSamples = 0;

    for (let i = 0; i < input.length; i += 1) {
      const raw = Number.isFinite(input[i]) ? input[i] : 0;
      if (Math.abs(raw * this.currentGain) > this.config.limiterCeiling) {
        limitedSamples += 1;
      }

      const normalized = clamp(
        raw * effectiveGain,
        -this.config.limiterCeiling,
        this.config.limiterCeiling,
      );
      output[i] = normalized;
      outputPeak = Math.max(outputPeak, Math.abs(normalized));
    }

    return {
      samples: output,
      rawRmsDbfs: measured.rmsDbfs,
      rawPeakDbfs: measured.peakDbfs,
      outputPeakDbfs: dbfs(outputPeak),
      clippedPercent: input.length
        ? (limitedSamples / input.length) * 100
        : 0,
      speechActive,
      noiseFloorDbfs: this.noiseFloorDbfs,
      speechLevelDbfs: this.speechLevelDbfs,
      adaptiveGain: this.currentGain,
      limiterGain,
      limiterReductionDb: dbfs(limiterGain),
    };
  }
}

export function processInputAudio(input, gain = 1) {
  const safeGain = Math.min(8, Math.max(1, Number(gain) || 1));
  const output = new Float32Array(input.length);

  let sumSquares = 0;
  let rawPeak = 0;
  let outputPeak = 0;
  let clipped = 0;

  for (let i = 0; i < input.length; i += 1) {
    const raw = Number.isFinite(input[i]) ? input[i] : 0;
    const absRaw = Math.abs(raw);
    sumSquares += raw * raw;
    rawPeak = Math.max(rawPeak, absRaw);

    const amplified = raw * safeGain;
    if (Math.abs(amplified) > 0.98) clipped += 1;
    const limited = Math.max(-0.98, Math.min(0.98, amplified));
    output[i] = limited;
    outputPeak = Math.max(outputPeak, Math.abs(limited));
  }

  const rms = input.length
    ? Math.sqrt(sumSquares / input.length)
    : 0;

  return {
    samples: output,
    rawRmsDbfs: dbfs(rms),
    rawPeakDbfs: dbfs(rawPeak),
    outputPeakDbfs: dbfs(outputPeak),
    clippedPercent: input.length ? (clipped / input.length) * 100 : 0,
  };
}
