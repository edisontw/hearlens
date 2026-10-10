import assert from "node:assert/strict";
import test from "node:test";
import { renderOfflineWDRC } from "./offline-wdrc.mjs";
import { fixtureTargets, testSine, projectedGainDb } from "./offline-wdrc.characterization.mjs";

const sampleRate = 16000;
const targets = fixtureTargets(f => f >= 2000 ? [9,9,9] : [0,0,0]);
const run = (frequencyHz, mode, gains = targets) => {
  const samples = testSine(frequencyHz,0.008,32768,sampleRate);
  const out = renderOfflineWDRC({
    samples,sampleRate,ear:"left",targets:gains,
    syntheticRmsDbFSAt65DbSPL:-37,crossoverMode:mode,limiterCeiling:0.95
  });
  return projectedGainDb(samples,out.samples,frequencyHz,24576,31744);
};
test("smooth crossover reduces 1410–1420 Hz gain discontinuity",()=>{
 const hard=Math.abs(run(1420,"hard")-run(1410,"hard"));
 const smooth=Math.abs(run(1420,"smooth")-run(1410,"smooth"));
 assert(hard>2.5, "retain matched historical hard-baseline reproduction");
 assert(smooth<hard/2, JSON.stringify({hard,smooth}));
 assert(smooth<1.5, JSON.stringify({hard,smooth}));
});
test("smooth mode preserves identity for zero-gain noisy and impulsive samples",()=>{
 const zero=fixtureTargets();
 for(const signal of [
  Float32Array.from({length:8192},(_,i)=>0.01*Math.sin(2*Math.PI*i*271/16000)),
  Float32Array.from({length:8192},(_,i)=>i===0?0.4:i===8191?-0.3:0)
 ]){
  const out=renderOfflineWDRC({samples:signal,sampleRate,ear:"left",targets:zero,syntheticRmsDbFSAt65DbSPL:-37,crossoverMode:"smooth"});
  let error=0;for(let i=0;i<signal.length;i++)error=Math.max(error,Math.abs(out.samples[i]-signal[i]));
  assert(error<1e-6,error);
 }
});
test("smooth mode preserves independent ears and final postmix limiter",()=>{
 const stereo=fixtureTargets(f=>[80,80,80]);
 const signal=Float32Array.from({length:8192},(_,i)=>8*Math.sin(2*Math.PI*i*1000/16000));
 for(const ear of ["left","right"]){
  const out=renderOfflineWDRC({samples:signal,sampleRate,ear,targets:stereo,syntheticRmsDbFSAt65DbSPL:-37,crossoverMode:"smooth",limiterCeiling:0.1});
  assert(out.diagnostics.limitedSamples>0);
  assert(out.samples.every(v=>Number.isFinite(v)&&Math.abs(v)<=0.1));
 }
});
test("uniform gains remain flat for smooth vs hard across center frequencies",()=>{
 const uniform=fixtureTargets(()=>[6,6,6]);
 for(const f of [250,500,1000,2000,4000,6000])assert(Math.abs(run(f,"hard",uniform)-run(f,"smooth",uniform))<0.2);
});
test("invalid crossover rejected",()=>{
 assert.throws(()=>renderOfflineWDRC({samples:new Float32Array(1024),sampleRate,ear:"left",targets,syntheticRmsDbFSAt65DbSPL:-37,crossoverMode:"unsafe"}));
});
