# HearLens Web Hearing Lab

M01 browser prototype.

## Scope

This build intentionally does **not** amplify the microphone to headphones or speakers.

It validates:

- microphone permission,
- requested vs actual capture settings,
- sample-rate/channel/latency diagnostics,
- large live captions,
- browser SpeechRecognition as a demo/fallback backend,
- a 30-second in-memory transcript,
- "What did they just say?",
- large-text older-adult UX.

## Run locally

Because microphone APIs require a secure context outside localhost, use localhost during development or serve the site over HTTPS.

A simple local static server is sufficient, for example:

```bash
python -m http.server 8080 --directory apps/web
```

Then open:

```text
http://localhost:8080
```

## Important

Browser SpeechRecognition is not the planned production STT SLA. The next architecture step is a provider interface so Web cloud streaming and later native on-device recognizers can be benchmarked without changing transcript UI/state logic.
