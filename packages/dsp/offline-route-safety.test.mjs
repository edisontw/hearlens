import assert from "node:assert/strict";
import test from "node:test";
import { createOfflineRouteSafetyModel, OFFLINE_ROUTE_SCHEMA } from "./offline-route-safety.mjs";

const setup = (r = createOfflineRouteSafetyModel({rampSamples:1024})) => {
  r.connect({kind:"wired-headphones",id:"wired-1"});
  r.attestMockCalibration({routeId:"wired-1",calibrationId:"synthetic-cal-1",
    profileId:"synthetic-profile-1",syntheticOnly:true});
  return r;
};
const arm = r => r.arm({routeId:"wired-1",calibrationId:"synthetic-cal-1",
  profileId:"synthetic-profile-1",explicitUserStart:true});

test("default state is muted and mock attestation does not allow automatic output",()=>{
 const r=setup();
 assert.equal(r.diagnostics.schema,OFFLINE_ROUTE_SCHEMA);
 assert.equal(r.diagnostics.stage,"muted");
 assert.equal(r.diagnostics.syntheticOutputAuthorized,false);
 assert.equal(r.diagnostics.mockRampFactor,0);
 assert.equal(r.diagnostics.realHardwareMuteImplemented,false);
});
test("explicit simulated authorization starts ramp at zero, never jumps immediately to 1",()=>{
 const r=setup();arm(r);
 assert.equal(r.diagnostics.stage,"ramping");
 assert.equal(r.diagnostics.mockRampFactor,0);
 assert.deepEqual(r.advanceSamples(256),{startFactor:0,endFactor:.25,stage:"ramping"});
 assert.equal(r.diagnostics.mockRampFactor,.25);
 assert.deepEqual(r.advanceSamples(768),{startFactor:.25,endFactor:1,stage:"active"});
 assert.equal(r.diagnostics.syntheticOutputAuthorized,true);
 assert.deepEqual(r.advanceSamples(256),{startFactor:1,endFactor:1,stage:"active"});
});
test("speaker fallback or unknown route is rejected even during initial setup",()=>{
 for(const kind of ["speaker","bluetooth","built-in","unknown",null]){
   const r=createOfflineRouteSafetyModel();
   assert.throws(()=>r.connect({kind,id:"phone"}),/unsupported-route-or-speaker/);
   assert.equal(r.diagnostics.stage,"faulted");
   assert.equal(r.diagnostics.syntheticOutputAuthorized,false);
 }
});
test("route disconnect or route ID change drops synthetic permission synchronously",()=>{
 for(const method of ["disconnect","switch","speaker"]){
  const r=setup();arm(r);r.advanceSamples(1024);
  if(method==="disconnect")assert.throws(()=>r.disconnect(),/route-disconnected/);
  if(method==="switch")assert.throws(()=>r.observeRoute({kind:"wired-headphones",id:"new-id"}),/route-disconnected/);
  if(method==="speaker")assert.throws(()=>r.observeRoute({kind:"speaker",id:"wired-1"}),/route-disconnected/);
  assert.equal(r.diagnostics.stage,"faulted");
  assert.equal(r.diagnostics.mockRampFactor,0);
  assert.equal(r.diagnostics.syntheticOutputAuthorized,false);
  assert.throws(()=>arm(r),/reset required/);
 }
});
test("reconnect requires reset, fresh route/calibration attestation and user start",()=>{
 const r=setup();arm(r);r.advanceSamples(1024);
 assert.throws(()=>r.disconnect());
 assert.throws(()=>r.connect({kind:"wired-headphones",id:"wired-1"}),/reset required/);
 r.reset();
 assert.equal(r.diagnostics.stage,"muted");
 assert.equal(r.diagnostics.syntheticOutputAuthorized,false);
 assert.throws(()=>arm(r),/missing-explicit-start/);
 r.reset();setup(r);
 assert.equal(r.diagnostics.syntheticOutputAuthorized,false);
 arm(r);
 assert.equal(r.diagnostics.stage,"ramping");
 assert.equal(r.diagnostics.mockRampFactor,0);
});
test("profile mismatch or false calibration attestation fails closed",()=>{
 const r=createOfflineRouteSafetyModel();
 r.connect({kind:"wired-headphones",id:"wired-1"});
 assert.throws(()=>r.attestMockCalibration({routeId:"wired-1",calibrationId:"cal",profileId:"profile",syntheticOnly:false}),/unverified-mock-calibration/);
 assert.equal(r.diagnostics.syntheticOutputAuthorized,false);
 r.reset();setup(r);
 assert.throws(()=>r.arm({routeId:"wired-1",calibrationId:"other",profileId:"synthetic-profile-1",explicitUserStart:true}),/missing-explicit-start/);
 assert.equal(r.diagnostics.syntheticOutputAuthorized,false);
});
test("no output without user start, with invalid ramp or without supplied mock route",()=>{
 const r=createOfflineRouteSafetyModel();
 assert.throws(()=>r.advanceSamples(256),/advance-without-authorization/);
 assert.equal(r.diagnostics.syntheticOutputAuthorized,false);
 assert.throws(()=>createOfflineRouteSafetyModel({rampSamples:0}),/rampSamples/);
 assert.throws(()=>createOfflineRouteSafetyModel({rampSamples:1.5}),/rampSamples/);
 assert.throws(()=>createOfflineRouteSafetyModel({rampSamples:48001}),/rampSamples/);
});
test("DSP fault immediately revokes mock authorization; reset erases the ramp",()=>{
 const r=setup();arm(r);r.advanceSamples(600);
 assert.equal(r.diagnostics.stage,"ramping");
 assert.throws(()=>r.signalDspFault(),/underlying-dsp-fault/);
 assert.equal(r.diagnostics.syntheticOutputAuthorized,false);
 assert.equal(r.diagnostics.mockRampFactor,0);
 assert.equal(r.diagnostics.faultCount,1);
 r.reset();
 assert.equal(r.diagnostics.rampPositionSamples,0);
});
