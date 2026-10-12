import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {
  SW3_ROUTE_SCHEMA,createOfflineBluetoothOutputPolicy
} from "./offline-bluetooth-output-policy.mjs";

const snapshot=(seq=1,override={})=>({
  seq,
  input:{kind:"phone-built-in-mic",id:"built-in-1",sampleRate:48000,channels:1},
  output:{kind:"bluetooth-a2dp",id:"a2dp-1",sampleRate:48000,channels:2},
  routeGeneration:"pairing-generation-1",bluetoothConnected:true,
  audioFocus:"granted",telephony:"idle",lifecycle:"foreground",
  earCount:2,mockCalibration:"synthetic-cal-1",
  profile:"synthetic-profile-1",health:"healthy",...override
});
const start=(p,s=snapshot())=>{
  p.observe(s);p.arm({explicitUserStart:true,syntheticOnly:true});return p;
};
const chunk=(seq,startSample,samples=256,override={})=>({
  samples,startSample,snapshot:snapshot(seq,override)
});

test("SW3 begins muted, with no PCM, device/audio sink or hardware mute claim",()=>{
  const p=createOfflineBluetoothOutputPolicy(),d=p.diagnostics;
  assert.equal(d.schema,SW3_ROUTE_SCHEMA);
  assert.equal(d.state,"muted");
  assert.equal(d.mockCandidateAuthorized,false);
  assert.equal(d.mockRampFactor,0);
  assert.equal(d.acceptsPCM,false);
  assert.equal(d.exposesPCM,false);
  assert.equal(d.externalAudioSink,false);
  assert.equal(d.physicalOutputObserved,false);
  assert.equal(d.hardwareMuteEnforced,false);
  assert.equal(d.calibratedEarMPO,false);
  assert.equal(typeof p.onAudioDeviceChanged,"undefined");
  assert.equal(typeof p.setOutputSink,"undefined");
});

test("SW3 requires fresh mock observation, explicit start and synthetic-only marker",()=>{
  for(const mode of ["missing-observation","no-start","no-synthetic-flag"]){
    const p=createOfflineBluetoothOutputPolicy();
    if(mode!=="missing-observation")p.observe(snapshot());
    assert.throws(()=>p.arm({
      explicitUserStart:mode!=="no-start",
      syntheticOnly:mode!=="no-synthetic-flag"
    }),/explicit-start/);
    assert.equal(p.diagnostics.state,"faulted");
    assert.equal(p.diagnostics.mockCandidateAuthorized,false);
  }
});

test("SW3 normal A2DP mock path ramps to 1 with per-chunk observation and no audio",()=>{
  const p=start(createOfflineBluetoothOutputPolicy());
  let output=p.process(chunk(2,0,256));
  assert.deepEqual(output,{kind:"synthetic-policy-counters-only",
    acceptedSamples:256,mockRampStart:0,mockRampEnd:0.25,stage:"ramping",pcmOutput:false});
  output=p.process(chunk(3,256,256));
  assert.equal(output.mockRampEnd,0.5);
  p.process(chunk(4,512,256));
  p.process(chunk(5,768,256));
  assert.equal(p.diagnostics.state,"active");
  assert.equal(p.diagnostics.completedSamples,1024);
  assert.equal(p.diagnostics.completedCallbacks,4);
  assert.equal(p.diagnostics.mockCandidateAuthorized,true);
  assert.equal(p.diagnostics.hardwareMuteEnforced,false);
});

test("SW3 supports simulated Bluetooth LE sink under same input/format constraints",()=>{
  const p=createOfflineBluetoothOutputPolicy({expectedOutputId:"le-1"});
  const s=snapshot(1,{output:{kind:"bluetooth-le",id:"le-1",sampleRate:48000,channels:2}});
  start(p,s);
  const r=p.process({...chunk(2,0,1024),snapshot:snapshot(2,{
    output:{kind:"bluetooth-le",id:"le-1",sampleRate:48000,channels:2}
  })});
  assert.equal(r.stage,"active");
  assert.equal(p.diagnostics.outputKind,"bluetooth-le");
});

