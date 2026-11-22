import { requestedAudioConstraints } from "./capture-profile.mjs";
import { encodePcm16Wav, resampleMonoLinear } from "./local-taigi-audio.mjs";

const LOCAL_API = "http://127.0.0.1:8765/v1";
const TARGET_SAMPLE_RATE = 16_000;
const CHUNK_SECONDS = 12;
const MIN_FINAL_SECONDS = 0.75;
const MAX_IN_FLIGHT = 2;
const HEALTH_TIMEOUT_MS = 4_000;
const TRANSCRIBE_TIMEOUT_MS = 90_000;

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal, cache: "no-store" });
  } finally {
    window.clearTimeout(timer);
  }
}

export class LocalTaigiProvider {
  constructor({
    captureMode = "raw",
    onPartial = () => {},
    onFinal = () => {},
    onStatus = () => {},
    onError = () => {},
    onDebug = () => {},
  } = {}) {
    this.id = "local-taigi";
    this.label = "台語本機模型（CPU INT8）";
    this.onPartial = onPartial;
    this.onFinal = onFinal;
    this.onStatus = onStatus;
    this.onError = onError;
    this.onDebug = onDebug;
    this.captureMode = captureMode;
    this.active = false;
    this.stopping = false;
    this.stream = null;
    this.audioContext = null;
    this.sourceNode = null;
    this.processorNode = null;
    this.silentGainNode = null;
    this.frameQueue = [];
    this.frameQueueLength = 0;
    this.frameQueueOffset = 0;
    this.pendingJobs = new Set();
    this.abortControllers = new Set();
    this.captureShutdownPromise = null;
    this.segmentId = 0;
    this.nextSegmentToEmit = 1;
    this.completedSegments = new Map();
    this.firstChunkSent = false;
    this.startEpoch = 0;
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

  async checkLocalModel() {
    let response;
    try {
      response = await fetchWithTimeout(
        LOCAL_API + "/health", { method: "GET" }, HEALTH_TIMEOUT_MS,
      );
    } catch {
      throw new Error("本機台語模型尚未啟動。請先依 docs/LOCAL_TAIGI.md 安裝並啟動本機服務。");
    }
    if (!response.ok) {
      throw new Error("本機台語模型尚未就緒。請先依 docs/LOCAL_TAIGI.md 啟動本機服務。");
    }
    const health = await response.json();
    if (health?.device !== "cpu" || health?.compute_type !== "int8" || health?.ready !== true) {
      throw new Error("本機台語服務沒有回報 CPU INT8 模型就緒。");
    }
    this.debug("local-model-ready", health.model || "Breeze-ASR-26");
  }

  async start() {
    if (this.active || this.stopping) throw new Error("本機台語字幕已在啟動或聆聽中。");
    const epoch = ++this.startEpoch;
    this.segmentId = 0;
    this.nextSegmentToEmit = 1;
    this.completedSegments.clear();
    this.firstChunkSent = false;
    this.active = true;
    try {
      await this.checkLocalModel();
      this.assertStartCurrent(epoch);
      const constraints = requestedAudioConstraints(this.captureMode);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints, video: false });
      if (this.startEpoch !== epoch || !this.active || this.stopping) {
        for (const track of stream.getTracks()) track.stop();
        throw new Error("本機台語字幕啟動已取消。");
      }
      this.stream = stream;
      const track = stream.getAudioTracks()[0];
      if (!track) throw new Error("沒有取得可用的麥克風。");

      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error("此瀏覽器沒有可用的 AudioContext。");
      this.audioContext = new AudioContextClass({ latencyHint: "interactive" });
      if (this.audioContext.state === "suspended") await this.audioContext.resume();
      this.assertStartCurrent(epoch);
      const sourceRate = this.audioContext.sampleRate;
      if (!Number.isFinite(sourceRate) || sourceRate < 8_000) {
        throw new Error("麥克風取樣率不支援本機台語模型。");
      }
      this.sourceRate = sourceRate;

      this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
      this.processorNode = this.audioContext.createScriptProcessor(4096, 1, 1);
      this.silentGainNode = this.audioContext.createGain();
      this.silentGainNode.gain.value = 0;
      this.processorNode.onaudioprocess = event => this.handleAudio(event, sourceRate);
      this.sourceNode.connect(this.processorNode);
      this.processorNode.connect(this.silentGainNode);
      this.silentGainNode.connect(this.audioContext.destination);

      this.onStatus({ state: "listening", providerId: this.id, label: this.label });
      this.debug("capture-ready", JSON.stringify(track.getSettings?.() || {}));
    } catch (error) {
      this.active = false;
      await this.shutdownCapture();
      throw error;
    }
  }

  assertStartCurrent(epoch) {
    if (this.startEpoch !== epoch || !this.active || this.stopping) {
      throw new Error("本機台語字幕啟動已取消。");
    }
  }

  handleAudio(event, sourceRate) {
    if (!this.active || this.stopping) return;
    const input = event.inputBuffer.getChannelData(0);
    this.frameQueue.push(input.slice());
    this.frameQueueLength += input.length;
    const chunkSize = Math.round(sourceRate * CHUNK_SECONDS);
    while (this.frameQueueLength >= chunkSize && this.active) {
      const samples = this.takeSamples(chunkSize);
      this.submitSamples(samples, sourceRate);
    }
  }

  takeSamples(sampleCount) {
    const result = new Float32Array(sampleCount);
    let offset = 0;
    while (offset < sampleCount && this.frameQueue.length) {
      const head = this.frameQueue[0];
      const available = head.length - this.frameQueueOffset;
      const count = Math.min(available, sampleCount - offset);
      result.set(head.subarray(this.frameQueueOffset, this.frameQueueOffset + count), offset);
      offset += count;
      this.frameQueueLength -= count;
      this.frameQueueOffset += count;
      if (this.frameQueueOffset === head.length) {
        this.frameQueue.shift();
        this.frameQueueOffset = 0;
      }
    }
    return offset === sampleCount ? result : result.slice(0, offset);
  }

  submitSamples(samples, sourceRate) {
    if (!samples.length) return;
    if (this.pendingJobs.size >= MAX_IN_FLIGHT) {
      this.failClosed("local-asr-overloaded", "本機模型來不及處理語音，已停止收音。請稍候再開始。");
      return;
    }
    const pcm = resampleMonoLinear(samples, sourceRate, TARGET_SAMPLE_RATE);
    const wav = encodePcm16Wav(pcm, TARGET_SAMPLE_RATE);
    this.segmentId += 1;
    if (!this.firstChunkSent) {
      this.firstChunkSent = true;
      this.debug("audio-first-chunk", "local-cpu");
    }
    const job = this.transcribe(wav, this.segmentId)
      .catch(error => {
        if (!this.stopping && this.active) {
          this.failClosed("local-asr-failed", error instanceof Error ? error.message : "本機辨識失敗。");
        } else {
          this.onError({
            providerId: this.id,
            code: "local-asr-failed",
            message: error instanceof Error ? error.message : "本機辨識失敗。",
            fatal: false,
          });
        }
      })
      .finally(() => this.pendingJobs.delete(job));
    this.pendingJobs.add(job);
  }

  async transcribe(wav, segmentId) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), TRANSCRIBE_TIMEOUT_MS);
    this.abortControllers.add(controller);
    try {
      const response = await fetch(LOCAL_API + "/transcribe", {
        method: "POST",
        headers: { "Content-Type": "audio/wav" },
        body: wav,
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || "本機台語模型無法辨識這段語音。");
      }
      const result = await response.json();
      if (typeof result.text !== "string") throw new Error("本機台語服務回傳格式錯誤。");
      const text = result.text.trim();
      this.debug("local-transcript", "chunk=" + segmentId + ", chars=" + text.length);
      this.completeSegment(segmentId, text);
    } finally {
      window.clearTimeout(timer);
      this.abortControllers.delete(controller);
    }
  }

  completeSegment(segmentId, text) {
    this.completedSegments.set(segmentId, text);
    while (this.completedSegments.has(this.nextSegmentToEmit)) {
      const nextText = this.completedSegments.get(this.nextSegmentToEmit);
      this.completedSegments.delete(this.nextSegmentToEmit);
      this.nextSegmentToEmit += 1;
      if (nextText && !this.disposed) {
        this.onFinal({ text: nextText, providerId: this.id, timestamp: Date.now() });
      }
    }
  }

  failClosed(code, message) {
    if (!this.active || this.stopping) return;
    this.active = false;
    this.debug("fatal", code);
    void this.shutdownCapture();
    this.onError({ providerId: this.id, code, message, fatal: true });
  }

  async shutdownCapture() {
    if (this.captureShutdownPromise) return this.captureShutdownPromise;
    this.captureShutdownPromise = (async () => {
      if (this.processorNode) this.processorNode.onaudioprocess = null;
      for (const node of [this.sourceNode, this.processorNode, this.silentGainNode]) {
        try { node?.disconnect(); } catch { /* already disconnected */ }
      }
      this.sourceNode = null;
      this.processorNode = null;
      this.silentGainNode = null;
      if (this.stream) {
        for (const track of this.stream.getTracks()) track.stop();
        this.stream = null;
      }
      if (this.audioContext && this.audioContext.state !== "closed") {
        await this.audioContext.close();
      }
      this.audioContext = null;
    })();
    return this.captureShutdownPromise;
  }

  async stop() {
    if (!this.active && !this.stopping) {
      await this.captureShutdownPromise;
      return;
    }
    this.stopping = true;
    this.startEpoch += 1;
    await this.shutdownCapture();
    const actualSourceRate = this.sourceRate || TARGET_SAMPLE_RATE;
    const minimumTail = Math.round(actualSourceRate * MIN_FINAL_SECONDS);
    const tail = this.frameQueueLength >= minimumTail
      ? this.takeSamples(this.frameQueueLength)
      : null;
    if (tail) await Promise.allSettled([...this.pendingJobs]);
    if (tail) {
      this.submitSamples(tail, actualSourceRate);
    } else {
      this.frameQueue = [];
      this.frameQueueLength = 0;
      this.frameQueueOffset = 0;
    }
    this.active = false;
    await Promise.allSettled([...this.pendingJobs]);
    this.stopping = false;
    this.onPartial({ text: "", providerId: this.id, timestamp: Date.now() });
    this.onStatus({ state: "stopped", providerId: this.id, label: this.label });
  }

  async dispose() {
    this.disposed = true;
    this.active = false;
    this.stopping = true;
    for (const controller of this.abortControllers) controller.abort();
    await this.shutdownCapture();
    this.frameQueue = [];
    this.frameQueueLength = 0;
    this.frameQueueOffset = 0;
    this.completedSegments.clear();
    this.stopping = false;
  }
}
