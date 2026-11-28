import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeWav16kMono,
  ensureEdisonModelLoaded,
  removeTranscriptOverlap,
  resampleLinear,
  submitEdisonAudio,
  validateEdisonLocalEndpoint,
  validateEdisonLocalSelection,
} from "./edison-local-asr.mjs";
import { EdisonLocalAsrProvider } from "./edison-local-asr.mjs?v=20261128-edison-segment-offset1";
import { createSttProvider, describeSttCapabilities, resolveSttProviderId, STT_PROVIDER_IDS } from "../provider.js";

test("Edison endpoint matches its configured IPv4 loopback listener", () => {
  assert.equal(validateEdisonLocalEndpoint("http://127.0.0.1:8765", "http://localhost:8080/"),
    "http://127.0.0.1:8765");
  for (const [endpoint, page] of [
    ["https://127.0.0.1:8765", "http://localhost:8080/"],
    ["http://example.com:8765", "http://localhost:8080/"],
    ["http://localhost:8765", "http://localhost:8080/"],
    ["http://[::1]:8765", "http://localhost:8080/"],
    ["http://127.0.0.1:8765", "https://example.com/"],
    ["http://user@127.0.0.1:8765", "http://localhost:8080/"],
    ["http://127.0.0.1:8765/path", "http://localhost:8080/"],
    ["http://127.0.0.1:8765/?token=x", "http://localhost:8080/"],
  ]) {
    assert.throws(() => validateEdisonLocalEndpoint(endpoint, page));
  }
});

test("Edison CrispASR is GPU-checked and preloaded before local microphone capture", async () => {
  const requests = [];
  let reads = 0;
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if (options.method === "POST") return { ok: true, json: async () => ({ state: "loading" }) };
    reads += 1;
    return { ok: true, json: async () => reads === 1
      ? { status: "not_started", active_model_id: null }
      : { status: "available", active_model_id: "breeze-asr-26-q5" } };
  };
  const states = [];
  const state = await ensureEdisonModelLoaded({ endpoint: "http://127.0.0.1:8765", model: "breeze-asr-26-q5",
    fetchImpl, onStatus: value => states.push(value), pollIntervalMs: 1, timeoutMs: 100 });
  assert.equal(state.status, "available");
  assert.deepEqual(requests.map(request => request.options.method || "GET"), ["GET", "POST", "GET"]);
  assert.equal(requests[1].url, "http://127.0.0.1:8765/api/v1/asr/models/breeze-asr-26-q5/load");
  assert.ok(states.some(value => value.state === "loading"));
});

