import { requestedAudioConstraints } from "./capture-profile.mjs?v=20261125-edison-local-stability2";

const SAMPLE_RATE = 16_000;
const MAX_SECONDS = 15 * 60;
const MAX_SEGMENT_SECONDS = 2.5;
const MAX_SEGMENT_SAMPLES = Math.round(MAX_SEGMENT_SECONDS * SAMPLE_RATE);
const SILENCE_HANGOVER_SAMPLES = Math.round(0.45 * SAMPLE_RATE);
const PRE_ROLL_SAMPLES = Math.round(0.2 * SAMPLE_RATE);
const OVERLAP_SAMPLES = Math.round(0.25 * SAMPLE_RATE);
const MIN_SPEECH_SAMPLES = Math.round(0.15 * SAMPLE_RATE);
const SPEECH_RMS_THRESHOLD = 0.012;
const MAX_PENDING_SEGMENTS = 20;
const LOCAL_MODELS = new Set([
  "whisper-large-v3-turbo",
  "qwen3-asr-1.7b-q8",
  "breeze-asr-26-q5",
]);
const PRELOAD_MODELS = new Set([
  "qwen3-asr-1.7b-q8",
  "breeze-asr-26-q5",
]);

function isLoopback(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

async function fetchEdison(url, options, fetchImpl = fetch) {
  try {
    return await fetchImpl(url, options);
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new Error("Edison 本機服務連線中斷；請確認服務狀態。未轉送雲端。");
  }
}

async function checkEdisonHealth(endpoint, { fetchImpl = fetch, signal } = {}) {
  let response;
  try {
    response = await fetchEdison(endpoint + "/health", {
      cache: "no-store", credentials: "omit", signal,
    }, fetchImpl);
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new Error("無法連線至 Edison 本機服務；請確認 127.0.0.1:8765 正在執行。未轉送雲端。");
  }
  if (!response.ok) throw new Error("Edison 本機服務目前無法使用；未轉送雲端。");
  return response;
}

export function validateEdisonLocalEndpoint(endpoint, pageUrl) {
  const page = new URL(pageUrl);
  const target = new URL(endpoint, page);
  if (page.protocol !== "http:" || !isLoopback(page.hostname)) {
    throw new Error("Edison 本機 ASR 只可由同一台電腦上的 localhost 網頁使用。");
  }
  if (target.protocol !== "http:" || target.hostname !== "127.0.0.1" ||
      target.username || target.password || target.search || target.hash || target.pathname !== "/") {
    throw new Error("Edison URL 必須使用 127.0.0.1 的本機 HTTP listener，不接受其他主機或帶路徑的 URL。");
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

export async function submitEdisonAudio({ endpoint, model, wav, language = "zh", fetchImpl = fetch, signal }) {
  if (!LOCAL_MODELS.has(model)) throw new Error("不支援所選的 Edison ASR 模型。");
  if (!["auto", "zh", "en"].includes(language)) throw new Error("不支援所選的 Edison 語言模式。");
  await checkEdisonHealth(endpoint, { fetchImpl, signal });
  const form = new FormData();
  form.append("file", wav, "hearlens-local-capture.wav");
  form.append("model", model);
  form.append("language", language);
  form.append("response_format", "verbose_json");
  const response = await fetchEdison(endpoint + "/v1/audio/transcriptions", {
    method: "POST",
    body: form,
    cache: "no-store",
    credentials: "omit",
    signal,
  }, fetchImpl);
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("Edison 本機 ASR 回傳無法讀取的結果。");
  }
  if (!response.ok) {
    throw new Error(typeof result?.detail === "string" ? result.detail : "Edison 本機轉錄失敗。");
  }
  if (typeof result?.text !== "string" || (!result.text.trim() && result.no_speech !== true)) {
    throw new Error("Edison 本機 ASR 沒有回傳逐字稿。");
  }
  return result;
}

async function readEdisonJson(response, fallback) {
  try {
    return await response.json();
  } catch {
    throw new Error(fallback);
  }
}

function delayOrAbort(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener("abort", abort);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      cleanup();
      reject(new DOMException("模型載入已取消。", "AbortError"));
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}

export async function ensureEdisonModelLoaded({ endpoint, model, fetchImpl = fetch, signal,
  onStatus = () => {}, pollIntervalMs = 750, timeoutMs = 240_000 }) {
  if (!PRELOAD_MODELS.has(model)) {
    return { state: "deferred", detail: "Whisper 會由 Edison 在第一段轉錄前載入並檢查 GPU。" };
  }
  const statusUrl = endpoint + "/api/v1/asr/status";
  const readStatus = async () => {
    const response = await fetchEdison(statusUrl, { cache: "no-store", credentials: "omit", signal }, fetchImpl);
    const value = await readEdisonJson(response, "無法讀取 Edison 模型狀態。");
    if (!response.ok) throw new Error(value?.detail || "無法讀取 Edison 模型狀態。");
    return value;
  };
  let status = await readStatus();
  if (status.active_model_id === model && ["available", "busy"].includes(status.status)) return status;

  onStatus({ providerId: "edison-local-asr", state: "loading", label: `Edison 正在檢查 GPU 並載入 ${model}…` });
  const load = await fetchEdison(endpoint + `/api/v1/asr/models/${encodeURIComponent(model)}/load`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    cache: "no-store",
    credentials: "omit",
    signal,
  }, fetchImpl);
  const loadResult = await readEdisonJson(load, "Edison 無法啟動模型載入。");
  if (!load.ok) throw new Error(loadResult?.detail || "Edison 無法啟動模型載入。");
  if (loadResult?.state === "available") return { ...status, ...loadResult, status: "available", active_model_id: model };

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new DOMException("模型載入已取消。", "AbortError");
    await delayOrAbort(pollIntervalMs, signal);
    status = await readStatus();
    if (status.active_model_id === model && ["available", "busy"].includes(status.status)) return status;
    if (status.status === "error" && !status.loading_model_id) {
      throw new Error(status.last_error || "Edison 模型載入失敗。");
    }
    if (status.loading_model_id && status.loading_model_id !== model) {
      throw new Error("Edison 正在載入另一個 ASR 模型，請稍後重試。");
    }
  }
  throw new Error("Edison 模型載入逾時；請查看 Edison GPU 與模型狀態。");
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
    this.label = "Edison 本機分段 ASR（Experimental）";
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
    this.trackEndListeners = [];
    this.audioContext = null;
    this.sourceNode = null;
    this.processorNode = null;
    this.zeroGainNode = null;
    this.currentChunks = [];
    this.currentSamples = 0;
    this.currentSpeechSamples = 0;
    this.silenceSamples = 0;
    this.preRoll = new Float32Array();
    this.overlapPrefix = new Float32Array();
    this.pendingSegments = [];
    this.drainPromise = null;
    this.requestAbort = null;
    this.startupAbort = null;
    this.fatalError = false;
    this.totalCaptureSamples = 0;
    this.lastEmittedText = "";
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
    const startupAbort = new AbortController();
    this.startupAbort = startupAbort;
    this.currentChunks = [];
    this.currentSamples = 0;
    this.currentSpeechSamples = 0;
    this.silenceSamples = 0;
    this.preRoll = new Float32Array();
    this.overlapPrefix = new Float32Array();
    this.pendingSegments = [];
    this.totalCaptureSamples = 0;
    this.lastEmittedText = "";
    this.firstAudioAt = 0;
    this.lastLevelAt = 0;
    this.fatalError = false;
    this.segmentId += 1;
    this.onStatus({ providerId: this.id, state: "connecting", label: this.label });
    try {
      await checkEdisonHealth(this.endpoint, { signal: startupAbort.signal });
      if (generation !== this.generation) return;
      const modelState = await ensureEdisonModelLoaded({ endpoint: this.endpoint, model: this.model,
        signal: startupAbort.signal, onStatus: this.onStatus });
      if (generation !== this.generation || this.stopping) return;
      if (modelState.status === "busy") {
        this.onStatus({ providerId: this.id, state: "processing", label: "Edison 模型已載入，GPU 目前忙碌；字幕片段會依序排隊" });
      }
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
        this.totalCaptureSamples += chunk.length;
        const now = Date.now();
        if (!this.firstAudioAt) {
          this.firstAudioAt = now;
          this.debug("audio-first-chunk", `samples=${chunk.length}`);
        }
        if (this.totalCaptureSamples > MAX_SECONDS * SAMPLE_RATE) {
          void this.fail("capture-limit", "本機字幕收音已達 15 分鐘上限，請停止後重新開始。", true);
          return;
        }
        const rms = Math.sqrt(input.reduce((sum, value) => sum + value * value, 0) / Math.max(1, input.length));
        const isSpeech = rms >= SPEECH_RMS_THRESHOLD;
        if (now - this.lastLevelAt >= 1000) {
          this.lastLevelAt = now;
          this.debug("audio-level", `rms=${rms.toFixed(4)}`);
        }

        if (isSpeech) {
          if (!this.currentChunks.length) {
            if (this.overlapPrefix.length) {
              this.currentChunks.push(this.overlapPrefix);
              this.currentSamples += this.overlapPrefix.length;
              this.overlapPrefix = new Float32Array();
            } else if (this.preRoll.length) {
              this.currentChunks.push(this.preRoll);
              this.currentSamples += this.preRoll.length;
            }
            this.currentSpeechSamples = 0;
            this.silenceSamples = 0;
          }
          this.currentChunks.push(chunk);
          this.currentSamples += chunk.length;
          this.currentSpeechSamples += chunk.length;
          this.silenceSamples = 0;
          this.preRoll = new Float32Array();
          if (this.currentSpeechSamples >= MAX_SEGMENT_SAMPLES) this.finalizeSegment("max-duration");
        } else if (this.currentChunks.length) {
          this.currentChunks.push(chunk);
          this.currentSamples += chunk.length;
          this.silenceSamples += chunk.length;
          if (this.silenceSamples >= SILENCE_HANGOVER_SAMPLES) this.finalizeSegment("vad-silence");
        } else {
          if (this.overlapPrefix.length) {
            this.silenceSamples += chunk.length;
            if (this.silenceSamples >= SILENCE_HANGOVER_SAMPLES) {
              this.overlapPrefix = new Float32Array();
              this.silenceSamples = 0;
            }
          }
          this.preRoll = keepTail(this.preRoll, chunk, PRE_ROLL_SAMPLES);
        }
      };
      this.captureStartedAt = Date.now();
      this.active = true;
      for (const track of stream.getTracks?.() ?? []) {
        if (typeof track.addEventListener !== "function") continue;
        const listener = () => {
          if (generation !== this.generation || !this.active || this.stopping) return;
          void this.fail("microphone-track-ended",
            "本機麥克風串流已中斷，Edison 收音已停止；請確認麥克風後重新開始。", true);
        };
        track.addEventListener("ended", listener, { once: true });
        this.trackEndListeners.push({ track, listener });
      }
      if ((stream.getTracks?.() ?? []).some(track => track.readyState === "ended")) {
        throw new Error("本機麥克風串流已中斷，請確認麥克風後重新開始。");
      }
      this.sourceNode.connect(this.processorNode);
      this.processorNode.connect(this.zeroGainNode);
      this.zeroGainNode.connect(context.destination);
    } catch (error) {
      if (generation === this.generation) {
        this.active = false;
        await this.releaseCapture();
        this.stopping = false;
      }
      if (generation !== this.generation || startupAbort.signal.aborted) return;
      throw error;
    } finally {
      if (this.startupAbort === startupAbort) this.startupAbort = null;
    }
    this.onStatus({ providerId: this.id, state: "listening", label: "本機分段字幕 Beta：語音片段會送到本機 Edison" });
    this.debug("capture-ready", `model=${this.model}; mode=vad-segments; segment-max=${MAX_SEGMENT_SECONDS}s; overlap=${OVERLAP_SAMPLES / SAMPLE_RATE}s; sample-rate=${SAMPLE_RATE}`);
  }

  finalizeSegment(reason) {
    if (!this.currentChunks.length) return;
    const chunks = this.currentChunks;
    const sampleCount = this.currentSamples;
    const speechSamples = this.currentSpeechSamples;
    const silenceSamples = this.silenceSamples;
    const startSample = Math.max(0, this.totalCaptureSamples - sampleCount);
    this.currentChunks = [];
    this.currentSamples = 0;
    this.currentSpeechSamples = 0;
    this.silenceSamples = 0;
    if (reason === "max-duration") this.overlapPrefix = tailSamples(chunks, OVERLAP_SAMPLES);
    else this.overlapPrefix = new Float32Array();
    if (speechSamples < MIN_SPEECH_SAMPLES) return;
    if (this.pendingSegments.length >= MAX_PENDING_SEGMENTS) {
      void this.fail("local-asr-overloaded", "本機 ASR 處理速度跟不上收音，為避免字幕延遲持續累積，已停止本機收音。", true);
      return;
    }
    const segment = {
      chunks,
      timestamp: this.captureStartedAt + Math.max(0, Math.round(startSample * 1000 / SAMPLE_RATE)),
      duration: sampleCount / SAMPLE_RATE,
    };
    this.pendingSegments.push(segment);
    this.debug("segment-queued", `reason=${reason}; duration=${segment.duration.toFixed(2)}s; pending=${this.pendingSegments.length}; silence=${(silenceSamples / SAMPLE_RATE).toFixed(2)}s`);
    void this.drainQueue();
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
    for (const { track, listener } of this.trackEndListeners.splice(0)) {
      try { track.removeEventListener?.("ended", listener); } catch { /* track already ended */ }
    }
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
    const startupAbort = this.startupAbort;
    if (startupAbort) {
      this.generation += 1;
      startupAbort.abort();
      if (this.startupAbort === startupAbort) this.startupAbort = null;
    }
    if (hadCapture && this.currentChunks.length) this.finalizeSegment("user-stop");
    await this.releaseCapture();
    if (!hadCapture && !this.pendingSegments.length && !this.drainPromise) {
      this.stopping = false;
      if (startupAbort) {
        this.onStatus({ providerId: this.id, state: "stopped", label: "Edison 本機收音啟動已取消" });
        this.debug("startup-cancelled", "stop-request");
      }
      return;
    }
    if (!this.pendingSegments.length && !this.drainPromise) {
      this.stopping = false;
      this.onError({ providerId: this.id, code: "no-speech", message: "沒有偵測到可辨識的語音。", fatal: false });
      this.onStatus({ providerId: this.id, state: "error", label: "沒有偵測到可辨識的語音" });
      return;
    }
    this.onStatus({ providerId: this.id, state: "processing", label: "正在完成佇列中的本機字幕片段" });
    try {
      await this.drainQueue();
      if (!this.fatalError) this.onStatus({ providerId: this.id, state: "stopped", label: "Edison 本機分段辨識完成" });
    } finally {
      this.stopping = false;
    }
  }

  async drainQueue() {
    if (this.drainPromise) return this.drainPromise;
    const generation = this.generation;
    const drainPromise = (async () => {
      while (generation === this.generation && this.pendingSegments.length && !this.fatalError) {
        const segment = this.pendingSegments.shift();
        this.onStatus({ providerId: this.id, state: "processing", label: `Edison 本機辨識中；待處理 ${this.pendingSegments.length} 段` });
        this.debug("segment-submit", `duration=${segment.duration.toFixed(2)}s; pending=${this.pendingSegments.length}`);
        const controller = new AbortController();
        this.requestAbort = controller;
        const timeout = window.setTimeout(() => controller.abort(), 120_000);
        try {
          const wav = encodeWav16kMono(segment.chunks);
          const result = await submitEdisonAudio({ endpoint: this.endpoint, model: this.model, wav,
            language: this.languageMode, fetchImpl: fetch, signal: controller.signal });
          if (generation !== this.generation || this.fatalError) break;
          const receivedAt = Date.now();
          const segmentDuration = Number.isFinite(segment.duration) ? Math.max(0, segment.duration) : 0;
          const outputs = Array.isArray(result.segments) && result.segments.length
            ? result.segments.map(item => {
              const requestedStart = Number(item?.start);
              const start = Number.isFinite(requestedStart)
                ? Math.min(segmentDuration, Math.max(0, requestedStart))
                : 0;
              return { text: item?.text, start };
            })
            : [{ text: result.text, start: 0 }];
          for (const item of outputs) {
            const text = removeTranscriptOverlap(item.text || "", this.lastEmittedText);
            if (!text) continue;
            this.lastEmittedText = (this.lastEmittedText + " " + text).slice(-240);
            this.onFinal({ providerId: this.id, text,
              timestamp: segment.timestamp + Math.max(0, Math.round(item.start * 1000)), latencyTimestamp: receivedAt });
          }
          this.onStatus({ providerId: this.id, state: this.active ? "listening" : "processing",
            label: this.active ? `本機收音中；待辨識 ${this.pendingSegments.length} 段` : "正在完成本機字幕片段" });
          this.debug("segment-complete", `model=${this.model}; audio=${Number(result.duration || segment.duration).toFixed(2)}s; pending=${this.pendingSegments.length}`);
        } catch (error) {
          if (generation !== this.generation || this.fatalError) break;
          const message = error?.name === "AbortError"
            ? "Edison 本機 ASR 等待逾時，已停止本機收音；請確認 Edison 服務與 GPU 狀態。"
            : (error instanceof Error ? error.message : "Edison 本機轉錄失敗。");
          await this.fail("edison-local-asr-failed", message, true);
        } finally {
          window.clearTimeout(timeout);
          if (this.requestAbort === controller) this.requestAbort = null;
        }
      }
    })();
    try {
      this.drainPromise = drainPromise;
      await drainPromise;
    } finally {
      if (this.drainPromise === drainPromise) this.drainPromise = null;
      if (generation !== this.generation && !this.fatalError && this.pendingSegments.length) {
        void this.drainQueue();
      }
    }
  }

  async fail(code, message, fatal) {
    if (this.fatalError) return;
    this.fatalError = true;
    this.active = false;
    this.pendingSegments = [];
    this.currentChunks = [];
    this.currentSamples = 0;
    this.requestAbort?.abort();
    await this.releaseCapture();
    this.onError({ providerId: this.id, code, message, fatal });
    this.onStatus({ providerId: this.id, state: "error", label: message });
    this.debug("provider-failed", code);
  }

  async dispose() {
    this.generation += 1;
    this.active = false;
    this.stopping = true;
    this.fatalError = true;
    const drainPromise = this.drainPromise;
    this.startupAbort?.abort();
    this.startupAbort = null;
    this.requestAbort?.abort();
    await this.releaseCapture();
    this.currentChunks = [];
    this.currentSamples = 0;
    this.pendingSegments = [];
    if (drainPromise) await drainPromise;
    this.stopping = false;
    if (!this.fatalError) this.onStatus({ providerId: this.id, state: "stopped", label: "Edison 本機收音已取消" });
  }
}

