export const CAPTURE_MODES = Object.freeze({
  RAW: "raw",
  VOICE: "voice",
});

export function normalizeCaptureMode(value) {
  return String(value || "").trim().toLowerCase() === CAPTURE_MODES.VOICE
    ? CAPTURE_MODES.VOICE
    : CAPTURE_MODES.RAW;
}

export function requestedAudioConstraints(mode = CAPTURE_MODES.RAW) {
  const voiceProcessing = normalizeCaptureMode(mode) === CAPTURE_MODES.VOICE;

  return {
    echoCancellation: voiceProcessing,
    noiseSuppression: voiceProcessing,
    autoGainControl: voiceProcessing,
    channelCount: 1,
  };
}
