/**
 * M03G: bounded, replay-based OFFLINE chunk adapter.
 *
 * Purpose: test deterministic chunk segmentation and stable prefix emission
 * against the offline reference renderer. NOT a real-time streaming DSP:
 * each push re-renders the cumulative clip (quadratic CPU work), and there is
 * a lookahead holdback. No device, browser, playback, network or live route.
 */
import {
  renderOfflineWDRC,
  OFFLINE_WDRC_FRAME_SIZE,
  OFFLINE_WDRC_MAX_SAMPLES,
} from "./offline-wdrc.mjs";

export const OFFLINE_CHUNK_HOLDBACK = OFFLINE_WDRC_FRAME_SIZE;

export function createOfflineChunkedWDRC(config) {
  if (config === null || typeof config !== "object" || Array.isArray(config) ||
      Object.hasOwn(config, "samples")) {
    throw new TypeError("config must be a DSP options object without samples");
  }

  // Validate all DSP options by a synthetic zero-valued initialization render.
  // No output is released from the validator.
  renderOfflineWDRC({ ...config, samples: new Float32Array(1) });
  let source = new Float32Array(0);
  let emitted = 0;
  let closed = false;
  let latestDiagnostics = null;

  function push(chunk) {
    if (closed) throw new Error("chunk renderer already finalized");
    if (!(chunk instanceof Float32Array) || chunk.length < 1) {
      throw new TypeError("chunk must be a nonempty Float32Array");
    }
    if (source.length + chunk.length > OFFLINE_WDRC_MAX_SAMPLES) {
      throw new RangeError("cumulative synthetic clip exceeds the offline 65536 sample bound");
    }
    for (const sample of chunk) {
      if (!Number.isFinite(sample) || Math.abs(sample) > 16) {
        throw new RangeError("chunk has invalid synthetic sample");
      }
    }

    const appended = new Float32Array(source.length + chunk.length);
    appended.set(source);
    appended.set(chunk, source.length);
    // Compute before committing state; failed DSP renders cannot modify the
    // accepted prefix or the cumulative source.
    const rendered = renderOfflineWDRC({ ...config, samples: appended });
    const stableLength = Math.max(0, appended.length - OFFLINE_CHUNK_HOLDBACK);
    if (stableLength < emitted) throw new Error("internal emitted cursor violation");
    const result = rendered.samples.slice(emitted, stableLength);
    source = appended;
    emitted = stableLength;
    latestDiagnostics = rendered.diagnostics;
    return result;
  }

  function finish() {
    if (closed) throw new Error("chunk renderer already finalized");
    if (source.length === 0) throw new Error("cannot finalize without a clip");
    const rendered = renderOfflineWDRC({ ...config, samples: source });
    const remainder = rendered.samples.slice(emitted);
    emitted = source.length;
    latestDiagnostics = rendered.diagnostics;
    closed = true;
    return remainder;
  }

  return Object.freeze({
    push,
    finish,
    get acceptedSamples() { return source.length; },
    get emittedSamples() { return emitted; },
    get finalized() { return closed; },
    get diagnostics() { return latestDiagnostics; },
    get holdbackSamples() { return OFFLINE_CHUNK_HOLDBACK; },
  });
}
