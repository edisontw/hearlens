import {
  BrowserSpeechProvider,
  browserSpeechSupported,
} from "./providers/browser-speech.js";

export const STT_PROVIDER_IDS = Object.freeze({
  AUTO: "auto",
  BROWSER: "browser-speech",
});

export function describeSttCapabilities() {
  return {
    browserSpeech: browserSpeechSupported(),
    planned: [
      "google-cloud-streaming",
      "openai-streaming",
      "local-taigi-breeze",
    ],
  };
}

export function createSttProvider({
  provider = STT_PROVIDER_IDS.AUTO,
  language = "zh-TW",
  onPartial,
  onFinal,
  onStatus,
  onError,
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
    });
  }

  throw new Error("Unknown STT provider: " + requested);
}
