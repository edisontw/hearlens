import assert from "node:assert/strict";
import test from "node:test";
import { GeminiLiveTranscribeProvider } from "./gemini-live-transcribe.js";

function fakeTrack() {
  const listeners = new Map();
  return {
    readyState: "live", muted: false, stops: 0,
    addEventListener(event, fn) {
      const callbacks = listeners.get(event) || new Set();
      callbacks.add(fn);
      listeners.set(event, callbacks);
    },
    removeEventListener(event, fn) { listeners.get(event)?.delete(fn); },
    emit(event) { for (const fn of [...(listeners.get(event) || [])]) fn(); },
    stop() { this.stops += 1; this.readyState = "ended"; },
    getSettings() { return { sampleRate: 48000 }; },
    listenerCount(event) { return listeners.get(event)?.size || 0; },
  };
}

class FakeAudioContext {
  constructor() { this.sampleRate = 48000; this.state = "running"; this.closeCalls = 0; }
  createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
  createScriptProcessor() { return { connect() {}, disconnect() {}, onaudioprocess: null }; }
  createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
  async close() { this.closeCalls += 1; this.state = "closed"; }
}

async function withCapture(track, run, options = {}) {
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const oldWindow = globalThis.window;
  const timers = new Map();
  let timerNext = 1;
  const source = { getTracks: () => [track], getAudioTracks: () => [track] };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true, value: { mediaDevices: { getUserMedia: () => Promise.resolve(source) } },
  });
  globalThis.window = {
    AudioContext: FakeAudioContext,
    setTimeout(fn) { const id = timerNext++; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  try {
    const errors = [];
    const provider = new GeminiLiveTranscribeProvider({
      onError(e) { errors.push(e); },
    });
    provider.active = true;
    const epoch = ++provider.startEpoch;
    await provider.startCapture(epoch);
    provider.listeningReady = true;
    return await run({ provider, errors, timers, track });
  } finally {
    if (oldNavigator) Object.defineProperty(globalThis, "navigator", oldNavigator);
    else delete globalThis.navigator;
    globalThis.window = oldWindow;
  }
}

test("device mic ended releases track, closes context and sends one fatal notification", async () => {
  const track = fakeTrack();
  await withCapture(track, async ({ provider, errors }) => {
    const context = provider.audioContext;
    assert.equal(track.listenerCount("ended"), 1);
    track.emit("ended");
    assert.equal(provider.active, false);
    assert.equal(provider.stream, null);
    assert.equal(track.stops, 1);
    assert.equal(context.state, "closed");
    assert.equal(errors.length, 1);
    assert.equal(errors[0].code, "mic-ended");
    assert.equal(errors[0].fatal, true);
    assert.equal(track.listenerCount("ended"), 0);
    track.emit("ended");
    assert.equal(errors.length, 1);
    await provider.dispose();
    assert.equal(track.stops, 1);
    assert.equal(context.closeCalls, 1);
  });
});

test("temporary mic mute followed by unmute does not fail the caption session", async () => {
  const track = fakeTrack();
  await withCapture(track, async ({ provider, errors, timers }) => {
    track.muted = true;
    track.emit("mute");
    assert.equal(timers.size, 1);
    track.muted = false;
    track.emit("unmute");
    assert.equal(timers.size, 0);
    assert.equal(provider.active, true);
    assert.equal(errors.length, 0);
    await provider.dispose();
    assert.equal(track.stops, 1);
  });
});

test("persistent mute after bounded grace stops mic and requires explicit restart", async () => {
  const track = fakeTrack();
  await withCapture(track, async ({ provider, errors, timers }) => {
    track.muted = true;
    track.emit("mute");
    assert.equal(timers.size, 1);
    [...timers.values()][0]();
    assert.equal(provider.active, false);
    assert.equal(provider.stream, null);
    assert.equal(track.stops, 1);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].code, "mic-muted");
    track.emit("unmute");
    assert.equal(errors.length, 1);
  });
});

test("late getUserMedia resolution after dispose stops acquired stream without reinstalling capture", async () => {
  const track = fakeTrack();
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let grant;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true, value: { mediaDevices: { getUserMedia: () => new Promise(resolve => { grant = resolve; }) } },
  });
  try {
    const provider = new GeminiLiveTranscribeProvider();
    provider.active = true;
    const epoch = ++provider.startEpoch;
    const starting = provider.startCapture(epoch);
    await provider.dispose();
    grant({ getTracks: () => [track], getAudioTracks: () => [track] });
    await assert.rejects(starting, /cancelled/);
    assert.equal(track.stops, 1);
    assert.equal(provider.stream, null);
    assert.equal(provider.audioContext, null);
  } finally {
    if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
    else delete globalThis.navigator;
  }
});

test("dispose while fetching Gemini token prevents delayed WebSocket/capture startup", async () => {
  const provider = new GeminiLiveTranscribeProvider();
  let grant;
  let socketStarts = 0;
  provider.fetchToken = () => new Promise(resolve => { grant = resolve; });
  provider.openSocket = async () => { socketStarts += 1; };
  const starting = provider.start();
  await provider.dispose();
  grant("fake-token");
  await assert.rejects(starting, /cancelled/);
  assert.equal(socketStarts, 0);
  assert.equal(provider.active, false);
});
