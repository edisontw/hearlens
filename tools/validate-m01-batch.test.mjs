import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { validateM01Batch } from "./validate-m01-batch.mjs";

const definition = JSON.parse(readFileSync("testdata/benchmark/zh-tw-regression-v2-short.json", "utf8"));
const sourceBytes = readFileSync(definition.sourceAudio);
const sha = "cdd7b9d8d1c94d1f254d7c9fe20b598e1e99982fb1bd96e3555c823ca32b77da";
const deviceNames = ["iPhone reference", "HTC U23"];
function validSet() {
  const reports = {};
  const entries = [];
  for (const device of deviceNames) for (const preset of ["auto", "far-noisy"])
    for (const distance of ["0.5m", "1m", "2m"]) for (const repeat of [1, 2]) {
      const file = "synthetic-" + entries.length + ".json";
      reports[file] = {
        schema: "hearlens-test-report-v1",
        buildId: "frozen-web-build",
        createdAt: "2026-10-13T01:00:00Z",
        sessionId: 1,
        test: { sourceId: "zh-tw-regression-v2", receiverDevice: device,
          distance, sourceVolume: "40", notes: "synthetic fixture, same room and position" },
        runtime: { provider: "gemini-live-transcribe",
          resolvedProvider: "gemini-live-transcribe",
          inputMode: "adaptive", inputGain: null,
          tuningProfile: { enabled: false },
          preset, captureMode: preset === "auto" ? "raw" : "voice" },
        finalTranscript: definition.referenceText,
        eventLog: ["synthetic level logging fixture"],
        captionLatency: { firstPartialFromAudioMs: 123 },
      };
      entries.push({ file, repeat, cutoffConfirmed: true, setupConfirmed: true, telemetryReviewed: true });
    }
  const manifest = {
    schema: "hearlens-m01-batch-manifest-v1",
    devices: deviceNames,
    frozen: { mainSha: "04836999c48612afed42ef38e6eb16c4a536816d",
      buildId: "frozen-web-build",
      provider: "gemini-live-transcribe", sourceVolume: "40", sourceSha256: sha },
    runs: entries,
  };
  function evaluate(bytes = sourceBytes) {
    return validateM01Batch(manifest, definition, file => {
      if (!(file in reports)) throw Error("missing file");
      return reports[file];
    }, bytes);
  }
  return { manifest, reports, evaluate };
}

test("24 synthetic complete runs are grouped 2 x 2 x 3 with both repeats", () => {
  const a = validSet();
  const b = a.evaluate();
  assert.equal(b.status, "COMPLETE");
  assert.equal(b.validRuns, 24);
  assert.equal(b.missing.length, 0);
  assert.equal(b.errors.length, 0);
  assert.equal(b.cells.length, 12);
  assert(b.cells.every(c => c.n === 2 && c.medianCer === 0));
  assert(b.runs.every(r => r.acousticLatencyMeasured === false));
});

test("empty manifest must not promote old exploratory runs", () => {
  const a = validSet();
  a.manifest.runs = [];
  const b = a.evaluate();
  assert.equal(b.status, "INCOMPLETE");
  assert.equal(b.validRuns, 0);
  assert.equal(b.missing.length, 24);
  assert.equal(b.cells[0].medianCer, null);
});

test("invalid/missing metadata, manual attestations and custom tuning block formal inclusion", () => {
  const a = validSet();
  a.reports["synthetic-0.json"].test.sourceVolume = null;
  a.reports["synthetic-1.json"].test.notes = null;
  a.reports["synthetic-2.json"].runtime.tuningProfile.enabled = true;
  a.reports["synthetic-3.json"].runtime.captureMode = "voice";
  a.reports["synthetic-4.json"].runtime.preset = "custom";
  a.reports["synthetic-5.json"].eventLog = [];
  a.manifest.runs[6].cutoffConfirmed = false;
  a.manifest.runs[7].telemetryReviewed = false;
  a.manifest.runs[8].setupConfirmed = false;
  const result = a.evaluate();
  assert.equal(result.status, "INCOMPLETE");
  assert.equal(result.validRuns, 15);
  assert.equal(result.missing.length, 9);
  const messages = result.errors.join(" ");
  for (const str of ["volume_missing_or_changed", "environment_or_orientation_note_missing",
      "nondefault_gain_or_tuning", "capture_mode_mismatch",
      "preset_wrong_or_custom", "event_log_missing",
      "section3_cutoff_not_confirmed", "telemetry_not_reviewed",
      "controlled_setup_not_confirmed"]) assert(messages.includes(str), str);
});

test("duplicate file, duplicate matrix slot, dropped repeat and unknown phone cannot PASS", () => {
  const a = validSet();
  a.manifest.runs[1].file = a.manifest.runs[0].file;
  const b = a.evaluate();
  assert.equal(b.status, "INCOMPLETE");
  assert(b.errors.some(x => x.includes("duplicate_report_file")));
  assert(b.errors.some(x => x.includes("duplicate_matrix_slot")));
  const c = validSet();
  c.reports["synthetic-0.json"].test.receiverDevice = "unregistered";
  assert(c.evaluate().errors.some(x => x.includes("receiver_label_missing_or_wrong")));
  const d = validSet();
  d.manifest.runs.pop();
  assert.equal(d.evaluate().missing.length, 1);
});

test("wrong source bytes or unpinned frozen metadata always blocks formal completion", () => {
  const a = validSet();
  assert(a.evaluate(Buffer.from("wrong source")).errors.includes("source_wav_hash_missing_or_mismatch"));
  a.manifest.frozen.mainSha = "<TBD>";
  assert(a.evaluate().errors.includes("main_sha_not_pinned"));
  a.manifest.frozen.mainSha = "04836999c48612afed42ef38e6eb16c4a536816d";
  a.reports["synthetic-0.json"].buildId = "different-build";
  assert(a.evaluate().errors.some(x => x.includes("mixed_web_build")));
});

test("short scoring definition and source IDs are not implicitly interchangeable", () => {
  const a = validSet();
  a.reports["synthetic-0.json"].test.sourceId = definition.sourceId;
  assert(a.evaluate().errors.some(x => x.includes("incorrect_report_source_id")));
  const unknown = { ...definition, sourceId: "other-source" };
  const z = validateM01Batch(a.manifest, unknown, file => a.reports[file], sourceBytes);
  assert(z.errors.includes("definition_source_mismatch"));
});
