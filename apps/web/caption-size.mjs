export const CAPTION_SIZE_LEVELS = Object.freeze({
  NORMAL: "normal",
  LARGE: "large",
  XLARGE: "xlarge",
});

export const CAPTION_SIZE_PIXELS = Object.freeze({
  [CAPTION_SIZE_LEVELS.NORMAL]: 32,
  [CAPTION_SIZE_LEVELS.LARGE]: 40,
  [CAPTION_SIZE_LEVELS.XLARGE]: 48,
});

export const DEFAULT_CAPTION_SIZE_LEVEL = CAPTION_SIZE_LEVELS.NORMAL;

export function normalizeCaptionSizeLevel(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return Object.hasOwn(CAPTION_SIZE_PIXELS, normalized)
    ? normalized
    : DEFAULT_CAPTION_SIZE_LEVEL;
}

export function captionSizePixels(level) {
  return CAPTION_SIZE_PIXELS[normalizeCaptionSizeLevel(level)];
}
