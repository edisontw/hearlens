import { createOfflineAutoFirResearch } from "./offline-auto-fir.mjs";
import { createOfflineSixBandLevelResearch } from "./offline-six-band-level.mjs";
import { createOfflineDynamicFirResearch } from "./offline-dynamic-fir.mjs";

const centers = [250, 500, 1000, 2000, 4000, 8000];
export const targets = {
  schema: "hearlens-prescription-targets-v1", usage: "offline-research-only",
  origin: { kind: "synthetic-fixture", referenceId: null },
  ears: Object.fromEntries(["left","right"].map(ear => [ear, {
    bands: centers.map((centerHz,i) => ({
      centerHz, gainDbByInputLevel: {
        50: ear === "left" ? i + 3 : i + 6,
        65: ear === "left" ? i + 2 : i + 5,
        80: ear === "left" ? i + 1 : i + 4,
      },
    })),
  }])),
};
export function makeFir(ear, factory = createOfflineDynamicFirResearch, options = {}) {
  return factory({
    usage: "offline-synthetic-test-only", targets, ear, sampleRate: 48000,
    maxGainDb: 12, limiterCeiling: 0.3, transitionMs: 50, ...options,
  });
}
export function makeDetector() {
  return createOfflineSixBandLevelResearch({
    usage: "offline-synthetic-test-only", sampleRate: 48000,
    attackMs: 15, releaseMs: 400,
  });
}
export function core(ear, factory, options) {
  return createOfflineAutoFirResearch({
    usage: "offline-synthetic-test-only", fir: makeFir(ear, factory, options), detector: makeDetector(), controlIntervalSamples: 480,
  });
}
export const pcm = Float32Array.from({length: 5281}, (_,i) =>
  i < 600 ? 0 : (i < 3000 ? .006 : .65) * Math.sin(2*Math.PI*1000*i/48000));
