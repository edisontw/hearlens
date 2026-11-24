import { requestedAudioConstraints } from "./capture-profile.mjs?v=20261124-edison-local1";

const SAMPLE_RATE = 16_000;
const MAX_SECONDS = 15 * 60;
const LOCAL_MODELS = new Set([
  "whisper-large-v3-turbo",
  "qwen3-asr-1.7b-q8",
  "breeze-asr-26-q5",
]);

function isLoopback(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

export function validateEdisonLocalEndpoint(endpoint, pageUrl) {
  const page = new URL(pageUrl);
  const target = new URL(endpoint, page);
  if (page.protocol !== "http:" || !isLoopback(page.hostname)) {
    throw new Error("Edison 本機 ASR 只可由同一台電腦上的 localhost 網頁使用。");
  }
  if (target.protocol !== "http:" || !isLoopback(target.hostname) ||
      target.username || target.password || target.search || target.hash || target.pathname !== "/") {
    throw new Error("Edison URL 必須是純本機 loopback HTTP 位址，不接受遠端或帶路徑的 URL。");
  }
  return target.origin;
}

export function validateEdisonLocalSelection({ endpoint, model, languageMode, pageUrl }) {
  const baseUrl = validateEdisonLocalEndpoint(endpoint, pageUrl);
  if (!LOCAL_MODELS.has(model)) throw new Error("不支援所選的 Edison ASR 模型。");
  if (!["auto", "zh", "en"].includes(languageMode)) throw new Error("不支援所選的 Edison 語言模式。");
  return baseUrl;
}

export function resampleLinear(input, sourceRate, targetRate = SAMPLE_RATE) {
  if (sourceRate === targetRate) return input.slice();
  if (!input.length || sourceRate <= 0 || targetRate <= 0) return new Float32Array();
  const ratio = sourceRate / targetRate;
  const output = new Float32Array(Math.max(1, Math.round(input.length / ratio)));
  for (let i = 0; i < output.length; i += 1) {
    const position = i * ratio;
    const left = Math.min(Math.floor(position), input.length - 1);
    const right = Math.min(left + 1, input.length - 1);
    const fraction = position - left;
    output[i] = input[left] * (1 - fraction) + input[right] * fraction;
  }
  return output;
}

export function encodeWav16kMono(chunks) {
  const sampleCount = chunks.reduce((total, chunk) => total + chunk.length, 0);
  if (!sampleCount) throw new Error("沒有收到可辨識的麥克風音訊。");
  const buffer = new ArrayBuffer(44 + sampleCount * 2);
  const view = new DataView(buffer);
  const writeText = (offset, value) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };
  writeText(0, "RIFF");
  view.setUint32(4, buffer.byteLength - 8, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, sampleCount * 2, true);
  let offset = 44;
  for (const chunk of chunks) {
    for (const raw of chunk) {
      const sample = Math.max(-1, Math.min(1, raw));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export async function submitEdisonAudio({ endpoint, model, wav, language = "zh", fetchImpl = fetch }) {
  if (!LOCAL_MODELS.has(model)) throw new Error("不支援所選的 Edison ASR 模型。");
  if (!["auto", "zh", "en"].includes(language)) throw new Error("不支援所選的 Edison 語言模式。");
  const health = await fetchImpl(endpoint + "/health", { cache: "no-store", credentials: "omit" });
  if (!health.ok) throw new Error("Edison 本機服務目前無法使用。");
  const form = new FormData();
  form.append("file", wav, "hearlens-local-capture.wav");
  form.append("model", model);
  form.append("language", language);
  form.append("response_format", "verbose_json");
  const response = await fetchImpl(endpoint + "/v1/audio/transcriptions", {
    method: "POST",
    body: form,
    cache: "no-store",
    credentials: "omit",
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("Edison 本機 ASR 回傳無法讀取的結果。");
  }
  if (!response.ok) {
    throw new Error(typeof result?.detail === "string" ? result.detail : "Edison 本機轉錄失敗。");
  }
  if (typeof result?.text !== "string" || !result.text.trim()) {
    throw new Error("Edison 本機 ASR 沒有回傳逐字稿。");
  }
  return result;
}

export class EdisonLocalAsrProvider {
  constructor({
    endpoint = "http://127.0.0.1:8765",
    model = "breeze-asr-26-q5",
    language = "zh-TW",
    languageMode = "zh",
    onPartial = () => {},
    onFinal = () => {},
    onStatus = () => {},
    onError = () => {},
    onDebug = () => {},
  } = {}) {
    this.id = "edison-local-asr";
    this.label = "Edison 本機 ASR（停止後辨識）";
    this.endpoint = endpoint;
    this.model = model;
    this.language = language;
    this.languageMode = languageMode;
    this.onPartial = onPartial;
    this.onFinal = onFinal;
    this.onStatus = onStatus;
    this.onError = onError;
    this.onDebug = onDebug;
    this.active = false;
    this.stopping = false;
    this.stream = null;
    this.audioContext = null;
    this.sourceNode = null;
    this.processorNode = null;
    this.zeroGainNode = null;
    this.chunks = [];
    this.sampleCount = 0;
    this.segmentId = 0;
    this.generation = 0;
    this.captureStartedAt = 0;
    this.firstAudioAt = 0;
    this.lastLevelAt = 0;
  }

  debug(event, detail = "") {
    this.onDebug({ providerId: this.id, event, detail, segmentId: this.segmentId, timestamp: Date.now() });
  }

  async start() {
    if (this.active) return;
    this.endpoint = validateEdisonLocalSelection({ endpoint: this.endpoint, model: this.model,
      languageMode: this.languageMode, pageUrl: window.location.href });
    if (!navigator.mediaDevices?.getUserMedia || !(window.AudioContext || window.webkitAudioContext)) {
      throw new Error("此瀏覽器無法建立本機麥克風音訊串流。");
    }
    this.stopping = false;
    this.active = false;
    const generation = ++this.generation;
    this.chunks = [];
    this.sampleCount = 0;
    this.segmentId += 1;
    this.onStatus({ providerId: this.id, state: "connecting", label: this.label });
    try {
      const health = await fetch(this.endpoint + "/health", { cache: "no-store", credentials: "omit" });
      if (!health.ok) throw new Error("Edison 本機服務目前無法使用。");
      if (generation !== this.generation) return;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: requestedAudioConstraints("raw"),
        video: false,
      });
      if (generation !== this.generation || this.stopping) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      this.stream = stream;
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const context = new AudioContextClass();
      this.audioContext = context;
      if (context.state === "suspended") await context.resume();
      if (generation !== this.generation || this.stopping) {
        await this.releaseCapture();
        return;
      }
      this.sourceNode = context.createMediaStreamSource(stream);
      this.processorNode = context.createScriptProcessor(4096, 1, 1);
      this.zeroGainNode = context.createGain();
      this.zeroGainNode.gain.value = 0;
      this.processorNode.onaudioprocess = (event) => {
        if (!this.active || this.stopping) return;
        const input = event.inputBuffer.getChannelData(0);
        const chunk = resampleLinear(input, context.sampleRate);
        if (!chunk.length) return;
        this.chunks.push(chunk);
        this.sampleCount += chunk.length;
        const now = Date.now();
        if (!this.firstAudioAt) {
          this.firstAudioAt = now;
          this.debug("audio-first-chunk", `samples=${chunk.length}`);
        }
        if (now - this.lastLevelAt >= 1000) {
          this.lastLevelAt = now;
          const rms = Math.sqrt(input.reduce((sum, value) => sum + value * value, 0) / Math.max(1, input.length));
          this.debug("audio-level", `rms=${rms.toFixed(4)}`);
        }
        if (this.sampleCount > MAX_SECONDS * SAMPLE_RATE) {
          this.onError({ providerId: this.id, code: "capture-limit", message: "本機整段辨識最多收音 15 分鐘，已停止緩衝。", fatal: true });
          void this.dispose();
        }
      };
      this.captureStartedAt = Date.now();
      this.active = true;
      this.sourceNode.connect(this.processorNode);
      this.processorNode.connect(this.zeroGainNode);
      this.zeroGainNode.connect(context.destination);
    } catch (error) {
      if (generation === this.generation) {
        this.active = false;
        await this.releaseCapture();
        this.stopping = false;
      }
      throw error;
    }
    this.onStatus({ providerId: this.id, state: "listening", label: "本機收音中；字幕會在停止後送至 Edison 辨識" });
    this.debug("capture-ready", `model=${this.model}; mode=whole-utterance; sample-rate=${SAMPLE_RATE}`);
  }

  async releaseCapture() {
    const processor = this.processorNode;
    this.processorNode = null;
    if (processor) processor.onaudioprocess = null;
    for (const node of [this.sourceNode, processor, this.zeroGainNode]) {
      try { node?.disconnect(); } catch { /* already disconnected */ }
    }
    this.sourceNode = null;
    this.zeroGainNode = null;
    const stream = this.stream;
    this.stream = null;
    for (const track of stream?.getTracks?.() ?? []) track.stop();
    const context = this.audioContext;
    this.audioContext = null;
    if (context && context.state !== "closed") await context.close();
  }

  async stop() {
    if (this.stopping) return;
    this.stopping = true;
    const hadCapture = this.active;
    this.active = false;
    await this.releaseCapture();
    const chunks = this.chunks;
    this.chunks = [];
    this.onStatus({ providerId: this.id, state: "transcribing", label: "正在使用本機 Edison 進行整段辨識" });
    try {
      if (!hadCapture || !this.sampleCount) throw new Error("沒有收到可辨識的麥克風音訊。");
      const wav = encodeWav16kMono(chunks);
      const result = await submitEdisonAudio({ endpoint: this.endpoint, model: this.model, wav,
        language: this.languageMode, fetchImpl: fetch });
      const receivedAt = Date.now();
      const captureStart = this.captureStartedAt;
      const segments = Array.isArray(result.segments) ? result.segments : [];
      if (segments.length) {
        for (const segment of segments) {
          if (typeof segment?.text === "string" && segment.text.trim()) {
            this.onFinal({ providerId: this.id, text: segment.text,
              timestamp: captureStart + Math.max(0, Math.round(Number(segment.start || 0) * 1000)),
              latencyTimestamp: receivedAt });
          }
        }
      } else {
        this.onFinal({ providerId: this.id, text: result.text, timestamp: captureStart, latencyTimestamp: receivedAt });
      }
      this.onStatus({ providerId: this.id, state: "stopped", label: "Edison 本機辨識完成" });
      this.debug("transcription-complete", `model=${this.model}; seconds=${Number(result.duration || 0).toFixed(2)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Edison 本機轉錄失敗。";
      this.onError({ providerId: this.id, code: "edison-local-asr-failed", message, fatal: false });
      this.onStatus({ providerId: this.id, state: "error", label: message });
      this.debug("transcription-failed", message);
    } finally {
      this.sampleCount = 0;
      this.stopping = false;
    }
  }

  async dispose() {
    this.generation += 1;
    this.active = false;
    this.stopping = true;
    await this.releaseCapture();
    this.chunks = [];
    this.sampleCount = 0;
    this.stopping = false;
    this.onStatus({ providerId: this.id, state: "stopped", label: "Edison 本機收音已取消" });
  }
}
