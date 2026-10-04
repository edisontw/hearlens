import { createSttProvider, describeSttCapabilities } from "./stt/provider.js";

const ROLLING_WINDOW_MS = 30_000;
const FONT_SIZES = [32, 38, 44, 50];

const els = {
  start: document.querySelector("#start"),
  stop: document.querySelector("#stop"),
  recall: document.querySelector("#recall"),
  closeRecall: document.querySelector("#close-recall"),
  fontSize: document.querySelector("#font-size"),
  caption: document.querySelector("#caption"),
  recallPanel: document.querySelector("#recall-panel"),
  recallText: document.querySelector("#recall-text"),
  status: document.querySelector("#status"),
  diagMic: document.querySelector("#diag-mic"),
  diagStt: document.querySelector("#diag-stt"),
  diagRate: document.querySelector("#diag-rate"),
  diagChannels: document.querySelector("#diag-channels"),
  diagBaseLatency: document.querySelector("#diag-base-latency"),
  diagOutputLatency: document.querySelector("#diag-output-latency"),
  diagSettings: document.querySelector("#diag-settings"),
};

let stream = null;
let audioContext = null;
let sttProvider = null;
let interimText = "";
let fontIndex = 0;
const transcript = [];

function setStatus(text, state = "idle") {
  els.status.textContent = text;
  els.status.dataset.state = state;
}

function trimTranscript(now = Date.now()) {
  while (transcript.length && now - transcript[0].time > ROLLING_WINDOW_MS) {
    transcript.shift();
  }
}

function visibleTranscript() {
  trimTranscript();
  return transcript.map((item) => item.text).join(" ").trim();
}

function renderCaption() {
  const finalText = visibleTranscript();
  const combined = [finalText, interimText].filter(Boolean).join(" ").trim();
  els.caption.textContent = combined || "正在聆聽…";
}

function addFinalTranscript(text) {
  const clean = text.trim();
  if (!clean) return;
  transcript.push({ text: clean, time: Date.now() });
  trimTranscript();
  renderCaption();
}

function showRecall() {
  const text = visibleTranscript() || interimText.trim();
  els.recallText.textContent = text || "目前沒有最近的字幕。";
  els.recallPanel.hidden = false;
  els.recallPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function setFontSize() {
  fontIndex = (fontIndex + 1) % FONT_SIZES.length;
  document.documentElement.style.setProperty(
    "--caption-size",
    `${FONT_SIZES[fontIndex]}px`,
  );
}

function requestedAudioConstraints() {
  return {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 1,
  };
}

function renderDiagnostics(track) {
  const settings = track.getSettings?.() ?? {};
  const supported = navigator.mediaDevices.getSupportedConstraints?.() ?? {};
  const requested = requestedAudioConstraints();

  els.diagMic.textContent = track.label || "已取得麥克風";
  els.diagRate.textContent = audioContext
    ? `${audioContext.sampleRate} Hz`
    : settings.sampleRate
      ? `${settings.sampleRate} Hz`
      : "—";
  els.diagChannels.textContent = settings.channelCount ?? "—";
  els.diagBaseLatency.textContent =
    audioContext && Number.isFinite(audioContext.baseLatency)
      ? `${(audioContext.baseLatency * 1000).toFixed(1)} ms`
      : "—";
  els.diagOutputLatency.textContent =
    audioContext && Number.isFinite(audioContext.outputLatency)
      ? `${(audioContext.outputLatency * 1000).toFixed(1)} ms`
      : "—";

  els.diagSettings.textContent = JSON.stringify(
    {
      requested,
      supported: {
        echoCancellation: Boolean(supported.echoCancellation),
        noiseSuppression: Boolean(supported.noiseSuppression),
        autoGainControl: Boolean(supported.autoGainControl),
        channelCount: Boolean(supported.channelCount),
        sampleRate: Boolean(supported.sampleRate),
      },
      actual: settings,
      note:
        "Browser-reported latency/settings are diagnostics only; they do not prove end-to-end acoustic latency or SPL calibration.",
    },
    null,
    2,
  );
}

async function startSession() {
  if (!window.isSecureContext) {
    throw new Error("需要 HTTPS 安全連線才能使用麥克風。");
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("這個瀏覽器不支援麥克風存取。");
  }

  setStatus("啟動中…");
  els.start.disabled = true;

  stream = await navigator.mediaDevices.getUserMedia({
    audio: requestedAudioConstraints(),
    video: false,
  });

  const [track] = stream.getAudioTracks();
  if (!track) {
    throw new Error("沒有取得可用的麥克風。");
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (AudioContextClass) {
    audioContext = new AudioContextClass({ latencyHint: "interactive" });
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();

    // Diagnostics only: deliberately do NOT connect to audioContext.destination.
    source.connect(analyser);
  }

  renderDiagnostics(track);

  sttProvider = createSttProvider({
    language: "zh-TW",
    onPartial: ({ text }) => {
      interimText = text;
      renderCaption();
    },
    onFinal: ({ text }) => {
      interimText = "";
      addFinalTranscript(text);
    },
    onStatus: ({ label }) => {
      els.diagStt.textContent = label;
    },
    onError: ({ message }) => {
      els.diagStt.textContent = message;
    },
  });

  if (sttProvider) {
    try {
      await sttProvider.start({ stream });
    } catch (error) {
      els.diagStt.textContent =
        "字幕引擎無法啟動：" +
        (error instanceof Error ? error.message : "unknown error");
    }
  } else {
    els.diagStt.textContent =
      "此瀏覽器沒有免費 Browser STT；麥克風診斷仍可使用";
  }

  setStatus("正在聆聽", "listening");
  els.stop.disabled = false;
  renderCaption();
}

async function stopSession() {
  if (sttProvider) {
    await sttProvider.stop();
  }
  sttProvider = null;

  for (const track of stream?.getTracks?.() ?? []) {
    track.stop();
  }
  stream = null;

  if (audioContext && audioContext.state !== "closed") {
    await audioContext.close();
  }
  audioContext = null;

  interimText = "";
  transcript.length = 0;
  els.caption.textContent = "字幕會顯示在這裡。";
  els.diagMic.textContent = "未啟動";
  els.start.disabled = false;
  els.stop.disabled = true;
  setStatus("已停止");
}

els.start.addEventListener("click", async () => {
  try {
    await startSession();
  } catch (error) {
    setStatus("無法啟動", "error");
    els.caption.textContent =
      error instanceof Error ? error.message : "無法啟動麥克風。";
    els.start.disabled = false;
    els.stop.disabled = true;
  }
});

els.stop.addEventListener("click", () => {
  void stopSession();
});

els.recall.addEventListener("click", showRecall);
els.closeRecall.addEventListener("click", () => {
  els.recallPanel.hidden = true;
});
els.fontSize.addEventListener("click", setFontSize);

window.addEventListener("pagehide", () => {
  void sttProvider?.dispose?.();

  for (const track of stream?.getTracks?.() ?? []) {
    track.stop();
  }
});

const sttCapabilities = describeSttCapabilities();
els.diagStt.textContent = sttCapabilities.browserSpeech
  ? "可用（Browser fallback）"
  : "此瀏覽器無 Browser SpeechRecognition";