test("Edison preload refuses unavailable models and defers Whisper to its managed worker", async () => {
  await assert.rejects(() => ensureEdisonModelLoaded({ endpoint: "http://127.0.0.1:8765",
    model: "qwen3-asr-1.7b-q8", fetchImpl: async () => ({ ok: false, json: async () => ({ detail: "VRAM不足" }) }) }), /VRAM不足/);
  const whisper = await ensureEdisonModelLoaded({ endpoint: "http://127.0.0.1:8765", model: "whisper-large-v3-turbo" });
  assert.equal(whisper.state, "deferred");
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

test("overlap dedupe removes repeated Chinese and English text without changing new words", () => {
  assert.equal(removeTranscriptOverlap("世界再見", "你好世界"), "再見");
  assert.equal(removeTranscriptOverlap("again today", "hello again"), "today");
  assert.equal(removeTranscriptOverlap("全新句子", "上一句"), "全新句子");
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

test("Edison submit accepts an explicit no-speech result without inventing caption text", async () => {
  const fetchImpl = async url => url.endsWith("/health")
    ? { ok: true }
    : { ok: true, json: async () => ({ text: "", segments: [], no_speech: true }) };
  const result = await submitEdisonAudio({ endpoint: "http://127.0.0.1:8765", model: "breeze-asr-26-q5",
    wav: encodeWav16kMono([new Float32Array([0, 0])]), fetchImpl });
  assert.equal(result.no_speech, true);
  assert.equal(result.text, "");
});

test("Edison segment timestamps stay within the submitted audio window", async () => {
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  const finals = [];
  globalThis.window = { setTimeout, clearTimeout };
  globalThis.fetch = async url => url.endsWith("/health")
    ? { ok: true }
    : { ok: true, json: async () => ({ text: "alpha bravo charlie", duration: 1, segments: [
      { start: "invalid", text: "alpha" },
      { start: -2, text: "bravo" },
      { start: 2, text: "charlie" },
    ] }) };
  const provider = new EdisonLocalAsrProvider({ onFinal: value => finals.push(value) });
  provider.pendingSegments.push({ chunks: [new Float32Array([0.25])], duration: 1, timestamp: 1234 });
  try {
    await provider.drainQueue();
    assert.deepEqual(finals.map(value => value.text), ["alpha", "bravo", "charlie"]);
    assert.deepEqual(finals.map(value => value.timestamp), [1234, 1234, 2234]);
  } finally {
    await provider.dispose();
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }
});

test("Edison offline errors are actionable and never trigger a cloud fallback", async () => {
  await assert.rejects(() => submitEdisonAudio({ endpoint: "http://127.0.0.1:8765", model: "breeze-asr-26-q5",
    wav: encodeWav16kMono([new Float32Array([0, 0])]), fetchImpl: async () => { throw new TypeError("Failed to fetch"); } }),
  /無法連線至 Edison 本機服務.*未轉送雲端/);
  let count = 0;
  await assert.rejects(() => submitEdisonAudio({ endpoint: "http://127.0.0.1:8765", model: "breeze-asr-26-q5",
    wav: encodeWav16kMono([new Float32Array([0, 0])]), fetchImpl: async () => {
      count += 1;
      if (count === 1) return { ok: true };
      throw new TypeError("Failed to fetch");
    } }), /Edison 本機服務連線中斷.*未轉送雲端/);
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

test("Edison local provider sends VAD-delimited microphone segments while listening", async () => {
  const previousWindow = globalThis.window;
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let processor;
  const stoppedTracks = { count: 0 };
  class FakeNode {
    connect() {}
    disconnect() {}
  }
  class FakeAudioContext {
    constructor() { this.sampleRate = 16_000; this.state = "running"; }
    createMediaStreamSource() { return new FakeNode(); }
    createScriptProcessor() { processor = new FakeNode(); return processor; }
    createGain() { const node = new FakeNode(); node.gain = { value: 1 }; return node; }
    async resume() {}
    async close() { this.state = "closed"; }
  }
  globalThis.window = {
    location: { href: "http://localhost:8080/" },
    AudioContext: FakeAudioContext,
    setTimeout,
    clearTimeout,
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { mediaDevices: { getUserMedia: async () => ({
      getTracks: () => [{ stop: () => { stoppedTracks.count += 1; } }],
    }) } },
  });
  const requests = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (url.endsWith("/health")) return { ok: true };
    if (url.endsWith("/api/v1/asr/status")) return { ok: true, json: async () => ({ status: "available",
      active_model_id: "breeze-asr-26-q5" }) };
    return { ok: true, json: async () => ({ text: "本機字幕測試", duration: 1.5,
        segments: [{ start: 0, end: 1.5, text: "本機字幕測試" }] }) };
  };
  const finals = [];
  const statuses = [];
  try {
    const provider = new EdisonLocalAsrProvider({
      endpoint: "http://127.0.0.1:8765",
      model: "breeze-asr-26-q5",
      onFinal: value => finals.push(value),
      onStatus: value => statuses.push(value),
    });
    await provider.start();
    const voice = new Float32Array(4096);
    for (let i = 0; i < voice.length; i += 1) voice[i] = Math.sin(i * 0.12) * 0.2;
    const silence = new Float32Array(4096);
    const emit = samples => processor.onaudioprocess({ inputBuffer: { getChannelData: () => samples } });
    for (let i = 0; i < 4; i += 1) emit(voice);
    emit(silence);
    emit(silence);
    await provider.stop();
    assert.equal(requests.filter(item => item.url.endsWith("/v1/audio/transcriptions")).length, 1);
    assert.equal(requests.filter(item => item.url.endsWith("/api/v1/asr/status")).length, 1);
    assert.equal(requests.filter(item => item.url.includes("/models/") && item.url.endsWith("/load")).length, 0);
    assert.equal(finals[0]?.text, "本機字幕測試");
    assert.ok(statuses.some(value => value.state === "processing"));
    assert.ok(statuses.some(value => value.state === "stopped"));
    assert.equal(stoppedTracks.count, 1);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
    if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
    else delete globalThis.navigator;
  }
});

test("a long pause after a maximum segment does not prepend stale speech to the next utterance", async () => {
  const previousWindow = globalThis.window;
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const previousFetch = globalThis.fetch;
  let processor;
  const submittedFirstSamples = [];
  class FakeNode { connect() {} disconnect() {} }
  class FakeAudioContext {
    constructor() { this.sampleRate = 16_000; this.state = "running"; }
    createMediaStreamSource() { return new FakeNode(); }
    createScriptProcessor() { processor = new FakeNode(); return processor; }
    createGain() { return Object.assign(new FakeNode(), { gain: { value: 1 } }); }
    async resume() {}
    async close() { this.state = "closed"; }
  }
  globalThis.window = {
    location: { href: "http://localhost:8080/" },
    AudioContext: FakeAudioContext,
    setTimeout,
    clearTimeout,
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } },
  });
  globalThis.fetch = async (url, options = {}) => {
    if (url.endsWith("/health")) return { ok: true };
    if (url.endsWith("/api/v1/asr/status")) {
      return { ok: true, json: async () => ({ status: "available", active_model_id: "breeze-asr-26-q5" }) };
    }
    if (url.endsWith("/v1/audio/transcriptions")) {
      const wav = options.body.get("file");
      const view = new DataView(await wav.arrayBuffer());
      submittedFirstSamples.push(view.getInt16(44, true));
      return { ok: true, json: async () => ({ text: "合成字幕", segments: [{ start: 0, end: 1, text: "合成字幕" }] }) };
    }
    throw new Error(`unexpected request: ${url}`);
  };
  let provider;
  try {
    provider = new EdisonLocalAsrProvider({ endpoint: "http://127.0.0.1:8765", model: "breeze-asr-26-q5" });
    await provider.start();
    const voice = new Float32Array(4096).fill(0.25);
    const silence = new Float32Array(4096);
    const emit = samples => processor.onaudioprocess({ inputBuffer: { getChannelData: () => samples } });

    for (let i = 0; i < 10; i += 1) emit(voice);
    await provider.drainQueue();
    emit(silence);
    emit(silence);
    emit(voice);
    emit(silence);
    emit(silence);
    await provider.drainQueue();

    assert.equal(submittedFirstSamples.length, 2);
    assert.equal(submittedFirstSamples[1], 0,
      "a new utterance after the VAD hangover starts with its silent pre-roll, not the prior segment overlap");
  } finally {
    await provider?.dispose();
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
    if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
    else delete globalThis.navigator;
  }
});

test("stopping during startup aborts health checks without reporting an error", async () => {
  const previousWindow = globalThis.window;
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const previousFetch = globalThis.fetch;
  let healthSignal;
  let healthStartedResolve;
  const healthStarted = new Promise(resolve => { healthStartedResolve = resolve; });
  globalThis.window = { location: { href: "http://localhost:8080/" }, AudioContext: class {}, setTimeout, clearTimeout };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { mediaDevices: { getUserMedia: async () => { throw new Error("must not request microphone"); } } },
  });
  globalThis.fetch = (url, options = {}) => {
    if (url.endsWith("/health")) {
      healthSignal = options.signal;
      healthStartedResolve();
      return new Promise((resolve, reject) => options.signal.addEventListener("abort", () => {
        reject(new DOMException("aborted", "AbortError"));
      }, { once: true }));
    }
    throw new Error(`unexpected request: ${url}`);
  };
  const statuses = [];
  const errors = [];
  try {
    const provider = new EdisonLocalAsrProvider({
      endpoint: "http://127.0.0.1:8765",
      model: "breeze-asr-26-q5",
      onStatus: value => statuses.push(value),
      onError: value => errors.push(value),
    });
    const starting = provider.start();
    await healthStarted;
    await provider.stop();
    await starting;
    assert.equal(healthSignal.aborted, true);
    assert.equal(provider.active, false);
    assert.ok(statuses.some(value => value.state === "stopped"));
    assert.equal(errors.length, 0);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
    if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
    else delete globalThis.navigator;
  }
});

