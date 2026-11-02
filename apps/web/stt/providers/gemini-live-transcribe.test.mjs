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

test("stop after an already-closed Gemini socket retires queued captions", async () => {
  await withFakeWebSocket(async ({ provider, socket, errors }) => {
    const finals = [], states = [];
    provider.onFinal = event => finals.push(event.text);
    provider.onStatus = event => states.push(event.state);
    provider.listeningReady = true;

    // The transport can close while stop() is releasing microphone resources.
    socket.readyState = FakeTransportSocket.CLOSED;
    await provider.stop();
    assert.equal(provider.socket, null, "closed socket must be retired");
    assert.equal(provider.stopping, false);
    assert.deepEqual(states, ["stopped"]);

    // A queued callback from that socket must not change stopped captions.
    socket.emit("message", { data: JSON.stringify({
      serverContent: { inputTranscription: { text: "late after stop" } },
    }) });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(finals, []);
    assert.deepEqual(errors, [], "normal stop must not report a fatal error");
  });
});

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

test("retired Gemini socket frames cannot contaminate a new listening session", async () => {
  await withFakeWebSocket(async ({ provider, socket }) => {
    const finals = [];
    provider.onFinal = (event) => finals.push(event.text);
    socket.emit("message", { data: JSON.stringify({
      serverContent: { inputTranscription: { text: "current session" } },
    }) });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(finals, ["current session"], "current socket still delivers captions");

    const nextSocket = { readyState: FakeTransportSocket.OPEN };
    provider.socket = nextSocket;
    socket.emit("message", { data: JSON.stringify({
      serverContent: { inputTranscription: { text: "retired session" } },
    }) });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(finals, ["current session"], "old socket frame must be discarded");

    await provider.handleMessage({ data: JSON.stringify({
      serverContent: { inputTranscription: { text: "new session" } },
    }) }, nextSocket);
    assert.deepEqual(finals, ["current session", "new session"]);
  });
});

test("delayed Gemini Blob decode is discarded when its socket is retired", async () => {
  await withFakeWebSocket(async ({ provider, socket }) => {
    const finals = [];
    provider.onFinal = (event) => finals.push(event.text);
    let releaseDecode;
    class DelayedBlob extends Blob {
      text() { return new Promise(resolve => { releaseDecode = resolve; }); }
    }
    socket.emit("message", { data: new DelayedBlob(["delayed"]) });
    assert.equal(typeof releaseDecode, "function");
    provider.socket = { readyState: FakeTransportSocket.OPEN };
    releaseDecode(JSON.stringify({
      serverContent: { inputTranscription: { text: "delayed stale final" } },
    }));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(finals, [], "post-decode socket identity must be checked");
  });
});

test("dispose immediately retires Gemini socket while AudioContext cleanup is pending", async () => {
  await withFakeWebSocket(async ({ provider, socket }) => {
    const finals = [], partials = [];
    provider.onFinal = event => finals.push(event.text);
    provider.onPartial = event => partials.push(event.text);
    let finishClose;
    provider.audioContext = {
      state: "running",
      close: () => new Promise(resolve => { finishClose = resolve; }),
    };
    let finishDecode;
    class PendingBlob extends Blob {
      text() { return new Promise(resolve => { finishDecode = resolve; }); }
    }
    socket.emit("message", { data: new PendingBlob(["pending"]) });
    assert.equal(typeof finishDecode, "function");

    const disposing = provider.dispose();
    assert.equal(typeof finishClose, "function");
    assert.equal(provider.socket, null, "dispose must retire transport before awaiting cleanup");

    await provider.handleMessage({ data: JSON.stringify({
      serverContent: { inputTranscription: { text: "late final" } },
    }) }, socket);
    finishDecode(JSON.stringify({
      serverContent: { interimInputTranscription: { text: "delayed partial" } },
    }));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(finals, [], "late final must be discarded");
    assert.deepEqual(partials, [], "pending Blob decode must be discarded");

    finishClose();
    await disposing;
    assert.equal(socket.readyState, FakeTransportSocket.CLOSED);
  });
});