test("SW3 rejects speaker fallback, HFP profile, output identity/format and input change",()=>{
  const cases=[
    ["speaker-fallback",{output:{kind:"phone-speaker",id:"a2dp-1",sampleRate:48000,channels:2}}],
    ["HFP-reroute",{output:{kind:"bluetooth-sco",id:"a2dp-1",sampleRate:48000,channels:2}}],
    ["output-removed",{output:null}],
    ["headset-changed",{output:{kind:"bluetooth-a2dp",id:"other",sampleRate:48000,channels:2}}],
    ["wrong-output-channel",{output:{kind:"bluetooth-a2dp",id:"a2dp-1",sampleRate:48000,channels:1}}],
    ["changed-output-rate",{output:{kind:"bluetooth-a2dp",id:"a2dp-1",sampleRate:44100,channels:2}}],
    ["changed-input",{input:{kind:"bluetooth-sco",id:"built-in-1",sampleRate:48000,channels:1}}],
    ["changed-input-id",{input:{kind:"phone-built-in-mic",id:"other",sampleRate:48000,channels:1}}],
    ["changed-input-rate",{input:{kind:"phone-built-in-mic",id:"built-in-1",sampleRate:16000,channels:1}}],
    ["new-route-epoch",{routeGeneration:"pairing-generation-2"}],
    ["missing-route-epoch",{routeGeneration:null}],
    ["one-ear-removed",{earCount:1}],
    ["unknown-ear-state",{earCount:null}],
    ["profile-changed",{profile:"another-profile"}],
    ["calibration-changed",{mockCalibration:"another-cal"}],
  ];
  for(const [name,override] of cases) {
    const p=start(createOfflineBluetoothOutputPolicy());
    p.process(chunk(2,0));
    const before=p.diagnostics.completedSamples;
    assert.throws(()=>p.process(chunk(3,256,256,override)),/SW3 synthetic policy fault/,
      name);
    assert.equal(p.diagnostics.state,"faulted",name);
    assert.equal(p.diagnostics.mockCandidateAuthorized,false,name);
    assert.equal(p.diagnostics.mockRampFactor,0,name);
    assert.equal(p.diagnostics.completedSamples,before,name);
    assert.throws(()=>p.process(chunk(4,256)),/reset required/,name);
  }
});

test("SW3 drop focus, phone call, background, wireless and DSP health from fresh observation",()=>{
  const checks=[
    ["focus-lost",{audioFocus:"lost"}],
    ["phone-call",{telephony:"in-call"}],
    ["background",{lifecycle:"background"}],
    ["wireless-down",{bluetoothConnected:false}],
    ["dsp-down",{health:"fault"}],
  ];
  for(const [name,change] of checks){
    const p=start(createOfflineBluetoothOutputPolicy());
    p.process(chunk(2,0,256));
    assert.throws(()=>p.process(chunk(3,256,256,change)),/interruption/,name);
    assert.equal(p.diagnostics.mockCandidateAuthorized,false);
    assert.equal(p.diagnostics.completedSamples,256);
  }
});

test("SW3 missing, repeated, reordered or malformed observations and sample-clock faults",()=>{
  const cases=[
    ["missing",{samples:256,startSample:0}],
    ["reused-seq",{samples:256,startSample:0,snapshot:snapshot(1)}],
    ["wrong-clock",chunk(2,1)],
    ["negative-clock",chunk(2,-1)],
    ["zero-length",{samples:0,startSample:0,snapshot:snapshot(2)}],
    ["oversize",{samples:4097,startSample:0,snapshot:snapshot(2)}],
    ["missing-actual-output",chunk(2,0,256,{output:undefined})],
  ];
  for(const [name,payload] of cases){
    const p=start(createOfflineBluetoothOutputPolicy());
    assert.throws(()=>p.process(payload),/SW3 synthetic policy fault/,name);
    assert.equal(p.diagnostics.completedSamples,0,name);
    assert.equal(p.diagnostics.mockCandidateAuthorized,false,name);
  }
  const p=start(createOfflineBluetoothOutputPolicy());
  p.process(chunk(2,0));
  assert.throws(()=>p.observe(snapshot(2)),/stale/, "duplicate observations");
  assert.equal(p.diagnostics.state,"faulted");
});