test("stopping during microphone permission stops a stream granted later", async () => {
  const previousWindow = globalThis.window;
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const previousFetch = globalThis.fetch;
  let resolveStream;
  let getUserMediaStartedResolve;
  const getUserMediaStarted = new Promise(resolve => { getUserMediaStartedResolve = resolve; });
  let stoppedTracks = 0;
  let contextsCreated = 0;
  class FakeNode { connect() {} disconnect() {} }
  class FakeAudioContext {
    constructor() { contextsCreated += 1; this.sampleRate = 16_000; this.state = "running"; }
    createMediaStreamSource() { return new FakeNode(); }
    createScriptProcessor() { return new FakeNode(); }
    createGain() { return Object.assign(new FakeNode(), { gain: { value: 1 } }); }
    async resume() {}
    async close() { this.state = "closed"; }
  }
  globalThis.window = { location: { href: "http://localhost:8080/" }, AudioContext: FakeAudioContext, setTimeout, clearTimeout };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { mediaDevices: { getUserMedia: () => {
      getUserMediaStartedResolve();
      return new Promise(resolve => { resolveStream = resolve; });
    } } },
  });
  globalThis.fetch = async url => url.endsWith("/health")
    ? { ok: true }
    : { ok: true, json: async () => ({ status: "available", active_model_id: "breeze-asr-26-q5" }) };
  const statuses = [];
  try {
    const provider = new EdisonLocalAsrProvider({
      endpoint: "http://127.0.0.1:8765",
      model: "breeze-asr-26-q5",
      onStatus: value => statuses.push(value),
    });
    const starting = provider.start();
    await getUserMediaStarted;
    await provider.stop();
    resolveStream({ getTracks: () => [{ stop: () => { stoppedTracks += 1; } }] });
    await starting;
    assert.equal(stoppedTracks, 1);
    assert.equal(contextsCreated, 0);
    assert.equal(provider.active, false);
    assert.ok(statuses.some(value => value.state === "stopped"));
    assert.equal(statuses.some(value => value.state === "listening"), false);
  } finally {
    if (resolveStream && stoppedTracks === 0) resolveStream({ getTracks: () => [{ stop: () => { stoppedTracks += 1; } }] });
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
    if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
    else delete globalThis.navigator;
  }
});