function keepTail(previous, next, limit) {
  if (next.length >= limit) return next.slice(next.length - limit);
  const joined = new Float32Array(previous.length + next.length);
  joined.set(previous);
  joined.set(next, previous.length);
  return joined.length > limit ? joined.slice(joined.length - limit) : joined;
}

function tailSamples(chunks, limit) {
  let remaining = limit;
  const tail = [];
  for (let index = chunks.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const chunk = chunks[index];
    const take = Math.min(remaining, chunk.length);
    tail.unshift(chunk.slice(chunk.length - take));
    remaining -= take;
  }
  const result = new Float32Array(limit - remaining);
  let offset = 0;
  for (const chunk of tail) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export function removeTranscriptOverlap(nextText, previousText) {
  const next = String(nextText || "").trim();
  const previous = String(previousText || "").trim();
  if (!next || !previous) return next;
  const normalized = value => [...value.normalize("NFKC").toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, "")];
  const oldChars = normalized(previous.slice(-100));
  const newChars = normalized(next);
  const max = Math.min(oldChars.length, newChars.length);
  let overlap = 0;
  for (let size = max; size >= 2; size -= 1) {
    if (oldChars.slice(-size).join("") === newChars.slice(0, size).join("")) {
      overlap = size;
      break;
    }
  }
  if (!overlap) return next;
  let seen = 0;
  let cut = 0;
  for (const match of next.matchAll(/[\p{L}\p{N}]/gu)) {
    if (seen === overlap) break;
    seen += normalized(match[0]).length;
    cut = match.index + match[0].length;
  }
  return next.slice(cut).replace(/^[\s\p{P}\p{S}]+/u, "").trim();
}
