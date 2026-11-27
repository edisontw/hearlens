#!/usr/bin/env node
/**
 * M04-D2 evidence gate. Pure metadata; never interfaces with PCM, audio
 * routing, input devices or speakers. This gate NEVER authorizes playback.
 *
 * A plausible-looking mock Android route, "PASS" string, CI status or copied
 * event log must not be promoted to physical no-speaker-fallback evidence.
 */
import fs from "node:fs";
import { createHash } from "node:crypto";
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
  {id:"mic_input_spl_calibration",kind:"calibration",needed:"calibration"},
  {id:"left_right_ear_canal_output_and_mpo",kind:"physical",needed:"recording"},
  {id:"bluetooth_earbud_hard_mute",kind:"physical",needed:"recording"},
  {id:"android_target_callback_performance",kind:"physical",needed:"recording"},
  {id:"acoustic_end_to_end_latency",kind:"physical",needed:"recording"},
  {id:"direct_and_delayed_sound_usability",kind:"physical",needed:"recording"},
]);

function wellFormedEvidence(e) {
  return e && typeof e==="object" && !Array.isArray(e) &&
    typeof e.id==="string" && SHORT_ID.test(e.id) &&
    ["simulated","observed","unit","physical","calibrated"].includes(e.basis) &&
    ["PASS","FAIL","NOT_MEASURED","INCONCLUSIVE"].includes(e.result) &&
    typeof e.source==="string" && e.source.length>=4 && e.source.length<=512;
}
function qualified(e, r, target, verifiedArtifacts) {
  if(!e || e.result!=="PASS")return false;
  if(r.needed==="observed")return e.basis==="observed";
  if(r.needed==="test")return e.basis==="unit";

  const identity=r.needed==="calibration" ? e.calibration_id : e.fixture_id;
  const basis=r.needed==="calibration" ? "calibrated" : "physical";
  const {provenance:p}=e;
  if(e.basis!==basis || typeof identity!=="string" || !SHORT_ID.test(identity) ||
     typeof e.artifact_sha256!=="string" || !SHA256.test(e.artifact_sha256) ||
     !p || p.repository_sha!==target.repository_sha ||
     ![p.run_id,p.setup_id,p.procedure_id].every(id=>typeof id==="string" && SHORT_ID.test(id)) ||
     typeof p.captured_at!=="string" ||
     !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(p.captured_at))return false;
  const captured=Date.parse(p.captured_at);
  return Number.isFinite(captured) && new Date(captured).toISOString()===p.captured_at &&
    verifiedArtifacts.has(e.artifact_sha256.toLowerCase());
}

export function assessM04Evidence(record, {verifiedArtifacts=new Set()}={}) {
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
    const valid=item ? qualified(item,req,target,verifiedArtifacts) : false;
    const failure=(item?.result==="FAIL");
    return {
      id:req.id,kind:req.kind,
      state:failure?"FAILED":valid?"EVIDENCE_SUPPLIED_UNREVIEWED":
        item?.result==="INCONCLUSIVE"?"INCONCLUSIVE":"MISSING_OR_INSUFFICIENT",
      basis:item?.basis??null,
      source:item?.source??null,
      artifact_sha256:valid ? item.artifact_sha256??null : null,
      provenance:valid ? item.provenance??null : null,
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

async function verifyArtifacts(items, artifactDirectory) {
  const verified=new Set();
  for(const item of items){
    if(item.result!=="PASS" || !["physical","calibrated"].includes(item.basis) ||
       typeof item.artifact_sha256!=="string" || !SHA256.test(item.artifact_sha256))continue;
    const expected=item.artifact_sha256.toLowerCase();
    if(verified.has(expected))continue;
    try {
      const flags=fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK;
      const handle=await fs.promises.open(resolve(artifactDirectory,expected),flags);
      try {
        const stat=await handle.stat();
        if(!stat.isFile() || stat.size===0)continue;
        const hash=createHash("sha256");
        for await(const chunk of handle.createReadStream({autoClose:false,end:stat.size-1})){
          hash.update(chunk);
        }
        if(hash.digest("hex")===expected && (await handle.stat()).size===stat.size)verified.add(expected);
      } finally {
        await handle.close();
      }
    } catch(error) {
      if(!["ENOENT","ELOOP","ENOTDIR"].includes(error.code))throw error;
    }
  }
  return verified;
}

async function main() {
  const argv=process.argv.slice(2);
  if(argv[0]!=="--evidence" || (argv.length!==2 &&
      (argv.length!==4 || argv[2]!=="--artifact-dir"))){
    process.stderr.write("Usage: node tools/m04-output-safety-gate.mjs --evidence <file.json> [--artifact-dir <directory>]\n");
    process.exitCode=2;
    return;
  }
  try {
    const input=JSON.parse(fs.readFileSync(argv[1],"utf8"));
    let report=assessM04Evidence(input);
    if(argv.length===4){
      const verifiedArtifacts=await verifyArtifacts(input.items,argv[3]);
      report=assessM04Evidence(input,{verifiedArtifacts});
    }
    process.stdout.write(JSON.stringify(report,null,2)+"\n");
    // Blocking is EXPECTED; the decision is reported in JSON, not process exit 1.
  } catch (error) {
    process.stderr.write("ERROR: "+error.message+"\n");
    process.exitCode=2;
  }
}
if(process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
