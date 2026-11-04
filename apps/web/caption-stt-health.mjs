// Passive caption telemetry only. Do not change capture, providers or restart
// the microphone automatically based on an absent transcript.
export function createCaptionNoTextMonitor({
  waitMs = 15_000,
  minActiveReports = 6,
} = {}) {
  let firstAudioAt = null;
  let activeReports = 0;
  let recognizedText = false;
  let warningEmitted = false;

  return {
    onAudioSent(now) {
      if (firstAudioAt === null && Number.isFinite(now)) firstAudioAt = now;
    },
    onAudioLevel(detail) {
      // Gemini adaptive capture reports one level per ~1 second. Fixed mode
      // and other providers do not provide speech-activity evidence here.
      if (/\bactive=1(?:\s|$)/.test(String(detail))) activeReports += 1;
    },
    onRecognizedText(text) {
      if (String(text || "").trim()) recognizedText = true;
    },
    shouldWarn(now) {
      if (warningEmitted || recognizedText || firstAudioAt === null ||
          !Number.isFinite(now) || now - firstAudioAt < waitMs ||
          activeReports < minActiveReports) return false;
      warningEmitted = true;
      return true;
    },
    reset() {
      firstAudioAt = null;
      activeReports = 0;
      recognizedText = false;
      warningEmitted = false;
    },
  };
}
