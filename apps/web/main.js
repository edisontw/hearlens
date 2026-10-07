import { createSttProvider, describeSttCapabilities } from "./stt/provider.js?v=20261007-transcript-ux1";
import {
  ensureTaiwanTraditionalDisplay,
  toTaiwanTraditional,
} from "./zh-display.js?v=20261007-transcript-ux1";
import {
  recentTranscriptItems,
  recentTranscriptText,
  relativeTranscriptTime,
} from "./transcript-window.mjs?v=20261007-transcript-ux1";
import {
  requestedAudioConstraints,
} from "./stt/providers/capture-profile.mjs?v=20261007-transcript-ux1";
import {
  QUICK_PRESETS,
  resolveQuickPreset,
} from "./stt/providers/quick-presets.mjs?v=20261007-transcript-ux1";
import {
  clearAdvancedTuningParams,
  resolveAdvancedTuning,
  writeAdvancedTuningParams,
} from "./stt/providers/tuning-profile.mjs?v=20261007-transcript-ux1";

const BUILD_ID = "20261007-transcript-ux1";
const DEFAULT_GEMINI_TOKEN_URL = "https://edison.pepepow.net/token";
const ROLLING_WINDOW_MS = 30_000;
const FONT_SIZES = [32, 38, 44, 50];
const MAX_DEBUG_LINES = 120;
const MAX_REPORT_DEBUG_LINES = 5000;

function readRuntimeSttConfig() {
  const params = new URLSearchParams(window.location.search);
  const rawProvider = (params.get("stt") || "gemini").trim().toLowerCase();
  const provider =
    rawProvider === "gemini"
      ? "gemini-live-transcribe"
      : rawProvider === "google"
        ? "google-cloud-streaming"
        : rawProvider === "browser"
          ? "browser-speech"
          : rawProvider;

  const tuningProfile = resolveAdvancedTuning(params);
  const fixedGainRequested = params.has("gain");
  const requestedGain = Number(params.get("gain") || "1");
  const inputGain = Number.isFinite(requestedGain)
    ? Math.min(8, Math.max(1, requestedGain))
    : 1;
  const captureOverridePresent = params.has("capture");
  const quickPreset = resolveQuickPreset({
    presetValue: params.get("preset"),
    captureOverridePresent,
    captureValue: params.get("capture"),
    tuningOverridePresent: tuningProfile.enabled || fixedGainRequested,
  });

  return {
    provider,
    tokenUrl: (params.get("token") || DEFAULT_GEMINI_TOKEN_URL).trim(),
    websocketUrl: (params.get("ws") || "").trim(),
    inputGain,
    inputMode: fixedGainRequested ? "fixed" : "adaptive",
    preset: quickPreset.preset,
    captureMode: quickPreset.captureMode,
    captureOverridePresent,
    tuningProfile,
    normalizationConfig: tuningProfile.normalizationConfig,
  };
}

const runtimeSttConfig = readRuntimeSttConfig();

