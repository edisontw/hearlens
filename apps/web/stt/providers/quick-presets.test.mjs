import assert from "node:assert/strict";
import test from "node:test";

import {
  QUICK_PRESETS,
  isAndroidPlatform,
  resolveQuickPreset,
} from "./quick-presets.mjs";

test("Auto preset keeps raw capture on non-Android platforms", () => {
  assert.deepEqual(resolveQuickPreset(), {
    preset: QUICK_PRESETS.AUTO,
    captureMode: "raw",
  });
});

test("Android Auto uses voice capture, not an unverified scene switch", () => {
  for (const device of [
    { userAgent: "Mozilla/5.0 (Linux; Android 13; moto g62) AppleWebKit/537.36 Chrome/120" },
    { userAgent: "Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36" },
    { platform: "Android" },
  ]) {
    assert.equal(isAndroidPlatform(device), true);
    assert.deepEqual(resolveQuickPreset(device), {
      preset: QUICK_PRESETS.AUTO,
      captureMode: "voice",
    });
  }
  for (const device of [
    { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X)", platform: "iPhone" },
    { userAgent: "Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X)", platform: "iPad" },
    { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", platform: "Windows" },
    { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)", platform: "MacIntel" },
  ]) {
    assert.equal(isAndroidPlatform(device), false);
    assert.deepEqual(resolveQuickPreset(device), {
      preset: QUICK_PRESETS.AUTO,
      captureMode: "raw",
    });
  }
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
      userAgent: "Mozilla/5.0 (Linux; Android 13; moto g62)",
    }),
    {
      preset: QUICK_PRESETS.CUSTOM,
      captureMode: "raw",
    },
  );
});


test("bounded tuning override is reported as custom while retaining preset capture policy", () => {
  assert.deepEqual(
    resolveQuickPreset({
      presetValue: "far-noisy",
      tuningOverridePresent: true,
    }),
    {
      preset: QUICK_PRESETS.CUSTOM,
      captureMode: "voice",
    },
  );

  assert.deepEqual(
    resolveQuickPreset({
      presetValue: "auto",
      tuningOverridePresent: true,
    }),
    {
      preset: QUICK_PRESETS.CUSTOM,
      captureMode: "raw",
    },
  );
});

test("Android explicit raw override remains available for research", () => {
  assert.deepEqual(resolveQuickPreset({
    presetValue: "auto",
    captureOverridePresent: true,
    captureValue: "raw",
    userAgent: "Android 13",
  }), {
    preset: QUICK_PRESETS.CUSTOM,
    captureMode: "raw",
  });
});

test("Android tuning override keeps voice unless capture is explicitly overridden", () => {
  assert.deepEqual(resolveQuickPreset({
    presetValue: "auto",
    tuningOverridePresent: true,
    userAgent: "Android 13",
  }), {
    preset: QUICK_PRESETS.CUSTOM,
    captureMode: "voice",
  });
});
