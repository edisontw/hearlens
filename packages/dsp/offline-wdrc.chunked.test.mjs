import assert from "node:assert/strict";
import test from "node:test";
import { createOfflineChunkedWDRC, OFFLINE_CHUNK_HOLDBACK } from "./offline-wdrc.chunked.mjs";
import { renderOfflineWDRC } from "./offline-wdrc.mjs";
import { fixtureTargets } from "./offline-wdrc.characterization.mjs";

const centers = [250,500,1000,2000,4000,6000];
const config = (mode, ear="left") => ({
  sampleRate:16000, ear, crossoverMode:mode,
  syntheticRmsDbFSAt65DbSPL:-37, limiterCeiling:0.2,
  targets:fixtureTargets(f => f >= 2000 ? [16,10,4] : [12,7,3]),
});
const signal = n => Float32Array.from({length:n}, (_,i) =>
  0.015*Math.sin(2*Math.PI*i*1219/16000)+0.011*Math.sin(2*Math.PI*i*3700/16000));
const combine = pieces => {
  const length=pieces.reduce((n,c)=>n+c.length,0);
  const out=new Float32Array(length);let offset=0;
  for(const piece of pieces){out.set(piece,offset);offset+=piece.length;}
  return out;
};
function chunkedReference(input, sizes, mode, ear) {
  const options=config(mode,ear);
  const stream=createOfflineChunkedWDRC(options);
  const pieces=[];let position=0,idx=0;
  while(position<input.length){
    const end=Math.min(input.length,position+sizes[idx%sizes.length]);
    const chunk=input.slice(position,end);
    const original=Float32Array.from(chunk);
    const emitted=stream.push(chunk);
    assert.deepEqual(chunk,original,"caller-owned chunk must not mutate");
    pieces.push(emitted);
    assert.equal(stream.acceptedSamples,end);
    assert.equal(stream.emittedSamples,Math.max(0,end-OFFLINE_CHUNK_HOLDBACK));
    position=end;idx++;
  }
  pieces.push(stream.finish());
  assert.equal(stream.finalized,true);
  assert.equal(stream.emittedSamples,input.length);
  assert.throws(()=>stream.finish(),/finalized/);
  assert.throws(()=>stream.push(Float32Array.of(0)),/finalized/);
  const actual=combine(pieces);
  const expected=renderOfflineWDRC({...options,samples:input}).samples;
  assert.deepEqual(actual,expected,"chunk segmentation cannot change reference Float32 output");
  assert(actual.every(n=>Math.abs(n)<=0.2 && Number.isFinite(n)));
}
test("tiny irregular chunks exactly match complete offline reference: hard and smooth, both ears",()=>{
  const input=signal(5000);
  for(const mode of ["hard","smooth"])
    for(const ear of ["left","right"])
      chunkedReference(input,[3,7,129,511,5,701,2048],mode,ear);
});
test("single-chunk and fixed-hop chunking give identical Float32 output",()=>{
  const input=signal(3072);
  for(const mode of ["hard","smooth"]) {
    chunkedReference(input,[3072],mode,"left");
    chunkedReference(input,[256],mode,"left");
  }
});
test("short and silent clips remain lossless, output holdback flushes final tail",()=>{
  const options=config("smooth");
  const stream=createOfflineChunkedWDRC(options);
  assert.equal(stream.push(Float32Array.of(0)).length,0);
  const tail=stream.finish();
  assert.deepEqual(tail,Float32Array.of(0));
  chunkedReference(new Float32Array(400),[31,67,5],"hard","right");
});
test("extreme synthetic input never bypasses post-sum digital limiter",()=>{
  const options=config("smooth");
  const input=Float32Array.from({length:4096},(_,i)=>8*Math.sin(i*0.5));
  const stream=createOfflineChunkedWDRC(options);
  const out=combine([stream.push(input.slice(0,1800)),stream.push(input.slice(1800)),stream.finish()]);
  assert(out.every(v=>Number.isFinite(v)&&Math.abs(v)<=0.2));
  assert(stream.diagnostics.limitedSamples>0);
});
test("invalid chunks fail without changing state, and total sample cap applies",()=>{
  const stream=createOfflineChunkedWDRC(config("hard"));
  const initial=Float32Array.of(0.1,0.2);
  stream.push(initial);
  for(const chunk of [new Float32Array(0),Float32Array.of(NaN),Float32Array.of(Infinity),Float32Array.of(17),[1,2]]){
    assert.throws(()=>stream.push(chunk));
    assert.equal(stream.acceptedSamples,2);
    assert.equal(stream.emittedSamples,0);
  }
  assert.throws(()=>stream.push(new Float32Array(65536)),/65536/);
  assert.equal(stream.acceptedSamples,2);
  stream.finish();
});
test("config cannot set unknown ear or invalid synthetic reference",()=>{
  assert.throws(()=>createOfflineChunkedWDRC(config("smooth","middle")));
  assert.throws(()=>createOfflineChunkedWDRC({...config("hard"),syntheticRmsDbFSAt65DbSPL:null}));
  assert.throws(()=>createOfflineChunkedWDRC({...config("hard"),samples:Float32Array.of(0)}));
  assert.throws(()=>createOfflineChunkedWDRC(null));
});
