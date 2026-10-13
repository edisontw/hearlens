# M01 — Live rolling-caption freshness (2026-10-13)

## Finding

The existing **30-second** window was only trimmed on an STT callback or a manual render. During a quiet period, already expired caption lines could remain in the primary "即時字幕" display indefinitely, while the "剛剛說什麼？" relative-age labels only changed on manual opening or a newly recognized final. A lingering partial from a streaming provider could likewise remain displayed even when no further interim updates arrived.

This was identified by source inspection and deterministic tests; no new microphone measurements or field efficacy are claimed.

## Fix

- Add a pure **display projection** `currentCaptionText` in `apps/web/transcript-window.mjs`: final segments are filtered by the same 30,000-ms window; partial text requires an independent recent timestamp, so stale interim text cannot masquerade as new speech. Boundary rules are tested at exactly 30 seconds and after.
- A **1-second foreground caption UI refresh** runs only while a caption session is active or recent caption/interim text still exists. The timer is disposed when no recent data and no active session remain. When mobile browsers throttle background timers, foreground callbacks/resumption or a future tick recompute from absolute timestamps; we do not infer dependable one-second scheduling on backgrounded devices.
- The live caption DOM `textContent` is assigned **only when the displayed string changes**, preventing a needless per-second aria-live announcement of unchanged text. The recall panel's contents and relative times are refreshed while open and recent data is present.
- Starting a new session explicitly clears the preceding rolling-display items and last interim fallback. This matches the existing privacy design: the new session gets its own recent caption history, and no audio or transcript persistence is added.
- `sessionFinals` and original report export **remain distinct and complete**; the 30-second projection never changes report scoring, formal test data or historical telemetry. On Stop or fatal error, any still-recent finalized lines remain visible briefly, then clear as they expire. No automatic microphone restart.
- Versioned Web assets/build: `20261013-rolling-caption1`.

## Verification and exclusions

- Pure tests cover final+partial expiry, exact boundary, future/unknown interim timestamp exclusion and input immutability.
- CI wiring checks periodic timer setup/teardown, no redundant DOM writes, complete `sessionFinals` report export, cache-busted browser files and existing M01/Gemini/M03/SW3 regressions.
- This patch does **not** change STT model, input normalization/limiter, audio capture configuration, caption finalization protocol, native Android route, or hearing output.
- A visually blank caption when quiet does **not** prove the mic is inactive or the recognizer disconnected: the existing "正在聆聽" session status remains authoritative.
- No new HTC/iPhone benchmark is required for this deterministic UI bug fix; on-device visual behavior may be spot-checked opportunistically.

Safety remains governed by [SAFETY.md](./SAFETY.md): no live amplified output without physical route/mute and per-ear calibrated MPO gates.
