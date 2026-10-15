import { SESSION_REVIEW_PAGE_SIZE, sessionReviewWindow } from "./transcript-review.mjs?v=20261015-session-review1";
import { captionSttPrivacyNotice } from "./stt-privacy.mjs?v=20261015-session-review1";
import { createCaptionFocusMode } from "./caption-focus.mjs?v=20261015-session-review1";
import { shouldFollowCaptionScroll } from "./caption-scroll.mjs?v=20261015-session-review1";
import { createCaptionScreenWakeLock } from "./caption-screen-wake-lock.mjs?v=20261015-session-review1";
import {
  assertCaptionSessionCurrent,
  shouldInterruptForPageEvent,
} from "./caption-lifecycle.mjs?v=20261013-mobile-lifecycle1";
import { createSttProvider, describeSttCapabilities } from "./stt/provider.js?v=20261015-session-review1";
import {
  ensureTaiwanTraditionalDisplay,
  toTaiwanTraditional,
} from "./zh-display.js?v=20261008-stop-flush1";
import {
  currentCaptionText,
  retainedCaptionText,
  recentTranscriptItems,
  recentTranscriptText,
  completeSessionTranscriptText,
  relativeTranscriptTime,
} from "./transcript-window.mjs?v=20261015-session-review1";
import {
  CAPTION_SIZE_LEVELS,
  captionSizePixels,
  normalizeCaptionSizeLevel,
} from "./caption-size.mjs?v=20261008-stop-flush1";
import {
  captionLatencySnapshot,
  createCaptionLatencyTelemetry,
  markFirstAudioChunk,
  markFirstFinal,
  markFirstPartial,
} from "./caption-latency.mjs?v=20261008-stop-flush1";
import {
  requestedAudioConstraints,
} from "./stt/providers/capture-profile.mjs?v=20261008-stop-flush1";
import {
  QUICK_PRESETS,
  resolveQuickPreset,
} from "./stt/providers/quick-presets.mjs?v=20261008-stop-flush1";
import {
  clearAdvancedTuningParams,
  resolveAdvancedTuning,
  writeAdvancedTuningParams,
} from "./stt/providers/tuning-profile.mjs?v=20261008-stop-flush1";

const BUILD_ID = "20261015-session-review1";
const DEFAULT_GEMINI_TOKEN_URL = "https://edison.pepepow.net/token";
const ROLLING_WINDOW_MS = 30_000;
const CAPTION_REFRESH_MS = 1_000;
const CAPTION_SIZE_STORAGE_KEY = "hearlens-caption-size-v1";
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
  sttPrivacyNotice: document.querySelector("#stt-privacy-notice"),
  stop: document.querySelector("#stop"),
  recall: document.querySelector("#recall"),
  recallRecent: document.querySelector("#recall-recent"),
  recallComplete: document.querySelector("#recall-complete"),
  recallLoadEarlier: document.querySelector("#recall-load-earlier"),
  closeRecall: document.querySelector("#close-recall"),
  copyRecentTranscript: document.querySelector("#copy-recent-transcript"),
  copyCompleteTranscript: document.querySelector("#copy-complete-transcript"),
  recallList: document.querySelector("#recall-list"),
  recallMeta: document.querySelector("#recall-meta"),
  recallCopyStatus: document.querySelector("#recall-copy-status"),
  captionSizeButtons: [...document.querySelectorAll("[data-caption-size]")],
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
  captionFocusToggle: document.querySelector("#caption-focus-toggle"),
  caption: document.querySelector("#caption"),
  clearCaption: document.querySelector("#clear-caption"),
  recallPanel: document.querySelector("#recall-panel"),
  status: document.querySelector("#status"),
  screenAwake: document.querySelector("#screen-awake-status"),
  diagMic: document.querySelector("#diag-mic"),
  diagStt: document.querySelector("#diag-stt"),
  diagBuild: document.querySelector("#diag-build"),
  diagRuntime: document.querySelector("#diag-runtime"),
  diagRate: document.querySelector("#diag-rate"),
  diagChannels: document.querySelector("#diag-channels"),
  diagBaseLatency: document.querySelector("#diag-base-latency"),
  diagOutputLatency: document.querySelector("#diag-output-latency"),
  diagCaptionPartial: document.querySelector("#diag-caption-partial"),
  diagCaptionFinal: document.querySelector("#diag-caption-final"),
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

