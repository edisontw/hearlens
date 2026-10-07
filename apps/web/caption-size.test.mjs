import assert from "node:assert/strict";
import test from "node:test";

import {
  CAPTION_SIZE_LEVELS,
  DEFAULT_CAPTION_SIZE_LEVEL,
  captionSizePixels,
  normalizeCaptionSizeLevel,
} from "./caption-size.mjs";

test("caption sizes expose three bounded readable levels", () => {
  assert.equal(captionSizePixels(CAPTION_SIZE_LEVELS.NORMAL), 32);
  assert.equal(captionSizePixels(CAPTION_SIZE_LEVELS.LARGE), 40);
  assert.equal(captionSizePixels(CAPTION_SIZE_LEVELS.XLARGE), 48);
});

test("unknown caption size safely falls back to normal", () => {
  assert.equal(normalizeCaptionSizeLevel("huge"), DEFAULT_CAPTION_SIZE_LEVEL);
  assert.equal(captionSizePixels("huge"), 32);
});

test("caption size normalization is case and whitespace tolerant", () => {
  assert.equal(normalizeCaptionSizeLevel(" LARGE "), CAPTION_SIZE_LEVELS.LARGE);
});
