import assert from "node:assert/strict";
import test from "node:test";

import { decodeWebSocketData } from "./gemini-live-wire.mjs";

const SAMPLE = '{"setupComplete":{}}';

test("decodes text WebSocket frames", async () => {
  assert.equal(await decodeWebSocketData(SAMPLE), SAMPLE);
});

test("decodes ArrayBuffer WebSocket frames", async () => {
  const bytes = new TextEncoder().encode(SAMPLE);
  assert.equal(await decodeWebSocketData(bytes.buffer), SAMPLE);
});

test("decodes typed-array WebSocket frames", async () => {
  const bytes = new TextEncoder().encode(SAMPLE);
  assert.equal(await decodeWebSocketData(bytes), SAMPLE);
});

test("decodes Blob WebSocket frames", async () => {
  assert.equal(await decodeWebSocketData(new Blob([SAMPLE])), SAMPLE);
});
