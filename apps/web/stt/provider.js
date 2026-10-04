import {
  BrowserSpeechProvider,
  browserSpeechSupported,
} from "./providers/browser-speech.js?v=20261004-gemini-live-mvp2";
import { GeminiLiveTranscribeProvider } from
  "./providers/gemini-live-transcribe.js?v=20261004-gemini-live-mvp2";
import { GoogleCloudStreamingProvider } from
  "./providers/google-cloud-streaming.js?v=20261004-gemini-live-mvp2";

export const STT_PROVIDER_IDS = Object.freeze({
  AUTO: "auto",
  BROWSER: "browser-speech",
  GEMINI: "gemini-live-transcribe",
  GOOGLE: "google-cloud-streaming",
});

export function describeSttCapabilities() {
  return {
    browserSpeech: browserSpeechSupported(),
    geminiLiveTranscribeClient: true,
    googleCloudStreamingClient: true,
    planned: ["openai-streaming", "local-taigi-breeze"],
  };
}

export function createSttProvider({
  provider = STT_PROVIDER_IDS.AUTO,
  language = "zh-TW",
  tokenUrl = "",
  websocketUrl = "",
  onPartial,
  onFinal,
  onStatus,
  onError,
  onDebug,
} = {}) {
  const requested =
    provider === STT_PROVIDER_IDS.AUTO
      ? STT_PROVIDER_IDS.BROWSER
      : provider;

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

  throw new Error("Unknown STT provider: " + requested);
}