test("SW3 immediate interruption event matrix revokes authorization, never returns PCM",()=>{
  const events=[
    "bluetooth-disabled","bluetooth-disconnected","route-removed",
    "phone-speaker-fallback","output-profile-switched","output-device-switched",
    "phone-call","focus-lost","background","app-paused","screen-off",
    "one-ear-removed","sample-rate-changed","channel-count-changed",
    "input-mic-switched","dsp-underrun","capture-clock-fault",
    "bluetooth-reconnected"
  ];
  for(const event of events){
    const p=start(createOfflineBluetoothOutputPolicy());
    p.process(chunk(2,0,1024));
    assert.equal(p.diagnostics.state,"active");
    assert.throws(()=>p.interrupt(event),new RegExp("simulated-"+event),event);
    assert.equal(p.diagnostics.state,"faulted");
    assert.equal(p.diagnostics.mockCandidateAuthorized,false);
    assert.equal(p.diagnostics.mockRampFactor,0);
    assert.throws(()=>p.arm({explicitUserStart:true,syntheticOnly:true}),/reset required/);
  }
});

test("SW3 reconnect cannot reauthorize automatically, reset needs new observation and user start",()=>{
  const p=start(createOfflineBluetoothOutputPolicy());
  p.process(chunk(2,0,1024));
  assert.throws(()=>p.interrupt("bluetooth-disconnected"),/reset required/);
  assert.throws(()=>p.observe(snapshot(3)),/reset required/);
  p.reset();
  assert.equal(p.diagnostics.mockCandidateAuthorized,false);
  assert.equal(p.diagnostics.clockSamples,0);
  assert.equal(p.diagnostics.completedSamples,0);
  assert.throws(()=>p.process(chunk(1,0)),/mock-start-required/);
  p.reset();
  assert.throws(()=>p.arm({explicitUserStart:true,syntheticOnly:true}),/explicit-start/);
  p.reset();
  start(p,snapshot(1,{routeGeneration:"pairing-generation-2"}));
  assert.equal(p.diagnostics.mockRampFactor,0);
  const resume=p.process(chunk(2,0,256,{routeGeneration:"pairing-generation-2"}));
  assert.equal(resume.mockRampStart,0);
  assert.equal(resume.mockRampEnd,0.25);
});

test("SW3 rejects invalid construction and unknown interrupt, cannot be used to produce audio",()=>{
  assert.throws(()=>createOfflineBluetoothOutputPolicy({rampSamples:0}),/rampSamples/);
  assert.throws(()=>createOfflineBluetoothOutputPolicy({expectedOutputId:""}),/expectedOutputId/);
  const p=start(createOfflineBluetoothOutputPolicy());
  assert.throws(()=>p.interrupt("not-a-real-event"),/untrusted/);
  assert.equal(p.diagnostics.mockCandidateAuthorized,false);
  const source=readFileSync(new URL("./offline-bluetooth-output-policy.mjs",import.meta.url),"utf8");
  for(const prohibited of [
    /\bAudioTrack\s*\(/,/\bAudioRecord\s*\(/,/\bAudioContext\s*\(/,
    /\bgetUserMedia\s*\(/,/\bWebSocket\s*\(/,/\bfetch\s*\(/,
    /\bnew\s+MediaRecorder\s*\(/,/\bprocessAudioSamples\s*\(/
  ])assert.doesNotMatch(source,prohibited);
});
