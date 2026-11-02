// Keep the latest long-caption text visible unless the user deliberately
// scrolled up to reread older lines. This is a display-only decision.
export function shouldFollowCaptionScroll(
  scrollTop,
  scrollHeight,
  clientHeight,
  thresholdPx = 48,
) {
  const values = [scrollTop, scrollHeight, clientHeight, thresholdPx];
  if (values.some((value) => !Number.isFinite(value)) ||
      scrollTop < 0 || scrollHeight < 0 || clientHeight < 0 ||
      thresholdPx < 0) return false;
  return scrollHeight - scrollTop - clientHeight <= thresholdPx;
}

/**
 * Preserve the live/latest reading position when a presentation-only change
 * (such as caption font size) alters scrollHeight. A reader who intentionally
 * scrolled up keeps their current position instead of being forced to the end.
 */
export function preserveCaptionScrollOnLayoutChange(caption, applyChange) {
  if (!caption || typeof applyChange !== "function") {
    throw new TypeError("Caption and layout callback are required.");
  }
  const follow = shouldFollowCaptionScroll(
    caption.scrollTop, caption.scrollHeight, caption.clientHeight);
  applyChange();
  if (follow) caption.scrollTop = caption.scrollHeight;
  return follow;
}
