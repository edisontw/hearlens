# HearLens Google STT proxy

Small WebSocket proxy for the HearLens Web Hearing Lab.

The browser sends mono LINEAR16 PCM over WebSocket. This service keeps Google Cloud credentials server-side and forwards audio to Speech-to-Text V2 streaming recognition.

## Defaults

- language: `cmn-Hant-TW`
- location: `us`
- model: `chirp_3`
- WebSocket path: `/stt`
- health check: `/healthz`
- prototype session limit: 240 seconds

The location/model are environment variables because Google model availability and regional client behavior can change. For Taiwan latency testing, benchmark supported Asia locations separately rather than hard-coding them into the browser.

## Local run

Prerequisites:

1. Enable Cloud Speech-to-Text in the selected Google Cloud project.
2. Configure Application Default Credentials (ADC).
3. Set `GOOGLE_CLOUD_PROJECT`.

```bash
cd services/stt-proxy
npm install
gcloud auth application-default login
export GOOGLE_CLOUD_PROJECT="your-project-id"
npm start
```

Health check:

```bash
curl http://127.0.0.1:8080/healthz
```

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `GOOGLE_CLOUD_PROJECT` | required | Google Cloud project ID |
| `GOOGLE_STT_LOCATION` | `us` | V2 recognizer location |
| `GOOGLE_STT_MODEL` | `chirp_3` | Recognition model |
| `GOOGLE_STT_LANGUAGE` | `cmn-Hant-TW` | Allowed language |
| `GOOGLE_STT_API_ENDPOINT` | derived from location | Optional explicit gRPC endpoint |
| `HEARLENS_ALLOWED_ORIGINS` | HearLens Pages + localhost | Comma-separated WebSocket Origin allowlist |
| `HEARLENS_MAX_SESSION_MS` | `240000` | Prototype stream limit |
| `PORT` | `8080` | HTTP/WebSocket port |

## Cloud Run prototype

From this directory:

```bash
gcloud run deploy hearlens-stt-proxy \
  --source . \
  --allow-unauthenticated \
  --set-env-vars GOOGLE_CLOUD_PROJECT=YOUR_PROJECT_ID,HEARLENS_ALLOWED_ORIGINS=https://edisontw.github.io
```

Use the resulting HTTPS service URL as a WSS URL in HearLens, for example:

```text
https://edisontw.github.io/hearlens/?stt=google&ws=wss%3A%2F%2FYOUR-SERVICE.run.app%2Fstt
```

Do not place service-account JSON or Google API credentials in `apps/web/` or in a query parameter.

The public Cloud Run form above is for controlled prototype testing only. Origin filtering is not authentication; add a real user/session authentication layer before broader exposure.
