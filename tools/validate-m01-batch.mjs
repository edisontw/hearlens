import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { scoreBenchmarkReport } from "./score-benchmark-report.mjs";

// Fixed by docs/M01_FORMAL_BENCHMARK.md: 2 devices x 2 presets x 3 distances x 2 repeats.
// Every slot must be independently evidenced; old exploratory results are NOT auto-imported.
export const PRESETS = Object.freeze({ auto: "raw", "far-noisy": "voice" });
export const DISTANCES = Object.freeze(["0.5m", "1m", "2m"]);
const SOURCE_ID = "zh-tw-regression-v2";
const EXPECTED_HASH = "cdd7b9d8d1c94d1f254d7c9fe20b598e1e99982fb1bd96e3555c823ca32b77da";

function nonempty(x) { return typeof x === "string" && x.trim().length > 0; }
function distanceKey(x) {
  const s = String(x ?? "").toLowerCase().replace(/\s/g, "");
  return DISTANCES.includes(s) ? s : null;
}
function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return (sorted[0] + sorted[sorted.length - 1]) / 2;
}
function hash(buffer) { return crypto.createHash("sha256").update(buffer).digest("hex"); }
function slot(device, preset, distance, repeat) {
  return [device, preset, distance, repeat].join("|");
}
function expectedSlots(devices) {
  return devices.flatMap(device =>
    Object.keys(PRESETS).flatMap(preset =>
      DISTANCES.flatMap(distance =>
        [1, 2].map(repeat => ({ device, preset, distance, repeat, slot: slot(device, preset, distance, repeat) }))
      )
    )
  );
}

