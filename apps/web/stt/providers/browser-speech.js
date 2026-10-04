export function browserSpeechSupported() {
  return Boolean(
    window.SpeechRecognition || window.webkitSpeechRecognition,
  );
}

function recognitionConstructor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export class BrowserSpeechProvider {
  constructor({
    language = "zh-TW",
    onPartial = () => {},
    onFinal = () => {},
    onStatus = () => {},
    onError = () => {},
  } = {}) {
    this.id = "browser-speech";
    this.label = "Browser SpeechRecognition (fallback)";
    this.language = language;
    this.onPartial = onPartial;
    this.onFinal = onFinal;
    this.onStatus = onStatus;
    this.onError = onError;
    this.active = false;
    this.recognition = null;
    this.restartTimer = null;
  }

  async start() {
    if (this.active) return;

    const Recognition = recognitionConstructor();
    if (!Recognition) {
      throw new Error("Browser SpeechRecognition is not available.");
    }

    const recognition = new Recognition();
    recognition.lang = this.language;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      this.onStatus({
        state: "listening",
        providerId: this.id,
        label: this.label,
      });
    };

    recognition.onresult = (event) => {
      let interim = "";

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result[0]?.transcript?.trim() ?? "";
        if (!text) continue;

        if (result.isFinal) {
          this.onFinal({
            text,
            providerId: this.id,
            timestamp: Date.now(),
          });
        } else {
          interim += text + " ";
        }
      }

      this.onPartial({
        text: interim.trim(),
        providerId: this.id,
        timestamp: Date.now(),
      });
    };

    recognition.onerror = (event) => {
      this.onError({
        providerId: this.id,
        code: event.error || "unknown",
        message: "SpeechRecognition error: " + (event.error || "unknown"),
      });
    };

    recognition.onend = () => {
      this.onPartial({
        text: "",
        providerId: this.id,
        timestamp: Date.now(),
      });

      if (!this.active) {
        this.onStatus({
          state: "stopped",
          providerId: this.id,
          label: this.label,
        });
        return;
      }

      this.restartTimer = window.setTimeout(() => {
        if (!this.active) return;
        try {
          recognition.start();
        } catch (error) {
          this.onError({
            providerId: this.id,
            code: "restart-failed",
            message:
              error instanceof Error
                ? error.message
                : "SpeechRecognition restart failed.",
          });
        }
      }, 300);
    };

    this.recognition = recognition;
    this.active = true;
    recognition.start();
  }

  async stop() {
    this.active = false;

    if (this.restartTimer !== null) {
      window.clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    const recognition = this.recognition;
    this.recognition = null;
    if (!recognition) return;

    try {
      recognition.stop();
    } catch {
      // Already stopped by the browser.
    }
  }

  async dispose() {
    this.active = false;

    if (this.restartTimer !== null) {
      window.clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    const recognition = this.recognition;
    this.recognition = null;

    try {
      recognition?.abort?.();
    } catch {
      // Ignore shutdown errors.
    }
  }
}
