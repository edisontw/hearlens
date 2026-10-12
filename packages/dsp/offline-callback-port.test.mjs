import assert from "node:assert/strict";
import test from "node:test";
import {createOfflineTimedWDRC} from "./offline-wdrc.timed.mjs";
import {renderOfflineWDRC} from "./offline-wdrc.mjs";
import {createOfflineMockHearingPort} from "./offline-callback-port.mjs";
import {fixtureTargets} from "./offline-wdrc.characterization.mjs";

const cfg=(ear="left",mode="hard",sampleRate=16000)=>({
  ear,crossoverMode:mode,sampleRate,limiterCeiling:0.15,
  syntheticRmsDbFSAt65DbSPL:-37,
  targets:fixtureTargets(f=>f>=2000?[12,7,3]:[9,5,2]),
});
const tone=(length,sr)=>Float32Array.from({length},(_,i)=>
  .021*Math.sin(2*Math.PI*1000*i/sr)+.007*Math.sin(2*Math.PI*3400*i/sr));
const join=parts=>{
  const all=new Float32Array(parts.reduce((n,p)=>n+p.length,0));
  let cursor=0;for(const p of parts){all.set(p,cursor);cursor+=p.length;}
  return all;
};
function armed(port){
  port.connect({kind:"wired-headphones",id:"mock-usbc-1"});
  port.attestMockCalibration({
    routeId:"mock-usbc-1",calibrationId:"fixture-cal",profileId:"fixture-profile",syntheticOnly:true,
  });
  port.arm({routeId:"mock-usbc-1",calibrationId:"fixture-cal",profileId:"fixture-profile",explicitUserStart:true});
  return port;
}
const observedRoute={kind:"wired-headphones",id:"mock-usbc-1"};

test("M03L timed processInto matches full-clip numerical oracle across ears, modes and rates",()=>{
  for(const sr of [16000,24000,48000])
    for(const ear of ["left","right"])
      for(const mode of ["hard","smooth"]){
        const config=cfg(ear,mode,sr),input=tone(9543,sr),timed=createOfflineTimedWDRC(config);
        const dest=new Float32Array(4352),parts=[];
        let cursor=0,i=0;
        const sizes=[1,255,256,257,4096,1023,3,127,400];
        while(cursor<input.length){
          const frag=input.subarray(cursor,Math.min(input.length,cursor+sizes[i++%sizes.length]));
          const need=timed.requiredOutputSamples(frag.length);
          dest.fill(.5);
          const n=timed.processInto(cursor,frag,dest);
          assert.equal(n,need);
          assert(dest.subarray(n).every(v=>v===.5),"untouched suffix");
          parts.push(dest.slice(0,n));
          cursor+=frag.length;
          timed.observeCaptureClock(cursor);
        }
        parts.push(timed.finish());
        const oracle=renderOfflineWDRC({...config,samples:input});
        assert.deepEqual(join(parts),oracle.samples,sr+" "+ear+" "+mode);
        assert.equal(timed.diagnostics.faultCount,0);
      }
});

test("M03L timed gap / overlap / invalid PCM clears destination and latches fail-stop",()=>{
  for(const bad of [
    t=>t.processInto(1030,new Float32Array(8),new Float32Array(4352)),
    t=>t.processInto(1010,new Float32Array(8),new Float32Array(4352)),
    t=>t.processInto(NaN,new Float32Array(8),new Float32Array(4352)),
    t=>{const x=new Float32Array(8);x[7]=NaN;
      t.processInto(1024,x,new Float32Array(4352));},
  ]){
    const t=createOfflineTimedWDRC(cfg());
    const out=new Float32Array(4352);
    t.processInto(0,new Float32Array(1024),out);
    assert.throws(()=>bad(t),/fault/);
    assert(t.diagnostics.faulted);
    assert.throws(()=>t.processInto(1024,new Float32Array(8),out),/reset required/);
    t.reset();
    assert.equal(t.processInto(0,new Float32Array(1024),out),256);
  }
  const t=createOfflineTimedWDRC(cfg());
  const out=new Float32Array(4352);out.fill(.9);
  assert.throws(()=>t.processInto(1,new Float32Array(1024),out),/missing-samples/);
  assert(out.every(x=>x===0),"fails before exposing stale/partial output");
  assert.equal(t.diagnostics.expectedSample,0);
});

test("M03L DSP destination failure scrubs even if destination contains previous PCM",()=>{
  const t=createOfflineTimedWDRC(cfg());
  const out=new Float32Array(255);out.fill(.7);
  assert.throws(()=>t.processInto(0,new Float32Array(1024),out),/underlying-dsp-rejected/);
  assert(out.every(x=>x===0));
  assert.equal(t.diagnostics.faulted,true);
  assert.equal(t.diagnostics.expectedSample,0);
});

