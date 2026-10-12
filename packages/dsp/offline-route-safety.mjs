/**
 * HearLens M03J: PURE SYNTHETIC route authorization / ramp state-machine.
 * NO device observation, Web Audio, headphone switching, real mute, SPL or MPO.
 * A future route adapter MUST independently enforce actual physical mute.
 */
export const OFFLINE_ROUTE_SCHEMA = "hearlens-m03j-route-model-v1";
const ALLOWED = "wired-headphones";

function identifier(x) {
  return typeof x === "string" && x.length > 0 && x.length <= 128 &&
    /^[a-zA-Z0-9_.:-]+$/.test(x);
}
export function createOfflineRouteSafetyModel({rampSamples = 1024} = {}) {
  if (!Number.isInteger(rampSamples) || rampSamples < 256 || rampSamples > 48000) {
    throw new RangeError("rampSamples must be integer 256–48000");
  }
  let stage = "muted",routeId = null,calibrationId = null,profileId = null;
  let rampPosition = 0, faultReason = null, faultCount = 0, resets = 0;
  const permission = () => stage === "ramping" || stage === "active";
  const diagnostics = () => Object.freeze({
    schema: OFFLINE_ROUTE_SCHEMA,
    kind: "offline-route-safety-model-only",
    stage, routeId, calibrationId, profileId,
    faultReason, faultCount,resetCount:resets,
    rampPositionSamples:rampPosition,rampSamples,
    // This is a model flag, not an assertion that actual hardware was muted.
    syntheticOutputAuthorized:permission(),
    mockRampFactor:stage==="active"?1:stage==="ramping"?rampPosition/rampSamples:0,
    realHardwareMuteImplemented:false,
  });
  function fail(reason) {
    stage="faulted";routeId=null;calibrationId=null;profileId=null;
    rampPosition=0;faultReason=reason;faultCount++;
    throw new Error("offline route model fault: "+reason+"; explicit reset required");
  }
  function ready() {
    if (stage==="faulted") throw new Error("route model faulted; explicit reset required");
  }
  function connect({kind,id} = {}) {
    ready();
    if(stage!=="muted" || routeId!==null) return fail("new-connection-requires-reset");
    if(kind!==ALLOWED) return fail("unsupported-route-or-speaker");
    if(!identifier(id)) return fail("invalid-route-id");
    routeId=id;
    return diagnostics();
  }
  function attestMockCalibration({routeId:id,calibrationId:cal,profileId:profile,syntheticOnly} = {}) {
    ready();
    if(stage!=="muted" || routeId===null || id!==routeId)
      return fail("route-attestation-mismatch");
    if(!identifier(cal) || !identifier(profile) || syntheticOnly!==true)
      return fail("unverified-mock-calibration");
    calibrationId=cal;profileId=profile;
    return diagnostics();
  }
  function arm({routeId:id,calibrationId:cal,profileId:profile,explicitUserStart} = {}) {
    ready();
    if(stage!=="muted" || routeId===null || !identifier(calibrationId) ||
      !identifier(profileId) || id!==routeId || cal!==calibrationId ||
      profile!==profileId || explicitUserStart!==true)
      return fail("missing-explicit-start-or-mock-attestation");
    stage="ramping";rampPosition=0;
    return diagnostics();
  }
  function advanceSamples(samples) {
    ready();
    if(!Number.isInteger(samples) || samples<1 || samples>4096)
      return fail("invalid-ramp-step");
    if(!permission()) return fail("advance-without-authorization");
    const before=rampPosition/rampSamples;
    rampPosition=Math.min(rampSamples,rampPosition+samples);
    if(rampPosition===rampSamples)stage="active";
    return Object.freeze({startFactor:before,endFactor:rampPosition/rampSamples,stage});
  }
  function observeRoute({kind,id} = {}) {
    ready();
    if(routeId===null || kind!==ALLOWED || id!==routeId)
      return fail("route-disconnected-or-switched");
    return diagnostics();
  }
  function disconnect() { return fail("route-disconnected-or-switched"); }
  function signalDspFault() { return fail("underlying-dsp-fault"); }
  function reset() {
    stage="muted";routeId=null;calibrationId=null;profileId=null;
    rampPosition=0;faultReason=null;resets++;
    return diagnostics();
  }
  return Object.freeze({
    connect,attestMockCalibration,arm,advanceSamples,observeRoute,
    disconnect,signalDspFault,reset,get diagnostics(){return diagnostics();},
  });
}