const els = {
  start: document.querySelector("#start"),
  stop: document.querySelector("#stop"),
  recall: document.querySelector("#recall"),
  closeRecall: document.querySelector("#close-recall"),
  copyRecentTranscript: document.querySelector("#copy-recent-transcript"),
  recallList: document.querySelector("#recall-list"),
  recallMeta: document.querySelector("#recall-meta"),
  recallCopyStatus: document.querySelector("#recall-copy-status"),
  fontSize: document.querySelector("#font-size"),
  quickPreset: document.querySelector("#quick-preset"),
  resetPreset: document.querySelector("#reset-preset"),
  presetHint: document.querySelector("#preset-hint"),
  advancedTuningFieldset: document.querySelector("#advanced-tuning-fieldset"),
  tuningTarget: document.querySelector("#tuning-target"),
  tuningMinGain: document.querySelector("#tuning-min-gain"),
  tuningMaxGain: document.querySelector("#tuning-max-gain"),
  tuningResponse: document.querySelector("#tuning-response"),
  tuningCapture: document.querySelector("#tuning-capture"),
  applyTuning: document.querySelector("#apply-tuning"),
  resetTuning: document.querySelector("#reset-tuning"),
  copyTuningLink: document.querySelector("#copy-tuning-link"),
  tuningSummary: document.querySelector("#active-tuning-summary"),
  tuningCopyStatus: document.querySelector("#tuning-copy-status"),
  caption: document.querySelector("#caption"),
  recallPanel: document.querySelector("#recall-panel"),
  recallText: document.querySelector("#recall-text"),
  status: document.querySelector("#status"),
  diagMic: document.querySelector("#diag-mic"),
  diagStt: document.querySelector("#diag-stt"),
  diagBuild: document.querySelector("#diag-build"),
  diagRuntime: document.querySelector("#diag-runtime"),
  diagRate: document.querySelector("#diag-rate"),
  diagChannels: document.querySelector("#diag-channels"),
  diagBaseLatency: document.querySelector("#diag-base-latency"),
  diagOutputLatency: document.querySelector("#diag-output-latency"),
  diagSettings: document.querySelector("#diag-settings"),
  sttLog: document.querySelector("#stt-log"),
  testSourceId: document.querySelector("#test-source-id"),
  testReceiverDevice: document.querySelector("#test-receiver-device"),
  testDistance: document.querySelector("#test-distance"),
  testSourceVolume: document.querySelector("#test-source-volume"),
  testNotes: document.querySelector("#test-notes"),
  copyTestReport: document.querySelector("#copy-test-report"),
  copyTestReportStatus: document.querySelector("#copy-test-report-status"),
};

let stream = null;
let audioContext = null;
let sttProvider = null;
let interimText = "";
let rawInterimText = "";
let lastRecognizedText = "";
let lastRecognizedAt = 0;
let fontIndex = 0;
let sessionCounter = 0;
let activeSessionId = 0;
let activeInputProfile = null;
let activeCaptureSettings = null;
const transcript = [];
const sessionFinals = [];
const debugLines = [];
const reportDebugLines = [];

appendSttLog("build " + BUILD_ID);
if (els.diagBuild) {
  els.diagBuild.textContent = BUILD_ID;
}
if (els.diagRuntime) {
  els.diagRuntime.textContent =
    runtimeSttConfig.provider +
    " / " +
    (runtimeSttConfig.inputMode === "adaptive"
      ? "adaptive"
      : "fixed " + runtimeSttConfig.inputGain.toFixed(2) + "x") +
    " / preset=" +
    runtimeSttConfig.preset +
    " / capture=" +
    runtimeSttConfig.captureMode +
    " / target=" +
    runtimeSttConfig.tuningProfile.controls.targetRmsDbfs +
    "dBFS / gain=" +
    runtimeSttConfig.tuningProfile.controls.minGain +
    "-" +
    runtimeSttConfig.tuningProfile.controls.maxGain +
    "x / response=" +
    runtimeSttConfig.tuningProfile.controls.responseSpeed;
}
void ensureTaiwanTraditionalDisplay().then((ready) => {
  appendSttLog("display-script " + (ready ? "zh-TW-ready" : "raw-fallback"));
});
appendSttLog("runtime-provider " + runtimeSttConfig.provider);
if (runtimeSttConfig.tokenUrl) {
  appendSttLog("runtime-token configured");
}
if (runtimeSttConfig.websocketUrl) {
  appendSttLog("runtime-ws configured");
}
appendSttLog(
  "runtime-input " +
    (runtimeSttConfig.inputMode === "adaptive"
      ? "adaptive"
      : "fixed gain=" + runtimeSttConfig.inputGain.toFixed(2) + "x"),
);
appendSttLog("runtime-preset " + runtimeSttConfig.preset);
appendSttLog("runtime-capture " + runtimeSttConfig.captureMode);
appendSttLog(
  "runtime-tuning " + JSON.stringify(runtimeSttConfig.tuningProfile),
);

function renderPresetUi() {
  if (!els.quickPreset) return;
  els.quickPreset.value = runtimeSttConfig.preset;
  if (els.presetHint) {
    els.presetHint.textContent =
      runtimeSttConfig.preset === QUICK_PRESETS.FAR_NOISY
        ? "遠距離／吵雜：使用已在 iPhone 與 HTC U23 測試中改善辨識的 voice capture。"
        : runtimeSttConfig.preset === QUICK_PRESETS.CUSTOM
          ? "目前使用工程參數覆寫；按「恢復自動」可回到標準設定。"
          : "自動：使用 raw capture；目前仍是一般情境的標準設定。";
  }
}

