/**
 * Window for an on-screen review of finalized captions in the current session.
 * Only the caller-owned finalized array is accepted. No persistence, audio,
 * partial text or network access. The caller renders strings via textContent.
 */
export const SESSION_REVIEW_PAGE_SIZE = 60;

export function sessionReviewWindow(finalizedItems = [], visibleCount = SESSION_REVIEW_PAGE_SIZE) {
  const items = Array.isArray(finalizedItems) ? finalizedItems : [];
  const wanted = Number.isFinite(visibleCount) && visibleCount > 0
    ? Math.floor(visibleCount)
    : SESSION_REVIEW_PAGE_SIZE;
  const start = Math.max(0, items.length - wanted);
  return {
    items: items.slice(start),
    total: items.length,
    hiddenCount: start,
  };
}
