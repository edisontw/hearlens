import { decodeWebSocketData } from "./gemini-live-wire.mjs?v=20261004-gemini-live-mvp4";
import { processInputAudio } from "./input-audio.mjs?v=20261004-gemini-live-mvp4";

const GEMINI_MODEL = "gemini-3.5-transcribe-live";
const TARGET_SAMPLE_RATE = 16_000;
const TARGET_CHUNK_SAMPLES = 1_600;
const OPEN_TIMEOUT_MS = 8_000;
const SETUP_TIMEOUT_MS = 8_000;
const STOP_TIMEOUT_MS = 1_500;
const GEMINI_WS_BASE =
  "wss://generativelanguage.googleapis.com/ws/" +
  "google.ai.generativelanguage.v1beta.GenerativeService." +
  "BidiGenerateContentConstrained";

function normalizeTokenUrl(value) {
  if (!value) {
    throw new Error("Gemini STT requires ?token=https://.../token.");
  }

  const url = new URL(value, window.location.href);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("Gemini token URL must use HTTPS.");
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

function resampleLinear(input, sourceRate, targetRate = TARGET_SAMPLE_RATE) {
  if (sourceRate === targetRate) {
    return input.slice();
  }

  const ratio = sourceRate / targetRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i += 1) {
    const position = i * ratio;
    const left = Math.floor(position);
    const right = Math.min(left + 1, input.length - 1);
    const fraction = position - left;
    output[i] = input[left] * (1 - fraction) + input[right] * fraction;
  }

  return output;
}