function selectedAdvancedTuningControls() {
  return {
    targetRmsDbfs: Number(els.tuningTarget?.value),
    minGain: Number(els.tuningMinGain?.value),
    maxGain: Number(els.tuningMaxGain?.value),
    responseSpeed: els.tuningResponse?.value || "balanced",
  };
}

function renderAdvancedTuningUi() {
  const controls = runtimeSttConfig.tuningProfile.controls;

  if (els.tuningTarget) els.tuningTarget.value = String(controls.targetRmsDbfs);
  if (els.tuningMinGain) els.tuningMinGain.value = String(controls.minGain);
  if (els.tuningMaxGain) els.tuningMaxGain.value = String(controls.maxGain);
  if (els.tuningResponse) els.tuningResponse.value = controls.responseSpeed;
  if (els.tuningCapture) {
    els.tuningCapture.value = runtimeSttConfig.captureOverridePresent
      ? runtimeSttConfig.captureMode
      : "";
  }

  if (els.tuningSummary) {
    els.tuningSummary.textContent =
      "目前：" +
      controls.targetRmsDbfs +
      " dBFS · " +
      controls.minGain +
      "–" +
      controls.maxGain +
      "x · " +
      controls.responseSpeed +
      " · capture=" +
      runtimeSttConfig.captureMode +
      (runtimeSttConfig.tuningProfile.enabled ? " · profile v1" : " · default");
  }
}

function setAdvancedTuningDisabled(disabled) {
  if (els.advancedTuningFieldset) {
    els.advancedTuningFieldset.disabled = disabled;
  }
}

function applyAdvancedTuning() {
  const url = new URL(window.location.href);
  url.searchParams.delete("gain");
  url.searchParams.delete("_build");
  writeAdvancedTuningParams(
    url.searchParams,
    selectedAdvancedTuningControls(),
  );

  const capture = els.tuningCapture?.value || "";
  if (capture === "raw" || capture === "voice") {
    url.searchParams.set("capture", capture);
  } else {
    url.searchParams.delete("capture");
  }

  window.location.assign(url.toString());
}

async function copyAdvancedTuningLink() {
  const url = new URL(window.location.href);
  url.searchParams.delete("gain");
  url.searchParams.delete("_build");
  url.searchParams.delete("token");
  url.searchParams.delete("ws");
  writeAdvancedTuningParams(
    url.searchParams,
    selectedAdvancedTuningControls(),
  );

  const capture = els.tuningCapture?.value || "";
  if (capture === "raw" || capture === "voice") {
    url.searchParams.set("capture", capture);
  } else {
    url.searchParams.delete("capture");
  }

  try {
    await navigator.clipboard.writeText(url.toString());
    if (els.tuningCopyStatus) {
      els.tuningCopyStatus.textContent = "已複製版本化設定連結";
    }
  } catch {
    if (els.tuningCopyStatus) {
      els.tuningCopyStatus.textContent = "瀏覽器禁止自動複製";
    }
  }
}

function applyQuickPreset(preset) {
  const url = new URL(window.location.href);
  url.searchParams.delete("gain");
  url.searchParams.delete("capture");
  url.searchParams.delete("_build");
  clearAdvancedTuningParams(url.searchParams);

  if (preset === QUICK_PRESETS.FAR_NOISY) {
    url.searchParams.set("preset", QUICK_PRESETS.FAR_NOISY);
  } else {
    url.searchParams.delete("preset");
  }

  window.location.assign(url.toString());
}

renderPresetUi();
renderAdvancedTuningUi();

async function ensureLatestBuild() {
  try {
    const buildUrl = new URL("./build.json", window.location.href);
    buildUrl.searchParams.set("_", Date.now().toString());
    const response = await fetch(buildUrl, { cache: "no-store" });
    if (!response.ok) return;

    const latest = await response.json();
    if (!latest?.buildId || latest.buildId === BUILD_ID) return;

    appendSttLog("stale-build latest=" + latest.buildId);
    setStatus("偵測到新版，重新載入中…");

    const reloadUrl = new URL(window.location.href);
    reloadUrl.searchParams.set("_build", latest.buildId);
    window.location.replace(reloadUrl.toString());
  } catch (error) {
    appendSttLog(
      "build-check skipped " +
        (error instanceof Error ? error.message : "unknown"),
    );
  }
}

