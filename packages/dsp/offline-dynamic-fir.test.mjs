import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createOfflineDynamicFirResearch } from "./offline-dynamic-fir.mjs";

const CENTER=[250,500,1000,2000,4000,8000];
const ANCHORS={
 left:[[0,0,0],[0,0,0],[0,0,0],[1.9472054262667307,1.9472054262667307,1.9472054262667307],
  [7.11714853661015,7.11714853661015,7.11714853661015],
  [9.783693510917363,2.274072925802951,0]],
 right:[[0,0,0],[0,0,0],[5.694005637713971,5.694005637713971,5.694005637713971],
  [11.94720542626673,11.94720542626673,11.94720542626673],
  [14.077006222739447,13.004447589867018,11.93188895699459],
  [13.704568901060156,4.142316736998374,0]],
};
const makeTargets=(table=ANCHORS)=>({schema:"hearlens-prescription-targets-v1",usage:"offline-research-only",origin:{kind:"synthetic-fixture",referenceId:null},ears:Object.fromEntries(["left","right"].map(ear=>[ear,{bands:CENTER.map((centerHz,i)=>({centerHz,gainDbByInputLevel:Object.fromEntries([50,65,80].map((v,j)=>[v,table[ear][i][j]]))}))}]))});
const conf=(overrides={})=>({usage:"offline-synthetic-test-only",targets:makeTargets(),ear:"left",sampleRate:48000,maxGainDb:12,limiterCeiling:0.8,transitionMs:50,...overrides});

test("Research FIR six independent nominal band coordinates retain CAMFIT 50/65/80 target law",()=>{
 const r=createOfflineDynamicFirResearch(conf({ear:"right"}));
 for(const l of [50,65,80,57.5,72.5]){
  const actual=r.setSyntheticBandLevels(Array(6).fill(l));
  for(let i=0;i<6;i++){
   const low=l<=65?0:1,high=low+1;
   const expected=Math.min(12,ANCHORS.right[i][low]+((l-(low===0?50:65))/15)*(ANCHORS.right[i][high]-ANCHORS.right[i][low]));
   assert(Math.abs(actual[i]-expected)<1e-11);
  }
 }
 const g=r.setSyntheticBandLevels([50,65,80,50,65,80]);
 assert.equal(g[5],0);
 assert.equal(r.diagnostics.audioRoute,"none");assert.equal(r.diagnostics.hearingOutputAuthorized,false);
});

test("Static 65-coordinate response is within 1.5dB for both CAMFIT fixture ears",()=>{
 for(const ear of ["left","right"]){
  const p=createOfflineDynamicFirResearch(conf({ear}));p.setSyntheticBandLevels(Array(6).fill(65));
  const impulse=new Float32Array(1024);impulse[0]=0.01;
  const result=new Float32Array(1024);p.processInto(impulse,result);
  for(const hz of CENTER){
   let real=0,imag=0;for(let k=0;k<1024;k++){
    const phase=2*Math.PI*hz*k/48000;
    real+=result[k]*Math.cos(phase);imag-=result[k]*Math.sin(phase);
   }
   const db=20*Math.log10(Math.hypot(real,imag)/0.01);
   const reference=Math.min(12,ANCHORS[ear][CENTER.indexOf(hz)][1]);
   assert(Math.abs(db-reference)<1.5,`${ear} @${hz}Hz ${db} != ${reference}`);
  }
 }
});

test("Zero-gain identity has 256-sample linear-phase delay, not zero acoustic latency",()=>{
 const zeros={left:Array.from({length:6},()=>[0,0,0]),right:Array.from({length:6},()=>[0,0,0])};
 const p=createOfflineDynamicFirResearch(conf({targets:makeTargets(zeros)}));p.setSyntheticBandLevels(Array(6).fill(65));
 const x=new Float32Array(1024);x[0]=0.25;const y=new Float32Array(1024);
 assert.equal(p.processInto(x,y),1024);
 assert(Math.abs(y[256]-0.25)<1e-6);
 for(let i=0;i<1024;i++) if(i!==256)assert(Math.abs(y[i])<1e-6,`impulse artifact ${i}: ${y[i]}`);
 assert.equal(p.diagnostics.frozenGainLinearPhaseDelaySamples,256);
 assert.equal(p.diagnostics.algorithmicFutureLookaheadSamples,0);
});

