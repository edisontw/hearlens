import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCaptionSessionCurrent,
  CaptionSessionInterrupted,
  shouldInterruptForPageEvent,
} from "./caption-lifecycle.mjs";

test("visibility and pagehide interrupt only when leaving foreground", () => {
  assert.equal(shouldInterruptForPageEvent("visibilitychange", "hidden"), true);
  assert.equal(shouldInterruptForPageEvent("visibilitychange", "visible"), false);
  assert.equal(shouldInterruptForPageEvent("pagehide", "visible"), true);
  assert.equal(shouldInterruptForPageEvent("pageshow", "visible"), false);
});

test("asynchronous startup checks reject superseded or hidden sessions", () => {
  assert.doesNotThrow(() => assertCaptionSessionCurrent(3, 3, false));
  for (const values of [[3, 0, false], [3, 4, false],
      [3, 3, true], [0, 0, false]]) {
    assert.throws(() => assertCaptionSessionCurrent(...values),
      CaptionSessionInterrupted);
  }
});