void ensureLatestBuild();

function setStatus(text, state = "idle") {
  els.status.textContent = text;
  els.status.dataset.state = state;
}

function appendSttLog(message) {
  const time = new Date().toLocaleTimeString("zh-TW", { hour12: false });
  const line = time + " " + message;
  debugLines.push(line);
  reportDebugLines.push(line);

  while (reportDebugLines.length > MAX_REPORT_DEBUG_LINES) {
    reportDebugLines.shift();
  }

  while (debugLines.length > MAX_DEBUG_LINES) {
    debugLines.shift();
  }

  if (els.sttLog) {
    els.sttLog.textContent = debugLines.join("\n");
    els.sttLog.scrollTop = els.sttLog.scrollHeight;
  }
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

function rememberRecognizedText(text, timestamp = Date.now()) {
  const clean = text.trim();
  if (!clean) return;
  lastRecognizedText = clean;
  lastRecognizedAt = timestamp;
}

function recentRecognizedText(now = Date.now()) {
  if (!lastRecognizedText) return "";
  if (now - lastRecognizedAt > ROLLING_WINDOW_MS) return "";
  return lastRecognizedText;
}

function renderCaption() {
  const finalText = visibleTranscript();
  const combined = [finalText, interimText].filter(Boolean).join(" ").trim();
  els.caption.textContent = combined || "正在聆聽…";
}

function addFinalTranscript(text, rawText = text) {
  const clean = text.trim();
  if (!clean) return;
  const now = Date.now();
  const item = {
    text: clean,
    rawText: rawText.trim(),
    time: now,
  };
  transcript.push(item);
  sessionFinals.push(item);
  rememberRecognizedText(clean, now);
  trimTranscript(now);
  renderCaption();
  if (els.recallPanel && !els.recallPanel.hidden) {
    renderRecall();
  }
}

function renderRecall() {
  if (!els.recallList || !els.recallMeta) return;

  const now = Date.now();
  const items = recentTranscriptItems(transcript, now, ROLLING_WINDOW_MS);
  els.recallList.replaceChildren();

  if (!items.length) {
    const fallback = interimText.trim() || recentRecognizedText(now);
    const empty = document.createElement("div");
    empty.className = "recall-empty";
    empty.textContent = fallback || "目前沒有最近 30 秒的字幕。";
    els.recallList.append(empty);
    els.recallMeta.textContent = fallback ? "目前辨識中的內容" : "最近 30 秒";
    return;
  }

  for (const item of items) {
    const row = document.createElement("div");
    row.className = "recall-item";

    const time = document.createElement("span");
    time.className = "recall-item-time";
    time.textContent = relativeTranscriptTime(item.time, now);

    const text = document.createElement("div");
    text.className = "recall-item-text";
    text.textContent = item.text;

    row.append(time, text);
    els.recallList.append(row);
  }

  els.recallMeta.textContent =
    "最近 30 秒 · " + items.length + " 段字幕";
}

function showRecall() {
  renderRecall();
  els.recallPanel.hidden = false;
  els.recallPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function copyRecentTranscript() {
  const items = recentTranscriptItems(
    transcript,
    Date.now(),
    ROLLING_WINDOW_MS,
  );
  const text =
    recentTranscriptText(items) ||
    interimText.trim() ||
    recentRecognizedText();

  if (!text) {
    if (els.recallCopyStatus) {
      els.recallCopyStatus.textContent = "目前沒有可複製的近期字幕";
    }
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    if (els.recallCopyStatus) {
      els.recallCopyStatus.textContent = "已複製近期字幕";
    }
  } catch {
    if (els.recallCopyStatus) {
      els.recallCopyStatus.textContent = "瀏覽器禁止自動複製";
    }
  }
}

function setFontSize() {
  fontIndex = (fontIndex + 1) % FONT_SIZES.length;
  document.documentElement.style.setProperty(
    "--caption-size",
    FONT_SIZES[fontIndex] + "px",
  );
}

function safeRuntimeConfigForReport() {
  return {
    provider: runtimeSttConfig.provider,
    resolvedProvider:
      runtimeSttConfig.provider === "auto"
        ? runtimeSttConfig.tokenUrl
          ? "gemini-live-transcribe"
          : "browser-speech"
        : runtimeSttConfig.provider,
    inputMode: runtimeSttConfig.inputMode,
    inputGain:
      runtimeSttConfig.inputMode === "fixed"
        ? runtimeSttConfig.inputGain
        : null,
    preset: runtimeSttConfig.preset,
    captureMode: runtimeSttConfig.captureMode,
    tuningProfile: runtimeSttConfig.tuningProfile,
    tokenConfigured: Boolean(runtimeSttConfig.tokenUrl),
    websocketConfigured: Boolean(runtimeSttConfig.websocketUrl),
  };
}

function parsedDiagnostics() {
  try {
    return JSON.parse(els.diagSettings?.textContent || "{}");
  } catch {
    return { raw: els.diagSettings?.textContent || "" };
  }
}

function buildTestReport() {
  return {
    schema: "hearlens-test-report-v1",
    createdAt: new Date().toISOString(),
    buildId: BUILD_ID,
    sessionId: activeSessionId || sessionCounter || null,
    test: {
      sourceId: els.testSourceId?.value?.trim() || null,
      receiverDevice: els.testReceiverDevice?.value?.trim() || null,
      distance: els.testDistance?.value?.trim() || null,
      sourceVolume: els.testSourceVolume?.value?.trim() || null,
      notes: els.testNotes?.value?.trim() || null,
    },
    runtime: safeRuntimeConfigForReport(),
    inputProfile: activeInputProfile,
    captureSettings: activeCaptureSettings,
    page: {
      origin: window.location.origin,
      pathname: window.location.pathname,
    },
    browser: {
      userAgent: navigator.userAgent,
      language: navigator.language,
      platform: navigator.userAgentData?.platform || navigator.platform || null,
    },
    diagnostics: parsedDiagnostics(),
    transcript: sessionFinals.map((item) => ({
      timestamp: new Date(item.time).toISOString(),
      text: item.text,
      rawText: item.rawText,
    })),
    finalTranscript: sessionFinals.map((item) => item.text).join(" ").trim(),
    eventLog: [...reportDebugLines],
  };
}

async function copyTestReport() {
  const report = buildTestReport();
  const reportText = JSON.stringify(report, null, 2);

  try {
    await navigator.clipboard.writeText(reportText);
    els.copyTestReportStatus.textContent =
      "已複製 " + report.eventLog.length + " 行記錄";
    appendSttLog("test-report copied");
  } catch {
    els.copyTestReportStatus.textContent =
      "瀏覽器禁止自動複製，請直接複製下方記錄";
  }
}

function renderDiagnostics(track) {
  const settings = track.getSettings?.() ?? {};
  const supported = navigator.mediaDevices.getSupportedConstraints?.() ?? {};
  const requested = requestedAudioConstraints(runtimeSttConfig.captureMode);

  els.diagMic.textContent = track.label || "已取得麥克風";
  els.diagRate.textContent = audioContext
    ? audioContext.sampleRate + " Hz"
    : settings.sampleRate
      ? settings.sampleRate + " Hz"
      : "—";
  els.diagChannels.textContent = settings.channelCount ?? "—";
  els.diagBaseLatency.textContent =
    audioContext && Number.isFinite(audioContext.baseLatency)
      ? (audioContext.baseLatency * 1000).toFixed(1) + " ms"
      : "—";
  els.diagOutputLatency.textContent =
    audioContext && Number.isFinite(audioContext.outputLatency)
      ? (audioContext.outputLatency * 1000).toFixed(1) + " ms"
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
        "The diagnostics capture is released before the selected STT provider starts its own recognition/capture path.",
    },
    null,
    2,
  );
}