test("dispose drains an aborted generation before restart and ignores its late transcript", async () => {
  const previousWindow = globalThis.window;
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const previousFetch = globalThis.fetch;
  let resolveTranscription;
  let requestStartedResolve;
  const requestStarted = new Promise(resolve => { requestStartedResolve = resolve; });
  let transcriptionSignal;
  let stoppedTracks = 0;
  let disposeFinished = false;
  let drainPromise;
  let disposePromise;
  class FakeNode { connect() {} disconnect() {} }
  class FakeAudioContext {
    constructor() { this.sampleRate = 16_000; this.state = "running"; }
    createMediaStreamSource() { return new FakeNode(); }
    createScriptProcessor() { return new FakeNode(); }
    createGain() { return Object.assign(new FakeNode(), { gain: { value: 1 } }); }
    async resume() {}
    async close() { this.state = "closed"; }
  }
  globalThis.window = { location: { href: "http://localhost:8080/" }, AudioContext: FakeAudioContext, setTimeout, clearTimeout };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { mediaDevices: { getUserMedia: async () => ({
      getTracks: () => [{ stop: () => { stoppedTracks += 1; } }],
    }) } },
  });
  globalThis.fetch = async (url, options = {}) => {
    if (url.endsWith("/health")) return { ok: true };
    if (url.endsWith("/api/v1/asr/status")) {
      return { ok: true, json: async () => ({ status: "available", active_model_id: "breeze-asr-26-q5" }) };
    }
    if (url.endsWith("/v1/audio/transcriptions")) {
      transcriptionSignal = options.signal;
      requestStartedResolve();
      return new Promise(resolve => { resolveTranscription = resolve; });
    }
    throw new Error(`unexpected request: ${url}`);
  };
  const finals = [];
  try {
    const provider = new EdisonLocalAsrProvider({
      endpoint: "http://127.0.0.1:8765",
      model: "breeze-asr-26-q5",
      onFinal: value => finals.push(value),
    });
    provider.pendingSegments.push({
      chunks: [new Float32Array([0.25, 0.5])],
      duration: 2 / 16_000,
      timestamp: 1234,
    });
    drainPromise = provider.drainQueue();
    await requestStarted;
    disposePromise = provider.dispose().then(() => { disposeFinished = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(transcriptionSignal.aborted, true);
    assert.equal(disposeFinished, false);

    resolveTranscription({ ok: true, json: async () => ({
      text: "過期世代字幕",
      duration: 1,
      segments: [{ start: 0, end: 1, text: "過期世代字幕" }],
    }) });
    await Promise.all([drainPromise, disposePromise]);
    assert.equal(provider.drainPromise, null);
    assert.deepEqual(finals, []);

    await provider.start();
    assert.equal(provider.active, true);
    assert.deepEqual(finals, []);
    await provider.dispose();
    assert.equal(stoppedTracks, 1);
  } finally {
    if (resolveTranscription) resolveTranscription({ ok: true, json: async () => ({ text: "late" }) });
    if (disposePromise) await disposePromise;
    if (drainPromise) await drainPromise;
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
    if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
    else delete globalThis.navigator;
  }
});

