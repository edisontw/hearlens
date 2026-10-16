import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {assessM04Evidence,formatSummary,REQUIREMENTS,SCHEMA} from "./m04-output-safety-gate.mjs";

const path="testdata/results/2026-10-16-m04-output-safety-state.json";
const source=()=>JSON.parse(readFileSync(path,"utf8"));
const hash="a".repeat(64);
const valid=(r)=>({
  id:r.id,
  basis:r.needed==="observed"?"observed":
    r.needed==="test"?"unit":
    r.needed==="calibration"?"calibrated":"physical",
  result:"PASS",
  source:"bench/verified-independent-measurement.wav",
  ...(r.needed==="recording"?{artifact_sha256:hash,fixture_id:"nonhuman-20261016"}:{}),
  ...(r.needed==="calibration"?{artifact_sha256:hash,calibration_id:"left-right-coupler-v1"}:{})
});

test("project's actual AIR31 evidence remains BLOCKED; SW3 predicted route is not physical",()=>{
  const report=assessM04Evidence(source());
  assert.equal(report.schema,"hearlens-m04-output-gate-report-v1");
  assert.equal(report.status,"BLOCKED_NEEDS_INDEPENDENT_PHYSICAL_SAFETY_EVIDENCE");
  assert.equal(report.nonhuman_playback_authorized,false);
  assert.equal(report.human_hearing_playback_authorized,false);
  assert.equal(report.automatic_unblock_supported,false);
  assert.equal(report.bluetooth_acoustic_latency_measured,false);
  assert.equal(report.checks.find(x=>x.id==="built_in_microphone").state,"EVIDENCE_SUPPLIED_UNREVIEWED");
  assert.equal(report.checks.find(x=>x.id==="post_dsp_digital_limiter").state,"EVIDENCE_SUPPLIED_UNREVIEWED");
  assert.equal(report.checks.find(x=>x.id==="actual_a2dp_output_not_prediction").state,"MISSING_OR_INSUFFICIENT");
  assert.ok(report.physical_unresolved.includes("phone_speaker_silent_on_disconnect"));
  assert.ok(report.physical_unresolved.includes("previously_queued_audio_cannot_escape"));
  assert.match(formatSummary(report),/Nonhuman playback authorized: false/);
});

test("forged simulation/prediction cannot satisfy any physical or calibration gate",()=>{
  const x=source();
  for(const req of REQUIREMENTS.filter(r=>["physical","calibration"].includes(r.kind))){
    x.items=x.items.filter(y=>y.id!==req.id);
    x.items.push({id:req.id,result:"PASS",basis:"simulated",source:"CI synthetic trace",
      artifact_sha256:hash,fixture_id:"fake-fixture",calibration_id:"mock-cal"});
  }
  const report=assessM04Evidence(x);
  assert.equal(report.physical_unresolved.length,
    REQUIREMENTS.filter(r=>["physical","calibration"].includes(r.kind)).length);
  assert.equal(report.nonhuman_playback_authorized,false);
});

test("unknown, duplicate, invalid and contradictory evidence never grant authorization",()=>{
  const x=source();
  assert.throws(()=>assessM04Evidence(null),/schema/);
  assert.throws(()=>assessM04Evidence({...x,schema:"other"}),/schema/);
  assert.throws(()=>assessM04Evidence({...x,target:{...x.target,phone:"other"}}),/Target/);
  assert.throws(()=>assessM04Evidence({...x,items:[...x.items,x.items[0]]}),/Duplicate/);
  assert.throws(()=>assessM04Evidence({...x,items:[{id:"bad",basis:"physical",result:"PASS",source:"x"}]}),/Malformed/);
  const failing=source();
  failing.items.push({id:"phone_speaker_silent_on_disconnect",result:"FAIL",basis:"physical",
    source:"field evidence shows phone-speaker leakage",artifact_sha256:hash,
    fixture_id:"nonhuman-test-1"});
  const result=assessM04Evidence(failing);
  assert.equal(result.checks.find(y=>y.id==="phone_speaker_silent_on_disconnect").state,"FAILED");
  assert.equal(result.nonhuman_playback_authorized,false);
});

test("even plausible complete physical metadata is only REVIEW_REQUIRED; never unblocks audio",()=>{
  const x=source();
  x.items=REQUIREMENTS.map(valid);
  const result=assessM04Evidence(x);
  assert.equal(result.unresolved.length,0);
  assert.equal(result.status,"EVIDENCE_COMPLETE_REQUIRES_INDEPENDENT_PHYSICAL_REVIEW");
  assert.equal(result.nonhuman_playback_authorized,false);
  assert.equal(result.human_hearing_playback_authorized,false);
  assert.equal(result.bluetooth_acoustic_latency_measured,false);
  assert.match(result.next_action,/independent safety review/);
});

test("missing raw fixture fingerprint does not count as recorded evidence",()=>{
  const x=source();
  x.items.push({id:"phone_speaker_silent_on_disconnect",basis:"physical",
    result:"PASS",source:"no original WAV stored",fixture_id:"bench-1"});
  const result=assessM04Evidence(x);
  assert.ok(result.unresolved.includes("phone_speaker_silent_on_disconnect"));
});

test("CLI prints machine-readable BLOCKED status and has no audio sink APIs",()=>{
  const child=spawnSync(process.execPath,
    ["tools/m04-output-safety-gate.mjs","--evidence",path],
    {encoding:"utf8",timeout:15_000});
  assert.equal(child.status,0,child.stderr);
  assert.equal(JSON.parse(child.stdout).nonhuman_playback_authorized,false);
  const implementation=readFileSync("tools/m04-output-safety-gate.mjs","utf8");
  const banned=/\b(?:AudioTrack|AudioContext|AudioWorklet|MediaPlayer|SoundPool|getUserMedia|navigator\.mediaDevices|BluetoothSocket)\b/;
  assert.doesNotMatch(implementation,banned);
  assert.equal(readFileSync("apps/android-mic-probe/app/src/main/AndroidManifest.xml","utf8").includes("android.permission.INTERNET"),false);
});
