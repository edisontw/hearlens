#!/usr/bin/env node
// Deterministic metrics; optional machine-dependent benchmark is separated.
import {
  characterizeOfflineWDRC, benchmarkOfflineWDRC,
} from "../packages/dsp/offline-wdrc.characterization.mjs";

const args = process.argv.slice(2);
if (args.some(x => x !== "--benchmark")) {
  console.error("Usage: node tools/characterize-offline-wdrc.mjs [--benchmark]");
  process.exitCode = 2;
} else {
  const stableReport = characterizeOfflineWDRC();
  const report = args.includes("--benchmark")
    ? {
        ...stableReport,
        performance: [16000, 24000, 48000].map(sampleRate =>
          benchmarkOfflineWDRC({ sampleRate, iterations: 3 })),
      }
    : stableReport;
  console.log(JSON.stringify(report, null, 2));
}
