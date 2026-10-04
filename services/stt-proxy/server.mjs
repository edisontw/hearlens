import http from "node:http";
import speechPackage from "@google-cloud/speech";
import { WebSocket, WebSocketServer } from "ws";

const { v2: speech } = speechPackage;

const PORT = Number(process.env.PORT || 8080);
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || "";
const LOCATION = process.env.GOOGLE_STT_LOCATION || "us";
const MODEL = process.env.GOOGLE_STT_MODEL || "chirp_3";
const LANGUAGE = process.env.GOOGLE_STT_LANGUAGE || "cmn-Hant-TW";
const API_ENDPOINT =
  process.env.GOOGLE_STT_API_ENDPOINT ||
  (LOCATION === "global" ? "" : LOCATION + "-speech.googleapis.com");
const MAX_AUDIO_MESSAGE_BYTES = 15 * 1024;
const MAX_SESSION_MS = Number(process.env.HEARLENS_MAX_SESSION_MS || 240_000);

const DEFAULT_ORIGINS = [
  "https://edisontw.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
];

const allowedOrigins = new Set(
  (process.env.HEARLENS_ALLOWED_ORIGINS || DEFAULT_ORIGINS.join(","))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

let speechClient = null;

function getSpeechClient() {
  if (!PROJECT_ID) {
    throw new Error("GOOGLE_CLOUD_PROJECT is required.");
  }

  if (!speechClient) {
    speechClient = new speech.SpeechClient(
      API_ENDPOINT ? { apiEndpoint: API_ENDPOINT } : {},
    );
  }

  return speechClient;
}

function originAllowed(origin) {
  return allowedOrigins.has("*") || allowedOrigins.has(origin || "");
}

function sendJson(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function sendError(ws, code, message) {
  sendJson(ws, { type: "error", code, message });
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url || "/", "http://localhost");

  if (url.pathname === "/healthz") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      ok: true,
      configured: Boolean(PROJECT_ID),
      location: LOCATION,
      model: MODEL,
      language: LANGUAGE,
    }));
    return;
  }

  response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  response.end("Not found\n");
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url || "/", "http://localhost");
  if (url.pathname !== "/stt") {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }

  if (!originAllowed(request.headers.origin)) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});

wss.on("connection", (ws) => {
  let googleStream = null;
  let configured = false;
  let finishing = false;
  let sessionTimer = null;

  const clearSessionTimer = () => {
    if (sessionTimer) {
      clearTimeout(sessionTimer);
      sessionTimer = null;
    }
  };

  const finishGoogleStream = () => {
    if (finishing) return;
    finishing = true;
    clearSessionTimer();
    try {
      googleStream?.end?.();
    } catch {
      // Ignore shutdown errors after the client has disconnected.
    }
  };

  const startGoogleStream = async (message) => {
    if (configured) {
      throw new Error("STT stream is already configured.");
    }

    const sampleRate = Number(message.sampleRate);
    if (!Number.isInteger(sampleRate) || sampleRate < 8_000 || sampleRate > 96_000) {
      throw new Error("Invalid sampleRate.");
    }

    const language = message.language || LANGUAGE;
    if (language !== LANGUAGE) {
      throw new Error("Unsupported language: " + language);
    }

    if (message.encoding !== "LINEAR16" || Number(message.channels) !== 1) {
      throw new Error("Only mono LINEAR16 input is supported.");
    }

    const client = getSpeechClient();
    googleStream = await client.streamingRecognize();

    googleStream.on("data", (response) => {
      for (const result of response.results || []) {
        const text = result.alternatives?.[0]?.transcript?.trim() || "";
        if (!text) continue;

        sendJson(ws, {
          type: result.isFinal ? "final" : "partial",
          text,
          stability: result.stability ?? null,
        });
      }
    });

    googleStream.on("error", (error) => {
      clearSessionTimer();
      sendError(
        ws,
        "google-stt-error",
        error instanceof Error ? error.message : "Google STT stream failed.",
      );
      try {
        ws.close(1011, "google stt error");
      } catch {
        // Ignore close errors.
      }
    });

    googleStream.on("end", () => {
      clearSessionTimer();
      sendJson(ws, { type: "stopped" });
    });

    const recognizer =
      "projects/" + PROJECT_ID +
      "/locations/" + LOCATION +
      "/recognizers/_";

    googleStream.write({
      recognizer,
      streamingConfig: {
        config: {
          explicitDecodingConfig: {
            encoding: "LINEAR16",
            sampleRateHertz: sampleRate,
            audioChannelCount: 1,
          },
          languageCodes: [language],
          model: MODEL,
          features: {
            enableAutomaticPunctuation: true,
          },
        },
        streamingFeatures: {
          interimResults: true,
        },
      },
    });

    configured = true;
    sessionTimer = setTimeout(() => {
      sendError(ws, "session-limit", "STT session reached the prototype time limit.");
      finishGoogleStream();
    }, MAX_SESSION_MS);

    sendJson(ws, {
      type: "ready",
      provider: "google-cloud-stt-v2",
      location: LOCATION,
      model: MODEL,
      language,
      sampleRate,
    });
  };

  ws.on("message", async (data, isBinary) => {
    if (isBinary) {
      if (!configured || !googleStream || finishing) {
        sendError(ws, "audio-before-ready", "Audio arrived before STT was ready.");
        return;
      }

      if (data.length > MAX_AUDIO_MESSAGE_BYTES) {
        sendError(ws, "audio-chunk-too-large", "Audio WebSocket frame exceeds 15 KB.");
        finishGoogleStream();
        return;
      }

      googleStream.write({ audio: Buffer.from(data) });
      return;
    }

    let message;
    try {
      message = JSON.parse(data.toString("utf8"));
    } catch {
      sendError(ws, "invalid-json", "Control message must be valid JSON.");
      return;
    }

    if (message.type === "start") {
      try {
        await startGoogleStream(message);
      } catch (error) {
        sendError(
          ws,
          "start-failed",
          error instanceof Error ? error.message : "Could not start Google STT.",
        );
      }
      return;
    }

    if (message.type === "stop") {
      finishGoogleStream();
      if (!googleStream) {
        sendJson(ws, { type: "stopped" });
      }
      return;
    }

    sendError(ws, "unknown-control", "Unknown control message.");
  });

  ws.on("close", () => {
    finishGoogleStream();
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    "HearLens STT proxy listening on :" + PORT +
      " (" + LOCATION + "/" + MODEL + "/" + LANGUAGE + ")",
  );
});
