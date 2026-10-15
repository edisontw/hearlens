export const DEFAULT_ROLLING_TRANSCRIPT_WINDOW_MS = 30_000;

export function recentTranscriptItems(
  items = [],
  now = Date.now(),
  windowMs = DEFAULT_ROLLING_TRANSCRIPT_WINDOW_MS,
) {
  const safeNow = Number.isFinite(now) ? now : Date.now();
  const safeWindow = Math.max(0, Number(windowMs) || 0);

  return items.filter((item) => {
    const time = Number(item?.time);
    const text = String(item?.text || "").trim();
    return text && Number.isFinite(time) && safeNow - time <= safeWindow;
  });
}

export function recentTranscriptText(items = []) {
  return items
    .map((item) => String(item?.text || "").trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * Opt-in copy-only projection of finalized captions from the current session.
 * Unlike the rolling 30-second display, this does not trim by age.
 * The caller MUST supply the finalized-only session collection (never interim).
 * No persistence, audio or external network I/O happens here.
 */
export function completeSessionTranscriptText(finalizedItems = []) {
  return recentTranscriptText(finalizedItems);
}

export function relativeTranscriptTime(itemTime, now = Date.now()) {
  const ageMs = Math.max(0, now - Number(itemTime || now));
  const seconds = Math.round(ageMs / 1000);

  if (seconds < 5) return "剛剛";
  if (seconds < 60) return seconds + " 秒前";

  return Math.max(1, Math.round(seconds / 60)) + " 分鐘前";
}

/**
 * Display-only rolling caption projection. Never mutates the original
 * transcript/session reports. A partial that has gone stale is not fresh
 * speech, even if the recognizer omitted a final event.
 */
export function currentCaptionText(
  items = [],
  interim = "",
  interimAt = null,
  now = Date.now(),
  windowMs = DEFAULT_ROLLING_TRANSCRIPT_WINDOW_MS,
) {
  const safeWindow = Math.max(0, Number(windowMs) || 0);
  const finals = recentTranscriptItems(items, now, safeWindow)
    .map((item) => String(item.text).trim())
    .join(" ");
  const age = now - interimAt;
  const liveInterim = Number.isFinite(interimAt) &&
    Number.isFinite(now) && age >= 0 && age <= safeWindow
      ? String(interim || "").trim()
      : "";
  return [finals, liveInterim].filter(Boolean).join(" ").trim();
}