test("M03L mock port exposes no PCM, no callback/sink and nothing before explicit arm",()=>{
  const p=createOfflineMockHearingPort(cfg());
  assert.equal("finish" in p,false);
  assert.equal("push" in p,false);
  assert.equal("output" in p,false);
  assert.equal("sink" in p,false);
  assert.equal("processInto" in p,false);
  assert.equal(p.diagnostics.pcmOutputExposed,false);
  assert.equal(p.diagnostics.realHardwareMuteImplemented,false);
  assert.equal(p.diagnostics.physicalRouteVerified,false);
  p.connect(observedRoute);
  assert.throws(()=>p.process({startSample:0,samples:new Float32Array(1024),clockSample:1024,observedRoute}),/no-mock-authorization/);
  assert(p.diagnostics.faulted);
  assert.equal(p.diagnostics.candidateSamples,0);
  assert.throws(()=>armed(p),/reset required/);
});

test("M03L authorized mock candidate progression, monotonic clock and ramp; still NO PCM",()=>{
  const p=armed(createOfflineMockHearingPort(cfg(),{rampSamples:1024}));
  assert.equal(p.diagnostics.mockRampFactor,0);
  const samples=tone(256,16000);
  for(let k=0;k<9;k++){
    const report=p.process({startSample:k*256,samples,clockSample:(k+1)*256,observedRoute});
    assert.equal(report.kind,"synthetic-metadata-no-pcm");
    assert.equal(Object.hasOwn(report,"pcm"),false);
    assert.equal(Object.hasOwn(report,"output"),false);
  }
  assert.equal(p.diagnostics.callbacks,9);
  assert(p.diagnostics.candidateSamples>0);
  assert(p.diagnostics.peakObserved<=cfg().limiterCeiling);
  assert.equal(p.diagnostics.stage,"active");
  assert.equal(p.diagnostics.mockRampFactor,1);
  assert.equal(p.diagnostics.acousticMpoVerified,false);
});

test("M03L route-disconnect, changed route, speaker, clock gap, time regression, interruption and underrun latch",()=>{
  const fixtures=[
    p=>p.disconnect(),
    p=>p.process({startSample:1024,samples:new Float32Array(256),clockSample:1280,observedRoute:{kind:"speaker",id:"mock-usbc-1"}}),
    p=>p.process({startSample:1024,samples:new Float32Array(256),clockSample:1280,observedRoute:{kind:"wired-headphones",id:"changed"}}),
    p=>p.process({startSample:1025,samples:new Float32Array(256),clockSample:1281,observedRoute}),
    p=>p.process({startSample:1024,samples:new Float32Array(256),clockSample:-1,observedRoute}),
    p=>p.process({startSample:1024,samples:new Float32Array(256),clockSample:4096,observedRoute}),
    p=>p.signalInterruption(),
    p=>p.signalUnderrun(),
  ];
  for(const fault of fixtures){
    const p=armed(createOfflineMockHearingPort(cfg()));
    p.process({startSample:0,samples:new Float32Array(1024),clockSample:1024,observedRoute});
    const count=p.diagnostics.candidateSamples;
    assert(count>0);
    assert.throws(()=>fault(p),/fault/);
    assert.equal(p.diagnostics.faulted,true);
    assert.equal(p.diagnostics.syntheticCandidateAuthorized,false);
    assert.equal(p.diagnostics.mockRampFactor,0);
    assert.equal(p.diagnostics.candidateSamples,count,"no candidate after failed operation");
    assert.throws(()=>p.process({startSample:0,samples:new Float32Array(1024),clockSample:1024,observedRoute}),/reset required/);
  }
});

test("M03L reconnect is never automatic; requires reset, mock re-attestation and explicit arm",()=>{
  const p=armed(createOfflineMockHearingPort(cfg()));
  p.process({startSample:0,samples:new Float32Array(1024),clockSample:1024,observedRoute});
  assert.throws(()=>p.disconnect());
  assert.throws(()=>p.connect(observedRoute),/reset required/);
  p.reset();
  assert.equal(p.diagnostics.candidateSamples,0);
  assert.equal(p.diagnostics.stage,"muted");
  p.connect(observedRoute);
  assert.throws(()=>p.arm({routeId:"mock-usbc-1",calibrationId:"fixture-cal",profileId:"fixture-profile",explicitUserStart:true}));
  assert(p.diagnostics.faulted);
  p.reset();
  armed(p);
  assert.equal(p.diagnostics.stage,"ramping");
  assert.equal(p.diagnostics.mockRampFactor,0);
  const r=p.process({startSample:0,samples:new Float32Array(1024),clockSample:1024,observedRoute});
  assert.equal(r.candidateSamples,256);
});

test("M03L invalid route, missing per-chunk observation or malformed clock fail closed",()=>{
  const p=createOfflineMockHearingPort(cfg());
  assert.throws(()=>p.connect({kind:"bluetooth",id:"wireless"}));
  assert(p.diagnostics.faulted);
  p.reset();
  armed(p);
  assert.throws(()=>p.process({startSample:0,samples:new Float32Array(1024),clockSample:1024}),/mock-route-lost-or-switched/);
  assert.equal(p.diagnostics.candidateSamples,0);
  p.reset();
  armed(p);
  assert.throws(()=>p.process({startSample:0,samples:new Float32Array(1024),clockSample:NaN,observedRoute}),/clock-or-dsp-fault/);
  assert.equal(p.diagnostics.candidateSamples,0);
});
