# M01 — Gemini Live unexpected disconnect fail-stop (2026-10-13)

## Motivation and reproduced code-path risk

Earlier M01 versions logged `gemini-closed` after a WebSocket close during an established caption session, but did **not** stop provider microphone capture or transition the main screen out of "正在聆聽". Further PCM frames could be processed locally while the socket was closed; `sendAudioChunk` silently discarded them. Users could therefore see a stale *listening* status with no captions. This was identified by source-code review and deterministic tests, **not** by a new reproduced phone crash.

## Implementation (caption path only)

- **Provider:** an unexpected WebSocket `close` or `error` now latches one fatal transport failure, turns `active` off immediately, disconnects capture nodes, stops the input track and closes its AudioContext. Duplicate `error` + `close` notifications cannot repeat fatal events. A closed transport during start cannot be silently accepted as a listening session.
- **Web UI:** on the fatal provider event from the active session, immediately invalidates its session ID so late partial/final/status/debug callbacks are ignored, displays **「字幕連線中斷，請重新開始」**, disables Stop, disposes provider and diagnostic capture, clears interim-only text, preserves finalized recent transcript and enables Start after cleanup.
- **No automatic retry** and no silent provider switching. The user intentionally restarts. This avoids invisible microphone permission/recording changes during an unexpected outage.
- The existing orderly **user-initiated Stop → audioStreamEnd → server final drain** path is unchanged. A manual Stop must **not** produce a fatal-disconnect message.
- Web build ID and cache-busting module URLs are updated to `20261013-gemini-failstop1`, allowing fresh GitHub Pages clients to obtain the changed code without changing audio DSP, STT model or capture/preset parameters.

## Safety, privacy and observability

The browser capture graph's gain-to-destination remains zero, as before. This patch does **not** amplify audio, route mic sound to speakers or headphones, modify the existing adaptive-normalizer/limiter, create native audio output, transmit analytics or persist raw voice. The existing M03/SW3 uncalibrated-hearing-output stop gate is unchanged.

Event logging adds a `transport-failed` provider event and session-level `fatal-session` / `fatal-cleanup-complete` markers. Existing report schema remains `hearlens-test-report-v1`. This is reliability hardening, **not** an STT accuracy improvement or measured mobile real-world PASS.

## Validation and future field gate

`npm test` runs deterministic WebSocket close/error/normal Stop/stale-message and idempotent cleanup checks plus static UI/session/build-version assertions, then all previous M01–M03 and SW3 tests. GitHub Pages deployment is left to the existing workflow.

Software regression PASS alone does **not** guarantee exact Android/iOS browser lifecycle behavior. If an actual disconnection is encountered in regular caption use, the user-visible expected behavior is: the status changes from listening to interrupted, mic recording stops, finalized captions remain briefly reviewable, and user can press Start again. There is **no need** to repeat the earlier HTC/iPhone fixed WAV distance matrix solely for this change. A focused in-device outage test is optional only if field evidence makes it necessary.

Formal M01 24-run accuracy benchmark remains **unperformed**, with intake tooling completed separately; do not pool old exploratory observations.
