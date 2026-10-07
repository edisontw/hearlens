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
  tuningOverridePresent = false,
} = {}) {
  const requestedPreset = normalizeQuickPreset(presetValue);
  const presetCaptureMode =
    requestedPreset === QUICK_PRESETS.FAR_NOISY ? "voice" : "raw";

  if (captureOverridePresent || tuningOverridePresent) {
    return {
      preset: QUICK_PRESETS.CUSTOM,
      captureMode: captureOverridePresent
        ? normalizeCaptureMode(captureValue)
        : presetCaptureMode,
    };
  }

  return {
    preset: requestedPreset,
    captureMode: presetCaptureMode,
  };
}
