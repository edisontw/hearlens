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

test("stalled Gemini token request aborts after timeout and allows a clean manual retry", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const timers = new Map();
  let nextId = 1;
  let requestSignal;
  globalThis.window = {
    location: { href: "https://edisontw.github.io/hearlens/" },
    setTimeout(fn) { const id = nextId++; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  globalThis.fetch = (_url, options) => {
    requestSignal = options.signal;
    return new Promise((_resolve, reject) => {
      requestSignal.addEventListener("abort", () => {
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      }, { once: true });
    });
  };
  try {
    const provider = new GeminiLiveTranscribeProvider({
      tokenUrl: "https://example.test/token",
    });
    const starting = provider.start();
    assert.equal(timers.size, 1, "token request has one bounded timeout");
    assert.equal(requestSignal.aborted, false);
    [...timers.values()][0]();
    await assert.rejects(starting, /Gemini 字幕連線憑證逾時/);
    assert.equal(requestSignal.aborted, true);
    assert.equal(provider.active, false);
    assert.equal(provider.socket, null);
    assert.equal(provider.stream, null);
    assert.equal(provider.tokenAbortController, null);
    assert.equal(timers.size, 0, "timeout is cleared after failure");
  } finally {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test("disposing during Gemini token fetch aborts pending network request without opening capture", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const timers = new Map();
  let nextId = 1;
  let requestSignal;
  globalThis.window = {
    location: { href: "https://edisontw.github.io/hearlens/" },
    setTimeout(fn) { const id = nextId++; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  globalThis.fetch = (_url, options) => {
    requestSignal = options.signal;
    return new Promise((_resolve, reject) => {
      requestSignal.addEventListener("abort", () => {
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      }, { once: true });
    });
  };
  try {
    const provider = new GeminiLiveTranscribeProvider({
      tokenUrl: "https://example.test/token",
    });
    const starting = provider.start();
    await provider.dispose();
    await assert.rejects(starting, /startup cancelled/i);
    assert.equal(requestSignal.aborted, true);
    assert.equal(provider.active, false);
    assert.equal(provider.socket, null);
    assert.equal(provider.tokenAbortController, null);
    assert.equal(timers.size, 0);
  } finally {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test("successful Gemini token response clears the pending timeout", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const timers = new Map();
  let nextId = 1;
  globalThis.window = {
    location: { href: "https://edisontw.github.io/hearlens/" },
    setTimeout(fn) { const id = nextId++; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.signal.aborted, false);
    return new Response(JSON.stringify({ token: "synthetic-ephemeral-token" }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  };
  try {
    const provider = new GeminiLiveTranscribeProvider({
      tokenUrl: "https://example.test/token",
    });
    assert.equal(await provider.fetchToken(), "synthetic-ephemeral-token");
    assert.equal(provider.tokenAbortController, null);
    assert.equal(timers.size, 0);
  } finally {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});


test("dispose during CONNECTING rejects promptly and closes a late-opened socket", async () => {
  const previousWindow = globalThis.window;
  const previousWebSocket = globalThis.WebSocket;
  const timers = new Map();
  let nextId = 1;
  let socket;
  class ConnectingSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;
    constructor() {
      socket = this;
      this.readyState = ConnectingSocket.CONNECTING;
      this.handlers = new Map();
      this.closeAttempts = 0;
    }
    addEventListener(event, callback) {
      const callbacks = this.handlers.get(event) || [];
      callbacks.push(callback);
      this.handlers.set(event, callbacks);
    }
    emit(event) {
      for (const callback of this.handlers.get(event) || []) callback({});
    }
    close() {
      this.closeAttempts += 1;
      if (this.readyState === ConnectingSocket.CONNECTING) {
        throw new Error("cannot close while connecting");
      }
      this.readyState = ConnectingSocket.CLOSED;
    }
  }
  globalThis.window = {
    setTimeout(fn) { const id = nextId++; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  globalThis.WebSocket = ConnectingSocket;
  try {
    const provider = new GeminiLiveTranscribeProvider();
    provider.fetchToken = async () => "synthetic-token";
    const starting = provider.start();
    await Promise.resolve();
    await Promise.resolve();
    assert.ok(socket, "WebSocket is connecting");
    assert.equal(timers.size, 1);
    await provider.dispose();
    await assert.rejects(starting, /cancelled/i);
    assert.equal(timers.size, 0, "cancel clears the connection timeout");
    assert.equal(provider.socket, null);
    socket.readyState = ConnectingSocket.OPEN;
    socket.emit("open");
    assert.equal(socket.readyState, ConnectingSocket.CLOSED,
      "late open is closed even if close(CONNECTING) failed");
    assert.equal(provider.stream, null);
  } finally {
    globalThis.window = previousWindow;
    globalThis.WebSocket = previousWebSocket;
  }
});

test("rejected Gemini Blob frame decode fails closed and preserves manual recovery", async () => {
  const track = fakeTrack();
  await withCapture(track, async ({ provider, errors }) => {
    let closes = 0;
    const socket = { close() { closes += 1; } };
    provider.socket = socket;
    const frame = new Blob(['{"serverContent":{}}']);
    Object.defineProperty(frame, "text", {
      value: async () => { throw new Error("synthetic Blob read failure"); },
    });

    await provider.handleMessage({ data: frame }, socket);
    assert.equal(provider.active, false, "decode failure must end false listening");
    assert.equal(provider.listeningReady, false);
    assert.equal(provider.stream, null, "mic stream must be released");
    assert.equal(track.stops, 1);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].fatal, true);
    assert.equal(errors[0].code, "gemini-frame-decode");
    assert.match(errors[0].message, /重新開始/);

    await provider.handleMessage({ data: frame }, socket);
    assert.equal(errors.length, 1, "repeated failed frames must not duplicate fatal errors");
    await provider.dispose();
    assert.equal(closes, 1, "dispose closes the retired socket");
  });
});