test("Shared-history coefficient morph deterministic across 128/one-sample chunking and midfade retarget",()=>{
 const lengths=[1500,1100,1700,900],total=lengths.reduce((s,v)=>s+v,0);
 const pcm=Float32Array.from({length:total},(_,i)=>.013*Math.sin(i*.31)+.007*Math.cos(i*.071));
 function stream(quantum){
  const p=createOfflineDynamicFirResearch(conf({ear:"right"})), out=new Float32Array(total);
  p.setSyntheticBandLevels(Array(6).fill(50));let pos=0;
  for(let segment=0;segment<lengths.length;segment++){
   if(segment===1)p.setSyntheticBandLevels(Array(6).fill(80));
   if(segment===2)p.setSyntheticBandLevels([80,50,65,65,50,80]); // before previous fade finishes
   if(segment===3)p.setSyntheticBandLevels(Array(6).fill(65));
   let remain=lengths[segment];
   while(remain){const n=Math.min(quantum,remain);p.processInto(pcm.subarray(pos,pos+n),out.subarray(pos,pos+n));pos+=n;remain-=n;}
  }
  return {out,p};
 }
 const a=stream(128),b=stream(1);
 assert.deepEqual(a.out,b.out);
 assert.equal(a.p.diagnostics.updates,4);
 assert.equal(a.p.diagnostics.acceptedSamples,total);
 assert(a.p.diagnostics.transitionRemainingSamples>=0);
});

test("Final digital limiter bounds extreme input; invalid input cannot partially write; reset explicit",()=>{
 const p=createOfflineDynamicFirResearch(conf({ear:"right",limiterCeiling:0.15}));p.setSyntheticBandLevels(Array(6).fill(50));
 const in1=Float32Array.from({length:3000},(_,i)=>8*Math.sin(i*.21));const y=new Float32Array(in1.length);
 p.processInto(in1,y);
 assert(y.every(v=>Number.isFinite(v)&&Math.abs(v)<=0.15));
 assert(p.diagnostics.limitedSamples>0);
 const bad=Float32Array.from([0,0,NaN,0]);const dst=new Float32Array(4).fill(0.137);
 assert.throws(()=>p.processInto(bad,dst),/finite/);assert(dst.every(x=>x===Math.fround(0.137)));
 assert.equal(p.diagnostics.faulted,true);
 assert.throws(()=>p.processInto(new Float32Array(1),dst),/faulted/);
 p.reset();assert.equal(p.diagnostics.ready,false);
 assert.throws(()=>p.processInto(new Float32Array(1),dst),/not initialized/);
 p.setSyntheticBandLevels(Array(6).fill(65));assert.equal(p.processInto(new Float32Array(1),dst),1);
});

test("Strict offline config rejects output claims and invalid per-band inputs",()=>{
 assert.throws(()=>createOfflineDynamicFirResearch(conf({route:"headphones"})),/research configuration/);
 assert.throws(()=>createOfflineDynamicFirResearch(conf({usage:"live"})),/offline/);
 assert.throws(()=>createOfflineDynamicFirResearch(conf({sampleRate:44100})),/48000/);
 assert.throws(()=>createOfflineDynamicFirResearch(conf({ear:"both"})),/left\/right/);
 const missing=makeTargets(); missing.ears.left=null;
 assert.throws(()=>createOfflineDynamicFirResearch(conf({targets:missing})),/bands/);
 const r=createOfflineDynamicFirResearch(conf());
 assert.throws(()=>r.setSyntheticBandLevels(Array(6).fill(85)),/50..80/);
 assert.equal(r.diagnostics.faulted,true);
});

test("Research FIR has no playback, microphone, recording or network APIs",()=>{
 const s=readFileSync(new URL("./offline-dynamic-fir.mjs",import.meta.url),"utf8");
 for(const re of [/\bAudioTrack\b/,/\bAudioRecord\b/,/\bgetUserMedia\b/,/\bAudioContext\b/,/\bWebSocket\b/,/\bfetch\s*\(/,/\bAudioWorklet\b/])assert.doesNotMatch(s,re);
});


test("fixed-horizon retarget mode is explicit and rejects unknown policy values",()=>{
 assert.equal(createOfflineDynamicFirResearch(conf({transitionRetargetPolicy:"fixed-horizon"})).diagnostics.transitionRetargetPolicy,"fixed-horizon");
 assert.equal(createOfflineDynamicFirResearch(conf()).diagnostics.transitionRetargetPolicy,"restart");
 assert.throws(()=>createOfflineDynamicFirResearch(conf({transitionRetargetPolicy:"unknown"})),/transitionRetargetPolicy/);
});