function pcm16Base64(samples) {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);

  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    const value = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    view.setInt16(i * 2, value, true);
  }

  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export class GeminiLiveTranscribeProvider {
  constructor({
    tokenUrl = "",
    inputGain = 1,
    onPartial = () => {},
    onFinal = () => {},
    onStatus = () => {},
    onError = () => {},
    onDebug = () => {},
  } = {}) {
    this.id = "gemini-live-transcribe";
    this.label = "Gemini 3.5 Transcribe Live";
    this.tokenUrl = tokenUrl;
    this.inputGain = Math.min(8, Math.max(1, Number(inputGain) || 1));
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
    this.pendingSamples = [];
    this.setupResolver = null;
    this.setupRejecter = null;
    this.stopResolver = null;
    this.firstAudioSent = false;
    this.lastLevelDebugAt = 0;
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

  async fetchToken() {
    const url = normalizeTokenUrl(this.tokenUrl);
    this.debug("token-request", new URL(url).origin);

    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        "Gemini token request failed (" +
          response.status +
          ")" +
          (detail ? ": " + detail.slice(0, 160) : ""),
      );
    }

    const payload = await response.json();
    if (!payload.token || typeof payload.token !== "string") {
      throw new Error("Gemini token response did not include a token.");
    }

    this.debug("token-ready");
    return payload.token;
  }

  async openSocket(token) {
    const url =
      GEMINI_WS_BASE + "?access_token=" + encodeURIComponent(token);
    const socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    await new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error("Timed out connecting to Gemini Live."));
      }, OPEN_TIMEOUT_MS);

      socket.addEventListener(
        "open",
        () => {
          window.clearTimeout(timeout);
          this.debug("ws-open");
          resolve();
        },
        { once: true },
      );

      socket.addEventListener(
        "error",
        () => {
          window.clearTimeout(timeout);
          reject(new Error("Could not connect to Gemini Live."));
        },
        { once: true },
      );
    });

    socket.addEventListener("message", (event) => {
      void this.handleMessage(event);
    });
    socket.addEventListener("close", (event) => {
      this.debug("ws-close", "code=" + event.code);

      if (this.setupRejecter) {
        this.setupRejecter(new Error("Gemini Live closed before setup completed."));
        this.clearSetupWaiters();
      }

      if (this.stopResolver) {
        this.stopResolver();
        this.stopResolver = null;
      }

      if (this.active && !this.stopping) {
        this.onError({
          providerId: this.id,
          code: "gemini-closed",
          message: "Gemini Live connection closed.",
        });
      }
    });
  }

  clearSetupWaiters() {
    this.setupResolver = null;
    this.setupRejecter = null;
  }

  async handleMessage(event) {
    const text = await decodeWebSocketData(event.data);
    if (!text) {
      this.debug(
        "ws-unsupported-frame",
        Object.prototype.toString.call(event.data),
      );
      return;
    }

    let message;
    try {
      message = JSON.parse(text);
    } catch {
      this.debug("ws-invalid-json");
      return;
    }

    if (message.setupComplete !== undefined) {
      this.debug("setup-complete");
      if (this.setupResolver) {
        this.setupResolver();
        this.clearSetupWaiters();
      }
      return;
    }

    const content = message.serverContent;
    if (!content) {
      if (message.goAway) {
        this.debug("go-away");
      }
      return;
    }

    const interim = content.interimInputTranscription?.text?.trim() || "";
    if (interim) {
      this.debug("interim");
      this.onPartial({
        text: interim,
        providerId: this.id,
        timestamp: Date.now(),
      });
    }

    const finalText = content.inputTranscription?.text?.trim() || "";
    if (finalText) {
      this.debug("final");
      this.onFinal({
        text: finalText,
        providerId: this.id,
        timestamp: Date.now(),
      });
      this.onPartial({
        text: "",
        providerId: this.id,
        timestamp: Date.now(),
      });

      if (this.stopping && this.stopResolver) {
        this.stopResolver();
        this.stopResolver = null;
      }
    }

    if (this.stopping && content.turnComplete && this.stopResolver) {
      this.stopResolver();
      this.stopResolver = null;
    }
  }

  sendSetup() {
    this.socket.send(
      JSON.stringify({
        setup: {
          model: "models/" + GEMINI_MODEL,
          generationConfig: {
            responseModalities: ["TEXT"],
          },
          inputAudioTranscription: {
            languageCodes: [],
            mode: "VERBATIM",
          },
        },
      }),
    );
    this.debug("setup-sent", GEMINI_MODEL);
  }

  async waitForSetup() {
    await new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.clearSetupWaiters();
        reject(new Error("Gemini Live setup timed out."));
      }, SETUP_TIMEOUT_MS);

      this.setupResolver = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      this.setupRejecter = (error) => {
        window.clearTimeout(timeout);
        reject(error);
      };
    });
  }

  sendAudioChunk(samples) {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    socket.send(
      JSON.stringify({
        realtimeInput: {
          audio: {
            data: pcm16Base64(samples),
            mimeType: "audio/pcm;rate=16000",
          },
        },
      }),
    );

    if (!this.firstAudioSent) {
      this.firstAudioSent = true;
      this.debug("audio-first-chunk", "samples=" + samples.length);
    }
  }

  pushResampledSamples(samples) {
    for (let i = 0; i < samples.length; i += 1) {
      this.pendingSamples.push(samples[i]);
    }

    while (this.pendingSamples.length >= TARGET_CHUNK_SAMPLES) {
      const chunk = new Float32Array(
        this.pendingSamples.splice(0, TARGET_CHUNK_SAMPLES),
      );
      this.sendAudioChunk(chunk);
    }
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
    this.pendingSamples = [];

    this.processorNode.onaudioprocess = (event) => {
      if (!this.active || this.stopping) return;

      const input = event.inputBuffer.getChannelData(0);
      const resampled = resampleLinear(
        input,
        this.audioContext.sampleRate,
        TARGET_SAMPLE_RATE,
      );
      const processed = processInputAudio(resampled, this.inputGain);
      const now = Date.now();

      if (now - this.lastLevelDebugAt >= 1000) {
        this.lastLevelDebugAt = now;
        this.debug(
          "audio-level",
          "gain=" + this.inputGain.toFixed(2) +
            "x raw-rms=" + processed.rawRmsDbfs.toFixed(1) +
            "dBFS raw-peak=" + processed.rawPeakDbfs.toFixed(1) +
            "dBFS out-peak=" + processed.outputPeakDbfs.toFixed(1) +
            "dBFS clipped=" + processed.clippedPercent.toFixed(2) + "%",
        );
      }

      this.pushResampledSamples(processed.samples);
    };

    this.sourceNode.connect(this.processorNode);
    this.processorNode.connect(this.zeroGainNode);
    this.zeroGainNode.connect(this.audioContext.destination);

    this.debug(
      "capture-ready",
      "source-rate=" + this.audioContext.sampleRate +
        ", target-rate=16000, gain=" + this.inputGain.toFixed(2) + "x",
    );
  }

  async start() {
    if (this.active) return;

    this.active = true;
    this.stopping = false;
    this.segmentId += 1;
    this.firstAudioSent = false;
    this.lastLevelDebugAt = 0;

    this.onStatus({
      state: "connecting",
      providerId: this.id,
      label: this.label,
    });
    this.debug("provider-start");

    try {
      const token = await this.fetchToken();
      await this.openSocket(token);

      const setupPromise = this.waitForSetup();
      this.sendSetup();
      await setupPromise;

      await this.startCapture();

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
      this.socket = null;
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
    this.pendingSamples = [];

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
      this.stopping = false;
      this.debug("provider-stopped");
      return;
    }

    if (socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          realtimeInput: {
            audioStreamEnd: true,
          },
        }),
      );
      this.debug("audio-stream-end-sent");
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
    this.clearSetupWaiters();
    if (this.stopResolver) {
      this.stopResolver();
      this.stopResolver = null;
    }
  }
}
