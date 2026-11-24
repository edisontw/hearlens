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

- The adapter buffers mono audio in the browser at 16 kHz and sends a WAV to Edison only after the user presses Stop. It is batch transcription, not live captions; the screen and diagnostics say so.
- Capture is limited to 15 minutes. The server applies its configured file-size and task-retention rules under `D:\AIData`.
- Edison accepts browser requests only from explicitly configured loopback origins. The adapter rejects HTTPS/public pages, remote service hosts, custom paths, credentials, and model IDs outside the allowlist.
- The browser microphone prompt appears before capture. The page’s notice explains that the recording is sent to the same computer’s Edison service after Stop. Get consent from people being recorded.
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
