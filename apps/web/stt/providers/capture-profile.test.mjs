import assert from "node:assert/strict";
import test from "node:test";

import {
  CAPTURE_MODES,
  normalizeCaptureMode,
  requestedAudioConstraints,
} from "./capture-profile.mjs";

test("raw capture disables browser voice processing", () => {
  assert.deepEqual(requestedAudioConstraints(CAPTURE_MODES.RAW), {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 1,
  });
});

test("voice capture requests available browser voice processing", () => {
  assert.deepEqual(requestedAudioConstraints(CAPTURE_MODES.VOICE), {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  });
});

test("unknown capture profiles fall back to raw", () => {
  assert.equal(normalizeCaptureMode("unknown"), CAPTURE_MODES.RAW);
  assert.equal(normalizeCaptureMode("VOICE"), CAPTURE_MODES.VOICE);
});
