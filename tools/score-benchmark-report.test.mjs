import assert from "node:assert/strict";
import test from "node:test";

import {
  characterErrorRate,
  normalizeCerText,
  scoreBenchmarkReport,
  scoreKeyFields,
} from "./score-benchmark-report.mjs";

test("CER normalization removes punctuation and whitespace but preserves content", () => {
  assert.equal(normalizeCerText("下午 3 點，見面。"), "下午3點見面");
});

test("CER is zero for identical normalized text", () => {
  const result = characterErrorRate("今天，天氣好。", "今天天氣好");
  assert.equal(result.edits, 0);
  assert.equal(result.cer, 0);
});

test("key fields accept explicitly allowed display variants", () => {
  const result = scoreKeyFields("下午3點見面，房間1208。", [
    { id: "meeting", variants: ["下午三點", "下午3點"] },
    { id: "room", variants: ["一二零八", "1208"] },
    { id: "missing", variants: ["健保卡"] },
  ]);
  assert.equal(result.matched, 2);
  assert.equal(result.total, 3);
  assert.equal(result.accuracy, 2 / 3);
});

test("benchmark report combines strict CER, key fields, and latency", () => {
  const scored = scoreBenchmarkReport(
    {
      buildId: "build-1",
      test: { sourceId: "sample", receiverDevice: "phone", distance: "1 m" },
      runtime: { preset: "auto", captureMode: "raw" },
      captionLatency: { firstPartialMs: 1000 },
      finalTranscript: "下午3點見面",
    },
    {
      sourceId: "sample",
      referenceText: "下午三點見面",
      keyFields: [{ id: "time", variants: ["下午三點", "下午3點"] }],
      utteranceAnchors: [
        { id: "meeting", variants: ["下午三點見面", "下午3點見面"] },
        { id: "missing", variants: ["健保卡"] },
      ],
    },
  );

  assert.equal(scored.cer.edits, 1);
  assert.equal(scored.keyFields.matched, 1);
  assert.equal(scored.utteranceCoverage.matched, 1);
  assert.equal(scored.utteranceCoverage.total, 2);
  assert.equal(scored.utteranceCoverage.missedRate, 0.5);
  assert.equal(scored.captionLatency.firstPartialMs, 1000);
});
