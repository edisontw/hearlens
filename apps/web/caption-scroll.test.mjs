import assert from "node:assert/strict";
import test from "node:test";
import { shouldFollowCaptionScroll } from "./caption-scroll.mjs";

test("long captions follow new speech when at or near their end", () => {
  assert.equal(shouldFollowCaptionScroll(0, 120, 180), true);
  assert.equal(shouldFollowCaptionScroll(250, 500, 200), false);
  assert.equal(shouldFollowCaptionScroll(252, 500, 200, 48), true);
  assert.equal(shouldFollowCaptionScroll(255, 500, 200, 48), true);
  assert.equal(shouldFollowCaptionScroll(300, 500, 200), true);
});

test("deliberate scroll-up remains in place and invalid geometry cannot auto-follow", () => {
  assert.equal(shouldFollowCaptionScroll(0, 900, 200), false);
  assert.equal(shouldFollowCaptionScroll(NaN, 900, 200), false);
  assert.equal(shouldFollowCaptionScroll(-1, 200, 200), false);
  assert.equal(shouldFollowCaptionScroll(1, Infinity, 200), false);
  assert.equal(shouldFollowCaptionScroll(0, 200, 200, -10), false);
});
