# Speech-to-Text Strategy

Updated: 2026-10-04

## Decision

HearLens will not bind the caption UI to one speech-recognition vendor.

The first product language is Taiwan Mandarin. Taiwanese Hokkien (Taigi) is a planned provider and benchmark track; it will not block the first MVP.

## Provider roadmap

### A. Browser fallback — now

Use SpeechRecognition / webkitSpeechRecognition when the browser provides it.

Advantages:
- no HearLens backend to operate,
- no API key,
- effectively zero backend cost for development,
- immediate partial-caption field testing.

Limitations:
- browser/platform support is inconsistent,
- the underlying service is outside our control,
- no production SLA,
- not a Taigi solution.

It remains a fallback/development baseline only.

### Verified Android Chrome limitation — 2026-10-04

On the tested Android Chrome device, a fresh first Browser SpeechRecognition session reaches `speechstart` and returns interim results. After a graceful `recognition.stop()` and normal `audioend` / `speechend` / `end`, the second session reaches `start` and `audiostart` but never reaches `speechstart` or `result`.

This was reproduced after:
- releasing the diagnostic `getUserMedia()` stream before SpeechRecognition,
- creating a fresh SpeechRecognition instance for every segment/session,
- replacing immediate `abort()` with graceful `stop()` plus delayed abort fallback.

Decision: stop spending M01 engineering time on the Android Browser SpeechRecognition lifecycle. Keep it as a zero-cost fallback only.

### B. Gemini 3.5 Transcribe Live — active M01 cloud path

This is now the first formal Taiwan Mandarin cloud benchmark because the Gemini Developer API currently exposes a free tier for Gemini 3.5 Transcribe Live.

Architecture:

    phone browser
      -> MN4 HTTPS token broker (no audio)
      -> one-use ephemeral token
      -> direct Gemini Live WebSocket
      -> interim/final captions

Reasons:
- dedicated low-latency streaming speech-to-text model,
- interim and final transcription events map directly to the HearLens provider contract,
- automatic language detection supports multilingual/code-switching speech,
- no long-lived Gemini API key in browser JavaScript,
- direct browser-to-Gemini audio avoids an extra MN4 media hop,
- current free tier is suitable for development benchmarking.

The browser sends 16 kHz mono PCM16 in approximately 100 ms chunks. The Live session limit is 10 minutes, so production-like continuous captions will later need session rollover/resumption behavior.

Current M01 status (2026-10-05):
- MN4 ephemeral-token provisioning is operational.
- Browser constrained-WebSocket setup is verified end to end.
- Binary WebSocket frames are decoded correctly in the browser provider.
- Gemini Mandarin output is converted for Taiwan Traditional Chinese display while preserving the raw STT text for evaluation.
- Manual `?gain=` plus RMS / peak / clipping telemetry is available only as an engineering probe.
- Informal distance tests show that input level materially affects 1 m recognition, so the next engineering step is adaptive input normalization rather than selecting one fixed gain value.

See [DEVELOPMENT_VALIDATION_STRATEGY.md](./DEVELOPMENT_VALIDATION_STRATEGY.md) for the staged test plan.

MN4 only serves `POST /token`. The long-lived `GEMINI_API_KEY` remains on MN4 and is exchanged for one-use short-lived Live API credentials.

### C. Google Cloud Speech-to-Text — later paid comparison

Google Cloud Speech-to-Text V2 explicitly supports Traditional Taiwan Mandarin (cmn-Hant-TW).

Why benchmark it early:
- explicit Taiwan Mandarin support,
- streaming-oriented speech service,
- punctuation and model-adaptation capabilities,
- published free usage tier suitable for small experiments.

Do not assume a Google AI / Google One student subscription is Cloud Speech API credit. Confirm billing/credits in the Cloud billing console before use.

Implementation status:
- browser PCM capture -> WebSocket provider added,
- server-side WebSocket -> Google Cloud STT V2 streaming proxy added,
- Google credentials remain server-side,
- Google provider is opt-in through the Web Hearing Lab query string so Browser fallback remains the default during deployment/benchmark setup.

The initial proxy defaults to a configurable V2 `us` / `chirp_3` path. Location and model are environment variables so Taiwan latency and regional model behavior can be benchmarked without rebuilding the browser client.

### Current Web default — 2026-10-06

The deployed Web Hearing Lab now defaults to Gemini 3.5 Transcribe Live using the MN4 ephemeral-token broker. Browser SpeechRecognition remains available only as an explicit fallback through `?stt=browser`.

If `?stt=auto` is used, HearLens selects Gemini when a token broker URL is configured and falls back to Browser SpeechRecognition only when no token broker is available.

### D. OpenAI transcription — comparison benchmark

OpenAI provides dedicated transcription and live-transcription models.

Why keep it as a benchmark:
- low published per-minute prices for transcription,
- multilingual recognition,
- useful Mandarin/English code-switch comparison,
- dedicated live-transcription path.

ChatGPT Plus and OpenAI API billing are separate. Plus must not be treated as API credit.

Never put an OpenAI API key in browser JavaScript. Cloud providers require a server-side token/proxy layer.

### E. Local / self-hosted Taigi

Primary candidate: MediaTek Research Breeze-ASR-26.

It is a Whisper-derived model fine-tuned for Taiwanese Hokkien / Taigi. Existing community runtimes demonstrate faster-whisper, whisper.cpp and quantized local deployment paths.

Initial architecture should be:

    phone browser
      -> HTTPS/WebSocket audio stream
      -> local ASR service
      -> partial/final transcript events

Do not attempt to download a multi-gigabyte Taigi model into the mobile Web MVP.

## Provider contract

All backends should converge on the same semantics:

    start({ stream, language })
    stop()
    dispose()

    onPartial({ text, timestamp, providerId })
    onFinal({ text, timestamp, providerId })
    onStatus(...)
    onError(...)

Provider-specific credentials, encoding, reconnect and billing logic must stay outside caption UI state.

## Language roadmap

### M01: Taiwan Mandarin

UI locale: zh-TW.

Provider-specific language codes may differ. For example, Google Cloud uses cmn-Hant-TW.

Benchmark speech must include:
- older speakers,
- dates and times,
- phone numbers,
- names and addresses,
- clinic and medication vocabulary,
- common Taiwan pronunciation.

### Next: Mandarin + English code switching

Include common mixed utterances such as MRI, HbA1c, LINE, AirPods and medication/product names.

### Later: Taigi

Taigi receives its own benchmark gate. Do not infer Taigi quality from Mandarin performance.

Evaluation must include:
- older speakers,
- regional accents,
- Mandarin/Taigi code switching,
- Chinese-character output usability,
- latency as well as recognition error.

Breeze-ASR-26 primarily produces Chinese-character transcription for Taigi; this may suit caption UX but requires actual user testing.

## Cost and quality decision

Development order:

1. Browser fallback.
2. Gemini 3.5 Transcribe Live free-tier benchmark.
3. Compare accuracy, first-partial latency, privacy and reconnect behavior.
4. Benchmark Google Cloud STT / OpenAI only if Gemini quality is insufficient or a second provider is needed.
5. Select a default Taiwan Mandarin backend only after measurement.
6. Preserve a self-hosted Taigi path.

Track cost as USD per active caption hour, together with:
- first meaningful partial latency,
- final latency,
- Taiwan Mandarin keyword/character error,
- number/date/medication error rate,
- reconnect/recovery behavior.

The cheapest recognizer is not acceptable if captions arrive too late for natural conversation.
