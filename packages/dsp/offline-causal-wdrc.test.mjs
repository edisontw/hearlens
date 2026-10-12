import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createOfflineCausalResearchDSP} from "./offline-causal-wdrc.mjs";

const sinusoid = (n, hz, rate, amplitude) =>
  Float32Array.from({length:n}, (_,i)=>amplitude*Math.sin(2*Math.PI*hz*i/rate));
const config={sampleRate:48000,ear:"left",crossoversHz:[350,700,1400,2800,5600],limiterCeiling:0.8};

test("SW2 causal identity: six bands, exact chunk output and zero sample lookahead",()=>{
  const pcm=Float32Array.from({length:8192},(_,i)=>0.05*Math.sin(i*0.117)+0.025*Math.cos(i*0.023));
  const processor=createOfflineCausalResearchDSP(config),out=new Float32Array(pcm.length);
  const sizes=[1,255,256,3,1024,2048,4605];
  let offset=0;
  for(const size of sizes){
    assert.equal(processor.processInto(pcm.subarray(offset,offset+size),out.subarray(offset,offset+size)),size);
    offset+=size;
  }
  assert.equal(offset,pcm.length);
  let maxError=0;
  for(let i=0;i<pcm.length;i++)maxError=Math.max(maxError,Math.abs(out[i]-pcm[i]));
  assert(maxError<1e-6,"identity error "+maxError);
  assert.equal(processor.diagnostics.acceptedSamples,8192);
  assert.equal(processor.diagnostics.emittedSamples,8192);
  assert.equal(processor.diagnostics.algorithmicLookaheadSamples,0);
  assert.equal(processor.diagnostics.bluetoothE2eMeasured,false);
  assert.equal(processor.diagnostics.acousticMpoMeasured,false);
  assert.equal(processor.diagnostics.limitedSamples,0);
});

test("SW2 impulse emitted with first sample; no block buffering",()=>{
  const p=createOfflineCausalResearchDSP(config);
  const input=new Float32Array(64);input[0]=0.32;
  const out=new Float32Array(64);
  assert.equal(p.processInto(input,out),64);
  assert(Math.abs(out[0]-0.32)<1e-6);
  for(let i=1;i<out.length;i++)assert(Math.abs(out[i])<1e-6);
});

test("SW2 eight bands and per-ear parameter independence, reproducible after reset",()=>{
  const bounds=[300,500,800,1200,1900,3000,4600];
  const left=createOfflineCausalResearchDSP({sampleRate:48000,ear:"left",crossoversHz:bounds,
    baseGainsDb:[-4,-3,-2,-1,0,2,5,8]});
  const right=createOfflineCausalResearchDSP({sampleRate:48000,ear:"right",crossoversHz:bounds,
    baseGainsDb:[8,5,2,0,-1,-2,-3,-4]});
  const pcm=sinusoid(4096,6500,48000,0.02),l=new Float32Array(pcm.length),r=new Float32Array(pcm.length);
  left.processInto(pcm,l);right.processInto(pcm,r);
  const diff=l.reduce((sum,x,i)=>sum+Math.abs(x-r[i]),0)/pcm.length;
  assert(diff>1e-4,"per-ear difference "+diff);
  assert.equal(left.diagnostics.bands,8);
  assert.equal(right.diagnostics.ear,"right");
  left.reset();right.reset();
  const l2=new Float32Array(pcm.length),r2=new Float32Array(pcm.length);
  left.processInto(pcm,l2);right.processInto(pcm,r2);
  assert.deepEqual(l2,l);assert.deepEqual(r2,r);
});

test("SW2 offline synthetic WDRC gives weaker stimulus more gain, not verified hearing benefit",()=>{
  const cfg={...config,baseGainsDb:Array(6).fill(10),ratios:Array(6).fill(2),
    thresholdDbfs:-46,attackMs:5,releaseMs:80};
  function signalGain(amplitude){
    const p=createOfflineCausalResearchDSP(cfg),input=sinusoid(24000,1100,48000,amplitude),
      out=new Float32Array(input.length);
    p.processInto(input,out);
    function rms(a){let power=0;for(let x of a)power+=x*x;return Math.sqrt(power/a.length)}
    return 20*Math.log10(rms(out.subarray(16000))/rms(input.subarray(16000)));
  }
  const weak=signalGain(0.002),loud=signalGain(0.2);
  assert(weak>loud+3,"weak "+weak+" loud "+loud);
  assert(loud<10);
});

test("SW2 final digital ceiling enforced; invalid chunks reject before mutation and reset required",()=>{
  const p=createOfflineCausalResearchDSP({...config,baseGainsDb:Array(6).fill(12),limiterCeiling:0.25});
  const input=Float32Array.from({length:2048},(_,i)=>1.6*Math.sin(i*.09));
  const dst=new Float32Array(input.length);p.processInto(input,dst);
  assert(dst.every(v=>Number.isFinite(v)&&Math.abs(v)<=0.25));
  assert(p.diagnostics.limitedSamples>0);
  assert.equal(p.diagnostics.acousticMpoMeasured,false);
  const before=dst.slice(),bad=new Float32Array(12);bad[9]=NaN;
  assert.throws(()=>p.processInto(bad,dst),/invalid synthetic PCM/);
  assert.deepEqual(dst,before);
  assert.equal(p.diagnostics.faulted,true);
  assert.throws(()=>p.processInto(new Float32Array(1),dst),/reset required/);
  p.reset();assert.equal(p.diagnostics.faulted,false);
  assert.equal(p.processInto(new Float32Array(1),dst),1);
});

test("SW2 undersized or aliased buffers fail without partial PCM writes",()=>{
  const p=createOfflineCausalResearchDSP(config),input=new Float32Array(128),small=new Float32Array(127);
  small.fill(0.5);
  assert.throws(()=>p.processInto(input,small),/independent Float32/);
  assert(small.every(v=>v===0.5));
  assert.equal(p.diagnostics.acceptedSamples,0);
  p.reset();
  assert.throws(()=>p.processInto(input,input),/independent Float32/);
  assert(p.diagnostics.faulted);
});

test("SW2 validates rate, filterbank and strictly research target bounds",()=>{
  assert.throws(()=>createOfflineCausalResearchDSP({...config,sampleRate:44100}),/sampleRate/);
  assert.throws(()=>createOfflineCausalResearchDSP({...config,ear:"both"}),/ear/);
  assert.throws(()=>createOfflineCausalResearchDSP({...config,crossoversHz:[350,700]}),/crossovers/);
  assert.throws(()=>createOfflineCausalResearchDSP({...config,crossoversHz:[350,700,1400,2800,2800]}),/strictly increase/);
  assert.throws(()=>createOfflineCausalResearchDSP({...config,baseGainsDb:[0]}),/one value/);
  assert.throws(()=>createOfflineCausalResearchDSP({...config,ratios:[1,2,1,1,1,0]}),/ratios/);
  assert.throws(()=>createOfflineCausalResearchDSP({...config,limiterCeiling:1}),/limiterCeiling/);
});

test("SW2 module exposes no browser/native live audio/network device access",()=>{
  const source=readFileSync(new URL("./offline-causal-wdrc.mjs",import.meta.url),"utf8");
  for(const forbidden of [/\bAudioTrack\b/,/\bAudioRecord\b/,/\bgetUserMedia\b/,
    /\bAudioContext\b/,/\bWebSocket\b/,/\bfetch\s*\(/,/\bAudioWorklet\b/]){
    assert.doesNotMatch(source,forbidden);
  }
});
