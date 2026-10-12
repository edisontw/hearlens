import assert from "node:assert/strict";
import test from "node:test";
import {createOfflineStatefulWDRC} from "./offline-wdrc.stateful.mjs";
import {renderOfflineWDRC} from "./offline-wdrc.mjs";
import {fixtureTargets} from "./offline-wdrc.characterization.mjs";

const options=(ear,mode,sampleRate)=>({
  ear,crossoverMode:mode,sampleRate,syntheticRmsDbFSAt65DbSPL:-37,
  limiterCeiling:0.18,targets:fixtureTargets(f=>f>=2000?[14,9,3]:[11,6,2]),
});
const tone=(length,sr)=>Float32Array.from({length},(_,i)=>
  0.017*Math.sin(2*Math.PI*1131*i/sr)+0.008*Math.sin(2*Math.PI*3431*i/sr));
function join(pieces){
  const output=new Float32Array(pieces.reduce((n,p)=>n+p.length,0));
  let at=0;
  for(const p of pieces){output.set(p,at);at+=p.length;}
  return output;
}

test("M03K: preallocated callback-shaped output exactly equals oracle, both ears, 3 rates, 2 crossovers",()=>{
  const splits=[1,3,255,256,257,4096,7,1023,128,19,2048];
  for(const sr of [16000,24000,48000])
    for(const mode of ["hard","smooth"])
      for(const ear of ["left","right"]){
        const cfg=options(ear,mode,sr),input=tone(13019,sr);
        const stream=createOfflineStatefulWDRC(cfg);
        const output=new Float32Array(4352),parts=[];
        const sentinel=Math.fround(0.731);
        let pos=0,i=0;
        while(pos<input.length){
          const fragment=input.subarray(pos,Math.min(input.length,pos+splits[i++%splits.length]));
          output.fill(sentinel);
          const needed=stream.requiredOutputSamples(fragment.length);
          assert(needed>=0 && needed<=4352);
          const written=stream.processInto(fragment,output);
          assert.equal(written,needed);
          assert(output.subarray(written).every(v=>v===sentinel),"must leave unused destination untouched");
          parts.push(output.slice(0,written));
          pos+=fragment.length;
        }
        parts.push(stream.finish());
        const reference=renderOfflineWDRC({...cfg,samples:input});
        assert.deepEqual(join(parts),reference.samples,ear+" "+mode+" "+sr);
        assert.equal(stream.diagnostics.frames,reference.diagnostics.frames);
        assert.equal(stream.diagnostics.limitedSamples,reference.diagnostics.limitedSamples);
      }
});

test("M03K: mix legacy push and caller-buffer API in one stream",()=>{
  const cfg=options("right","smooth",16000),input=tone(5005,16000);
  const stream=createOfflineStatefulWDRC(cfg),parts=[];
  const out=new Float32Array(4352);
  let pos=0,i=0;
  const chunks=[1,256,1000,4096,3];
  while(pos<input.length){
    const chunk=input.subarray(pos,Math.min(input.length,pos+chunks[i]));
    if(i%2===0){
      const n=stream.processInto(chunk,out);
      parts.push(out.slice(0,n));
    }else parts.push(stream.push(chunk));
    pos+=chunk.length;i++;
  }
  parts.push(stream.finish());
  assert.deepEqual(join(parts),renderOfflineWDRC({...cfg,samples:input}).samples);
});

test("M03K: startup preflight counts match exact emitted prefix and buffer is reusable",()=>{
  const stream=createOfflineStatefulWDRC(options("left","hard",16000));
  const out=new Float32Array(256);
  assert.equal(stream.requiredOutputSamples(1023),0);
  assert.equal(stream.processInto(new Float32Array(1023),out),0);
  assert.equal(stream.requiredOutputSamples(1),256);
  assert.equal(stream.processInto(new Float32Array(1),out),256);
  assert.equal(stream.diagnostics.emittedSamples,256);
  stream.reset();
  assert.equal(stream.processInto(new Float32Array(1024),out),256);
  assert.equal(stream.diagnostics.callbackStyleWriteIntoAvailable,true);
  assert.equal(stream.diagnostics.callbackStyleDoesNotAllocateResultArrays,true);
});

test("M03K: insufficient output capacity fails before input mutation, never writes partial PCM",()=>{
  const stream=createOfflineStatefulWDRC(options("left","smooth",16000));
  const out=new Float32Array(255);out.fill(0.5);
  assert.throws(()=>stream.processInto(new Float32Array(1024),out),/destination too short/);
  assert.equal(stream.diagnostics.acceptedSamples,0);
  assert(out.every(v=>v===0.5));
  assert.equal(stream.diagnostics.faulted,true);
  assert.throws(()=>stream.processInto(new Float32Array(1),out),/reset required/);
  stream.reset();
  const good=new Float32Array(256);
  assert.equal(stream.processInto(new Float32Array(1024),good),256);
});

test("M03K: aliased buffers, invalid PCM and wrong destinations fail closed",()=>{
  const cfg=options("right","hard",16000);
  const shared=new Float32Array(1024);
  const alias=createOfflineStatefulWDRC(cfg);
  assert.throws(()=>alias.processInto(shared,shared.subarray(0,256)),/independent/);
  assert(alias.diagnostics.faulted);
  const invalid=createOfflineStatefulWDRC(cfg),out=new Float32Array(4352);
  const nan=new Float32Array(1024);nan[980]=NaN;
  assert.throws(()=>invalid.processInto(nan,out),/invalid synthetic PCM/);
  assert.equal(invalid.diagnostics.acceptedSamples,0);
  assert(out.every(x=>x===0));
  const wrong=createOfflineStatefulWDRC(cfg);
  assert.throws(()=>wrong.processInto(new Float32Array(1024),[]),/independent/);
  assert(wrong.diagnostics.faulted);
  assert.throws(()=>wrong.requiredOutputSamples(1),/reset required/);
  assert.throws(()=>createOfflineStatefulWDRC(cfg).requiredOutputSamples(0),/chunkLength/);
});

test("M03K: sustained reused buffers remain bounded, numeric result is post-limited",()=>{
  const cfg=options("left","smooth",16000),stream=createOfflineStatefulWDRC(cfg);
  const input=Float32Array.from({length:256},(_,i)=>8*Math.sin(i*0.5));
  const out=new Float32Array(512);
  let received=0;
  for(let k=0;k<400;k++){
    const count=stream.processInto(input,out);
    assert(out.subarray(0,count).every(v=>Number.isFinite(v)&&Math.abs(v)<=cfg.limiterCeiling));
    received+=count;
  }
  const tail=stream.finish();
  assert.equal(received+tail.length,400*256);
  assert.equal(stream.diagnostics.inputCapacitySamples,1024);
  assert.equal(stream.diagnostics.wolaCapacitySamples,1024);
  assert(stream.diagnostics.limitedSamples>0);
});
