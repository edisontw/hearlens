import assert from "node:assert/strict";
import test from "node:test";

import {
  QUICK_PRESETS,
  resolveQuickPreset,
} from "./quick-presets.mjs";

test("Auto preset resolves to raw capture", () => {
  assert.deepEqual(resolveQuickPreset(), {
    preset: QUICK_PRESETS.AUTO,
    captureMode: "raw",
  });
});

test("Far/Noisy preset resolves to voice capture", () => {
  assert.deepEqual(resolveQuickPreset({ presetValue: "far-noisy" }), {
    preset: QUICK_PRESETS.FAR_NOISY,
    captureMode: "voice",
  });
});

test("Near/Normal remain Auto until distinct behavior is evidence-based", () => {
  for (const presetValue of ["near", "normal"]) {
    assert.deepEqual(resolveQuickPreset({ presetValue }), {
      preset: QUICK_PRESETS.AUTO,
      captureMode: "raw",
    });
  }
});

test("explicit capture override wins and is reported as custom", () => {
  assert.deepEqual(
    resolveQuickPreset({
      presetValue: "far-noisy",
      captureOverridePresent: true,
      captureValue: "raw",
    }),
    {
      preset: QUICK_PRESETS.CUSTOM,
      captureMode: "raw",
    },
  );
});
