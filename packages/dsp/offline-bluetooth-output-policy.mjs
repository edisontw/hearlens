/**
 * HearLens SW3 — OFFLINE synthetic *metadata-only* phone-mic -> Bluetooth
 * output route policy. No PCM is accepted/returned, no device/audio/browser
 * APIs, no earbud controls, no physical mute, no clinical/calibration proof.
 *
 * This is a policy *fixture* to test modeled transitions; an actual Android
 * route callback may arrive AFTER a speaker fallback, so no hard-mute or
 * physical output safety can be inferred from any passing unit test.
 */
export const SW3_ROUTE_SCHEMA = "hearlens-sw3-route-policy-fixture-v1";

const BT_KINDS = new Set(["bluetooth-a2dp", "bluetooth-le"]);
const failText = reason => "SW3 synthetic policy fault: " + reason + "; explicit reset required";
const identifier = v => typeof v==="string" && v.length>=1 && v.length<=96 &&
  /^[a-zA-Z0-9_.:-]+$/.test(v);
const integer = (v,lo,hi) => Number.isSafeInteger(v) && v>=lo && v<=hi;

/**
 * Designed to pin exactly one mock input and mock Bluetooth output route.
 * Only an explicit new session after reset can authorize any new route.
 * A communication/HFP profile is NOT an interchangeable A2DP audio sink.
 */
