import { DEFAULT_ADAPTIVE_INPUT_CONFIG } from "./input-audio.mjs";

export const ADVANCED_TUNING_PROFILE_VERSION = "v1";

export const ADVANCED_TUNING_QUERY_KEYS = Object.freeze({
  version: "tuning",
  targetRmsDbfs: "targetDbfs",
  minGain: "minGain",
  maxGain: "maxGain",
  responseSpeed: "response",
});

export const ADVANCED_TUNING_OPTIONS = Object.freeze({
  targetRmsDbfs: Object.freeze([-54, -51, -48, -45]),
  minGain: Object.freeze([1, 1.5, 2]),
  maxGain: Object.freeze([4, 6, 8]),
  responseSpeed: Object.freeze(["fast", "balanced", "steady"]),
});

export const DEFAULT_ADVANCED_TUNING_CONTROLS = Object.freeze({
  targetRmsDbfs: DEFAULT_ADAPTIVE_INPUT_CONFIG.targetRmsDbfs,
  minGain: DEFAULT_ADAPTIVE_INPUT_CONFIG.minGain,
  maxGain: DEFAULT_ADAPTIVE_INPUT_CONFIG.maxGain,
  responseSpeed: "balanced",
});

const RESPONSE_CONFIGS = Object.freeze({
  fast: Object.freeze({
    gainUpMs: 220,
    gainDownMs: 80,
  }),
  balanced: Object.freeze({
    gainUpMs: DEFAULT_ADAPTIVE_INPUT_CONFIG.gainUpMs,
    gainDownMs: DEFAULT_ADAPTIVE_INPUT_CONFIG.gainDownMs,
  }),
  steady: Object.freeze({
    gainUpMs: 600,
    gainDownMs: 220,
  }),
});

function hasParam(params, key) {
  return Boolean(params?.has?.(key));
}

function getParam(params, key) {
  return params?.get?.(key) ?? null;
}

function allowedNumber(rawValue, allowedValues, fallback) {
  const value = Number(rawValue);
  return Number.isFinite(value) && allowedValues.includes(value)
    ? value
    : fallback;
}

function allowedString(rawValue, allowedValues, fallback) {
  const value = String(rawValue || "").trim().toLowerCase();
  return allowedValues.includes(value) ? value : fallback;
}

function sanitizeControls(raw = {}) {
  return {
    targetRmsDbfs: allowedNumber(
      raw.targetRmsDbfs,
      ADVANCED_TUNING_OPTIONS.targetRmsDbfs,
      DEFAULT_ADVANCED_TUNING_CONTROLS.targetRmsDbfs,
    ),
    minGain: allowedNumber(
      raw.minGain,
      ADVANCED_TUNING_OPTIONS.minGain,
      DEFAULT_ADVANCED_TUNING_CONTROLS.minGain,
    ),
    maxGain: allowedNumber(
      raw.maxGain,
      ADVANCED_TUNING_OPTIONS.maxGain,
      DEFAULT_ADVANCED_TUNING_CONTROLS.maxGain,
    ),
    responseSpeed: allowedString(
      raw.responseSpeed,
      ADVANCED_TUNING_OPTIONS.responseSpeed,
      DEFAULT_ADVANCED_TUNING_CONTROLS.responseSpeed,
    ),
  };
}

export function hasAdvancedTuning(params) {
  return (
    getParam(params, ADVANCED_TUNING_QUERY_KEYS.version) ===
    ADVANCED_TUNING_PROFILE_VERSION
  );
}

export function resolveAdvancedTuning(params) {
  const enabled = hasAdvancedTuning(params);
  const controls = enabled
    ? sanitizeControls({
        targetRmsDbfs: getParam(
          params,
          ADVANCED_TUNING_QUERY_KEYS.targetRmsDbfs,
        ),
        minGain: getParam(params, ADVANCED_TUNING_QUERY_KEYS.minGain),
        maxGain: getParam(params, ADVANCED_TUNING_QUERY_KEYS.maxGain),
        responseSpeed: getParam(
          params,
          ADVANCED_TUNING_QUERY_KEYS.responseSpeed,
        ),
      })
    : { ...DEFAULT_ADVANCED_TUNING_CONTROLS };

  const response = RESPONSE_CONFIGS[controls.responseSpeed];

  return {
    version: ADVANCED_TUNING_PROFILE_VERSION,
    enabled,
    controls,
    normalizationConfig: {
      ...DEFAULT_ADAPTIVE_INPUT_CONFIG,
      targetRmsDbfs: controls.targetRmsDbfs,
      minGain: controls.minGain,
      maxGain: controls.maxGain,
      gainUpMs: response.gainUpMs,
      gainDownMs: response.gainDownMs,
    },
  };
}

export function writeAdvancedTuningParams(params, rawControls = {}) {
  const controls = sanitizeControls(rawControls);

  params.set(
    ADVANCED_TUNING_QUERY_KEYS.version,
    ADVANCED_TUNING_PROFILE_VERSION,
  );
  params.set(
    ADVANCED_TUNING_QUERY_KEYS.targetRmsDbfs,
    String(controls.targetRmsDbfs),
  );
  params.set(ADVANCED_TUNING_QUERY_KEYS.minGain, String(controls.minGain));
  params.set(ADVANCED_TUNING_QUERY_KEYS.maxGain, String(controls.maxGain));
  params.set(
    ADVANCED_TUNING_QUERY_KEYS.responseSpeed,
    controls.responseSpeed,
  );

  return controls;
}

export function clearAdvancedTuningParams(params) {
  for (const key of Object.values(ADVANCED_TUNING_QUERY_KEYS)) {
    if (hasParam(params, key)) {
      params.delete(key);
    }
  }
}