// Populate the already-visible pre-capture notice from the selected provider.
if (els.sttPrivacyNotice) {
  els.sttPrivacyNotice.textContent = captionSttPrivacyNotice(runtimeSttConfig.provider);
}

// Presentation only: no microphone, STT, audio or persistence privileges.
createCaptionFocusMode({ body: document.body, button: els.captionFocusToggle });

let stream = null;
let audioContext = null;
let sttProvider = null;
let interimText = "";
let rawInterimText = "";
let lastRecognizedText = "";
let lastRecognizedAt = 0;
let captionSizeLevel = CAPTION_SIZE_LEVELS.NORMAL;
let sessionCounter = 0;
let activeSessionId = 0;
let activeInputProfile = null;
let activeCaptureSettings = null;
let activeCaptionLatency = null;
let captionStopRequested = false;
let captionRefreshTimer = null;
let lastInterimAt = null;
const transcript = []; // Existing recent-history / recall, independent of clear-screen action.
const displayFinals = []; // Only recent confirmed text visible since last screen clear.
let lastDisplayFinal = null; // Final-only retained caption, never a partial.
let captionManuallyCleared = false;
const sessionFinals = [];
let recallView = "recent";
let reviewVisibleCount = SESSION_REVIEW_PAGE_SIZE;
let lastFullReviewSignature = "";
const debugLines = [];
const reportDebugLines = [];

const captionScreenWakeLock = createCaptionScreenWakeLock({
  requestWakeLock: typeof navigator.wakeLock?.request === "function"
    ? (type) => navigator.wakeLock.request(type)
    : null,
  onState: (state) => {
    if (els.screenAwake) {
      els.screenAwake.textContent = {
        requesting: "正在嘗試保持螢幕開啟…",
        held: "聆聽期間已保持螢幕開啟；停止後恢復原本休眠設定。",
        unsupported: "此瀏覽器不支援螢幕常亮；字幕仍可使用。",
        unavailable: "系統未允許螢幕常亮；字幕仍可使用。",
        released: "系統已取消螢幕常亮；請留意鎖屏會暫停字幕。",
        idle: "開始聆聽時會嘗試保持螢幕開啟（可能增加耗電）。",
      }[state] || "";
    }
    appendSttLog("caption-screen-awake " + state);
  },
});

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

function readStoredCaptionSize() {
  try {
    return normalizeCaptionSizeLevel(
      window.localStorage.getItem(CAPTION_SIZE_STORAGE_KEY),
    );
  } catch {
    return CAPTION_SIZE_LEVELS.NORMAL;
  }
}

function applyCaptionSize(level, { persist = true } = {}) {
  captionSizeLevel = normalizeCaptionSizeLevel(level);
  document.documentElement.style.setProperty(
    "--caption-size",
    captionSizePixels(captionSizeLevel) + "px",
  );

  for (const button of els.captionSizeButtons) {
    const selected = button.dataset.captionSize === captionSizeLevel;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  }

  if (persist) {
    try {
      window.localStorage.setItem(CAPTION_SIZE_STORAGE_KEY, captionSizeLevel);
    } catch {
      // Caption sizing still works when storage is unavailable.
    }
  }
}

applyCaptionSize(readStoredCaptionSize(), { persist: false });

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

function visibleDisplayTranscript(now = Date.now()) {
  return retainedCaptionText(
    displayFinals, lastDisplayFinal, interimText, lastInterimAt, now, ROLLING_WINDOW_MS);
}

function liveInterim(now = Date.now()) {
  return currentCaptionText([], interimText, lastInterimAt, now, ROLLING_WINDOW_MS);
}

