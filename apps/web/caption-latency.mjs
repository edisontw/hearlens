export function createCaptionLatencyTelemetry(sessionStartedAt = Date.now()) {
  return {
    sessionStartedAt,
    firstAudioChunkAt: null,
    firstPartialAt: null,
    firstFinalAt: null,
  };
}

function asFiniteTimestamp(value) {
  return Number.isFinite(value) ? Number(value) : null;
}

export function markFirstAudioChunk(telemetry, timestamp = Date.now()) {
  if (!telemetry || telemetry.firstAudioChunkAt !== null) return telemetry;
  telemetry.firstAudioChunkAt = asFiniteTimestamp(timestamp);
  return telemetry;
}

export function markFirstPartial(telemetry, timestamp = Date.now()) {
  if (!telemetry || telemetry.firstPartialAt !== null) return telemetry;
  telemetry.firstPartialAt = asFiniteTimestamp(timestamp);
  return telemetry;
}

export function markFirstFinal(telemetry, timestamp = Date.now()) {
  if (!telemetry || telemetry.firstFinalAt !== null) return telemetry;
  telemetry.firstFinalAt = asFiniteTimestamp(timestamp);
  return telemetry;
}

function elapsed(from, to) {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.max(0, Math.round(to - from));
}

export function captionLatencySnapshot(telemetry) {
  if (!telemetry) {
    return {
      reference: null,
      firstPartialMs: null,
      firstFinalMs: null,
      firstPartialFromSessionMs: null,
      firstFinalFromSessionMs: null,
      audioStartupMs: null,
    };
  }

  const {
    sessionStartedAt,
    firstAudioChunkAt,
    firstPartialAt,
    firstFinalAt,
  } = telemetry;

  const referenceAt = Number.isFinite(firstAudioChunkAt)
    ? firstAudioChunkAt
    : Number.isFinite(sessionStartedAt)
      ? sessionStartedAt
      : null;

  return {
    reference: Number.isFinite(firstAudioChunkAt)
      ? "first-audio-chunk"
      : Number.isFinite(sessionStartedAt)
        ? "session-start"
        : null,
    firstPartialMs: elapsed(referenceAt, firstPartialAt),
    firstFinalMs: elapsed(referenceAt, firstFinalAt),
    firstPartialFromSessionMs: elapsed(sessionStartedAt, firstPartialAt),
    firstFinalFromSessionMs: elapsed(sessionStartedAt, firstFinalAt),
    audioStartupMs: elapsed(sessionStartedAt, firstAudioChunkAt),
  };
}
