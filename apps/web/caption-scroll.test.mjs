import assert from "node:assert/strict";
import test from "node:test";
import { shouldFollowCaptionScroll, preserveCaptionScrollOnLayoutChange } from "./caption-scroll.mjs";

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

test("caption font layout change follows latest only for a reader already at the end", () => {
  const atLatest = { scrollTop: 300, scrollHeight: 500, clientHeight: 200 };
  assert.equal(preserveCaptionScrollOnLayoutChange(atLatest, () => {
    atLatest.scrollHeight = 900;
  }), true);
  assert.equal(atLatest.scrollTop, 900, "growing text should keep latest visible");

  const rereading = { scrollTop: 80, scrollHeight: 500, clientHeight: 200 };
  assert.equal(preserveCaptionScrollOnLayoutChange(rereading, () => {
    rereading.scrollHeight = 900;
  }), false);
  assert.equal(rereading.scrollTop, 80, "manual reread position must be preserved");

  const invalid = { scrollTop: NaN, scrollHeight: 500, clientHeight: 200 };
  let applied = false;
  assert.equal(preserveCaptionScrollOnLayoutChange(invalid, () => {
    applied = true;
  }), false);
  assert.equal(applied, true, "layout updates still apply on unknown geometry");
  assert.throws(() => preserveCaptionScrollOnLayoutChange(null, () => {}), TypeError);
});