function syncCaptionRefreshTimer() {
  const now = Date.now();
  const needRefresh = Boolean(activeSessionId) ||
    recentTranscriptItems(transcript, now, ROLLING_WINDOW_MS).length > 0 ||
    Boolean(recentRecognizedText(now)) ||
    Boolean(liveInterim(now));
  if (needRefresh && captionRefreshTimer === null) {
    captionRefreshTimer = window.setInterval(refreshCaptionWindow, CAPTION_REFRESH_MS);
  } else if (!needRefresh && captionRefreshTimer !== null) {
    window.clearInterval(captionRefreshTimer);
    captionRefreshTimer = null;
  }
}

function refreshCaptionWindow() {
  const now = Date.now();
  trimTranscript(now);
  while (displayFinals.length && now - displayFinals[0].time > ROLLING_WINDOW_MS) {
    displayFinals.shift();
  }
  if (activeSessionId && !captionStopRequested) {
    renderCaption();
  } else if (!activeSessionId) {
    const text = visibleDisplayTranscript() || (captionManuallyCleared
      ? "" : "字幕會顯示在這裡。");
    updateCaptionDisplay(text);
  }
  if (els.recallPanel && !els.recallPanel.hidden) renderRecall();
  syncCaptionRefreshTimer();
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

function updateCaptionDisplay(text) {
  if (els.caption.textContent === text) return;
  const follow = shouldFollowCaptionScroll(
    els.caption.scrollTop, els.caption.scrollHeight, els.caption.clientHeight);
  els.caption.textContent = text;
  if (follow) els.caption.scrollTop = els.caption.scrollHeight;
}

function renderCaption() {
  const now = Date.now();
  const combined = visibleDisplayTranscript(now);
  const nextText = combined || (captionManuallyCleared ? "" : "正在聆聽…");
  // No repeat announcement for an unchanged caption, and no forced jump
  // when a user has scrolled up to reread an earlier long sentence.
  updateCaptionDisplay(nextText);
  syncCaptionRefreshTimer();
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
  displayFinals.push(item);
  lastDisplayFinal = item;
  captionManuallyCleared = false;
  sessionFinals.push(item);
  syncCompleteTranscriptCopyButton();
  rememberRecognizedText(clean, now);
  trimTranscript(now);
  while (displayFinals.length && now - displayFinals[0].time > ROLLING_WINDOW_MS) {
    displayFinals.shift();
  }
  renderCaption();
  if (els.recallPanel && !els.recallPanel.hidden) {
    renderRecall();
  }
  syncCaptionRefreshTimer();
}

function renderRecall() {
  if (!els.recallList || !els.recallMeta) return;

  const full = recallView === "session";
  els.recallRecent?.setAttribute("aria-pressed", String(!full));
  els.recallComplete?.setAttribute("aria-pressed", String(full));
  els.recallList.classList.toggle("full-session-review", full);
  if (els.recallLoadEarlier) els.recallLoadEarlier.hidden = true;

  if (full) {
    // Current-session review is final-only, so it must never show stale or
    // provisional recognition results that were not confirmed by STT.
    els.recallList.setAttribute("aria-live", "off");
    els.recallList.setAttribute("aria-label", "本次已確認字幕，可在框內捲動");
    els.recallList.tabIndex = 0;
    const page = sessionReviewWindow(sessionFinals, reviewVisibleCount);
    els.recallMeta.textContent = page.total
      ? "本次對話 · 顯示 " + page.items.length + " / " + page.total + " 段已確認字幕"
      : "本次對話 · 尚無已確認字幕";
    if (els.recallLoadEarlier) els.recallLoadEarlier.hidden = page.hiddenCount === 0;

    // The 1-second recent-history refresh must not recreate a long list,
    // steal the scroll position or repeatedly announce its contents.
    const signature = sessionCounter + ":" + page.total + ":" + page.items.length;
    if (signature === lastFullReviewSignature) return;
    const priorTop = els.recallList.scrollTop;
    const priorHeight = els.recallList.scrollHeight;
    const wasNearBottom = priorHeight - priorTop - els.recallList.clientHeight <= 56;
    const wasRendered = lastFullReviewSignature !== "";
    els.recallList.replaceChildren();

    if (!page.items.length) {
      const empty = document.createElement("div");
      empty.className = "recall-empty";
      empty.textContent = "本次尚無已確認字幕。";
      els.recallList.append(empty);
    } else {
      page.items.forEach((item, index) => {
        const row = document.createElement("div");
        row.className = "recall-item";
        const time = document.createElement("span");
        time.className = "recall-item-time";
        const timeLabel = Number.isFinite(item.time)
          ? new Date(item.time).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })
          : "";
        time.textContent = "第 " + (page.hiddenCount + index + 1) + " 段" +
          (timeLabel ? " · " + timeLabel : "");
        const text = document.createElement("div");
        text.className = "recall-item-text";
        text.textContent = item.text;
        row.append(time, text);
        els.recallList.append(row);
      });
    }

    lastFullReviewSignature = signature;
    if (!wasRendered || wasNearBottom) {
      els.recallList.scrollTop = els.recallList.scrollHeight;
    } else {
      els.recallList.scrollTop = priorTop;
    }
    return;
  }

  lastFullReviewSignature = "";
  els.recallList.classList.remove("full-session-review");
  els.recallList.setAttribute("aria-live", "polite");
  els.recallList.removeAttribute("aria-label");
  els.recallList.removeAttribute("tabindex");
  const now = Date.now();
  const items = recentTranscriptItems(transcript, now, ROLLING_WINDOW_MS);
  els.recallList.replaceChildren();

  if (!items.length) {
    const fallback = liveInterim(now) || recentRecognizedText(now);
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

  els.recallMeta.textContent = "最近 30 秒 · " + items.length + " 段字幕";
}

