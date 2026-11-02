import test from "node:test";
import assert from "node:assert/strict";
import { BrowserSpeechProvider } from "./browser-speech.js";

function fakeSpeech() {
  const original = globalThis.window;
  const instances = [];
  const timers = new Map();
  let id = 0;
  class Recognition {
    constructor() { instances.push(this); }
    start() {}
    stop() { this.onend?.(); }
    abort() { this.onend?.(); }
  }
  globalThis.window = {
    SpeechRecognition: Recognition,
    setTimeout(fn) { const key = ++id; timers.set(key, fn); return key; },
    clearTimeout(key) { timers.delete(key); },
  };
  return { instances, timers, restore() { globalThis.window = original; } };
}

test("terminal SpeechRecognition errors never auto-restart and signal fatal cleanup", async () => {
  const f = fakeSpeech();
  try {
    for (const code of ["not-allowed", "service-not-allowed", "audio-capture", "language-not-supported"]) {
      const errors = [];
      const provider = new BrowserSpeechProvider({ onError: e => errors.push(e) });
      await provider.start();
      const recognition = f.instances.at(-1);
      recognition.onerror({ error: code });
      assert.equal(provider.active, false, code);
      assert.equal(errors.length, 1);
      assert.equal(errors[0].fatal, true, code);
      assert.equal(errors[0].code, code);
      assert.match(errors[0].message, /請|不支援/);
      recognition.onend();
      assert.equal(f.timers.size, 0, code + " must not restart");
      await provider.dispose();
      recognition.onerror({ error: code });
      assert.equal(errors.length, 1, "stale error must be ignored");
    }
  } finally { f.restore(); }
});

test("transient no-speech still retries, but stop ignores late aborted error", async () => {
  const f = fakeSpeech();
  try {
    const errors = [];
    const provider = new BrowserSpeechProvider({ onError: e => errors.push(e) });
    await provider.start();
    f.instances[0].onerror({ error: "no-speech" });
    assert.equal(errors[0].fatal, false);
    assert.equal(provider.active, true);
    f.instances[0].onend();
    assert.equal(f.timers.size, 1);
    const [key, restart] = f.timers.entries().next().value;
    f.timers.delete(key);
    restart();
    assert.equal(f.instances.length, 2);
    await provider.dispose();
    f.instances[1].onerror({ error: "aborted" });
    assert.equal(errors.length, 1);
    assert.equal(f.timers.size, 0);
  } finally { f.restore(); }
});

test("synchronous recognition start failure is terminal, not an endless retry loop", async () => {
  const f = fakeSpeech();
  try {
    let attempts = 0;
    globalThis.window.SpeechRecognition = class {
      start() { attempts += 1; throw new Error("synthetic start rejection"); }
      abort() { this.onend?.(); }
    };
    const errors = [];
    const provider = new BrowserSpeechProvider({ onError: event => errors.push(event) });
    await provider.start();
    assert.equal(attempts, 1);
    assert.equal(provider.active, false, "failed recognizer must not remain active");
    assert.equal(f.timers.size, 0, "no repeating 800-ms restart timer");
    assert.equal(errors.length, 1);
    assert.equal(errors[0].code, "start-failed");
    assert.equal(errors[0].fatal, true);
    assert.match(errors[0].message, /瀏覽器語音辨識無法啟動/);
    await provider.dispose();
    assert.equal(f.timers.size, 0);
  } finally { f.restore(); }
});

test("stale segment callbacks cannot erase current captions or start duplicate recognizers", async () => {
  const f = fakeSpeech();
  try {
    const partials = [];
    const finals = [];
    const provider = new BrowserSpeechProvider({
      onPartial: event => partials.push(event.text),
      onFinal: event => finals.push(event.text),
    });
    await provider.start();
    const oldSegment = f.instances[0];
    oldSegment.onend();
    assert.equal(f.timers.size, 1, "normal segment end schedules one restart");
    const [key, restart] = f.timers.entries().next().value;
    f.timers.delete(key);
    restart();
    const currentSegment = f.instances[1];
    assert.equal(provider.recognition, currentSegment);

    currentSegment.onresult({
      resultIndex: 0,
      results: [{ 0: { transcript: "新段落暫存" }, isFinal: false }],
    });
    assert.equal(partials.at(-1), "新段落暫存");
    const partialCount = partials.length;

    // The retired recognizer can deliver a delayed final, start or duplicate
    // end after its replacement is already active. None belongs to the new
    // conversation segment or should start a third recognizer.
    oldSegment.onresult({
      resultIndex: 0,
      results: [{ 0: { transcript: "過期結果" }, isFinal: true }],
    });
    oldSegment.onstart();
    oldSegment.onend();
    assert.equal(finals.length, 0, "stale final must not enter history");
    assert.equal(partials.length, partialCount, "stale end must not erase current interim");
    assert.equal(f.timers.size, 0, "stale end must not schedule another restart");
    assert.equal(provider.recognition, currentSegment);

    currentSegment.onresult({
      resultIndex: 0,
      results: [{ 0: { transcript: "新段落已確認" }, isFinal: true }],
    });
    assert.deepEqual(finals, ["新段落已確認"]);
    await provider.dispose();
  } finally { f.restore(); }
});
