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

export function relativeTranscriptTime(itemTime, now = Date.now()) {
  const ageMs = Math.max(0, now - Number(itemTime || now));
  const seconds = Math.round(ageMs / 1000);

  if (seconds < 5) return "剛剛";
  if (seconds < 60) return seconds + " 秒前";

  return Math.max(1, Math.round(seconds / 60)) + " 分鐘前";
}
