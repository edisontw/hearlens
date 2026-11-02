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
