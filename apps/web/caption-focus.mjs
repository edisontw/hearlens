/**
 * Optional, presentation-only caption focus mode.
 * No microphone, STT, audio route, network or persistence side effects.
 * Each new page load starts in the normal layout.
 */
export function createCaptionFocusMode({ body, button, onLayoutChange }) {
  if (!body?.classList || !button?.addEventListener) {
    throw new TypeError("Caption focus controls are required.");
  }

  function setEnabled(enabled) {
    const next = enabled === true;
    const apply = () => {
      body.classList.toggle("caption-focus-mode", next);
      button.setAttribute("aria-pressed", next ? "true" : "false");
      button.textContent = next ? "返回一般畫面" : "專注閱讀";
    };
    // Allow the caller to preserve caption scroll while the layout changes.
    // Focus mode itself remains presentation-only.
    if (typeof onLayoutChange === "function") onLayoutChange(apply);
    else apply();
    return next;
  }

  setEnabled(false);
  button.addEventListener("click", () =>
    setEnabled(!body.classList.contains("caption-focus-mode")));

  return {
    enabled: () => body.classList.contains("caption-focus-mode"),
    setEnabled,
  };
}
