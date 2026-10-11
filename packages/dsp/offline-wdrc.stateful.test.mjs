import assert from "node:assert/strict";
import test from "node:test";
import {createOfflineStatefulWDRC, STREAM_MAX_CHUNK_SAMPLES, STREAM_LOOKAHEAD_SAMPLES} from "./offline-wdrc.stateful.mjs";
import {renderOfflineWDRC, OFFLINE_WDRC_FRAME_SIZE, OFFLINE_WDRC_HOP_SIZE} from "./offline-wdrc.mjs";
import {fixtureTargets} from "./offline-wdrc.characterization.mjs";

const options=(mode,ear="left",sampleRate=16000)=>({
  sampleRate,ear,crossoverMode:mode,syntheticRmsDbFSAt65DbSPL:-37,
  limiterCeiling:0.15,targets:fixtureTargets(f=>f>=2000?[16,10,4]:[12,7,3]),
});
const tone=(length,sr=16000)=>Float32Array.from({length},(_,i)=>
  0.018*Math.sin(2*Math.PI*1219*i/sr)+0.011*Math.sin(2*Math.PI*3700*i/sr));
function join(parts){
  const result=new Float32Array(parts.reduce((s,x)=>s+x.length,0));
  let at=0;
  for(const x of parts){result.set(x,at);at+=x.length;}
  return result;
}
function verify(input,chunks,cfg){
  const stream=createOfflineStatefulWDRC(cfg);
  const parts=[];
  let pos=0,i=0;
  while(pos<input.length){
    const end=Math.min(input.length,pos+chunks[i++%chunks.length]);
    const fragment=input.slice(pos,end);
    const copy=Float32Array.from(fragment);
    parts.push(stream.push(fragment));
    assert.deepEqual(fragment,copy);
    pos=end;
    assert.equal(stream.diagnostics.acceptedSamples,pos);
    assert(stream.diagnostics.pendingSamples>=0);
    assert(stream.diagnostics.pendingSamples<=1024);
    assert.equal(stream.diagnostics.inputCapacitySamples,1024);
    assert.equal(stream.diagnostics.wolaCapacitySamples,1024);
  }
  parts.push(stream.finish());
  const ref=renderOfflineWDRC({...cfg,samples:input});
  assert.deepEqual(join(parts),ref.samples,"stateful PCM must exactly match offline reference");
  assert.equal(stream.diagnostics.frames,ref.diagnostics.frames);
  assert.equal(stream.diagnostics.limitedSamples,ref.diagnostics.limitedSamples);
  assert.equal(stream.diagnostics.emittedSamples,input.length);
  assert.equal(stream.diagnostics.finalized,true);
  return stream;
}

test("full sample-for-sample reference equality for hard/smooth and both ears",()=>{
  const input=tone(7167);
  for(const mode of ["hard","smooth"])for(const ear of ["left","right"])
    verify(input,[1,3,17,127,128,255,256,511,1023,4096],options(mode,ear));
});
test("single-chunk, hop chunks and partial tail match offline exactly",()=>{
  const input=tone(4096);
  for(const mode of ["hard","smooth"]){
    verify(input,[4096],options(mode));
    verify(input,[256],options(mode));
  }
});
test("three supported sample rates, short samples, silence and flush",()=>{
  for(const sr of [16000,24000,48000])for(const mode of ["hard","smooth"]){
    verify(tone(1301,sr),[7,299,1024],options(mode,"left",sr));
    verify(new Float32Array(231),[1,60,170],options(mode,"right",sr));
  }
});
test("stream can exceed old 65536-sample history cap without growing DSP rings",()=>{
  const stream=createOfflineStatefulWDRC(options("hard"));
  const part=tone(2048);
  for(let i=0;i<48;i++)stream.push(part);
  stream.finish();
  assert.equal(stream.diagnostics.acceptedSamples,98304);
  assert.equal(stream.diagnostics.emittedSamples,98304);
  assert.equal(stream.diagnostics.inputCapacitySamples,1024);
  assert.equal(stream.diagnostics.wolaCapacitySamples,1024);
});
test("final limiter cannot be bypassed under extreme input",()=>{
  const cfg=options("smooth","right");
  const stream=createOfflineStatefulWDRC(cfg);
  const input=Float32Array.from({length:8192},(_,i)=>
    8*Math.sin(2*Math.PI*500*i/16000)+7*Math.sin(2*Math.PI*3700*i/16000));
  const pieces=[];
  for(let at=0;at<input.length;at+=2048)pieces.push(stream.push(input.slice(at,at+2048)));
  pieces.push(stream.finish());
  assert(join(pieces).every(x=>Number.isFinite(x)&&Math.abs(x)<=cfg.limiterCeiling));
  assert(stream.diagnostics.limitedSamples>0);
});
test("bad input is atomic and fail-stop until explicit reset",()=>{
  const st=createOfflineStatefulWDRC(options("hard"));
  st.push(Float32Array.of(0.01,0.02));
  assert.throws(()=>st.push(Float32Array.of(NaN)),/reset required/);
  assert(st.diagnostics.faulted);
  assert.equal(st.diagnostics.acceptedSamples,2);
  assert.throws(()=>st.push(Float32Array.of(0)),/reset required/);
  assert.throws(()=>st.finish(),/reset required/);
  st.reset();
  assert(!st.diagnostics.faulted);
  const input=tone(2001);
  assert.deepEqual(join([st.push(input),st.finish()]),
    renderOfflineWDRC({...options("hard"),samples:input}).samples);
});
test("input chunk cap, empty input and configuration validation",()=>{
  const st=createOfflineStatefulWDRC(options("smooth"));
  assert.equal(STREAM_MAX_CHUNK_SAMPLES,4096);
  assert.equal(STREAM_LOOKAHEAD_SAMPLES,OFFLINE_WDRC_FRAME_SIZE-OFFLINE_WDRC_HOP_SIZE);
  assert.throws(()=>st.push(new Float32Array(4097)),/4096/);
  assert(st.diagnostics.faulted);
  st.reset();
  assert.throws(()=>st.finish(),/empty/);
  assert.throws(()=>st.push([]),/Float32Array/);
  assert.throws(()=>createOfflineStatefulWDRC({...options("hard"),ear:"both"}));
  assert.throws(()=>createOfflineStatefulWDRC({...options("hard"),samples:Float32Array.of(0)}));
});
test("reset clears pending audio, envelopes and close state",()=>{
  const st=createOfflineStatefulWDRC(options("smooth"));
  st.push(tone(1000));
  assert(st.diagnostics.pendingSamples>0);
  st.reset();
  assert.equal(st.diagnostics.acceptedSamples,0);
  assert.equal(st.diagnostics.frames,0);
  const input=tone(2111);
  assert.deepEqual(join([st.push(input),st.finish()]),
    renderOfflineWDRC({...options("smooth"),samples:input}).samples);
  assert.throws(()=>st.push(Float32Array.of(0)),/reset required/);
  st.reset();
  assert.equal(st.diagnostics.finalized,false);
});
test("mutable caller target changes never affect already configured stream",()=>{
  const cfg=options("hard");
  const st=createOfflineStatefulWDRC(cfg);
  const input=tone(3072);
  const pieces=[st.push(input.slice(0,1024))];
  cfg.targets.ears.left.bands[0].gainDbByInputLevel["65"]=0;
  cfg.crossoverMode="smooth";
  pieces.push(st.push(input.slice(1024)),st.finish());
  assert.deepEqual(join(pieces),
    renderOfflineWDRC({...options("hard"),samples:input}).samples);
});
