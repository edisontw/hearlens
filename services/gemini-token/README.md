# HearLens Gemini token broker

This small service belongs on MN4 or another HTTPS server. It does **not** proxy microphone audio.

Flow:

1. HearLens requests a one-use ephemeral Gemini Live token from `POST /token`.
2. The broker exchanges the server-side `GEMINI_API_KEY` for a short-lived token.
3. The browser connects directly to Gemini 3.5 Transcribe Live.
4. Microphone audio never passes through MN4.

## Environment

- `GEMINI_API_KEY` — required; keep it only on the server.
- `PORT` — default `8787`.
- `HEARLENS_ALLOWED_ORIGINS` — default includes `https://edisontw.github.io`.
- `HEARLENS_TOKEN_RATE_LIMIT` — default 12 token requests per IP per minute.

## Local test

```bash
cd services/gemini-token
export GEMINI_API_KEY="..."
node server.mjs
curl http://127.0.0.1:8787/healthz
```

The production endpoint must use HTTPS because HearLens is served from GitHub Pages over HTTPS. Put this service behind the existing MN4 nginx or another TLS reverse proxy.

Example HearLens URL after HTTPS is configured:

```text
https://edisontw.github.io/hearlens/?stt=gemini&token=https%3A%2F%2FYOUR-HOST%2Fhearlens-token
```

Do not expose the long-lived Gemini API key to browser JavaScript, GitHub Actions logs, query strings, or the repository.
