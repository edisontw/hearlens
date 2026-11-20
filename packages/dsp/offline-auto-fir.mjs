/**
 * M03 synthetic-only detector-to-FIR control adapter.
 * Explicitly supplied offline research cores; no capture, output, or routes.
 * Updates are sample-clocked, not callback-clocked, and never per PCM sample.
 */
const RATE = 48000;
const BANDS = 6;
const ZERO_LEVELS = Object.freeze(Array(BANDS).fill(50));
const finiteBounded = value => typeof value === "number" && Number.isFinite(value) &&
  value >= -16 && value <= 16;

export function createOfflineAutoFirResearch(config) {
  const keys = ["usage", "fir", "detector", "controlIntervalSamples"];
  if (!config || typeof config !== "object" || Array.isArray(config) ||
      Object.keys(config).some(key => !keys.includes(key)) ||
      keys.some(key => !Object.hasOwn(config, key)) ||
      config.usage !== "offline-synthetic-test-only" ||
      !Number.isInteger(config.controlIntervalSamples) ||
      config.controlIntervalSamples < 128 || config.controlIntervalSamples > 2048) {
    throw new TypeError("explicit offline synthetic control interval required");
  }
  const { fir, detector, controlIntervalSamples } = config;
  if (!fir || typeof fir.processInto !== "function" ||
      typeof fir.setSyntheticBandLevels !== "function" || typeof fir.reset !== "function" ||
      !detector || typeof detector.process !== "function" ||
      typeof detector.readNominalLevelsInto !== "function" || typeof detector.reset !== "function") {
    throw new TypeError("offline FIR and six-band detector instances required");
  }
  const fd = fir.diagnostics, dd = detector.diagnostics;
  if (fd.kind !== "offline-synthetic-dynamic-fir-research-only" ||
      dd.kind !== "offline-synthetic-six-band-level-only" ||
      fd.sampleRate !== RATE || dd.sampleRate !== RATE ||
      fd.audioRoute !== "none" || dd.audioRoute !== "none" ||
      fd.hearingOutputAuthorized !== false || dd.hearingOutputAuthorized !== false ||
      fd.nominalSyntheticInputOnly !== true || dd.syntheticMappingOnly !== true ||
      fd.acceptedSamples !== 0 || dd.acceptedSamples !== 0 ||
      fd.faulted || dd.faulted || fd.ready) {
    throw new TypeError("fresh 48-kHz disconnected synthetic research cores required");
  }
  const levelScratch = new Float64Array(BANDS);
  const nominalLevels = Array(BANDS).fill(50);
  let acceptedSamples = 0, sinceUpdate = 0, updates = 0, faulted = false, initialized = false;

  function processInto(input, output) {
    if (faulted) throw new Error("offline automatic FIR adapter faulted; reset required");
    if (!(input instanceof Float32Array) || !(output instanceof Float32Array) ||
        input.length < 1 || input.length > 4096 || output.length < input.length ||
        input.buffer === output.buffer || input.some(x => !finiteBounded(x))) {
      faulted = true;
      throw new TypeError("independent finite synthetic PCM buffers required; reset required");
    }
    try {
      if (!initialized) {
        fir.setSyntheticBandLevels(ZERO_LEVELS.slice());
        initialized = true;
      }
      let pos = 0;
      while (pos < input.length) {
        const count = Math.min(input.length - pos, controlIntervalSamples - sinceUpdate);
        const segment = input.subarray(pos, pos + count);
        detector.process(segment);
        fir.processInto(segment, output.subarray(pos, pos + count));
        pos += count;
        sinceUpdate += count;
        if (sinceUpdate === controlIntervalSamples) {
          detector.readNominalLevelsInto(levelScratch);
          for (let band = 0; band < BANDS; band++) nominalLevels[band] = levelScratch[band];
          fir.setSyntheticBandLevels(nominalLevels);
          sinceUpdate = 0;
          updates++;
        }
      }
      acceptedSamples += input.length;
      return input.length;
    } catch (error) {
      output.fill(0);
      faulted = true;
      throw error;
    }
  }

  function reset() {
    // Preserve fail-stop if either underlying core rejects its reset.
    faulted = true;
    fir.reset();
    detector.reset();
    levelScratch.fill(0); nominalLevels.fill(50);
    acceptedSamples = sinceUpdate = updates = 0;
    initialized = false;
    faulted = false;
  }

  return Object.freeze({
    processInto, reset,
    get diagnostics() {
      return Object.freeze({
        kind: "offline-synthetic-auto-fir-research-only", sampleRate: RATE,
        controlIntervalSamples, acceptedSamples, sinceUpdate, updates, initialized, faulted,
        detector: detector.diagnostics, fir: fir.diagnostics,
        physicalMicCalibrated: false, physicalReceiverCalibrated: false,
        acousticMpoMeasured: false, hearingOutputAuthorized: false, audioRoute: "none",
      });
    },
  });
}
