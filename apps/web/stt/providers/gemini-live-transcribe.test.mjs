import assert from "node:assert/strict";
import test from "node:test";

import { disposeCaptionResourcesSafely } from "../../caption-stop.mjs";
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
    this.bufferedAmount = 0;
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
    provider.pushResampledSamples(new Float32Array([0.5]));
    socket.send = () => assert.fail("closed socket must not receive the PCM remainder");

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

test("manual Gemini stop sends remaining PCM exactly once before audioStreamEnd", async () => {
  for (const [wholeChunks, tailLength] of [[0, 3], [1, 1599], [1, 0]]) {
    await withFakeWebSocket(async ({ provider, socket }) => {
      const sent = [];
      socket.send = payload => sent.push(JSON.parse(payload).realtimeInput);
      provider.listeningReady = true;
      const samples = new Float32Array(wholeChunks * 1600 + tailLength);
      if (tailLength) samples.set([0.5, -0.5, 0.25], wholeChunks * 1600);
      provider.pushResampledSamples(samples);
      assert.equal(sent.length, wholeChunks, "only full chunks are sent while listening");

      const stopping = provider.stop();
      await new Promise(resolve => setImmediate(resolve));
      socket.close();
      await stopping;

      assert.deepEqual(sent.at(-1), { audioStreamEnd: true });
      const chunks = sent.slice(0, -1);
      assert.equal(chunks.length, wholeChunks + Number(tailLength > 0));
      if (tailLength) {
        const { data, mimeType } = chunks.at(-1).audio;
        const pcm = Buffer.from(data, "base64");
        assert.equal(mimeType, "audio/pcm;rate=16000");
        assert.equal(pcm.length, tailLength * 2, "no padding or duplicated samples");
        assert.deepEqual([0, 2, 4].map(offset => pcm.readInt16LE(offset)),
          [16383, -16384, 8191]);
      }
      assert.deepEqual(provider.pendingSamples, []);
    });
  }
});

