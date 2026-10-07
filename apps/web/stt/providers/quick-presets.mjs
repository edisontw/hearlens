import { normalizeCaptureMode } from "./capture-profile.mjs";

export const QUICK_PRESETS = Object.freeze({
  AUTO: "auto",
  FAR_NOISY: "far-noisy",
  CUSTOM: "custom",
});

export function normalizeQuickPreset(value) {
  return String(value || "").trim().toLowerCase() === QUICK_PRESETS.FAR_NOISY
    ? QUICK_PRESETS.FAR_NOISY
    : QUICK_PRESETS.AUTO;
}

export function resolveQuickPreset({
  presetValue = "",
  captureOverridePresent = false,
  captureValue = "",
} = {}) {
  const requestedPreset = normalizeQuickPreset(presetValue);

  if (captureOverridePresent) {
    return {
      preset: QUICK_PRESETS.CUSTOM,
      captureMode: normalizeCaptureMode(captureValue),
    };
  }

  return {
    preset: requestedPreset,
    captureMode:
      requestedPreset === QUICK_PRESETS.FAR_NOISY ? "voice" : "raw",
  };
}