export function createOfflineBluetoothOutputPolicy({
  rampSamples=1024,expectedInputId="built-in-1",expectedOutputId="a2dp-1",
  mockCalibrationId="synthetic-cal-1",mockProfileId="synthetic-profile-1",
}={}) {
  if(!integer(rampSamples,256,48000)) throw new RangeError("rampSamples must be 256..48000");
  for(const [name,value] of Object.entries({
    expectedInputId,expectedOutputId,mockCalibrationId,mockProfileId
  })) if(!identifier(value))throw new RangeError(name+" must be nonempty mock identifier");

  let state="muted",faultReason=null,faultCount=0,resetCount=0;
  let observationSeq=0,observed=null,routeGeneration=null,outputKind=null;
  let rampPosition=0,clockSamples=0,completedCallbacks=0,completedSamples=0;
  let staleChecks=0;
  const mockAuthorized=()=>state==="ramping"||state==="active";

  function diagnostics() {
    return Object.freeze({
      schema:SW3_ROUTE_SCHEMA,state,
      kind:"synthetic-metadata-only-no-pcm",
      expectedInputId,expectedOutputId,
      outputKind,routeGeneration,observationSeq,
      faultReason,faultCount,resetCount,
      mockCandidateAuthorized:mockAuthorized(),
      mockRampFactor:state==="active"?1:state==="ramping"?rampPosition/rampSamples:0,
      clockSamples,completedCallbacks,completedSamples,staleChecks,
      acceptsPCM:false,exposesPCM:false,externalAudioSink:false,
      physicalInputObserved:false,physicalOutputObserved:false,
      hardwareMuteEnforced:false,calibratedEarMPO:false,
    });
  }
  function latch(reason) {
    state="faulted";
    faultReason=reason;faultCount++;
    rampPosition=0;observed=null;routeGeneration=null;outputKind=null;
    throw new Error(failText(reason));
  }
  function clean() {
    if(state==="faulted") throw new Error("SW3 policy faulted; explicit reset required");
  }

  function normalizeSnapshot(snapshot) {
    if(!snapshot || typeof snapshot!=="object" || Array.isArray(snapshot))
      return latch("missing-or-malformed-route-observation");
    const {
      seq,input,output,routeGeneration:gen,
      bluetoothConnected,audioFocus,telephony,lifecycle,
      earCount,mockCalibration,profile,health
    } = snapshot;
    if(!integer(seq,1,Number.MAX_SAFE_INTEGER) || seq<=observationSeq)
      return latch("stale-or-nonmonotonic-observation");
    if(!input || input.kind!=="phone-built-in-mic" || input.id!==expectedInputId ||
        input.sampleRate!==48000 || input.channels!==1)
      return latch("wrong-or-missing-phone-microphone");
    if(!output || !BT_KINDS.has(output.kind) ||
        output.id!==expectedOutputId || output.channels!==2 ||
        output.sampleRate!==48000)
      return latch("speaker-fallback-bluetooth-route-or-format-change");
    if(!identifier(gen))return latch("missing-route-generation");
    if(bluetoothConnected!==true || audioFocus!=="granted" ||
       telephony!=="idle" || lifecycle!=="foreground" || health!=="healthy")
      return latch("wireless-focus-call-background-or-dsp-interruption");
    // Mock ear count is externally supplied; Android may not observe one-ear
    // removal. A missing/different field must fail the mock, not be inferred.
    if(earCount!==2)return latch("missing-or-changed-mock-ear-count");
    if(mockCalibration!==mockCalibrationId || profile!==mockProfileId)
      return latch("missing-or-changed-mock-per-ear-profile");
    if(routeGeneration!==null && (gen!==routeGeneration ||
        output.kind!==outputKind))
      return latch("output-route-identity-or-generation-changed");
    return {seq,outputKind:output.kind,routeGeneration:gen};
  }

  /** Accepts CALLER-SUPPLIED mock route observation. Not OS verification. */
  function observe(snapshot) {
    clean();
    const accepted=normalizeSnapshot(snapshot);
    if(state==="muted") {
      observed=accepted;
      observationSeq=accepted.seq;
      return diagnostics();
    }
    if(!mockAuthorized())return latch("observation-in-illegal-state");
    observationSeq=accepted.seq;
    observed=accepted;
    return diagnostics();
  }

  function arm({explicitUserStart=false,syntheticOnly=false}={}) {
    clean();
    if(state!=="muted" || !observed || explicitUserStart!==true ||
       syntheticOnly!==true)
      return latch("no-fresh-mock-observation-or-explicit-start");
    routeGeneration=observed.routeGeneration;
    outputKind=observed.outputKind;
    state="ramping";rampPosition=0;
    return diagnostics();
  }

  /** Process *only clock/count metadata*, and require a new mock route
   * observation for every chunk. Returns no PCM and cannot drive playback.
   */
  function process({samples,startSample,snapshot}={}) {
    clean();
    if(!mockAuthorized())return latch("mock-start-required");
    if(!integer(samples,1,4096) || !integer(startSample,0,Number.MAX_SAFE_INTEGER) ||
       startSample!==clockSamples)
      return latch("invalid-chunk-or-sample-clock");
    if(!snapshot) {
      staleChecks++;
      return latch("missing-fresh-per-chunk-route-observation");
    }
    observe(snapshot); // a stale/invalid sample latches before any counters
    const before=state==="active"?1:rampPosition/rampSamples;
    rampPosition=Math.min(rampSamples,rampPosition+samples);
    if(rampPosition===rampSamples)state="active";
    clockSamples+=samples;
    completedCallbacks++;completedSamples+=samples;
    return Object.freeze({
      kind:"synthetic-policy-counters-only",
      acceptedSamples:samples,mockRampStart:before,
      mockRampEnd:rampPosition/rampSamples,stage:state,
      pcmOutput:false
    });
  }

  /** Fail-stop modeled loss of focus, route, phone call, OS pause,
   * Bluetooth connection, sample format or DSP clock.
   */
  function interrupt(event) {
    clean();
    const reasons=new Set([
      "bluetooth-disabled","bluetooth-disconnected","route-removed",
      "phone-speaker-fallback","output-profile-switched","output-device-switched",
      "phone-call","focus-lost","background","app-paused","screen-off",
      "one-ear-removed","sample-rate-changed","channel-count-changed",
      "input-mic-switched","dsp-underrun","capture-clock-fault",
      "bluetooth-reconnected"
    ]);
    if(!reasons.has(event))return latch("unknown-or-untrusted-interruption");
    return latch("simulated-"+event);
  }
  function reset() {
    state="muted";faultReason=null;resetCount++;
    observationSeq=0;observed=null;routeGeneration=null;outputKind=null;
    rampPosition=0;clockSamples=0;completedCallbacks=0;completedSamples=0;
    staleChecks=0;
    return diagnostics();
  }
  return Object.freeze({
    observe,arm,process,interrupt,reset,
    get diagnostics(){return diagnostics();}
  });
}
