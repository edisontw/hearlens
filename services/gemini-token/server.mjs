import http from "node:http";

import {
  createTokenWithKey,
  redactSecrets,
  shouldTryAnotherKey,
} from "./token.mjs";

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8787);
const GEMINI_API_KEYS = [
  ...(process.env.GEMINI_API_KEYS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  ...(process.env.GEMINI_API_KEY || "").trim()
    ? [(process.env.GEMINI_API_KEY || "").trim()]
    : [],
].filter((value, index, array) => array.indexOf(value) === index);

let nextKeyIndex = 0;
const WINDOW_MS = 60 * 1000;
const MAX_TOKENS_PER_WINDOW = Number(
  process.env.HEARLENS_TOKEN_RATE_LIMIT || 12,
);

const DEFAULT_ORIGINS = [
  "https://edisontw.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
];

const allowedOrigins = new Set(
  (process.env.HEARLENS_ALLOWED_ORIGINS || DEFAULT_ORIGINS.join(","))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

const rateBuckets = new Map();

function corsHeaders(origin) {
  if (!allowedOrigins.has("*") && !allowedOrigins.has(origin || "")) {
    return null;
  }

  return {
    "access-control-allow-origin": origin || "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "600",
    vary: "Origin",
  };
}

function sendJson(response, status, payload, headers = {}) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  });
  response.end(JSON.stringify(payload));
}

function requestIp(request) {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return request.socket.remoteAddress || "unknown";
}

function rateAllowed(ip) {
  const now = Date.now();
  const current = rateBuckets.get(ip);

  if (!current || now - current.startedAt >= WINDOW_MS) {
    rateBuckets.set(ip, { startedAt: now, count: 1 });
    return true;
  }

  if (current.count >= MAX_TOKENS_PER_WINDOW) {
    return false;
  }

  current.count += 1;
  return true;
}

async function createGeminiToken() {
  if (GEMINI_API_KEYS.length === 0) {
    throw new Error(
      "GEMINI_API_KEYS or GEMINI_API_KEY is not configured.",
    );
  }

  const startIndex = nextKeyIndex % GEMINI_API_KEYS.length;
  nextKeyIndex = (nextKeyIndex + 1) % GEMINI_API_KEYS.length;

  let lastError = null;

  for (let offset = 0; offset < GEMINI_API_KEYS.length; offset += 1) {
    const index = (startIndex + offset) % GEMINI_API_KEYS.length;

    try {
      return await createTokenWithKey(GEMINI_API_KEYS[index]);
    } catch (error) {
      lastError = error;

      // Retry only credential/configuration failures. Do not hop keys on
      // quota/rate-limit responses: Gemini quotas are project-scoped.
      if (!shouldTryAnotherKey(error)) {
        throw error;
      }

      console.warn(
        "Gemini token key slot " + (index + 1) +
          " failed credential validation; trying the next configured key.",
      );
    }
  }

  throw lastError || new Error("No Gemini API key could provision a token.");
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://localhost");
  const origin = request.headers.origin || "";
  const cors = corsHeaders(origin);

  if (url.pathname === "/healthz" && request.method === "GET") {
    sendJson(response, 200, {
      ok: true,
      configured: GEMINI_API_KEYS.length > 0,
      keyCount: GEMINI_API_KEYS.length,
      provider: "gemini-3.5-transcribe-live",
    });
    return;
  }

  if (url.pathname !== "/token") {
    sendJson(response, 404, { error: "not-found" });
    return;
  }

  if (!cors) {
    sendJson(response, 403, { error: "origin-not-allowed" });
    return;
  }

  if (request.method === "OPTIONS") {
    response.writeHead(204, cors);
    response.end();
    return;
  }

  if (request.method !== "POST") {
    sendJson(response, 405, { error: "method-not-allowed" }, cors);
    return;
  }

  if (!rateAllowed(requestIp(request))) {
    sendJson(response, 429, { error: "rate-limited" }, cors);
    return;
  }

  try {
    const token = await createGeminiToken();
    sendJson(response, 200, token, cors);
  } catch (error) {
    const message = redactSecrets(
      error instanceof Error ? error.message : "unknown error",
      GEMINI_API_KEYS,
    );
    console.error("token provisioning failed:", message);
    sendJson(
      response,
      502,
      {
        error: "token-provisioning-failed",
        message,
      },
      cors,
    );
  }
});

server.listen(PORT, HOST, () => {
  console.log("HearLens Gemini token broker listening on " + HOST + ":" + PORT);
});
