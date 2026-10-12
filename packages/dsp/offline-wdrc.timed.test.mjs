import assert from "node:assert/strict";
import test from "node:test";
import {createOfflineTimedWDRC, DEFAULT_DEADLINE_SLACK_SAMPLES, OFFLINE_TIMED_GUARD_SCHEMA} from "./offline-wdrc.timed.mjs";
import {renderOfflineWDRC} from "./offline-wdrc.mjs";
import {fixtureTargets} from "./offline-wdrc.characterization.mjs";

const config=(mode="hard",ear="left")=>({
  sampleRate:16000,ear,crossoverMode:mode,syntheticRmsDbFSAt65DbSPL:-37,
  targets:fixtureTargets(f=>f>=2000?[16,10,4]:[12,7,3]),
  limiterCeiling:0.2,
});
const tone=n=>Float32Array.from({length:n},(_,i)=>
  0.025*Math.sin(2*Math.PI*1187*i/16000)+0.012*Math.sin(2*Math.PI*3670*i/16000));
function concat(parts){
  const out=new Float32Array(parts.reduce((n,v)=>n+v.length,0));let at=0;
  for(const p of parts){out.set(p,at);at+=p.length;}
  return out;
}
function runContinuous(mode,ear,pattern){
  const input=tone(8191),opts=config(mode,ear);
  const timed=createOfflineTimedWDRC(opts);
  const chunks=[];let index=0,p=0;
  while(index<input.length){
    const end=Math.min(input.length,index+pattern[p++%pattern.length]);
    const slice=input.slice(index,end),copy=slice.slice();
    const output=timed.push({startSample:index,samples:slice});
    chunks.push(output);
    assert.deepEqual(slice,copy,"caller PCM must not be modified");
    assert.equal(timed.diagnostics.expectedSample,end);
    assert(!timed.diagnostics.faulted);
    assert.equal(timed.diagnostics.schema,OFFLINE_TIMED_GUARD_SCHEMA);
    index=end;
  }
  chunks.push(timed.finish());
  const actual=concat(chunks);
  const expected=renderOfflineWDRC({...opts,samples:input}).samples;
  assert.deepEqual(actual,expected,"timestamped guard must preserve bitwise offline reference");
  assert(timed.diagnostics.finalized);
  assert(actual.every(v=>Math.abs(v)<=opts.limiterCeiling && Number.isFinite(v)));
  assert.throws(()=>timed.push({startSample:index,samples:Float32Array.of(0)}),/reset required/);
}
test("valid timestamped chunks match reference exactly across hard/smooth and L/R",()=>{
  for(const mode of ["hard","smooth"])for(const ear of ["left","right"]){
    runContinuous(mode,ear,[3,7,256,1,2048,511,9,4096]);
  }
});
test("missing samples fault and flush pending DSP state; new data rejected until reset",()=>{
  const timed=createOfflineTimedWDRC(config());
  timed.push({startSample:0,samples:tone(1400)});
  assert.throws(()=>timed.push({startSample:1500,samples:tone(256)}),/missing-samples/);
  assert.equal(timed.diagnostics.expectedSample,1400);
  assert.equal(timed.diagnostics.faultReason,"missing-samples");
  assert.equal(timed.diagnostics.frames,0,"pending DSP state discarded on fault");
  assert.equal(timed.diagnostics.maxPendingSamplesObserved,0);
  assert.throws(()=>timed.finish(),/reset required/);
  assert.throws(()=>timed.push({startSample:1400,samples:tone(256)}),/reset required/);
  timed.reset();
  assert.equal(timed.diagnostics.expectedSample,0);
  assert.equal(timed.diagnostics.resetCount,1);
  assert.equal(timed.diagnostics.faultCount,1);
  assert.equal(timed.diagnostics.faultReason,null);
  const input=tone(2400);
  assert.deepEqual(concat([timed.push({startSample:0,samples:input}),timed.finish()]),
    renderOfflineWDRC({...config(),samples:input}).samples);
});
test("overlap, retransmission, reordering and wrong initial timestamp are all fail-stop",()=>{
  for(const startSample of [0,99,200,511]){
    const stream=createOfflineTimedWDRC(config());
    stream.push({startSample:0,samples:tone(256)});
    if(startSample===511){
      assert.throws(()=>stream.push({startSample,samples:tone(256)}),/missing-samples/);
    } else {
      assert.throws(()=>stream.push({startSample,samples:tone(256)}),/overlap-or-reorder/);
    }
    assert(stream.diagnostics.faulted);
  }
  const stream=createOfflineTimedWDRC(config());
  assert.throws(()=>stream.push({startSample:256,samples:tone(256)}),/missing-samples/);
});
test("logical capture-clock detects underrun and regression, not wall-clock scheduling",()=>{
  const stream=createOfflineTimedWDRC(config(),{deadlineSlackSamples:256});
  assert.equal(DEFAULT_DEADLINE_SLACK_SAMPLES,256);
  stream.push({startSample:0,samples:tone(512)});
  const a=stream.observeCaptureClock(700);
  assert.equal(a.leadSamples,188);
  assert.throws(()=>stream.observeCaptureClock(769),/simulated-underrun/);
  assert(stream.diagnostics.faulted);
  assert.equal(stream.diagnostics.faultReason,"simulated-underrun");
  assert.throws(()=>stream.push({startSample:512,samples:tone(256)}),/reset required/);
  stream.reset();
  stream.observeCaptureClock(100);
  assert.throws(()=>stream.observeCaptureClock(99),/clock-regression/);
});
test("explicit underrun and invalid simulated clock both require reset",()=>{
  const stream=createOfflineTimedWDRC(config());
  assert.throws(()=>stream.signalUnderrun(),/explicit-underrun/);
  assert(stream.diagnostics.faulted);
  stream.reset();
  assert.throws(()=>stream.observeCaptureClock(-1),/invalid-clock/);
  stream.reset();
  assert.throws(()=>stream.observeCaptureClock(NaN),/invalid-clock/);
});
test("bad timestamp, sample type, PCM and overflow never return new output",()=>{
  for(const packet of [
    null, {}, {startSample:0,samples:new Float32Array(0)},
    {startSample:-1,samples:tone(256)},
    {startSample:0.5,samples:tone(256)},
    {startSample:"0",samples:tone(256)},
    {startSample:0,samples:[0,1]},
    {startSample:0,samples:Float32Array.of(NaN)},
    {startSample:0,samples:Float32Array.of(17)},
    {startSample:0,samples:new Float32Array(4097)},
    {startSample:0,samples:tone(2),unsafe:true},
  ]){
    const stream=createOfflineTimedWDRC(config());
    assert.throws(()=>stream.push(packet));
    assert(stream.diagnostics.faulted,JSON.stringify(packet));
    assert.equal(stream.diagnostics.packets,0);
    assert.equal(stream.diagnostics.expectedSample,0);
  }
  const stream=createOfflineTimedWDRC(config());
  stream.reset();
  assert.throws(()=>stream.push({startSample:Number.MAX_SAFE_INTEGER,samples:Float32Array.of(0)}));
});
test("exact deadline threshold, strict configuration, and double finish safety",()=>{
  assert.throws(()=>createOfflineTimedWDRC(config(),{deadlineSlackSamples:-1}));
  assert.throws(()=>createOfflineTimedWDRC(config(),{deadlineSlackSamples:1.2}));
  assert.throws(()=>createOfflineTimedWDRC(config(),{deadlineSlackSamples:4097}));
  const stream=createOfflineTimedWDRC(config(),{deadlineSlackSamples:0});
  stream.push({startSample:0,samples:tone(1024)});
  stream.observeCaptureClock(1024);
  assert.throws(()=>stream.observeCaptureClock(1025),/simulated-underrun/);
  stream.reset();
  assert.throws(()=>stream.finish(),/invalid-finalization/);
  stream.reset();
  stream.push({startSample:0,samples:tone(2048)});
  stream.finish();
  assert.throws(()=>stream.finish(),/reset required/);
});
test("sustained 200k-sample logical-clock sequence uses fixed DSP rings",()=>{
  const stream=createOfflineTimedWDRC(config("smooth","right"));
  const chunk=tone(1024);
  for(let n=0;n<200;n++){
    stream.push({startSample:n*chunk.length,samples:chunk});
    stream.observeCaptureClock((n+1)*chunk.length);
  }
  const tail=stream.finish();
  assert(tail.length>0);
  assert.equal(stream.diagnostics.expectedSample,204800);
  assert.equal(stream.diagnostics.inputCapacitySamples,1024);
  assert.equal(stream.diagnostics.wolaCapacitySamples,1024);
  assert(stream.diagnostics.maxPendingSamplesObserved<=1024);
  assert.equal(stream.diagnostics.packets,200);
  assert.equal(stream.diagnostics.faultCount,0);
});
test("extreme PCM cannot bypass final limiter in either crossover mode",()=>{
  for(const mode of ["hard","smooth"]){
    const stream=createOfflineTimedWDRC(config(mode));
    const chunk=Float32Array.from({length:3072},(_,i)=>8*Math.sin(i*0.7));
    const output=concat([stream.push({startSample:0,samples:chunk}),stream.finish()]);
    assert(output.every(v=>Number.isFinite(v)&&Math.abs(v)<=0.2));
    assert(stream.diagnostics.limitedSamples>0);
  }
});
