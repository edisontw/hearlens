import assert from "node:assert/strict";
import test from "node:test";

import {
  captionLatencySnapshot,
  createCaptionLatencyTelemetry,
  markFirstAudioChunk,
  markFirstFinal,
  markFirstPartial,
} from "./caption-latency.mjs";

test("caption latency uses first audio chunk as the preferred reference", () => {
  const telemetry = createCaptionLatencyTelemetry(1_000);
  markFirstAudioChunk(telemetry, 1_300);
  markFirstPartial(telemetry, 1_900);
  markFirstFinal(telemetry, 2_500);

  assert.deepEqual(captionLatencySnapshot(telemetry), {
    reference: "first-audio-chunk",
    firstPartialMs: 600,
    firstFinalMs: 1_200,
    firstPartialFromSessionMs: 900,
    firstFinalFromSessionMs: 1_500,
    audioStartupMs: 300,
  });
});

test("caption latency falls back to session start when audio telemetry is unavailable", () => {
  const telemetry = createCaptionLatencyTelemetry(2_000);
  markFirstPartial(telemetry, 2_400);
  markFirstFinal(telemetry, 2_800);

  const snapshot = captionLatencySnapshot(telemetry);
  assert.equal(snapshot.reference, "session-start");
  assert.equal(snapshot.firstPartialMs, 400);
  assert.equal(snapshot.firstFinalMs, 800);
  assert.equal(snapshot.audioStartupMs, null);
});

test("first-event markers are immutable after the first observation", () => {
  const telemetry = createCaptionLatencyTelemetry(0);
  markFirstAudioChunk(telemetry, 100);
  markFirstAudioChunk(telemetry, 200);
  markFirstPartial(telemetry, 300);
  markFirstPartial(telemetry, 400);
  markFirstFinal(telemetry, 500);
  markFirstFinal(telemetry, 600);

  assert.equal(telemetry.firstAudioChunkAt, 100);
  assert.equal(telemetry.firstPartialAt, 300);
  assert.equal(telemetry.firstFinalAt, 500);
});
