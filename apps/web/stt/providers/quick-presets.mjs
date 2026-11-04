import { normalizeCaptureMode } from "./capture-profile.mjs";

export const QUICK_PRESETS = Object.freeze({
  AUTO: "auto",
  FAR_NOISY: "far-noisy",
  CUSTOM: "custom",
});

// The default is a platform policy, not an automatic acoustic scene classifier.
// Existing field evidence favors Android's OS voice-processing capture path;
// leave non-Android devices on their previous raw baseline.
export function isAndroidPlatform({ userAgent = "", platform = "" } = {}) {
  return /\bAndroid\b/i.test(String(userAgent)) ||
    /^android$/i.test(String(platform).trim());
}

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
  userAgent = "",
  platform = "",
} = {}) {
  const requestedPreset = normalizeQuickPreset(presetValue);
  const presetCaptureMode =
    requestedPreset === QUICK_PRESETS.FAR_NOISY ||
    isAndroidPlatform({ userAgent, platform })
      ? "voice"
      : "raw";

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
