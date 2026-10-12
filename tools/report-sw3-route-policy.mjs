#!/usr/bin/env node
/** SW3 deterministic route policy scenario manifest. NO output PCM, hardware or network. */
import {createOfflineBluetoothOutputPolicy} from "../packages/dsp/offline-bluetooth-output-policy.mjs";

const safe=(seq=1,override={})=>({
  seq,
  input:{kind:"phone-built-in-mic",id:"built-in-1",sampleRate:48000,channels:1},
  output:{kind:"bluetooth-a2dp",id:"a2dp-1",sampleRate:48000,channels:2},
  routeGeneration:"bt-session-1",bluetoothConnected:true,
  audioFocus:"granted",telephony:"idle",lifecycle:"foreground",
  earCount:2,mockCalibration:"synthetic-cal-1",
  profile:"synthetic-profile-1",health:"healthy",...override
});
function active(){
  const p=createOfflineBluetoothOutputPolicy();
  p.observe(safe(1));
  p.arm({explicitUserStart:true,syntheticOnly:true});
  p.process({samples:1024,startSample:0,snapshot:safe(2)});
  return p;
}
function caseEvent(event){
  const p=active();let caught=null;
  try{p.interrupt(event)}catch(e){caught=e.message}
  if(!caught||p.diagnostics.mockCandidateAuthorized)throw Error("SW3 policy failed "+event);
  return {event,failStopObserved:true,postStage:p.diagnostics.state,
    modelAuthorizationRevoked:true,physicalSilenceVerified:false,
    reason:p.diagnostics.faultReason};
}
function caseObservation(event,change){
  const p=active();let caught=null;
  try{p.process({samples:256,startSample:1024,snapshot:safe(3,change)})}
  catch(e){caught=e.message}
  if(!caught||p.diagnostics.mockCandidateAuthorized)throw Error("SW3 mismatch not caught "+event);
  return {event,failStopObserved:true,postStage:p.diagnostics.state,
    modelAuthorizationRevoked:true,physicalSilenceVerified:false,
    reason:p.diagnostics.faultReason};
}
const cases=[
  ...["bluetooth-disabled","bluetooth-disconnected","phone-speaker-fallback",
      "output-profile-switched","phone-call","focus-lost","background",
      "app-paused","screen-off","one-ear-removed","sample-rate-changed",
      "channel-count-changed","dsp-underrun","capture-clock-fault",
      "bluetooth-reconnected"].map(caseEvent),
  caseObservation("speaker-observed",{output:{kind:"phone-speaker",id:"speaker",sampleRate:48000,channels:2}}),
  caseObservation("hfp-observed",{output:{kind:"bluetooth-sco",id:"a2dp-1",sampleRate:16000,channels:1}}),
  caseObservation("mic-switched",{input:{kind:"bluetooth-sco",id:"built-in-1",sampleRate:48000,channels:1}}),
  caseObservation("missing-device-observation",{output:null}),
  caseObservation("route-id-changed",{output:{kind:"bluetooth-a2dp",id:"new-headset",sampleRate:48000,channels:2}}),
  caseObservation("bluetooth-le-switch",{output:{kind:"bluetooth-le",id:"a2dp-1",sampleRate:48000,channels:2}}),
  caseObservation("route-generation-recreated",{routeGeneration:"bt-session-2"}),
  caseObservation("missing-ear-state",{earCount:undefined}),
  caseObservation("focus-not-granted",{audioFocus:"lost"}),
  caseObservation("call-active",{telephony:"in-call"}),
  caseObservation("app-background",{lifecycle:"background"}),
];
const output={
  schema:"hearlens-sw3-bluetooth-output-route-policy-v1",
  noPcmPath:true,noPhysicalAudioPlayed:true,
  platform:"offline Node synthetic metadata",
  sourceChoice:"phone-built-in-mic",
  allowedMockOutputKinds:["bluetooth-a2dp","bluetooth-le"],
  explicitlyDisallowed:["phone-speaker","bluetooth-sco-HFP","unobserved-or-changed-route"],
  casesPassed:cases.length,cases,
  measuredRouteEventToPhysicalMuteMs:null,
  measuredPhysicalSpeakerFallbackSuppression:false,
  calibratedPerEarMaxSPL:false,
  limitations:"Mock device observations are externally supplied and can arrive late or be spoofed. This fixture cannot physically prevent Android audio fallback or prove Bluetooth acoustic safety.",
  decision:"Passes synthetic fail-stop scenarios only. STOP before real speech amplification until physical no-speaker-fallback, independent per-ear MPO and hard mute are proven."
};
console.log(JSON.stringify(output,null,2));
