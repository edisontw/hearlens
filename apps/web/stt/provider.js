import {
  BrowserSpeechProvider,
  browserSpeechSupported,
} from "./providers/browser-speech.js?v=20261128-edison-segment-offset1";
import { GeminiLiveTranscribeProvider } from
  "./providers/gemini-live-transcribe.js?v=20261128-edison-segment-offset1";
import { GoogleCloudStreamingProvider } from
  "./providers/google-cloud-streaming.js?v=20261128-edison-segment-offset1";
import { EdisonLocalAsrProvider } from
  "./providers/edison-local-asr.mjs?v=20261128-edison-segment-offset1";
export { validateEdisonLocalSelection } from
  "./providers/edison-local-asr.mjs?v=20261128-edison-segment-offset1";

export const STT_PROVIDER_IDS = Object.freeze({
  AUTO: "auto",
  BROWSER: "browser-speech",
  GEMINI: "gemini-live-transcribe",
  GOOGLE: "google-cloud-streaming",
  EDISON_LOCAL: "edison-local-asr",
});

// Resolve AUTO once so pre-capture disclosure and provider construction agree.
// Unknown IDs are left intact for an actionable preflight error in the UI.
export function resolveSttProviderId(provider = STT_PROVIDER_IDS.AUTO, tokenUrl = "") {
  return provider === STT_PROVIDER_IDS.AUTO
    ? tokenUrl ? STT_PROVIDER_IDS.GEMINI : STT_PROVIDER_IDS.BROWSER
    : provider;
}

export function describeSttCapabilities() {
  return {
    browserSpeech: browserSpeechSupported(),
    geminiLiveTranscribeClient: true,
    googleCloudStreamingClient: true,
    edisonLocalBatch: true,
    edisonLocalSegmented: true,
    edisonLocalStreaming: false,
    planned: ["openai-streaming", "native-taigi-evaluation"],
  };
}

export function createSttProvider({
  provider = STT_PROVIDER_IDS.AUTO,
  language = "zh-TW",
  tokenUrl = "",
  websocketUrl = "",
  edisonUrl = "http://127.0.0.1:8765",
  edisonModel = "breeze-asr-26-q5",
  edisonLanguageMode = "zh",
  inputGain = 1,
  inputMode = "adaptive",
  captureMode = "raw",
  normalizationConfig = {},
  onPartial,
  onFinal,
  onStatus,
  onError,
  onDebug,
} = {}) {
  const requested = resolveSttProviderId(provider, tokenUrl);

  if (requested === STT_PROVIDER_IDS.BROWSER) {
    if (!browserSpeechSupported()) {
      return null;
    }

    return new BrowserSpeechProvider({
      language,
      onPartial,
      onFinal,
      onStatus,
      onError,
      onDebug,
    });
  }

  if (requested === STT_PROVIDER_IDS.GEMINI) {
    return new GeminiLiveTranscribeProvider({
      tokenUrl,
      inputGain,
      inputMode,
      captureMode,
      normalizationConfig,
      onPartial,
      onFinal,
      onStatus,
      onError,
      onDebug,
    });
  }

  if (requested === STT_PROVIDER_IDS.GOOGLE) {
    return new GoogleCloudStreamingProvider({
      language: language === "zh-TW" ? "cmn-Hant-TW" : language,
      websocketUrl,
      onPartial,
      onFinal,
      onStatus,
      onError,
      onDebug,
    });
  }

  if (requested === STT_PROVIDER_IDS.EDISON_LOCAL) {
    return new EdisonLocalAsrProvider({
      endpoint: edisonUrl,
      model: edisonModel,
      language,
      languageMode: edisonLanguageMode,
      onPartial,
      onFinal,
      onStatus,
      onError,
      onDebug,
    });
  }

  throw new Error("Unknown STT provider: " + requested);
}
