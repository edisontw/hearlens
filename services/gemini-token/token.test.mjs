import assert from "node:assert/strict";
import test from "node:test";

import {
  GEMINI_MODEL,
  NEW_SESSION_LIFETIME_MS,
  TOKEN_ENDPOINT,
  TOKEN_LIFETIME_MS,
  TokenProvisionError,
  buildAuthTokenPayload,
  createTokenWithKey,
  redactSecrets,
  shouldTryAnotherKey,
} from "./token.mjs";

const FIXED_NOW = Date.UTC(2026, 9, 4, 12, 0, 0);

test("AuthToken request uses current bidiGenerateContentSetup schema", async () => {
  const apiKey = "test-secret-api-key";
  let capturedUrl = null;
  let capturedOptions = null;

  const fetchImpl = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return new Response(JSON.stringify({ name: "ephemeral-test-token" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await createTokenWithKey(apiKey, {
    fetchImpl,
    now: FIXED_NOW,
  });

  assert.equal(capturedUrl, TOKEN_ENDPOINT);
  assert.equal(capturedOptions.method, "POST");
  assert.equal(capturedOptions.headers["x-goog-api-key"], apiKey);
  assert.equal(capturedOptions.headers["content-type"], "application/json");

  const payload = JSON.parse(capturedOptions.body);
  assert.equal(payload.uses, 1);
  assert.equal("liveConnectConstraints" in payload, false);
  assert.deepEqual(payload.bidiGenerateContentSetup, {
    model: GEMINI_MODEL,
    generationConfig: {
      responseModalities: ["TEXT"],
    },
    inputAudioTranscription: {
      languageCodes: [],
      mode: "VERBATIM",
    },
  });

  assert.equal(
    Date.parse(payload.expireTime) - FIXED_NOW,
    TOKEN_LIFETIME_MS,
  );
  assert.equal(
    Date.parse(payload.newSessionExpireTime) - FIXED_NOW,
    NEW_SESSION_LIFETIME_MS,
  );
  assert.ok(TOKEN_LIFETIME_MS < 20 * 60 * 60 * 1000);
  assert.ok(NEW_SESSION_LIFETIME_MS <= 60 * 1000);

  assert.deepEqual(result, {
    token: "ephemeral-test-token",
    expireTime: payload.expireTime,
    newSessionExpireTime: payload.newSessionExpireTime,
  });
  assert.equal(JSON.stringify(result).includes(apiKey), false);
});

test("payload builder is deterministic for a supplied clock", () => {
  assert.deepEqual(
    buildAuthTokenPayload(FIXED_NOW),
    buildAuthTokenPayload(FIXED_NOW),
  );
});

test("key hopping remains limited to credential/configuration failures", () => {
  assert.equal(shouldTryAnotherKey(new TokenProvisionError("bad key", 400)), true);
  assert.equal(shouldTryAnotherKey(new TokenProvisionError("unauthorized", 401)), true);
  assert.equal(shouldTryAnotherKey(new TokenProvisionError("forbidden", 403)), true);
  assert.equal(shouldTryAnotherKey(new TokenProvisionError("quota", 429)), false);
  assert.equal(shouldTryAnotherKey(new TokenProvisionError("upstream", 500)), false);
});

test("secret redaction removes configured API keys from messages", () => {
  const key1 = "secret-key-one";
  const key2 = "secret-key-two";
  const redacted = redactSecrets(
    `upstream mentioned ${key1} and ${key2}`,
    [key1, key2],
  );

  assert.equal(redacted.includes(key1), false);
  assert.equal(redacted.includes(key2), false);
  assert.match(redacted, /\[REDACTED\]/);
});
