#!/usr/bin/env node
/**
 * M04-D2 evidence gate. Pure metadata; never interfaces with PCM, audio
 * routing, input devices or speakers. This gate NEVER authorizes playback.
 *
 * A plausible-looking mock Android route, "PASS" string, CI status or copied
 * event log must not be promoted to physical no-speaker-fallback evidence.
 */
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

export const SCHEMA = "hearlens-m04-output-safety-evidence-v1";
const SHA256 = /^[a-f0-9]{64}$/i;
const SHORT_ID = /^[a-z0-9][a-z0-9_.:-]{1,95}$/i;

export const REQUIREMENTS = Object.freeze([
  {id:"built_in_microphone",kind:"device",needed:"observed"},
  {id:"post_dsp_digital_limiter",kind:"software",needed:"test"},
  {id:"bounded_gain_per_ear",kind:"software",needed:"test"},
  {id:"low_volume_ramp_and_manual_stop",kind:"software",needed:"test"},
  {id:"capture_watchdog_and_dropout",kind:"software",needed:"test"},
  {id:"actual_a2dp_output_not_prediction",kind:"physical",needed:"recording"},
  {id:"phone_speaker_silent_on_disconnect",kind:"physical",needed:"recording"},
  {id:"phone_speaker_silent_on_call_focus_route",kind:"physical",needed:"recording"},
  {id:"previously_queued_audio_cannot_escape",kind:"physical",needed:"recording"},
  {id:"acoustic_feedback_bounded",kind:"physical",needed:"recording"},
  {id:"left_right_output_spl_calibration",kind:"calibration",needed:"calibration"},
]);

function wellFormedEvidence(e) {
  return e && typeof e==="object" && !Array.isArray(e) &&
    typeof e.id==="string" && SHORT_ID.test(e.id) &&
    ["simulated","observed","unit","physical","calibrated"].includes(e.basis) &&
    ["PASS","FAIL","NOT_MEASURED","INCONCLUSIVE"].includes(e.result) &&
    typeof e.source==="string" && e.source.length>=4 && e.source.length<=512;
}
function qualified(e, r) {
  if(!e || e.result!=="PASS")return false;
  // A developer assertion from a mock can never fulfill a physical item.
  if(r.needed==="observed")return e.basis==="observed";
  if(r.needed==="test")return e.basis==="unit";
  if(r.needed==="recording")return e.basis==="physical" && SHA256.test(e.artifact_sha256||"") &&
    typeof e.fixture_id==="string" && SHORT_ID.test(e.fixture_id);
  if(r.needed==="calibration")return e.basis==="calibrated" &&
    SHA256.test(e.artifact_sha256||"") && typeof e.calibration_id==="string" &&
    SHORT_ID.test(e.calibration_id);
  return false;
}
export function assessM04Evidence(record) {
  if(!record || typeof record!=="object" || Array.isArray(record) || record.schema!==SCHEMA)
    throw new TypeError("M04 evidence schema is required");
  const {target,items}=record;
  if(!target || target.phone!=="moto-g62-android13" || target.earbuds!=="AIR31" ||
     typeof target.repository_sha!=="string" || !/^[a-f0-9]{40}$/i.test(target.repository_sha))
    throw new TypeError("Target phone/earbuds and exact repository SHA are required");
  if(!Array.isArray(items) || items.length>100)
    throw new TypeError("Evidence items must be a bounded array");
  const accepted=new Map();
  for(const e of items){
    if(!wellFormedEvidence(e)) throw new TypeError("Malformed evidence item");
    if(accepted.has(e.id))throw new TypeError("Duplicate evidence ID: "+e.id);
    accepted.set(e.id,e);
  }
  const rows=REQUIREMENTS.map(req=>{
    const item=accepted.get(req.id);
    const valid=item ? qualified(item,req) : false;
    const failure=(item?.result==="FAIL");
    return {
      id:req.id,kind:req.kind,
      state:failure?"FAILED":valid?"EVIDENCE_SUPPLIED_UNREVIEWED":
        item?.result==="INCONCLUSIVE"?"INCONCLUSIVE":"MISSING_OR_INSUFFICIENT",
      basis:item?.basis??null,
      source:item?.source??null,
      note:(!item?"No evidence":!valid?"Evidence does not meet this requirement":
        "Metadata accepted for independent review, NOT safety certification")
    };
  });
  const pending=rows.filter(x=>x.state!=="EVIDENCE_SUPPLIED_UNREVIEWED");
  const physical=rows.filter(x=>["physical","calibration"].includes(x.kind));
  const physicalUnmet=physical.filter(x=>x.state!=="EVIDENCE_SUPPLIED_UNREVIEWED");
  return {
    schema:"hearlens-m04-output-gate-report-v1",
    target,
    status:pending.length?"BLOCKED_NEEDS_INDEPENDENT_PHYSICAL_SAFETY_EVIDENCE":
                   "EVIDENCE_COMPLETE_REQUIRES_INDEPENDENT_PHYSICAL_REVIEW",
    evidence_count:items.length,requirements:rows.length,
    unresolved:pending.map(x=>x.id),
    physical_unresolved:physicalUnmet.map(x=>x.id),
    checks:rows,
    nonhuman_playback_authorized:false,
    human_hearing_playback_authorized:false,
    automatic_unblock_supported:false,
    bluetooth_acoustic_latency_measured:false,
    reason:"No GitHub CI, input-clock timestamp, predicted route, user-supplied label or metadata can establish physical speaker isolation or safe ear-level SPL.",
    next_action:physicalUnmet.length
      ?"Do not start live DSP or Bluetooth test-tone playback; first solve independent hard-mute and leakage observability without re-running the accepted SW1–SW4 tests."
      :"Seek independent safety review of raw physical evidence; this metadata tool cannot grant any playback permission."
  };
}
export function formatSummary(report) {
  return [
    "M04 output safety: "+report.status,
    "Target: "+report.target.phone+" / "+report.target.earbuds+" @ "+report.target.repository_sha,
    "Unresolved ("+report.unresolved.length+"): "+(report.unresolved.join(", ")||"none (review still required)"),
    "Nonhuman playback authorized: false",
    "Human hearing playback authorized: false",
    report.next_action
  ].join("\n");
}

function main() {
  const argv=process.argv.slice(2);
  if(argv.length!==2 || argv[0]!=="--evidence"){
    process.stderr.write("Usage: node tools/m04-output-safety-gate.mjs --evidence <file.json>\n");
    process.exitCode=2;
    return;
  }
  try {
    const input=JSON.parse(fs.readFileSync(argv[1],"utf8"));
    const report=assessM04Evidence(input);
    process.stdout.write(JSON.stringify(report,null,2)+"\n");
    // Blocking is EXPECTED; the decision is reported in JSON, not process exit 1.
  } catch (error) {
    process.stderr.write("ERROR: "+error.message+"\n");
    process.exitCode=2;
  }
}
if(process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
