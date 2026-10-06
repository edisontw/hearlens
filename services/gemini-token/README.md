# HearLens Gemini token broker

This small service belongs on MN4 or another HTTPS server. It does **not** proxy microphone audio.

Flow:

1. HearLens requests a one-use ephemeral Gemini Live token from `POST /token`.
2. The broker exchanges the server-side `GEMINI_API_KEY` for a short-lived token.
3. The browser connects directly to Gemini 3.5 Transcribe Live.
4. Microphone audio never passes through MN4.

## Environment

- `GEMINI_API_KEYS` — preferred for multiple keys; comma-separated, server-side only. Requests rotate across configured keys.\n- `GEMINI_API_KEY` — single-key fallback for compatibility; server-side only.
- `PORT` — default `8787`.
- `HEARLENS_ALLOWED_ORIGINS` — default includes `https://edisontw.github.io`.
- `HEARLENS_TOKEN_RATE_LIMIT` — default 12 token requests per IP per minute.

## Local test

```bash
cd services/gemini-token
export GEMINI_API_KEYS="key1,key2,key3"
node server.mjs
curl http://127.0.0.1:8787/healthz
```

The production endpoint must use HTTPS because HearLens is served from GitHub Pages over HTTPS. Put this service behind the existing MN4 nginx or another TLS reverse proxy.

The deployed Web Hearing Lab uses the production broker by default, so the normal URL needs no STT query parameters:

```text
https://edisontw.github.io/hearlens/
```

For engineering overrides, `?stt=browser` explicitly selects Browser SpeechRecognition, while `?token=...` can override the broker endpoint.

Do not expose the long-lived Gemini API key to browser JavaScript, GitHub Actions logs, query strings, or the repository.


## Multiple-key behavior

The broker rotates token provisioning across configured key slots. If a key is invalid or disabled, it can fall through to another configured key without exposing any secret in logs.

Gemini rate limits are project-scoped rather than key-scoped. Multiple keys from the same project therefore share the same quota. The broker deliberately does **not** switch keys on HTTP 429 rate-limit/quota responses.

Every ephemeral token is constrained to:

- model: `gemini-3.5-transcribe-live`
- response modality: `TEXT`
- input audio transcription with automatic language detection

This limits what a captured short-lived token can be used for.