export function validateM01Batch(manifest, definition, loadReport, sourceBytes) {
  const errors = [];
  const warnings = [];
  const runs = [];
  if (manifest?.schema !== "hearlens-m01-batch-manifest-v1") errors.push("manifest_schema_mismatch");
  if (definition?.sourceId !== "zh-tw-regression-v2-short-through-section3") errors.push("definition_source_mismatch");
  if (!Array.isArray(manifest?.devices) || manifest.devices.length !== 2 ||
    new Set(manifest.devices).size !== 2 || manifest.devices.some(x => !nonempty(x) || /REPLACE|TBD|[<>]/i.test(x))) {
    errors.push("two_distinct_receiver_labels_required");
  }
  const devices = Array.isArray(manifest?.devices) && manifest.devices.length === 2
    ? manifest.devices : [];
  if (devices.length === 2 &&
    (!devices.some(x => /iphone/i.test(x)) ||
     !devices.some(x => /HTC\s*U23/i.test(x)))) {
    errors.push("locked_iphone_and_htc_u23_receiver_pair_required");
  }
  const frozen = manifest?.frozen || {};
  if (!/^[0-9a-f]{40}$/.test(frozen.mainSha || "")) errors.push("main_sha_not_pinned");
  if (!nonempty(frozen.buildId) || /<|>/.test(frozen.buildId || "")) errors.push("build_id_not_pinned");
  if (frozen.provider !== "gemini-live-transcribe") errors.push("unexpected_provider");
  if (!nonempty(frozen.sourceVolume) || /<|>/.test(frozen.sourceVolume || "")) errors.push("source_volume_not_pinned");
  const actualSourceHash = sourceBytes == null ? null : hash(sourceBytes);
  if (frozen.sourceSha256 !== EXPECTED_HASH ||
      actualSourceHash !== EXPECTED_HASH) errors.push("source_wav_hash_missing_or_mismatch");
  const slots = expectedSlots(devices);
  const claimed = new Set();
  const reportFiles = new Set();
  if (!Array.isArray(manifest?.runs)) errors.push("runs_must_be_array");
  for (const entry of Array.isArray(manifest?.runs) ? manifest.runs : []) {
    const label = nonempty(entry?.file) ? entry.file : "<missing_file>";
    const issue = [];
    const repeat = entry?.repeat;
    if (repeat !== 1 && repeat !== 2) issue.push("invalid_repeat");
    if (entry?.cutoffConfirmed !== true) issue.push("section3_cutoff_not_confirmed");
    if (entry?.setupConfirmed !== true) issue.push("controlled_setup_not_confirmed");
    if (entry?.telemetryReviewed !== true) issue.push("telemetry_not_reviewed");
    if (!nonempty(entry?.file)) issue.push("file_path_missing");
    if (reportFiles.has(label)) issue.push("duplicate_report_file");
    reportFiles.add(label);
    let report;
    try { report = loadReport(label); }
    catch { issue.push("report_missing_or_invalid_json"); }
    if (report) {
      const test = report.test || {};
      const rt = report.runtime || {};
      const distance = distanceKey(test.distance);
      const device = test.receiverDevice;
      const preset = rt.preset;
      const key = slot(device, preset, distance, repeat);
      if (report.schema !== "hearlens-test-report-v1") issue.push("report_schema_mismatch");
      if (report.buildId !== frozen.buildId) issue.push("mixed_web_build");
      if (!devices.includes(device)) issue.push("receiver_label_missing_or_wrong");
      if (!distance) issue.push("distance_missing_or_wrong");
      if (!(preset in PRESETS)) issue.push("preset_wrong_or_custom");
      else if (rt.captureMode !== PRESETS[preset]) issue.push("capture_mode_mismatch");
      if (rt.provider !== frozen.provider || (rt.resolvedProvider && rt.resolvedProvider !== frozen.provider)) {
        issue.push("provider_mismatch");
      }
      if (rt.inputMode !== "adaptive" || rt.inputGain != null ||
        rt.tuningProfile?.enabled !== false) issue.push("nondefault_gain_or_tuning");
      if (test.sourceId !== SOURCE_ID) issue.push("incorrect_report_source_id");
      if (String(test.sourceVolume ?? "").trim() !== frozen.sourceVolume) issue.push("volume_missing_or_changed");
      if (!nonempty(test.notes)) issue.push("environment_or_orientation_note_missing");
      if (!Array.isArray(report.eventLog) || report.eventLog.length === 0) issue.push("event_log_missing");
      if (typeof report.finalTranscript !== "string") issue.push("transcript_missing");
      if (!Number.isInteger(report.sessionId) || report.sessionId <= 0) issue.push("session_id_missing");
      if (!nonempty(report.createdAt) || !Number.isFinite(Date.parse(report.createdAt))) issue.push("created_at_missing");
      if (claimed.has(key)) issue.push("duplicate_matrix_slot");
      if (slots.some(x => x.slot === key) && issue.length === 0) claimed.add(key);
      if (issue.length === 0) {
        const scored = scoreBenchmarkReport(report, definition);
        runs.push({ file: label, device, preset, distance, repeat,
          cer: scored.cer.value, keyFieldAccuracy: scored.keyFields.accuracy,
          utteranceCoverage: scored.utteranceCoverage.accuracy,
          clientTiming: scored.captionLatency,
          // Do not infer any acoustic latency or full-session no-clipping proof here.
          acousticLatencyMeasured: false,
        });
      }
    }
    if (issue.length) errors.push(label + ": " + [...new Set(issue)].join(", "));
  }
  const acceptedSlots = new Set(runs.map(x => slot(x.device, x.preset, x.distance, x.repeat)));
  const missing = slots.filter(x => !acceptedSlots.has(x.slot));
  const cells = [];
  for (const device of devices) for (const preset of Object.keys(PRESETS)) for (const distance of DISTANCES) {
    const records = runs.filter(x => x.device === device && x.preset === preset && x.distance === distance);
    cells.push({
      device, preset, distance, n: records.length,
      repeat1: records.find(x => x.repeat === 1)?.file || null,
      repeat2: records.find(x => x.repeat === 2)?.file || null,
      medianCer: records.length === 2 ? median(records.map(x => x.cer)) : null,
      cerRange: records.length === 2 ? [Math.min(...records.map(x => x.cer)), Math.max(...records.map(x => x.cer))] : null,
      medianKeyFieldAccuracy: records.length === 2 ? median(records.map(x => x.keyFieldAccuracy)) : null,
      medianUtteranceCoverage: records.length === 2 ? median(records.map(x => x.utteranceCoverage)) : null,
    });
  }
  if (!runs.length) warnings.push("No valid formal runs. Historical exploratory data are not substituted.");
  warnings.push("Client-observed caption startup telemetry is NOT acoustic speech-onset latency.");
  warnings.push("Manual cutoff/setup/telemetry attestations are not independently instrumented measurements.");
  return {
    schema: "hearlens-m01-batch-summary-v1",
    status: errors.length === 0 && missing.length === 0 && runs.length === 24 ? "COMPLETE" : "INCOMPLETE",
    frozen: { ...frozen, actualSourceHash },
    validRuns: runs.length,
    requiredRuns: 24,
    missing,
    errors,
    warnings,
    cells,
    runs,
  };
}

function cli() {
  const [manifestFile, definitionFile, ...flags] = process.argv.slice(2);
  if (!manifestFile || !definitionFile || flags.some(x => x !== "--preview")) {
    console.error("Usage: node tools/validate-m01-batch.mjs <manifest.json> <short-definition.json> [--preview]");
    process.exitCode = 2;
    return;
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    const definition = JSON.parse(fs.readFileSync(definitionFile, "utf8"));
    const base = path.dirname(path.resolve(manifestFile));
    const sourceBytes = fs.readFileSync(path.resolve(definition.sourceAudio));
    const result = validateM01Batch(manifest, definition,
      file => JSON.parse(fs.readFileSync(path.resolve(base, file), "utf8")), sourceBytes);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    if (result.status !== "COMPLETE" && !flags.includes("--preview")) process.exitCode = 1;
  } catch (error) {
    console.error("M01 batch intake failed: " + error.message);
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) cli();
