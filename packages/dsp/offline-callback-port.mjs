/**
 * M03L synthetic-only policy seam. NO AUDIO OUTPUT API, no hardware adapter.
 *
 * The sole public "callback" consumes synthetic PCM and emits counters ONLY.
 * It does not return PCM, register a sink, request a mic or emit to headphones.
 * Mock route attestation is deliberately NOT a device security credential.
 */
import {createOfflineTimedWDRC} from "./offline-wdrc.timed.mjs";
import {createOfflineRouteSafetyModel} from "./offline-route-safety.mjs";

export const OFFLINE_CALLBACK_PORT_SCHEMA = "hearlens-m03l-callback-route-fixture-v1";
const OUTPUT_CAPACITY = 4352;

export function createOfflineMockHearingPort(dspConfig, {
  deadlineSlackSamples = 256, rampSamples = 1024,
} = {}) {
  const dsp = createOfflineTimedWDRC(dspConfig,{deadlineSlackSamples});
  const route = createOfflineRouteSafetyModel({rampSamples});
  // Not exposed in the returned API, and never handed to an injected sink.
  const scratch = new Float32Array(OUTPUT_CAPACITY);
  let faultReason = null, faultCount = 0, resetCount = 0;
  let candidateSamples = 0, callbacks = 0, peakObserved = 0;

  function status() {
    const gate = route.diagnostics;
    return Object.freeze({
      schema: OFFLINE_CALLBACK_PORT_SCHEMA,
      kind:"synthetic-metrics-only-no-pcm-output",
      stage:gate.stage, mockRouteId:gate.routeId,
      mockCalibrationId:gate.calibrationId, mockProfileId:gate.profileId,
      syntheticCandidateAuthorized:gate.syntheticOutputAuthorized && faultReason===null,
      mockRampFactor:gate.mockRampFactor,
      candidateSamples,callbacks,peakObserved,
      faulted:faultReason!==null, faultReason,faultCount,resetCount,
      realHardwareMuteImplemented:false,
      physicalRouteVerified:false,acousticMpoVerified:false,
      pcmOutputExposed:false,externalSinkSupported:false,
    });
  }
  function requireClean() {
    if(faultReason!==null)throw new Error("offline callback port faulted; explicit reset required");
  }
  function latch(reason) {
    scratch.fill(0);
    faultReason=reason;faultCount++;
    dsp.reset(); // discards all queued PCM/envelopes and the sample epoch
    if(route.diagnostics.stage!=="faulted"){
      try{route.signalDspFault();}catch{/* model deliberately throws on fault */}
    }
    throw new Error("offline callback port fault: "+reason+"; explicit reset required");
  }
  function attempt(action,label){
    requireClean();
    try{return action();}catch{ return latch(label); }
  }
  function connect(info) {
    return attempt(()=>{route.connect(info);return status();},"invalid-mock-route");
  }
  function attestMockCalibration(info) {
    return attempt(()=>{route.attestMockCalibration(info);return status();},"invalid-mock-attestation");
  }
  function arm(info) {
    return attempt(()=>{route.arm(info);return status();},"invalid-mock-user-start");
  }
  function observeRoute(info) {
    return attempt(()=>{route.observeRoute(info);return status();},"mock-route-lost-or-switched");
  }
  function disconnect() {requireClean();return latch("simulated-disconnect");}
  function signalInterruption() {requireClean();return latch("simulated-audio-interruption");}
  function signalUnderrun() {requireClean();return latch("simulated-underrun");}
  function process(packet = {}) {
    requireClean();
    if(!packet || typeof packet!=="object" || Array.isArray(packet))
      return latch("malformed-mock-callback");
    const {startSample,samples,clockSample,observedRoute}=packet;
    // "syntheticCandidateAuthorized" is ONLY an offline policy flag.
    if(!route.diagnostics.syntheticOutputAuthorized)return latch("no-mock-authorization");
    try {
      // REQUIRE fresh mock observation on *each* input chunk. This is not
      // evidence that an OS event arrives before a physical speaker fallback.
      route.observeRoute(observedRoute);
    } catch {return latch("mock-route-lost-or-switched");}
    let count=0;
    try{
      count=dsp.processInto(startSample,samples,scratch);
      // Validate the supplied simulated clock BEFORE recording candidates.
      dsp.observeCaptureClock(clockSample);
      // Model start ramp progress, but do NOT send PCM anywhere.
      for(let remaining=count;remaining>0;remaining-=4096)
        route.advanceSamples(Math.min(remaining,4096));
    }catch{ return latch("clock-or-dsp-fault"); }
    for(let i=0;i<count;i++)peakObserved=Math.max(peakObserved,Math.abs(scratch[i]));
    candidateSamples+=count;
    callbacks++;
    // Erase even the model's temporary processed PCM after inspection.
    scratch.fill(0);
    return Object.freeze({
      kind:"synthetic-metadata-no-pcm",
      candidateSamples:count,mockRampFactor:route.diagnostics.mockRampFactor,
    });
  }
  function reset(){
    route.reset();
    dsp.reset();
    scratch.fill(0);
    faultReason=null;candidateSamples=0;callbacks=0;peakObserved=0;resetCount++;
    return status();
  }
  // There is deliberately no finish(), PCM accessor, user-provided sink
  // callback, event subscription, or output-device API.
  return Object.freeze({
    connect,attestMockCalibration,arm,observeRoute,
    disconnect,signalInterruption,signalUnderrun,process,reset,
    get diagnostics(){return status();},
  });
}