test("a failed local request fail-stops without retry, then an explicit restart recovers cleanly", async () => {
  const previousWindow = globalThis.window;
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const previousFetch = globalThis.fetch;
  let transcriptionCalls = 0;
  let getUserMediaCalls = 0;
  let stoppedTracks = 0;
  let closedContexts = 0;
  class FakeNode { connect() {} disconnect() {} }
  class FakeAudioContext {
    constructor() { this.sampleRate = 16_000; this.state = "running"; }
    createMediaStreamSource() { return new FakeNode(); }
    createScriptProcessor() { return new FakeNode(); }
    createGain() { return Object.assign(new FakeNode(), { gain: { value: 1 } }); }
    async resume() {}
    async close() { this.state = "closed"; closedContexts += 1; }
  }
  globalThis.window = { location: { href: "http://localhost:8080/" }, AudioContext: FakeAudioContext, setTimeout, clearTimeout };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { mediaDevices: { getUserMedia: async () => {
      getUserMediaCalls += 1;
      return { getTracks: () => [{ stop: () => { stoppedTracks += 1; } }] };
    } } },
  });
  globalThis.fetch = async (url) => {
    if (url.endsWith("/health")) return { ok: true };
    if (url.endsWith("/api/v1/asr/status")) {
      return { ok: true, json: async () => ({ status: "available", active_model_id: "breeze-asr-26-q5" }) };
    }
    if (url.endsWith("/v1/audio/transcriptions")) {
      transcriptionCalls += 1;
      if (transcriptionCalls === 1) {
        return { ok: true, json: async () => ({ text: "上一段字幕", segments: [{ start: 0, end: 1, text: "上一段字幕" }] }) };
      }
      if (transcriptionCalls === 2) {
        return { ok: false, json: async () => ({ detail: "Edison 本機服務正在重新啟動" }) };
      }
      return { ok: true, json: async () => ({ text: "上一段字幕與新內容", segments: [{ start: 0, end: 1, text: "上一段字幕與新內容" }] }) };
    }
    throw new Error(`unexpected request: ${url}`);
  };
  const finals = [];
  const errors = [];
  try {
    const provider = new EdisonLocalAsrProvider({
      endpoint: "http://127.0.0.1:8765",
      model: "breeze-asr-26-q5",
      onFinal: value => finals.push(value),
      onError: value => errors.push(value),
    });
    const queueSegment = text => provider.pendingSegments.push({
      chunks: [new Float32Array([0.25, 0.5])],
      duration: 2 / 16_000,
      timestamp: 1234 + text.length,
    });

    await provider.start();
    queueSegment("first");
    await provider.drainQueue();
    assert.deepEqual(finals.map(item => item.text), ["上一段字幕"]);

    queueSegment("failure");
    await provider.drainQueue();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(transcriptionCalls, 2, "a failed segment is not automatically retried");
    assert.equal(provider.active, false);
    assert.equal(provider.fatalError, true);
    assert.equal(provider.pendingSegments.length, 0);
    assert.equal(stoppedTracks, 1, "the failed session releases its capture");
    assert.equal(errors.length, 1);
    assert.equal(errors[0].fatal, true);
    assert.match(errors[0].message, /正在重新啟動/);

    await provider.start();
    assert.equal(provider.active, true);
    queueSegment("recovered");
    await provider.drainQueue();
    assert.deepEqual(finals.map(item => item.text), ["上一段字幕", "上一段字幕與新內容"],
      "the new session does not deduplicate against the prior session's transcript");
    assert.equal(transcriptionCalls, 3);
    assert.equal(getUserMediaCalls, 2, "capture resumes only after explicit start");
    assert.equal(errors.length, 1, "recovery does not erase the prior failure evidence");

    await provider.dispose();
    assert.equal(stoppedTracks, 2);
    assert.equal(closedContexts, 2);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
    if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
    else delete globalThis.navigator;
  }
});
