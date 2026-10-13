# M01 — Foreground/mobile microphone lifecycle fail-stop (2026-10-13)

## Problem / scope

The caption browser workflow already fails closed for an unexpected Gemini WebSocket transport loss. The next distinct failure mode is **mobile lifecycle**: Android Chrome or iOS Safari may hide/freeze a page during app switch or screen lock; permission prompts, token fetches and `getUserMedia` may complete late; OS microphone permission/device removal may end or mute an audio track. Without guards, an older startup could recreate a hidden mic stream or leave "正在聆聽" displayed without useful captions.

This release addresses **foreground captions only**. It does not attempt background capture, screen-off operation, auto-resume, native audio output, Bluetooth speaker isolation or ear-level MPO calibration.

## Change

1. When a live/starting caption session sees `document.visibilityState === "hidden"` via `visibilitychange`, or `window.pagehide`, immediately invalidate its session ID, show **「字幕已暫停，請重新開始」**, dispose its provider/stream and disable the Start control until cleanup ends. `pageshow` / foreground return **never** automatically reopens the mic.
2. The diagnostic permission stream is acquired into a **local** variable. Before ownership is assigned, a session-ID/visibility check rejects results from a hidden or superseded session and explicitly stops their tracks. Recheck after diagnostic release, 250-ms cooldown and provider startup.
3. Gemini provider maintains a startup epoch. After token fetch, WebSocket open, setup, microphone acquisition and AudioContext resume, it rejects continuation if a manual dispose/stop/transport fault happened in the meantime. A late-arriving microphone stream is stopped before it can be connected to processing.
4. The active Gemini `MediaStreamTrack` registers `ended`, `mute`, `unmute` handlers. A permanently ended capture track immediately terminates the session. For transient `mute`, allow **2 seconds** for platform recovery; if still muted, stop and require deliberate restart. `unmute` cancels the timer. This threshold is a conservative *software UI-reliability policy*, **not** a measured mobile OS guarantee.
5. Capture handlers and timers are removed during all stop/dispose/fatal paths. Previous finished captions remain available in the existing **memory-only** short history. Existing explicit Stop / `audioStreamEnd` final drain is preserved.

## Verification

- Deterministic tests: document hidden vs visible/pagehide logic, stale session admission, microhone `ended`, transient `mute/unmute`, persistent 2-second mute, post-dispose `getUserMedia` resolution, post-dispose token resolution, prior duplicate WebSocket close and normal Stop/drain.
- `npm test` and GitHub Pages deployment in unchanged workflows.
- No new physical test; **browser-specific OS suspension behavior remains unmeasured**. On a real field outage the expected result is no stale "正在聆聽", released mic and a manual Start option, but iOS/Android lifecycle callbacks can be delayed or omitted, especially if the process is forcibly terminated. Thus **software tests are not a guarantee of instant hardware mic release or uninterrupted background capture**.
- The prior iPhone/HTC distance/A-B datasets remain exploratory. Formal M01 24-run protocol remains open, and this change does not alter capture/audio gain/STT provider/model policy.

References: [MDN visibilitychange](https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event), [MDN pagehide](https://developer.mozilla.org/en-US/docs/Web/API/Window/pagehide_event), [MDN MediaStreamTrack ended](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/ended_event).

## Stop gate

HearLens **cannot** claim real-ear hearing benefit, physical Bluetooth route locking, speaker-fallback hard mute, or independent L/R acoustic MPO from this work. Live microphone amplification remains OFF.
