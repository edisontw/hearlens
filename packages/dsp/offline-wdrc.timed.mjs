/**
 * M03I: sample-clock integrity guard for the synthetic-only offline stateful
 * WDRC processor. No device, speaker, audio output or wall-clock scheduler.
 *
 * This is an explicit fail-stop policy, NOT gap concealment. On any gap,
 * overlap, nonmonotonic simulated clock, underrun or bad PCM the in-memory
 * DSP is reset to discard its queued audio and gain state. The wrapper then
 * refuses output until explicit reset() starts a NEW sample-time epoch.
 *
 * Previously returned PCM cannot be revoked; a future hardware route MUST
 * separately mute or disconnect when the guard faults. M03L adds an isolated
 * preallocated-buffer entrypoint, not any real callback or hardware guard.
 */
import { createOfflineStatefulWDRC, STREAM_MAX_CHUNK_SAMPLES } from "./offline-wdrc.stateful.mjs";

export const OFFLINE_TIMED_GUARD_SCHEMA = "hearlens-m03i-sample-clock-guard-v1";
export const DEFAULT_DEADLINE_SLACK_SAMPLES = 256;

function safeSampleInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function createOfflineTimedWDRC(config, { deadlineSlackSamples = DEFAULT_DEADLINE_SLACK_SAMPLES } = {}) {
  if (!safeSampleInteger(deadlineSlackSamples) || deadlineSlackSamples > 4096) {
    throw new RangeError("deadlineSlackSamples must be integer 0–4096");
  }
  const processor = createOfflineStatefulWDRC(config);
  let expectedSample = 0;
  let lastClockSample = 0;
  let packets = 0;
  let faults = 0;
  let resets = 0;
  let faultReason = null;
  let finalized = false;

  function fail(reason) {
    // Reset BEFORE marking fault. This discards pending WOLA and gain state.
    // No new PCM is emitted from the failing operation.
    processor.reset();
    faultReason = reason;
    faults++;
    return new Error("offline timed guard fault: " + reason + "; explicit reset required");
  }
  function requireActive() {
    if (faultReason !== null || finalized) {
      throw new Error("offline timed guard faulted/finalized; explicit reset required");
    }
  }
  function push(packet) {
    requireActive();
    if (!packet || typeof packet !== "object" || Array.isArray(packet) ||
      Object.keys(packet).length !== 2 ||
      !Object.hasOwn(packet,"startSample") || !Object.hasOwn(packet,"samples")) {
      throw fail("malformed-packet");
    }
    const { startSample, samples } = packet;
    if (!safeSampleInteger(startSample)) throw fail("invalid-timestamp");
    if (!(samples instanceof Float32Array) || samples.length < 1 ||
        samples.length > STREAM_MAX_CHUNK_SAMPLES) throw fail("invalid-chunk");
    if (startSample !== expectedSample) {
      throw fail(startSample > expectedSample ? "missing-samples" : "overlap-or-reorder");
    }
    if (!Number.isSafeInteger(startSample + samples.length)) throw fail("timestamp-overflow");

    // The underlying DSP validates values and emits only after WOLA + final
    // limiter. Any bad PCM requires a new epoch, not a partial retry.
    try {
      const output = processor.push(samples);
      expectedSample += samples.length;
      packets++;
      return output;
    } catch {
      throw fail("underlying-dsp-rejected");
    }
  }

  /**
   * M03L isolated callback variant: no packet-object requirement, no returned
   * PCM buffer. Caller must own independent preallocated destination.
   * No device output. Destination is scrubbed if any failure occurs.
   */
  function requiredOutputSamples(chunkLength) {
    requireActive();
    return processor.requiredOutputSamples(chunkLength);
  }
  function processInto(startSample,samples,destination) {
    requireActive();
    // Never expose a partially written output prefix when the guard faults.
    const scrub=()=>{if(destination instanceof Float32Array)destination.fill(0);};
    if(!safeSampleInteger(startSample)) {scrub();throw fail("invalid-timestamp");}
    if(!(samples instanceof Float32Array)||samples.length<1||
        samples.length>STREAM_MAX_CHUNK_SAMPLES) {scrub();throw fail("invalid-chunk");}
    if(startSample!==expectedSample) {
      scrub();throw fail(startSample>expectedSample?"missing-samples":"overlap-or-reorder");
    }
    if(!Number.isSafeInteger(startSample+samples.length)){
      scrub();throw fail("timestamp-overflow");
    }
    try{
      const written=processor.processInto(samples,destination);
      expectedSample+=samples.length;
      packets++;
      return written;
    }catch{
      scrub();
      throw fail("underlying-dsp-rejected");
    }
  }
  function observeCaptureClock(sampleClock) {
    requireActive();
    if (!safeSampleInteger(sampleClock)) throw fail("invalid-clock");
    if (sampleClock < lastClockSample) throw fail("clock-regression");
    if (sampleClock > expectedSample + deadlineSlackSamples) {
      throw fail("simulated-underrun");
    }
    lastClockSample = sampleClock;
    return Object.freeze({
      expectedSample, clockSample: sampleClock,
      leadSamples: sampleClock - expectedSample,
      underrun: false,
    });
  }
  function signalUnderrun() {
    requireActive();
    throw fail("explicit-underrun");
  }
  function finish() {
    requireActive();
    try {
      const output = processor.finish();
      finalized = true;
      return output;
    } catch {
      throw fail("invalid-finalization");
    }
  }
  function reset() {
    processor.reset();
    expectedSample = 0;
    lastClockSample = 0;
    packets = 0;
    faultReason = null;
    finalized = false;
    resets++;
  }
  return Object.freeze({
    push, processInto, requiredOutputSamples, observeCaptureClock, signalUnderrun, finish, reset,
    get diagnostics() {
      const inner = processor.diagnostics;
      return Object.freeze({
        schema: OFFLINE_TIMED_GUARD_SCHEMA,
        kind: "offline-synthetic-timestamp-guard",
        expectedSample, lastClockSample,
        packets, faultCount: faults, resetCount: resets,
        faultReason, faulted: faultReason !== null, finalized,
        deadlineSlackSamples,
        inputCapacitySamples: inner.inputCapacitySamples,
        wolaCapacitySamples: inner.wolaCapacitySamples,
        maxPendingSamplesObserved: inner.maxPendingSamplesObserved,
        maxChunkSamples: inner.maxChunkSamples,
        frames: inner.frames,
        limitedSamples: inner.limitedSamples,
      });
    },
  });
}
