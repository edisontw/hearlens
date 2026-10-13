# M01 — Mobile caption layout and long-sentence readability (2026-10-14)

## Source-level finding

In the prior `apps/web/styles.css`, a `max-width:540px` rule stacked both sets of home-screen controls vertically. Large subtitle text had only `min-height` and no contained scrolling; lengthy recent captions therefore expanded the primary panel, moving Start/Stop far down the page. Landscape phone viewports inherited an oversized title, intro and vertical spacing.

This is a **source-review finding**, not a claim that each mobile phone model reproduced the problem.

## Changes

- The primary caption area is now a **bounded, independently scrollable** dark high-contrast region with natural Chinese word wrapping (`overflow-wrap:anywhere`, `word-break:normal`) and keyboard-scroll focus (`tabindex=0`, labeled `role=log`). Existing **一般／大／特大** caption sizes remain 32/40/48 px.
- New source-independent `shouldFollowCaptionScroll` policy follows incoming text only if the caption was already within **48 px of its bottom**; manually scrolling up to reread older visible text is preserved. Caption text is still assigned only when changed, retaining the previous non-repeating aria-live behavior. This is UI scrolling only; **30-second rolling transcript and complete exported report remain untouched**.
- For phone-width screens at most 540 px, Start and Stop stay **side-by-side**. The recall action and three text-size controls also share a compact row; the size group retains its accessible `aria-label`. Buttons preserve at least **48 px** touch height; quick profile mode selection remains available, and side safe-area insets are respected.
- For **short-height landscape** screens (`orientation:landscape`, height at most 560 px), reduce decorative title/intro space, retain the important status and caption controls, and constrain caption height to a compact scrollable window with **44 px** minimum control height. Research diagnostics stay in a separate details panel.
- The build and responsive CSS/main module are explicitly versioned `20261014-caption-layout1`, with the default cloud STT workflow, input capture mode, normalization and backend unchanged.

## Validation boundaries

Pure unit tests verify scroll-follow boundary, invalid geometry and deliberate upward scroll. CI structural regressions verify CSS viewport breakpoints, layout constraints, button touch heights, cache-busted assets, accessible scrollable caption, and prior 30-second caption report behavior. Existing M01/Gemini/M03/SW3 tests remain in `npm test`.

**Structural CSS tests do not constitute screenshot-based or real-device layout verification.** Follow-up mobile acceptance can be lightweight: on the existing iPhone/Android page, check portrait and landscape with 一般／大／特大 text and one long caption. No repeat of the locked 24-run STT source/volume/distance matrix is indicated for this visual-only change.

No hearing audio route or output is enabled, and the safety stop gate in [SAFETY.md](./SAFETY.md) remains intact.