test("Gemini disposal discards buffered PCM without sending it", async () => {
  await withFakeWebSocket(async ({ provider, socket }) => {
    let sends = 0;
    socket.send = () => { sends += 1; };
    provider.listeningReady = true;
    provider.pushResampledSamples(new Float32Array([0.5, -0.5]));

    await provider.dispose();

    assert.equal(sends, 0);
    assert.deepEqual(provider.pendingSamples, []);
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

test("Gemini audio congestion bounds the send queue and stops capture once", async () => {
  await withFakeWebSocket(async ({ provider, socket, errors }) => {
    const maxBytes = 128 * 1024;
    const chunk = new Float32Array(1600);
    const events = [];
    let micStops = 0;
    socket.send = payload => { socket.bufferedAmount += Buffer.byteLength(payload); };
    provider.onDebug = event => events.push(event);
    provider.listeningReady = true;
    provider.stream = { getTracks: () => [{ stop() { micStops += 1; } }] };

    for (let i = 0; i < 10; i += 1) provider.pushResampledSamples(chunk);
    assert(socket.bufferedAmount > 0 && socket.bufferedAmount < maxBytes);
    assert.equal(provider.active, true, "ordinary variation below the limit can recover");
    socket.bufferedAmount = 0;

    for (let i = 0; i < 40 && provider.active; i += 1) provider.pushResampledSamples(chunk);
    assert(socket.bufferedAmount <= maxBytes, "the next chunk must not exceed the limit");
    assert.equal(provider.active, false);
    assert.equal(micStops, 1);
    assert.deepEqual(provider.pendingSamples, []);
    socket.emit("error");
    socket.close();
    assert.equal(errors.length, 1);
    assert.equal(errors[0].code, "gemini-audio-backlog");
    assert.equal(errors[0].fatal, true);
    assert.match(errors[0].message, /網路/);
    const backlog = events.find(event => event.event === "audio-send-backlog");
    assert.match(backlog.detail, /^buffered-bytes=\d+$/);
    await provider.dispose();
  });
});

for (const closeSucceeds of [true, false]) {
  test("fatal Gemini cleanup waits for AudioContext close " +
    (closeSucceeds ? "before allowing restart" : "and blocks restart on rejection"), async () => {
    await withFakeWebSocket(async ({ provider, socket }) => {
      const close = Promise.withResolvers();
      let closeCalls = 0;
      let micStops = 0;
      let retryAllowed;
      const cleanupErrors = [];
      provider.listeningReady = true;
      provider.stream = { getTracks: () => [{ stop() { micStops += 1; } }] };
      provider.audioContext = {
        state: "running",
        close() {
          closeCalls += 1;
          return close.promise;
        },
      };
      let cleanup;
      provider.onError = () => {
        cleanup = disposeCaptionResourcesSafely(provider, async () => {},
          (phase, error) => cleanupErrors.push([phase, error.message]));
        void cleanup.then(result => { retryAllowed = result; });
      };

      socket.emit("error");
      await new Promise(resolve => setImmediate(resolve));
      const retryBeforeClose = retryAllowed;
      const socketStateBeforeAudioClose = socket.readyState;
      if (closeSucceeds) close.resolve();
      else close.reject(new Error("synthetic AudioContext close failure"));

      assert.equal(await cleanup, closeSucceeds, "the UI must see the actual cleanup result");
      assert.equal(retryBeforeClose, undefined, "the UI must wait for the first cleanup");
      assert.equal(micStops, 1);
      assert.equal(closeCalls, 1);
      assert.equal(socketStateBeforeAudioClose, FakeTransportSocket.CLOSED,
        "socket should close independently of AudioContext cleanup");
      assert.deepEqual(cleanupErrors, closeSucceeds
        ? [] : [["provider", "synthetic AudioContext close failure"]]);
    });
  });
}

test("Gemini socket error during setup immediately rejects startup without a false listening alert", async () => {
  await withFakeWebSocket(async ({ provider, socket, errors }) => {
    const setup = provider.waitForSetup();
    assert.equal(typeof provider.setupRejecter, "function");
    socket.emit("error");
    await assert.rejects(setup, /connection failed before setup completed/);
    assert.equal(provider.setupRejecter, null);
    assert.equal(provider.setupResolver, null);
    assert.equal(provider.active, false);
    assert.equal(provider.listeningReady, false);
    assert.deepEqual(errors, [], "pre-listening failure belongs to start(), not onError");
    socket.readyState = FakeTransportSocket.CLOSED;
    socket.emit("close", { code: 1006 });
    assert.deepEqual(errors, [], "late close cannot duplicate a fatal alert");
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

test("Gemini WebSocket frames retain arrival order across delayed Blob decoding", async () => {
  await withFakeWebSocket(async ({ provider, socket }) => {
    const finals = [];
    provider.onFinal = event => finals.push(event.text);
    let releaseDecode;
    class DelayedBlob extends Blob {
      text() { return new Promise(resolve => { releaseDecode = resolve; }); }
    }

    socket.emit("message", { data: new DelayedBlob(["first"]) });
    assert.equal(typeof releaseDecode, "function");
    socket.emit("message", { data: JSON.stringify({
      serverContent: { inputTranscription: { text: "第二段" } },
    }) });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(finals, [],
      "a later final must not overtake an earlier undecoded frame");

    releaseDecode(JSON.stringify({
      serverContent: { inputTranscription: { text: "第一段" } },
    }));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(finals, ["第一段", "第二段"]);
    await provider.dispose();
  });
});

test("stalled Gemini Blob decoding bounds queued frames and fails closed once", async () => {
  await withFakeWebSocket(async ({ provider, socket, errors }) => {
    const finals = [];
    provider.onFinal = event => finals.push(event.text);
    provider.listeningReady = true;
    let releaseDecode;
    class DelayedBlob extends Blob {
      text() { return new Promise(resolve => { releaseDecode = resolve; }); }
    }
    socket.emit("message", { data: new DelayedBlob(["stalled"]) });
    assert.equal(typeof releaseDecode, "function");

    for (let i = 0; i < 129; i += 1) {
      socket.emit("message", { data: JSON.stringify({
        serverContent: { inputTranscription: { text: "queued " + i } },
      }) });
    }
    assert.equal(provider.active, false);
    assert.equal(provider.listeningReady, false);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].code, "gemini-frame-backlog");
    assert.match(errors[0].message, /重新開始/);

    releaseDecode(JSON.stringify({
      serverContent: { inputTranscription: { text: "stale after backlog" } },
    }));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(finals, [], "no queued or delayed captions may escape after failure");
    await provider.dispose();
  });
});
