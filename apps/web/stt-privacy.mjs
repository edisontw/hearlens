/**
 * User-visible disclosure before microphone capture.
 * Display text depends on the selected STT provider. Do not assume browser
 * SpeechRecognition is on-device or promise cloud-provider retention terms.
 * This module performs no capture, network, consent, or persistence actions.
 */
export function captionSttPrivacyNotice(provider) {
  switch (provider) {
    case "gemini-live-transcribe":
      return "開始後，麥克風聲音會傳送至 Google Gemini 進行雲端辨識。請先告知對話者。";
    case "browser-speech":
      return "開始後，語音會交由瀏覽器的辨識服務處理，可能使用雲端。請先告知對話者。";
    case "google-cloud-streaming":
      return "開始後，麥克風聲音會經由語音代理傳送至 Google Cloud 辨識。請先告知對話者。";
    case "edison-local-asr":
      return "開始後，音訊會暫存於此瀏覽器；停止收音後才傳送到本機 Edison 辨識，並依 D:\\AIData 任務保留規則保存。字幕不會即時出現。";
    default:
      return "開始後，語音可能傳送至外部辨識服務。請先告知對話者。";
  }
}
