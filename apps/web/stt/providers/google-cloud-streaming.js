const OPEN_TIMEOUT_MS = 8_000;
const READY_TIMEOUT_MS = 8_000;
const STOP_TIMEOUT_MS = 1_500;
const MAX_BUFFERED_BYTES = 256 * 1024;

function normalizeWebSocketUrl(value) {
  if (!value) {
    throw new Error("Google STT requires ?ws=wss://.../stt.");
  }

  const url = new URL(value, window.location.href);
  if (url.protocol === "https:") url.protocol = "wss:";
  if (url.protocol === "http:") url.protocol = "ws:";

  if (url.protocol !== "wss:" && url.protocol !== "ws:") {
    throw new Error("Google STT proxy URL must use ws:// or wss://.");
  }

  return url.toString();
}

function requestedAudioConstraints() {
  return {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 1,
  };
}

function float32ToLinear16(input) {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);

  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, input[i]));
    const value = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    view.setInt16(i * 2, value, true);
  }

  return buffer;
}

export class GoogleCloudStreamingProvider {
  constructor({
    language = "cmn-Hant-TW",
    websocketUrl = "",
    onPartial = () => {},
    onFinal = () => {},
    onStatus = () => {},
    onError = () => {},
    onDebug = () => {},
  } = {}) {
    this.id = "google-cloud-streaming";
    this.label = "Google Cloud STT (streaming proxy)";
    this.language = language;
    this.websocketUrl = websocketUrl;
    this.onPartial = onPartial;
    this.onFinal = onFinal;
    this.onStatus = onStatus;
    this.onError = onError;
    this.onDebug = onDebug;

    this.active = false;
    this.stopping = false;
    this.socket = null;
    this.stream = null;
    this.audioContext = null;
    this.sourceNode = null;
    this.processorNode = null;
    this.zeroGainNode = null;
    this.segmentId = 0;
    this.readyResolver = null;
    this.readyRejecter = null;
    this.stopResolver = null;
    this.backpressureReported = false;
    this.firstAudioSent = false;
    this.proxyReady = false;
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

  async openSocket() {
    const url = normalizeWebSocketUrl(this.websocketUrl);
    this.debug("ws-connect", url.replace(/\?.*$/, ""));

    const socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    await new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error("Timed out connecting to Google STT proxy."));
      }, OPEN_TIMEOUT_MS);

      const cleanup = () => window.clearTimeout(timeout);

      socket.addEventListener("open", () => {
        cleanup();
        this.debug("ws-open");
        resolve();
      }, { once: true });

      socket.addEventListener("error", () => {
        cleanup();
        reject(new Error("Could not connect to Google STT proxy."));
      }, { once: true });
    });

    socket.addEventListener("message", (event) => this.handleSocketMessage(event));
    socket.addEventListener("close", (event) => {
      this.debug("ws-close", "code=" + event.code);

      if (this.readyRejecter) {
        this.readyRejecter(new Error("Google STT proxy closed before ready."));
        this.clearReadyWaiters();
      }

      if (this.stopResolver) {
        this.stopResolver();
        this.stopResolver = null;
      }

      if (this.active && !this.stopping) {
        this.onError({
          providerId: this.id,
          code: "proxy-closed",
          message: "Google STT proxy connection closed.",
        });
      }
    });
  }

  handleSocketMessage(event) {
    if (typeof event.data !== "string") return;

    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      this.debug("ws-invalid-json");
      return;
    }

    if (message.type === "ready") {
      this.proxyReady = true;
      this.debug(
        "proxy-ready",
        [message.model, message.location].filter(Boolean).join("@"),
      );

      if (this.readyResolver) {
        this.readyResolver();
        this.clearReadyWaiters();
      }
      return;
    }

    if (message.type === "partial") {
      this.onPartial({
        text: message.text || "",
        providerId: this.id,
        timestamp: Date.now(),
      });
      return;
    }

    if (message.type === "final") {
      this.onFinal({
        text: message.text || "",
        providerId: this.id,
        timestamp: Date.now(),
      });
      return;
    }

    if (message.type === "error") {
      const error = new Error(message.message || "Google STT proxy error.");
      this.debug("proxy-error", message.code || "unknown");
      this.onError({
        providerId: this.id,
        code: message.code || "proxy-error",
        message: error.message,
      });

      if (this.readyRejecter) {
        this.readyRejecter(error);
        this.clearReadyWaiters();
      }
      return;
    }

    if (message.type === "stopped") {
      this.debug("proxy-stopped");
      if (this.stopResolver) {
        this.stopResolver();
        this.stopResolver = null;
      }
    }
  }

  clearReadyWaiters() {
    this.readyResolver = null;
    this.readyRejecter = null;
  }

  async startCapture() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: requestedAudioConstraints(),
      video: false,
    });

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error("Web Audio API is unavailable.");
    }

    this.audioContext = new AudioContextClass({ latencyHint: "interactive" });
    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }

    if (!this.audioContext.createScriptProcessor) {
      throw new Error("This browser cannot create the PCM capture processor.");
    }

    this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
    this.processorNode = this.audioContext.createScriptProcessor(4096, 1, 1);
    this.zeroGainNode = this.audioContext.createGain();
    this.zeroGainNode.gain.value = 0;

    this.processorNode.onaudioprocess = (event) => {
      const socket = this.socket;
      if (!this.active || !this.proxyReady || !socket || socket.readyState !== WebSocket.OPEN) return;
      if (!this.firstAudioSent) {
        this.firstAudioSent = true;
        this.debug("audio-first-chunk", "rate=" + this.audioContext.sampleRate);
      }

      if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
        if (!this.backpressureReported) {
          this.backpressureReported = true;
          this.debug("audio-backpressure", "buffered=" + socket.bufferedAmount);
        }
        return;
      }

      this.backpressureReported = false;
      const channel = event.inputBuffer.getChannelData(0);
      socket.send(float32ToLinear16(channel));
    };

    this.sourceNode.connect(this.processorNode);
    this.processorNode.connect(this.zeroGainNode);
    this.zeroGainNode.connect(this.audioContext.destination);

    return this.audioContext.sampleRate;
  }

  async start() {
    if (this.active) return;
    this.debug("provider-start");
    this.active = true;
    this.stopping = false;
    this.proxyReady = false;
    this.firstAudioSent = false;
    this.segmentId += 1;
    this.onStatus({
      state: "connecting",
      providerId: this.id,
      label: this.label,
    });

    try {
      await this.openSocket();
      const sampleRate = await this.startCapture();

      const readyPromise = new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          this.clearReadyWaiters();
          reject(new Error("Google STT proxy did not become ready."));
        }, READY_TIMEOUT_MS);

        this.readyResolver = () => {
          window.clearTimeout(timeout);
          resolve();
        };
        this.readyRejecter = (error) => {
          window.clearTimeout(timeout);
          reject(error);
        };
      });

      this.socket.send(JSON.stringify({
        type: "start",
        language: this.language,
        sampleRate,
        encoding: "LINEAR16",
        channels: 1,
      }));
      this.debug("proxy-start-sent", "rate=" + sampleRate);

      await readyPromise;
      this.onStatus({
        state: "listening",
        providerId: this.id,
        label: this.label,
      });
    } catch (error) {
      this.active = false;
      await this.shutdownCapture();
      try {
        this.socket?.close();
      } catch {
        // Ignore close errors during failed startup.
      }
      throw error;
    }
  }

  async shutdownCapture() {
    if (this.processorNode) {
      this.processorNode.onaudioprocess = null;
    }

    for (const node of [this.sourceNode, this.processorNode, this.zeroGainNode]) {
      try {
        node?.disconnect?.();
      } catch {
        // Ignore disconnect errors.
      }
    }

    this.sourceNode = null;
    this.processorNode = null;
    this.zeroGainNode = null;

    for (const track of this.stream?.getTracks?.() ?? []) {
      track.stop();
    }
    this.stream = null;

    if (this.audioContext && this.audioContext.state !== "closed") {
      await this.audioContext.close();
    }
    this.audioContext = null;
  }

  async stop() {
    this.debug("provider-stop");
    this.active = false;
    this.stopping = true;
    await this.shutdownCapture();

    const socket = this.socket;
    if (!socket || socket.readyState === WebSocket.CLOSED) {
      this.debug("provider-stopped");
      return;
    }

    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "stop" }));
      this.debug("proxy-stop-sent");
    }

    await new Promise((resolve) => {
      const timeout = window.setTimeout(resolve, STOP_TIMEOUT_MS);
      this.stopResolver = () => {
        window.clearTimeout(timeout);
        resolve();
      };
    });

    try {
      socket.close(1000, "client stop");
    } catch {
      // Ignore close errors.
    }

    this.socket = null;
    this.proxyReady = false;
    this.stopping = false;
    this.onStatus({
      state: "stopped",
      providerId: this.id,
      label: this.label,
    });
    this.debug("provider-stopped");
  }

  async dispose() {
    this.debug("provider-dispose");
    this.active = false;
    this.stopping = true;
    await this.shutdownCapture();

    try {
      this.socket?.close(1000, "dispose");
    } catch {
      // Ignore close errors.
    }

    this.socket = null;
    this.proxyReady = false;
    this.clearReadyWaiters();
    if (this.stopResolver) {
      this.stopResolver();
      this.stopResolver = null;
    }
  }
}
