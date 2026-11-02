const TERMINAL_RECOGNITION_ERRORS = new Set([
  "not-allowed", "service-not-allowed", "audio-capture", "language-not-supported",
]);

const RECOGNITION_ERROR_GUIDANCE = Object.freeze({
  "not-allowed": "麥克風權限遭拒，請在瀏覽器設定中允許麥克風後手動重新開始。",
  "service-not-allowed": "瀏覽器不允許語音辨識服務，請檢查瀏覽器設定後手動重新開始。",
  "audio-capture": "無法使用麥克風，請檢查裝置與權限後手動重新開始。",
  "language-not-supported": "此瀏覽器不支援所選的語音辨識語言。",
});

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
    onDebug = () => {},
  } = {}) {
    this.id = "browser-speech";
    this.label = "Browser SpeechRecognition (fallback)";
    this.language = language;
    this.onPartial = onPartial;
    this.onFinal = onFinal;
    this.onStatus = onStatus;
    this.onError = onError;
    this.onDebug = onDebug;

    this.active = false;
    this.recognition = null;
    this.restartTimer = null;
    this.endResolver = null;
    this.segmentId = 0;
  }

  debug(event, detail = "") {
    this.onDebug({
      providerId: this.id,
      event,
      detail,
      timestamp: Date.now(),
      segmentId: this.segmentId,
    });
  }

  createRecognition() {
    const Recognition = recognitionConstructor();
    if (!Recognition) {
      throw new Error("Browser SpeechRecognition is not available.");
    }

    const recognition = new Recognition();
    recognition.lang = this.language;

    // Chrome Android does not keep continuous sessions reliably.
    // Each segment gets a fresh SpeechRecognition instance.
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      this.debug("start");
      this.onStatus({
        state: "listening",
        providerId: this.id,
        label: this.label,
      });
    };

    recognition.onaudiostart = () => this.debug("audiostart");
    recognition.onsoundstart = () => this.debug("soundstart");
    recognition.onspeechstart = () => this.debug("speechstart");
    recognition.onspeechend = () => this.debug("speechend");
    recognition.onsoundend = () => this.debug("soundend");
    recognition.onaudioend = () => this.debug("audioend");
    recognition.onnomatch = () => this.debug("nomatch");

    recognition.onresult = (event) => {
      let interim = "";
      let finalCount = 0;

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result[0]?.transcript?.trim() ?? "";
        if (!text) continue;

        if (result.isFinal) {
          finalCount += 1;
          this.onFinal({
            text,
            providerId: this.id,
            timestamp: Date.now(),
          });
        } else {
          interim += text + " ";
        }
      }

      this.debug(
        "result",
        "final=" + finalCount + ", interim=" + (interim.trim() ? "yes" : "no"),
      );

      this.onPartial({
        text: interim.trim(),
        providerId: this.id,
        timestamp: Date.now(),
      });
    };

    recognition.onerror = (event) => {
      // Ignore late errors from stopped or superseded recognizers.
      if (!this.active || this.recognition !== recognition) return;
      const code = event.error || "unknown";
      this.debug("error", code);
      const fatal = TERMINAL_RECOGNITION_ERRORS.has(code);
      if (fatal) {
        // Permission/device/language failures cannot be fixed by automatic
        // segment restart. Stop retrying before the UI releases capture.
        this.active = false;
        if (this.restartTimer !== null) {
          window.clearTimeout(this.restartTimer);
          this.restartTimer = null;
        }
      }
      this.onError({
        providerId: this.id,
        code,
        message: RECOGNITION_ERROR_GUIDANCE[code] || "SpeechRecognition error: " + code,
        fatal,
      });
    };

    recognition.onend = () => {
      this.debug("end");

      if (this.recognition === recognition) {
        this.recognition = null;
      }

      this.onPartial({
        text: "",
        providerId: this.id,
        timestamp: Date.now(),
      });

      if (this.endResolver) {
        this.endResolver();
        this.endResolver = null;
      }

      if (!this.active) {
        this.onStatus({
          state: "stopped",
          providerId: this.id,
          label: this.label,
        });
        return;
      }

      this.restartTimer = window.setTimeout(() => {
        this.restartTimer = null;
        this.startSegment();
      }, 500);
    };

    return recognition;
  }

  startSegment() {
    if (!this.active) return;

    this.segmentId += 1;
    const recognition = this.createRecognition();
    this.recognition = recognition;
    this.debug("start-call");

    try {
      recognition.start();
    } catch (error) {
      this.debug(
        "start-throw",
        error instanceof Error ? error.message : "unknown",
      );
      // A synchronous start() rejection is not a running recognition
      // segment. Retrying every 800 ms can loop indefinitely while the UI
      // incorrectly claims to be listening. Release via fatal UI cleanup.
      this.active = false;
      this.onError({
        providerId: this.id,
        code: "start-failed",
        message: "瀏覽器語音辨識無法啟動，請改用預設 Gemini 字幕或重新整理後重試。",
        fatal: true,
      });
    }
  }

  async start() {
    if (this.active) return;

    this.active = true;
    this.debug("provider-start");
    this.startSegment();
  }

  async stop() {
    this.debug("provider-stop");
    this.active = false;

    if (this.restartTimer !== null) {
      window.clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    const recognition = this.recognition;
    if (!recognition) {
      this.debug("provider-stop-no-active-recognition");
      return;
    }

    await new Promise((resolve) => {
      let settled = false;
      let abortFallback = null;

      const finish = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        if (abortFallback !== null) {
          window.clearTimeout(abortFallback);
        }
        resolve();
      };

      const timeout = window.setTimeout(() => {
        this.debug("stop-timeout");
        finish();
      }, 1800);

      this.endResolver = finish;

      try {
        // Prefer a graceful stop so the Android recognition service can
        // finalize and release its VAD/session state normally.
        this.debug("stop-call");
        recognition.stop();

        // Some Android Chrome builds fail to emit end after stop().
        // Fall back to abort only if graceful shutdown stalls.
        abortFallback = window.setTimeout(() => {
          if (settled) return;
          try {
            this.debug("abort-fallback-call");
            recognition.abort();
          } catch (error) {
            this.debug(
              "abort-fallback-throw",
              error instanceof Error ? error.message : "unknown",
            );
            finish();
          }
        }, 800);
      } catch (error) {
        this.debug(
          "stop-throw",
          error instanceof Error ? error.message : "unknown",
        );

        try {
          this.debug("abort-fallback-call");
          recognition.abort();
        } catch {
          finish();
        }
      }
    });

    this.recognition = null;
    this.endResolver = null;

    await new Promise((resolve) => window.setTimeout(resolve, 350));
    this.debug("provider-stopped");
  }

  async dispose() {
    this.debug("provider-dispose");
    this.active = false;

    if (this.restartTimer !== null) {
      window.clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    const recognition = this.recognition;
    this.recognition = null;

    if (this.endResolver) {
      this.endResolver();
      this.endResolver = null;
    }

    try {
      recognition?.abort?.();
    } catch {
      // Ignore shutdown errors.
    }
  }
}
