import assert from "node:assert/strict";
import test from "node:test";

import { GeminiLiveTranscribeProvider } from "./gemini-live-transcribe.js";

test("a final transcription received while stopping does not close the socket immediately", async () => {
  const finals = [];
  let stopResolved = 0;
  const provider = new GeminiLiveTranscribeProvider({
    onFinal: (event) => finals.push(event.text),
  });

  provider.stopping = true;
  provider.stopResolver = () => {
    stopResolved += 1;
  };

  await provider.handleMessage({
    data: JSON.stringify({
      serverContent: {
        inputTranscription: { text: "最後一段" },
      },
    }),
  });

  assert.deepEqual(finals, ["最後一段"]);
  assert.equal(stopResolved, 0);
});

test("turnComplete starts a drain grace period before stop resolves", async () => {
  const originalWindow = globalThis.window;
  let scheduled = null;
  let cleared = [];
  globalThis.window = {
    setTimeout(callback) {
      scheduled = callback;
      return 42;
    },
    clearTimeout(id) {
      cleared.push(id);
    },
  };

  try {
    let stopReason = null;
    const provider = new GeminiLiveTranscribeProvider();
    provider.stopping = true;
    provider.stopResolver = (reason) => {
      stopReason = reason;
      provider.stopResolver = null;
    };

    await provider.handleMessage({
      data: JSON.stringify({
        serverContent: {
          turnComplete: true,
        },
      }),
    });

    assert.equal(stopReason, null);
    assert.equal(typeof scheduled, "function");

    scheduled();
    assert.equal(stopReason, "drain-complete");
  } finally {
    globalThis.window = originalWindow;
  }
});


class FakeTransportSocket {
  static OPEN = 1;
  static CLOSED = 3;

  constructor() {
    this.listeners = new Map();
    this.readyState = 0;
    FakeTransportSocket.last = this;
  }

  addEventListener(name, fn) {
    const callbacks = this.listeners.get(name) || [];
    callbacks.push(fn);
    this.listeners.set(name, callbacks);
  }

  emit(name, event = {}) {
    for (const fn of this.listeners.get(name) || []) fn(event);
  }

  close() {
    this.readyState = FakeTransportSocket.CLOSED;
    this.emit("close", { code: 1000 });
  }
}

async function withFakeWebSocket(run) {
  const originalWindow = globalThis.window;
  const originalWebSocket = globalThis.WebSocket;
  globalThis.window = { setTimeout, clearTimeout };
  globalThis.WebSocket = FakeTransportSocket;
  try {
    const errors = [];
    const provider = new GeminiLiveTranscribeProvider({ onError: e => errors.push(e) });
    provider.active = true;
    const opening = provider.openSocket("synthetic-token");
    const socket = FakeTransportSocket.last;
    socket.readyState = FakeTransportSocket.OPEN;
    socket.emit("open");
    await opening;
    return await run({ provider, socket, errors });
  } finally {
    globalThis.window = originalWindow;
    globalThis.WebSocket = originalWebSocket;
  }
}

test("mid-session Gemini close immediately stops capture and reports one fatal error", async () => {
  await withFakeWebSocket(async ({ provider, socket, errors }) => {
    let tracksStopped = 0;
    let contextClosed = 0;
    provider.stream = { getTracks: () => [{ stop() { tracksStopped += 1; } }] };
    provider.audioContext = { state: "running", close: async () => { contextClosed += 1; } };
    provider.listeningReady = true;
    socket.readyState = FakeTransportSocket.CLOSED;
    socket.emit("close", { code: 1006 });
    assert.equal(provider.active, false);
    assert.equal(provider.listeningReady, false);
    assert.equal(provider.stream, null);
    assert.equal(tracksStopped, 1);
    assert.equal(contextClosed, 1);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].code, "gemini-closed");
    assert.equal(errors[0].fatal, true);
    socket.emit("error");
    socket.emit("close", { code: 1006 });
    assert.equal(errors.length, 1, "duplicate transport callbacks cannot restart cleanup");
    assert.equal(tracksStopped, 1);
    await provider.dispose();
    assert.equal(contextClosed, 1, "dispose cannot double-close context");
  });
});

test("mid-session WebSocket error fails closed even before subsequent close event", async () => {
  await withFakeWebSocket(async ({ provider, socket, errors }) => {
    let stopped = 0;
    provider.listeningReady = true;
    provider.stream = { getTracks: () => [{ stop() { stopped += 1; } }] };
    socket.emit("error");
    assert.equal(stopped, 1);
    assert.equal(provider.active, false);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].code, "gemini-socket-error");
    socket.readyState = FakeTransportSocket.CLOSED;
    socket.emit("close", { code: 1006 });
    assert.equal(errors.length, 1);
  });
});

test("deliberate user stop or pre-listening failure is not a spurious mid-session alert", async () => {
  await withFakeWebSocket(async ({ provider, socket, errors }) => {
    provider.stopping = true;
    socket.readyState = FakeTransportSocket.CLOSED;
    socket.emit("close", { code: 1000 });
    assert.equal(errors.length, 0);
  });
  await withFakeWebSocket(async ({ provider, socket, errors }) => {
    provider.listeningReady = false;
    socket.readyState = FakeTransportSocket.CLOSED;
    socket.emit("close", { code: 1006 });
    assert.equal(errors.length, 0);
    assert.equal(provider.fatalTransportHandled, true);
  });
});

test("late decoded frames are discarded after fatal transport failure", async () => {
  await withFakeWebSocket(async ({ provider, socket }) => {
    const finals = [];
    provider.onFinal = e => finals.push(e.text);
    provider.listeningReady = true;
    socket.readyState = FakeTransportSocket.CLOSED;
    socket.emit("close", { code: 1006 });
    await provider.handleMessage({ data: JSON.stringify({
      serverContent: { inputTranscription: { text: "stale final" } },
    }) });
    assert.deepEqual(finals, []);
  });
});
