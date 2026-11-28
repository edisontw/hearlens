# HearLens Edison Local ASR (opt-in)

This adapter is a local integration experiment. It does not change the default Gemini provider or any deployment configuration.

## Run

Start Edison on `127.0.0.1:8765`, then serve HearLens from a loopback origin allowed in Edison’s local resource configuration. The development origin is `http://localhost:8080`:

```powershell
python -m http.server 8080 --directory apps/web
```

Open this explicit opt-in URL:

```text
http://localhost:8080/?stt=edison-local-asr&edison=http://127.0.0.1:8765&edisonModel=breeze-asr-26-q5&edisonLanguage=auto
```

Supported models are `whisper-large-v3-turbo`, `qwen3-asr-1.7b-q8`, and `breeze-asr-26-q5`. `edisonLanguage` accepts `auto`, `zh`, or `en`; `auto` is a general language-detection request, not a promise of accurate Taiwanese Hokkien transcription.

## Behavior and limits

- The adapter processes mono audio in the browser at 16 kHz and sends VAD-delimited WAV segments to Edison during capture. Speech segments contain up to about 2.5 seconds before a forced split, with 250 ms of overlap across a continuous utterance; requests are serialized and captions appear as each local response completes. This is segmented batch ASR, not a continuous streaming connection. Stop sends the current segment and drains the remaining queue.
- Capture is limited to 15 minutes. The server applies its configured file-size and task-retention rules under `D:\AIData`.
- Edison accepts browser requests only from explicitly configured loopback origins. Its API binds to IPv4 `127.0.0.1`, so the adapter requires that service host instead of accepting `localhost` or IPv6 `::1`, which may not reach the listener. It also rejects HTTPS/public pages, remote service hosts, custom paths, credentials, and model IDs outside the allowlist.
- The browser microphone prompt appears before capture. The page’s notice explains that speech is sent in short segments to the same computer’s Edison service during capture. Get consent from people being recorded.
- Stop during startup invalidates the provider generation and aborts health/model checks. If a pending browser permission request returns a stream later, its tracks are stopped before an audio context or listening state is created.
- Disposing a session invalidates its generation, aborts any in-flight transcription request, and waits for the request queue to settle before cleanup resolves; a late response from that generation cannot emit captions after restart.
- A transcription request failure or an unexpected microphone-track end stops the current capture and requires an explicit restart; the adapter does not auto-retry or switch to cloud ASR. After recovery, a new start checks service/model state again and begins a fresh caption generation.
- Do not use this adapter from a phone. A phone’s `127.0.0.1` would be the phone itself, and this API has no remote authentication or HTTPS gateway.
- Local TTS, Taiwanese Hokkien accuracy, mobile access, and low-latency streaming are outside this adapter’s verified scope.

## Edison CORS setting

In `D:\AIData\config\local-resources.yaml`, allow only the exact loopback origin used by the development server:

```yaml
hearlens:
  local_origins:
    - 'http://localhost:8080'
    - 'http://127.0.0.1:8080'
```

The API still binds to `127.0.0.1`; this allowlist does not expose it to the LAN or Internet.
