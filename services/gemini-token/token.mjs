export const TOKEN_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/auth_tokens";
export const GEMINI_MODEL = "models/gemini-3.5-transcribe-live";
export const TOKEN_LIFETIME_MS = 12 * 60 * 1000;
export const NEW_SESSION_LIFETIME_MS = 60 * 1000;

export class TokenProvisionError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function buildAuthTokenPayload(now = Date.now()) {
  return {
    uses: 1,
    expireTime: new Date(now + TOKEN_LIFETIME_MS).toISOString(),
    newSessionExpireTime: new Date(
      now + NEW_SESSION_LIFETIME_MS,
    ).toISOString(),
    bidiGenerateContentSetup: {
      model: GEMINI_MODEL,
      generationConfig: {
        responseModalities: ["TEXT"],
      },
      inputAudioTranscription: {
        languageCodes: [],
        mode: "VERBATIM",
      },
    },
  };
}

export async function createTokenWithKey(
  apiKey,
  { fetchImpl = globalThis.fetch, now = Date.now() } = {},
) {
  const payload = buildAuthTokenPayload(now);
  const response = await fetchImpl(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
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
    throw new TokenProvisionError(message, response.status);
  }

  if (!data?.name) {
    throw new TokenProvisionError(
      "Gemini token provisioning returned no token.",
      502,
    );
  }

  return {
    token: data.name,
    expireTime: payload.expireTime,
    newSessionExpireTime: payload.newSessionExpireTime,
  };
}

export function shouldTryAnotherKey(error) {
  if (!(error instanceof TokenProvisionError)) return false;
  return [400, 401, 403].includes(error.status);
}

export function redactSecrets(value, secrets = []) {
  let text = String(value ?? "");
  for (const secret of secrets) {
    if (secret) text = text.split(secret).join("[REDACTED]");
  }
  return text;
}
