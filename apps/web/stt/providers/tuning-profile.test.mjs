import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_ADAPTIVE_INPUT_CONFIG } from "./input-audio.mjs";
import {
  ADVANCED_TUNING_PROFILE_VERSION,
  clearAdvancedTuningParams,
  resolveAdvancedTuning,
  writeAdvancedTuningParams,
} from "./tuning-profile.mjs";

test("default tuning profile exactly preserves the current adaptive defaults", () => {
  const profile = resolveAdvancedTuning(new URLSearchParams());

  assert.equal(profile.enabled, false);
  assert.equal(profile.version, ADVANCED_TUNING_PROFILE_VERSION);
  assert.equal(profile.controls.targetRmsDbfs, -48);
  assert.equal(profile.controls.minGain, 1);
  assert.equal(profile.controls.maxGain, 8);
  assert.equal(profile.controls.responseSpeed, "balanced");
  assert.deepEqual(profile.normalizationConfig, DEFAULT_ADAPTIVE_INPUT_CONFIG);
});

test("versioned bounded tuning applies only allow-listed values", () => {
  const params = new URLSearchParams(
    "tuning=v1&targetDbfs=-51&minGain=1.5&maxGain=6&response=steady",
  );
  const profile = resolveAdvancedTuning(params);

  assert.equal(profile.enabled, true);
  assert.deepEqual(profile.controls, {
    targetRmsDbfs: -51,
    minGain: 1.5,
    maxGain: 6,
    responseSpeed: "steady",
  });
  assert.equal(profile.normalizationConfig.gainUpMs, 600);
  assert.equal(profile.normalizationConfig.gainDownMs, 220);
  assert.equal(profile.normalizationConfig.limiterCeiling, 0.95);
  assert.equal(
    profile.normalizationConfig.noiseMarginDb,
    DEFAULT_ADAPTIVE_INPUT_CONFIG.noiseMarginDb,
  );
});

test("unsupported values fall back to defaults and cannot override limiter safety", () => {
  const params = new URLSearchParams(
    "tuning=v1&targetDbfs=-12&minGain=0.25&maxGain=99&response=instant&limiterCeiling=10",
  );
  const profile = resolveAdvancedTuning(params);

  assert.deepEqual(profile.controls, {
    targetRmsDbfs: -48,
    minGain: 1,
    maxGain: 8,
    responseSpeed: "balanced",
  });
  assert.equal(profile.normalizationConfig.limiterCeiling, 0.95);
  assert.equal(profile.normalizationConfig.gainUpMs, 350);
  assert.equal(profile.normalizationConfig.gainDownMs, 120);
});

test("unversioned tuning query values are ignored", () => {
  const params = new URLSearchParams(
    "targetDbfs=-51&minGain=1.5&maxGain=6&response=fast",
  );
  const profile = resolveAdvancedTuning(params);

  assert.equal(profile.enabled, false);
  assert.deepEqual(profile.normalizationConfig, DEFAULT_ADAPTIVE_INPUT_CONFIG);
});

test("profile writer creates a canonical reproducible URL snapshot and reset clears it", () => {
  const params = new URLSearchParams("preset=far-noisy");

  const controls = writeAdvancedTuningParams(params, {
    targetRmsDbfs: -54,
    minGain: 2,
    maxGain: 4,
    responseSpeed: "fast",
  });

  assert.deepEqual(controls, {
    targetRmsDbfs: -54,
    minGain: 2,
    maxGain: 4,
    responseSpeed: "fast",
  });
  assert.equal(params.get("tuning"), "v1");
  assert.equal(params.get("targetDbfs"), "-54");
  assert.equal(params.get("minGain"), "2");
  assert.equal(params.get("maxGain"), "4");
  assert.equal(params.get("response"), "fast");
  assert.equal(params.get("preset"), "far-noisy");

  clearAdvancedTuningParams(params);

  assert.equal(params.get("tuning"), null);
  assert.equal(params.get("targetDbfs"), null);
  assert.equal(params.get("minGain"), null);
  assert.equal(params.get("maxGain"), null);
  assert.equal(params.get("response"), null);
  assert.equal(params.get("preset"), "far-noisy");
});
