import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeWav16kMono,
  resampleLinear,
  submitEdisonAudio,
  validateEdisonLocalEndpoint,
  validateEdisonLocalSelection,
} from "./edison-local-asr.mjs";
import { EdisonLocalAsrProvider } from "./edison-local-asr.mjs?v=20261124-edison-local1";
import { createSttProvider, describeSttCapabilities, resolveSttProviderId, STT_PROVIDER_IDS } from "../provider.js";

test("Edison endpoint accepts only loopback HTTP pages and loopback service URLs", () => {
  assert.equal(validateEdisonLocalEndpoint("http://127.0.0.1:8765", "http://localhost:8080/"),
    "http://127.0.0.1:8765");
  assert.equal(validateEdisonLocalEndpoint("http://[::1]:8765", "http://[::1]:8080/"),
    "http://[::1]:8765");
  for (const [endpoint, page] of [
    ["https://127.0.0.1:8765", "http://localhost:8080/"],
    ["http://example.com:8765", "http://localhost:8080/"],
    ["http://127.0.0.1:8765", "https://example.com/"],
    ["http://user@127.0.0.1:8765", "http://localhost:8080/"],
    ["http://127.0.0.1:8765/path", "http://localhost:8080/"],
    ["http://127.0.0.1:8765/?token=x", "http://localhost:8080/"],
  ]) {
    assert.throws(() => validateEdisonLocalEndpoint(endpoint, page));
  }
});

test("browser audio is linearly resampled and encoded as mono 16 kHz PCM WAV", async () => {
  const output = resampleLinear(new Float32Array([0, 0.5, 1, 0.5, 0, -0.5]), 48_000);
  assert.equal(output.length, 2);
  const wav = encodeWav16kMono([new Float32Array([-1, 0, 1])]);
  assert.equal(wav.type, "audio/wav");
  const view = new DataView(await wav.arrayBuffer());
  assert.equal(view.getUint32(24, true), 16_000);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 6);
  assert.deepEqual([view.getInt16(44, true), view.getInt16(46, true), view.getInt16(48, true)],
    [-32768, 0, 32767]);
});

test("Edison submit sends a complete WAV with an allowlisted model and language", async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    return url.endsWith("/health")
      ? { ok: true }
      : { ok: true, json: async () => ({ text: "本機測試", duration: 1, segments: [{ start: 0, end: 1, text: "本機測試" }] }) };
  };
  const wav = encodeWav16kMono([new Float32Array([0, 0.25])]);
  const result = await submitEdisonAudio({ endpoint: "http://127.0.0.1:8765", model: "breeze-asr-26-q5",
    wav, language: "auto", fetchImpl });
  assert.equal(result.text, "本機測試");
  assert.deepEqual(requests.map(request => request.url), [
    "http://127.0.0.1:8765/health", "http://127.0.0.1:8765/v1/audio/transcriptions",
  ]);
  const form = requests[1].options.body;
  assert.equal(form.get("model"), "breeze-asr-26-q5");
  assert.equal(form.get("language"), "auto");
  assert.equal(form.get("response_format"), "verbose_json");
  assert.equal(form.get("file").type, "audio/wav");
  await assert.rejects(() => submitEdisonAudio({ endpoint: "http://127.0.0.1:8765",
    model: "arbitrary-model", wav, fetchImpl }), /不支援所選的 Edison ASR 模型/);
});

test("HearLens exposes Edison only as an opt-in batch provider and preserves Gemini AUTO", () => {
  assert.equal(resolveSttProviderId("auto", "https://example.test/token"), STT_PROVIDER_IDS.GEMINI);
  assert.equal(resolveSttProviderId("edison-local-asr", "https://example.test/token"), "edison-local-asr");
  const provider = createSttProvider({ provider: "edison-local-asr", edisonModel: "qwen3-asr-1.7b-q8" });
  assert.ok(provider instanceof EdisonLocalAsrProvider);
  assert.equal(provider.model, "qwen3-asr-1.7b-q8");
  assert.equal(validateEdisonLocalSelection({ endpoint: "http://127.0.0.1:8765", model: "breeze-asr-26-q5",
    languageMode: "auto", pageUrl: "http://localhost:8080/" }), "http://127.0.0.1:8765");
  assert.throws(() => validateEdisonLocalSelection({ endpoint: "http://127.0.0.1:8765", model: "unknown",
    languageMode: "auto", pageUrl: "http://localhost:8080/" }));
  globalThis.window = {};
  try {
    const capabilities = describeSttCapabilities();
    assert.equal(capabilities.edisonLocalBatch, true);
    assert.equal(capabilities.edisonLocalStreaming, false);
  } finally {
    delete globalThis.window;
  }
});
