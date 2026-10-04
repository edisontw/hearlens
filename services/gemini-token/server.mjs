import http from "node:http";

const PORT = Number(process.env.PORT || 8787);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const TOKEN_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/auth_tokens";
const TOKEN_LIFETIME_MS = 12 * 60 * 1000;
const NEW_SESSION_LIFETIME_MS = 60 * 1000;
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
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const now = Date.now();
  const payload = {
    uses: 1,
    expireTime: new Date(now + TOKEN_LIFETIME_MS).toISOString(),
    newSessionExpireTime: new Date(
      now + NEW_SESSION_LIFETIME_MS,
    ).toISOString(),
  };

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "x-goog-api-key": GEMINI_API_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.message ||
      text ||
      "Gemini token provisioning failed.";
    throw new Error(message);
  }

  if (!data?.name) {
    throw new Error("Gemini token provisioning returned no token.");
  }

  return {
    token: data.name,
    expireTime: payload.expireTime,
    newSessionExpireTime: payload.newSessionExpireTime,
  };
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://localhost");
  const origin = request.headers.origin || "";
  const cors = corsHeaders(origin);

  if (url.pathname === "/healthz" && request.method === "GET") {
    sendJson(response, 200, {
      ok: true,
      configured: Boolean(GEMINI_API_KEY),
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
    console.error(
      "token provisioning failed:",
      error instanceof Error ? error.message : error,
    );
    sendJson(
      response,
      502,
      {
        error: "token-provisioning-failed",
        message: error instanceof Error ? error.message : "unknown error",
      },
      cors,
    );
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("HearLens Gemini token broker listening on :" + PORT);
});