function showRecall() {
  recallView = "recent";
  reviewVisibleCount = SESSION_REVIEW_PAGE_SIZE;
  lastFullReviewSignature = "";
  els.recallPanel.hidden = false;
  renderRecall();
  syncCaptionRefreshTimer();
  els.recallPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function chooseRecallView(mode) {
  if (mode !== "recent" && mode !== "session") return;
  recallView = mode;
  reviewVisibleCount = SESSION_REVIEW_PAGE_SIZE;
  lastFullReviewSignature = "";
  renderRecall();
}

function loadEarlierSessionCaptions() {
  if (recallView !== "session") return;
  const beforeTop = els.recallList.scrollTop;
  const beforeHeight = els.recallList.scrollHeight;
  reviewVisibleCount += SESSION_REVIEW_PAGE_SIZE;
  renderRecall();
  // Prepending earlier messages should preserve the reader's current
  // sentence rather than unexpectedly jumping to another position.
  els.recallList.scrollTop = beforeTop +
    Math.max(0, els.recallList.scrollHeight - beforeHeight);
}

function syncCompleteTranscriptCopyButton() {
  if (els.copyCompleteTranscript) {
    els.copyCompleteTranscript.disabled = sessionFinals.length === 0;
  }
}

async function copyCompleteTranscript() {
  // Only finalized text from this one session; never interims or debug logs.
  const text = completeSessionTranscriptText(sessionFinals);
  if (!text) {
    if (els.recallCopyStatus) {
      els.recallCopyStatus.textContent = "本次尚無已確認的字幕";
    }
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    if (els.recallCopyStatus) {
      els.recallCopyStatus.textContent = "已複製本次完整字幕（僅已確認內容）";
    }
  } catch {
    if (els.recallCopyStatus) {
      els.recallCopyStatus.textContent = "瀏覽器禁止自動複製，尚未儲存字幕";
    }
  }
}

async function copyRecentTranscript() {
  const items = recentTranscriptItems(
    transcript,
    Date.now(),
    ROLLING_WINDOW_MS,
  );
  const text =
    recentTranscriptText(items) ||
    liveInterim() ||
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

function formatCaptionLatency(value, reference) {
  if (!Number.isFinite(value)) return "—";
  return (
    value +
    " ms" +
    (reference === "first-audio-chunk"
      ? "（首音訊後）"
      : reference === "session-start"
        ? "（session 後）"
        : "")
  );
}

function renderCaptionLatencyTelemetry() {
  const snapshot = captionLatencySnapshot(activeCaptionLatency);
  if (els.diagCaptionPartial) {
    els.diagCaptionPartial.textContent = formatCaptionLatency(
      snapshot.firstPartialMs,
      snapshot.reference,
    );
  }
  if (els.diagCaptionFinal) {
    els.diagCaptionFinal.textContent = formatCaptionLatency(
      snapshot.firstFinalMs,
      snapshot.reference,
    );
  }
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
    captionLatency: captionLatencySnapshot(activeCaptionLatency),
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
  // Detach ownership BEFORE awaiting browser cleanup, so concurrent
  // pagehide and startup-finalization cannot close/stop the same resource twice.
  const priorStream = stream;
  stream = null;
  for (const track of priorStream?.getTracks?.() ?? []) {
    track.stop();
  }

  const priorContext = audioContext;
  audioContext = null;
  if (priorContext && priorContext.state !== "closed") {
    await priorContext.close();
  }

  if (label) {
    els.diagMic.textContent = label;
  }
}

// Unexpected Gemini transport failure is terminal for this session.
// Preserve already finalized text, but do not silently continue displaying
// "listening" or retain the microphone after the WebSocket has died.
async function failClosedCaptionSession(expectedSessionId, message, code) {
  if (expectedSessionId !== activeSessionId) return;
  captionScreenWakeLock.stop();
  activeSessionId = 0; // immediately reject delayed partial/final/status callbacks
  els.start.disabled = true;
  els.stop.disabled = true;
  if (els.quickPreset) els.quickPreset.disabled = true;
  if (els.resetPreset) els.resetPreset.disabled = true;
  setAdvancedTuningDisabled(true);
  const reasonLabel = code === "page-hidden" || code === "pagehide"
    ? "字幕已暫停，請重新開始"
    : code === "mic-ended" || code === "mic-muted"
      ? "麥克風已中斷，請重新開始"
      : "字幕連線中斷，請重新開始";
  setStatus(reasonLabel, "error");
  appendSttLog("S" + expectedSessionId + " fatal-session " + code);
  const failedProvider = sttProvider;
  sttProvider = null;
  try {
    await failedProvider?.dispose?.();
  } catch (error) {
    appendSttLog("S" + expectedSessionId + " dispose-error " +
      (error instanceof Error ? error.message : "unknown"));
  }
  try {
    await releaseDiagnosticCapture("未使用");
  } catch (error) {
    appendSttLog("S" + expectedSessionId + " capture-cleanup-error " +
      (error instanceof Error ? error.message : "unknown"));
  } finally {
    interimText = "";
    rawInterimText = "";
    lastInterimAt = null;
    trimTranscript();
    updateCaptionDisplay(
      visibleDisplayTranscript() || (captionManuallyCleared
        ? "" : "字幕已中斷，請重新開始。"));
    els.diagStt.textContent = message;
    els.start.disabled = false;
    els.stop.disabled = true;
    if (els.quickPreset) els.quickPreset.disabled = false;
    if (els.resetPreset) els.resetPreset.disabled = false;
    setAdvancedTuningDisabled(false);
    appendSttLog("S" + expectedSessionId + " fatal-cleanup-complete");
    syncCaptionRefreshTimer();
  }
}

function requireActiveCaptionSession(sessionId) {
  assertCaptionSessionCurrent(sessionId, activeSessionId, document.hidden);
}

async function startSession() {
  if (!window.isSecureContext) {
    throw new Error("需要 HTTPS 安全連線才能使用麥克風。");
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("這個瀏覽器不支援麥克風存取。");
  }

  if (document.hidden) {
    throw new Error("請切回此頁面，再開始字幕。");
  }

  const sessionId = ++sessionCounter;
  activeSessionId = sessionId;
  captionStopRequested = false;
  activeInputProfile = null;
  activeCaptureSettings = null;
  activeCaptionLatency = createCaptionLatencyTelemetry(Date.now());
  renderCaptionLatencyTelemetry();
  sessionFinals.length = 0;
  reviewVisibleCount = SESSION_REVIEW_PAGE_SIZE;
  lastFullReviewSignature = "";
  if (els.recallPanel && !els.recallPanel.hidden) renderRecall();
  syncCompleteTranscriptCopyButton();
  if (els.recallCopyStatus) els.recallCopyStatus.textContent = "";
  transcript.length = 0;
  displayFinals.length = 0;
  lastDisplayFinal = null;
  captionManuallyCleared = false;
  lastRecognizedText = "";
  lastRecognizedAt = 0;
  interimText = "";
  rawInterimText = "";
  lastInterimAt = null;
  syncCaptionRefreshTimer();
  appendSttLog("S" + sessionId + " session-start");

  setStatus("啟動中…");
  els.start.disabled = true;
  els.stop.disabled = true;
  if (els.quickPreset) els.quickPreset.disabled = true;
  if (els.resetPreset) els.resetPreset.disabled = true;
  setAdvancedTuningDisabled(true);

  // getUserMedia here is used only for permission/device diagnostics.
  // The selected STT provider owns its actual recognition capture.
  const diagnosticStream = await navigator.mediaDevices.getUserMedia({
    audio: requestedAudioConstraints(runtimeSttConfig.captureMode),
    video: false,
  });
  try {
    requireActiveCaptionSession(sessionId);
  } catch (error) {
    // Permission may resolve AFTER pagehide or a newer session starts.
    for (const track of diagnosticStream.getTracks()) track.stop();
    throw error;
  }
  stream = diagnosticStream;

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
  requireActiveCaptionSession(sessionId);
  appendSttLog("S" + sessionId + " diagnostic-mic-released");
  await new Promise((resolve) => window.setTimeout(resolve, 250));
  requireActiveCaptionSession(sessionId);

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
      if (text?.trim()) {
        markFirstPartial(activeCaptionLatency, timestamp);
        renderCaptionLatencyTelemetry();
      }
      rawInterimText = text;
      interimText = toTaiwanTraditional(text);
      if (interimText.trim()) captionManuallyCleared = false;
      lastInterimAt = interimText.trim() ? Date.now() : null;
      if (interimText.trim()) {
        rememberRecognizedText(interimText, timestamp);
      }
      renderCaption();
    },
    onFinal: ({ text, timestamp }) => {
      if (sessionId !== activeSessionId) return;
      if (text?.trim()) {
        markFirstFinal(activeCaptionLatency, timestamp);
        renderCaptionLatencyTelemetry();
      }
      const displayText = toTaiwanTraditional(text);
      rawInterimText = "";
      interimText = "";
      lastInterimAt = null;
      rememberRecognizedText(displayText, timestamp);
      addFinalTranscript(displayText, text);
    },
    onStatus: ({ label, state }) => {
      if (sessionId !== activeSessionId) return;
      els.diagStt.textContent = label;
      appendSttLog("S" + sessionId + " status " + state);
    },
    onError: ({ message, code, fatal }) => {
      if (sessionId !== activeSessionId) return;
      els.diagStt.textContent = message;
      appendSttLog("S" + sessionId + " provider-error " + (code || message));
      if (fatal === true && (code === "gemini-closed" ||
          code === "gemini-socket-error" || code === "mic-ended" ||
          code === "mic-muted")) {
        void failClosedCaptionSession(sessionId, message, code);
      }
    },
    onDebug: ({ event, detail, segmentId, timestamp }) => {
      if (sessionId !== activeSessionId) return;
      if (event === "audio-first-chunk") {
        markFirstAudioChunk(activeCaptionLatency, timestamp);
        renderCaptionLatencyTelemetry();
      }
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
      requireActiveCaptionSession(sessionId);
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

  requireActiveCaptionSession(sessionId);
  setStatus("正在聆聽", "listening");
  void captionScreenWakeLock.start();
  els.stop.disabled = false;
  renderCaption();
}

async function stopSession() {
  const sessionId = activeSessionId;
  if (!sessionId || captionStopRequested) return;
  captionScreenWakeLock.stop();
  captionStopRequested = true;
  els.stop.disabled = true;
  setStatus("停止中…");
  appendSttLog("S" + sessionId + " stop-request");

  if (sttProvider) {
    await sttProvider.stop();
  }
  sttProvider = null;

  await releaseDiagnosticCapture(null);
  if (sessionId !== activeSessionId) return;

  interimText = "";
  rawInterimText = "";
  lastInterimAt = null;
  trimTranscript();
  const retained = visibleDisplayTranscript();
  updateCaptionDisplay(retained || (captionManuallyCleared
    ? "" : "字幕會顯示在這裡。"));
  els.diagMic.textContent = "未使用";
  activeSessionId = 0;
  els.start.disabled = false;
  els.stop.disabled = true;
  if (els.quickPreset) els.quickPreset.disabled = false;
  if (els.resetPreset) els.resetPreset.disabled = false;
  setAdvancedTuningDisabled(false);
  setStatus("已停止");
  appendSttLog("S" + sessionId + " session-stopped");
  captionStopRequested = false;
  syncCaptionRefreshTimer();
}

async function cleanupFailedStart(error) {
  captionScreenWakeLock.stop();
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
  lastInterimAt = null;
  syncCaptionRefreshTimer();
}

els.start.addEventListener("click", async () => {
  const expectedSessionId = sessionCounter + 1;
  try {
    await startSession();
  } catch (error) {
    // Old in-flight permission/token/socket completions cannot clobber
    // the interruption state or a newly started foreground session.
    if (expectedSessionId <= sessionCounter &&
        expectedSessionId !== activeSessionId) return;
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

function interruptForPageEvent(eventType) {
  if (!shouldInterruptForPageEvent(eventType, document.visibilityState)) return;
  if (!activeSessionId || captionStopRequested) return;
  const code = eventType === "pagehide" ? "pagehide" : "page-hidden";
  const reason = "字幕已暫停；返回頁面後請手動重新開始。";
  void failClosedCaptionSession(activeSessionId, reason, code);
}

document.addEventListener("visibilitychange",
  () => interruptForPageEvent("visibilitychange"));
window.addEventListener("pagehide", () => interruptForPageEvent("pagehide"));
// Deliberately NO pageshow/visibility-visible auto-restart: microphone
// permission and cloud transcription restart require another user action.

els.clearCaption?.addEventListener("click", () => {
  // Clear only what the main live caption displays; leave the last-30-second
  // recall and finalized complete-session copy intact.
  displayFinals.length = 0;
  lastDisplayFinal = null;
  interimText = "";
  rawInterimText = "";
  lastInterimAt = null;
  captionManuallyCleared = true;
  updateCaptionDisplay("");
  syncCaptionRefreshTimer();
});
els.recall.addEventListener("click", showRecall);
els.recallRecent?.addEventListener("click", () => chooseRecallView("recent"));
els.recallComplete?.addEventListener("click", () => chooseRecallView("session"));
els.recallLoadEarlier?.addEventListener("click", loadEarlierSessionCaptions);
els.closeRecall.addEventListener("click", () => {
  els.recallPanel.hidden = true;
  syncCaptionRefreshTimer();
  if (els.recallCopyStatus) els.recallCopyStatus.textContent = "";
});
els.copyRecentTranscript?.addEventListener("click", () => {
  void copyRecentTranscript();
});
els.copyCompleteTranscript?.addEventListener("click", () => {
  void copyCompleteTranscript();
});
syncCompleteTranscriptCopyButton();
for (const button of els.captionSizeButtons) {
  button.addEventListener("click", () => {
    applyCaptionSize(button.dataset.captionSize);
  });
}
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
  captionScreenWakeLock.stop();
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
