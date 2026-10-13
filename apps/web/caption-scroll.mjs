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