async function releaseDiagnosticCapture(label = "已釋放") {
  for (const track of stream?.getTracks?.() ?? []) {
    track.stop();
  }
  stream = null;

  if (audioContext && audioContext.state !== "closed") {
    await audioContext.close();
  }
  audioContext = null;

  if (label) {
    els.diagMic.textContent = label;
  }
}

async function startSession() {
  if (!window.isSecureContext) {
    throw new Error("需要 HTTPS 安全連線才能使用麥克風。");
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("這個瀏覽器不支援麥克風存取。");
  }

  const sessionId = ++sessionCounter;
  activeSessionId = sessionId;
  activeInputProfile = null;
  activeCaptureSettings = null;
  sessionFinals.length = 0;
  appendSttLog("S" + sessionId + " session-start");

  setStatus("啟動中…");
  els.start.disabled = true;
  els.stop.disabled = true;
  if (els.quickPreset) els.quickPreset.disabled = true;
  if (els.resetPreset) els.resetPreset.disabled = true;
  setAdvancedTuningDisabled(true);

  // getUserMedia here is used only for permission/device diagnostics.
  // The selected STT provider owns its actual recognition capture.
  stream = await navigator.mediaDevices.getUserMedia({
    audio: requestedAudioConstraints(runtimeSttConfig.captureMode),
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

    // Diagnostics only: deliberately do NOT connect to destination.
    source.connect(analyser);
  }

  renderDiagnostics(track);
  appendSttLog("S" + sessionId + " diagnostic-mic-ready");

  // Do not keep the diagnostics capture open while the STT provider
  // starts its own microphone/recognition path.
  await releaseDiagnosticCapture("權限正常；已釋放給字幕引擎");
  appendSttLog("S" + sessionId + " diagnostic-mic-released");
  await new Promise((resolve) => window.setTimeout(resolve, 250));

  sttProvider = createSttProvider({
    provider: runtimeSttConfig.provider,
    tokenUrl: runtimeSttConfig.tokenUrl,
    websocketUrl: runtimeSttConfig.websocketUrl,
    inputGain: runtimeSttConfig.inputGain,
    inputMode: runtimeSttConfig.inputMode,
    captureMode: runtimeSttConfig.captureMode,
    normalizationConfig: runtimeSttConfig.normalizationConfig,
    language: "zh-TW",
    onPartial: ({ text, timestamp }) => {
      if (sessionId !== activeSessionId) return;
      rawInterimText = text;
      interimText = toTaiwanTraditional(text);
      if (interimText.trim()) {
        rememberRecognizedText(interimText, timestamp);
      }
      renderCaption();
    },
    onFinal: ({ text, timestamp }) => {
      if (sessionId !== activeSessionId) return;
      const displayText = toTaiwanTraditional(text);
      rawInterimText = "";
      interimText = "";
      rememberRecognizedText(displayText, timestamp);
      addFinalTranscript(displayText, text);
    },
    onStatus: ({ label, state }) => {
      if (sessionId !== activeSessionId) return;
      els.diagStt.textContent = label;
      appendSttLog("S" + sessionId + " status " + state);
    },
    onError: ({ message, code }) => {
      if (sessionId !== activeSessionId) return;
      els.diagStt.textContent = message;
      appendSttLog("S" + sessionId + " provider-error " + (code || message));
    },
    onDebug: ({ event, detail, segmentId }) => {
      if (event === "input-profile" && detail) {
        try {
          activeInputProfile = JSON.parse(detail);
        } catch {
          activeInputProfile = { raw: detail };
        }
      }
      if (event === "capture-settings" && detail) {
        try {
          activeCaptureSettings = JSON.parse(detail);
        } catch {
          activeCaptureSettings = { raw: detail };
        }
      }
      const suffix = detail ? " " + detail : "";
      appendSttLog(
        "S" + sessionId + " seg" + segmentId + " " + event + suffix,
      );
    },
  });

  if (sttProvider) {
    try {
      await sttProvider.start();
    } catch (error) {
      appendSttLog(
        "S" +
          sessionId +
          " provider-start-failed " +
          (error instanceof Error ? error.message : "unknown"),
      );
      els.diagStt.textContent =
        "字幕引擎無法啟動：" +
        (error instanceof Error ? error.message : "unknown error");
      throw error;
    }
  } else {
    els.diagStt.textContent =
      "此瀏覽器沒有免費 Browser STT；麥克風診斷仍可使用";
    appendSttLog("S" + sessionId + " no-browser-stt");
  }

  setStatus("正在聆聽", "listening");
  els.stop.disabled = false;
  renderCaption();
}

async function stopSession() {
  const sessionId = activeSessionId;
  els.stop.disabled = true;
  setStatus("停止中…");
  appendSttLog("S" + sessionId + " stop-request");

  if (sttProvider) {
    await sttProvider.stop();
  }
  sttProvider = null;

  await releaseDiagnosticCapture(null);

  interimText = "";
  rawInterimText = "";
  trimTranscript();
  const recent = visibleTranscript() || recentRecognizedText();
  els.caption.textContent = recent || "字幕會顯示在這裡。";
  els.diagMic.textContent = "未使用";
  activeSessionId = 0;
  els.start.disabled = false;
  els.stop.disabled = true;
  if (els.quickPreset) els.quickPreset.disabled = false;
  if (els.resetPreset) els.resetPreset.disabled = false;
  setAdvancedTuningDisabled(false);
  setStatus("已停止");
  appendSttLog("S" + sessionId + " session-stopped");
}

async function cleanupFailedStart(error) {
  appendSttLog(
    "S" +
      activeSessionId +
      " session-start-error " +
      (error instanceof Error ? error.message : "unknown"),
  );

  try {
    await sttProvider?.dispose?.();
  } catch {
    // Ignore cleanup errors.
  }
  sttProvider = null;

  await releaseDiagnosticCapture("未啟動");
  activeSessionId = 0;
}

els.start.addEventListener("click", async () => {
  try {
    await startSession();
  } catch (error) {
    await cleanupFailedStart(error);
    setStatus("無法啟動", "error");
    els.caption.textContent =
      error instanceof Error ? error.message : "無法啟動麥克風。";
    els.start.disabled = false;
    els.stop.disabled = true;
    if (els.quickPreset) els.quickPreset.disabled = false;
    if (els.resetPreset) els.resetPreset.disabled = false;
    setAdvancedTuningDisabled(false);
  }
});

els.stop.addEventListener("click", () => {
  void stopSession();
});

els.recall.addEventListener("click", showRecall);
els.closeRecall.addEventListener("click", () => {
  els.recallPanel.hidden = true;
  if (els.recallCopyStatus) els.recallCopyStatus.textContent = "";
});
els.copyRecentTranscript?.addEventListener("click", () => {
  void copyRecentTranscript();
});
els.fontSize.addEventListener("click", setFontSize);
els.quickPreset?.addEventListener("change", (event) => {
  applyQuickPreset(event.target.value);
});
els.resetPreset?.addEventListener("click", () => {
  applyQuickPreset(QUICK_PRESETS.AUTO);
});
els.applyTuning?.addEventListener("click", applyAdvancedTuning);
els.resetTuning?.addEventListener("click", () => {
  applyQuickPreset(QUICK_PRESETS.AUTO);
});
els.copyTuningLink?.addEventListener("click", () => {
  void copyAdvancedTuningLink();
});
els.copyTestReport?.addEventListener("click", () => {
  void copyTestReport();
});

window.addEventListener("pagehide", () => {
  void sttProvider?.dispose?.();

  for (const track of stream?.getTracks?.() ?? []) {
    track.stop();
  }
});

const sttCapabilities = describeSttCapabilities();
if (runtimeSttConfig.provider === "gemini-live-transcribe") {
  els.diagStt.textContent = runtimeSttConfig.tokenUrl
    ? "Gemini 3.5 Transcribe Live 已設定"
    : "Gemini 已選擇，但缺少 ?token=https://.../token";
} else if (runtimeSttConfig.provider === "google-cloud-streaming") {
  els.diagStt.textContent = runtimeSttConfig.websocketUrl
    ? "Google Cloud streaming proxy 已設定"
    : "Google Cloud 已選擇，但缺少 ?ws=wss://.../stt";
} else {
  els.diagStt.textContent = sttCapabilities.browserSpeech
    ? "可用（Browser fallback）"
    : "此瀏覽器無 Browser SpeechRecognition";
}
