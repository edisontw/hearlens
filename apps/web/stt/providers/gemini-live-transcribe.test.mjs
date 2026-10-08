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
