import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createOfflineSixBandLevelResearch } from "./offline-six-band-level.mjs";

const conf = (overrides={}) => ({
  usage: "offline-synthetic-test-only", sampleRate: 48000,
  attackMs: 15, releaseMs: 400, ...overrides,
});
const read = p => p.readNominalLevelsInto(new Float64Array(6));
const tone = (hz, rmsDbfs, seconds=0.6) => {
  const amp = Math.SQRT2 * 10 ** (rmsDbfs / 20);
  return Float32Array.from({length: Math.round(seconds*48000)}, (_,i) => amp*Math.sin(2*Math.PI*hz*i/48000));
};
function feed(p, input, size=128) {
  for(let n=0;n<input.length;n+=size) p.process(input.subarray(n,Math.min(n+size,input.length)));
}

test("synthetic -37 dBFS RMS center tone maps to nominal 65 without calibration claim", () => {
  for (const [index, hz] of [[0,250],[2,1000],[5,8000]]) {
    const p=createOfflineSixBandLevelResearch(conf());
    feed(p,tone(hz,-37));
    const estimates=read(p);
    assert(Math.abs(estimates[index]-65)<0.7, String(hz)+": "+estimates[index]);
    assert(estimates.every(v=>v>=50&&v<=80));
    assert.equal(p.diagnostics.physicalMicCalibrated,false);
    assert.equal(p.diagnostics.hearingOutputAuthorized,false);
    assert.equal(p.diagnostics.audioRoute,"none");
  }
});

test("frequency separation at octave centers is informative, not spectral brick-wall", () => {
  const p=createOfflineSixBandLevelResearch(conf());feed(p,tone(1000,-28));
  const l=read(p);
  assert(l[2]>l[1]+6,"1k/500 "+l);
  assert(l[2]>l[3]+6,"1k/2k "+l);
  assert(l[2]>l[0]+10,"1k/250 "+l);
});

test("sample-exact results regardless of callback partitioning", () => {
  const input=Float32Array.from({length:11003},(_,i)=>.013*Math.sin(i*.071)+.009*Math.sin(i*.21));
  const a=createOfflineSixBandLevelResearch(conf());
  const b=createOfflineSixBandLevelResearch(conf());
  feed(a,input,1);feed(b,input,128);
  assert.deepEqual(read(a),read(b));
  assert.equal(a.diagnostics.acceptedSamples,input.length);
});

test("silence, attack and slow release react without a future-sample lookahead", () => {
  const p=createOfflineSixBandLevelResearch(conf());
  assert.deepEqual([...read(p)],Array(6).fill(50));
  feed(p,tone(1000,-22,0.3)); const loud=read(p)[2];
  assert(loud>78,"loud "+loud);
  feed(p,new Float32Array(48000)); const quiet=read(p)[2];
  assert(quiet<loud-7,"quiet "+quiet+" loud "+loud);
  p.reset();assert.deepEqual([...read(p)],Array(6).fill(50));
  assert.equal(p.diagnostics.acceptedSamples,0);
});

test("two independent ear instances do not bleed filter states", () => {
  const left=createOfflineSixBandLevelResearch(conf());
  const right=createOfflineSixBandLevelResearch(conf());
  feed(left,tone(250,-27));feed(right,tone(8000,-27));
  assert(read(left)[0]>read(left)[5]+10);
  assert(read(right)[5]>read(right)[0]+10);
  const previous=read(right);
  feed(left,new Float32Array(128));
  assert.deepEqual(read(right),previous);
});

test("strict synthetic-only configuration; malformed PCM fail-stop until reset", () => {
  assert.throws(()=>createOfflineSixBandLevelResearch(conf({output:"earbuds"})),/synthetic-only/);
  assert.throws(()=>createOfflineSixBandLevelResearch(conf({usage:"live"})),/synthetic-only/);
  assert.throws(()=>createOfflineSixBandLevelResearch(conf({sampleRate:44100})),/48kHz/);
  const p=createOfflineSixBandLevelResearch(conf());
  assert.throws(()=>p.process(Float32Array.from([0,NaN,0])),/finite/);
  assert.equal(p.diagnostics.acceptedSamples,0);
  assert.equal(p.diagnostics.faulted,true);
  assert.throws(()=>p.process(new Float32Array([0])),/faulted/);
  p.reset();assert.equal(p.process(new Float32Array([0])),1);
});

test("standalone research detector has no device or network interfaces",()=>{
  const source=readFileSync(new URL("./offline-six-band-level.mjs",import.meta.url),"utf8");
  for(const re of [/\bAudioTrack\b/,/\bgetUserMedia\b/,/\bAudioContext\b/,/\bWebSocket\b/,/\bfetch\s*\(/, /\bAudioWorklet\b/])
    assert.doesNotMatch(source,re);
});
