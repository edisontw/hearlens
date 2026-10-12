#!/usr/bin/env node
/**
 * Deterministic SW2 analytical/offline report.
 * --benchmark optionally prints Node host timing; not physical phone or BT delay.
 */
import {performance} from "node:perf_hooks";
import {createOfflineCausalResearchDSP} from "../packages/dsp/offline-causal-wdrc.mjs";
import {createOfflineStatefulWDRC} from "../packages/dsp/offline-wdrc.stateful.mjs";
import {fixtureTargets} from "../packages/dsp/offline-wdrc.characterization.mjs";

const sampleRate=48000;
const crossovers=[350,700,1400,2800,5600];
const stftFrameSamples=1024,stftHopSamples=256;
const stftLookaheadSamples=stftFrameSamples-stftHopSamples;
const r4=n=>Number(n.toFixed(4));

function responseDb(hz,gainDb){
  const p=createOfflineCausalResearchDSP({
    sampleRate,crossoversHz:crossovers,baseGainsDb:gainDb,limiterCeiling:0.8
  });
  const length=12000,input=Float32Array.from({length},(_,i)=>0.012*Math.sin(2*Math.PI*hz*i/sampleRate));
  const out=new Float32Array(length);p.processInto(input,out);
  let powerIn=0,powerOut=0;
  // after transient, sample-domain energy (not synchronized E2E phase)
  for(let i=4800;i<length;i++){powerIn+=input[i]*input[i];powerOut+=out[i]*out[i]}
  return r4(10*Math.log10(powerOut/powerIn));
}
function impulseProbe(gains){
  const p=createOfflineCausalResearchDSP({
    sampleRate,crossoversHz:crossovers,baseGainsDb:gains,limiterCeiling:0.8});
  const input=new Float32Array(384),out=new Float32Array(384);input[0]=0.05;
  p.processInto(input,out);
  let peak=0,idx=0,energy=0,weighted=0;
  for(let i=0;i<out.length;i++){
    const a=Math.abs(out[i]);
    if(a>peak){peak=a;idx=i}
    energy+=out[i]*out[i];weighted+=i*out[i]*out[i];
  }
  return {peakIndexSamples:idx,impulseEnergyCentroidSamples:r4(weighted/energy),
    caveat:"energy centroid is NOT frequency-specific group delay or total physical latency"};
}

const frequencies=[250,500,700,1000,1400,2000,2800,4000,5600,8000];
const shaped=[0,2,4,6,3,0];
const report={
  schema:"hearlens-sw2-causal-software-ceiling-v1",
  offlineSyntheticOnly:true,liveAudioOutput:false,
  platformInputObservation:{device:"moto g62 5G",androidApi:33,
    observedClientAndDeviceInputHz:48000,channels:1,
    note:"These values were supplied by SW1 field log, not measured by this offline tool"},
  referenceStft:{frameSamples:stftFrameSamples,hopSamples:stftHopSamples,
    algorithmicLookaheadSamples:stftLookaheadSamples,
    algorithmicLookaheadMs:r4(1000*stftLookaheadSamples/sampleRate),
    note:"Known M03 H-L algorithmic lookahead only, excludes sample capture, processing, buffers, BT"},
  causalCandidate:{
    bands:6,crossoversHz:crossovers,algorithmicLookaheadSamples:0,
    algorithmicLookaheadMs:0,
    equalGainIdentityImpulse:impulseProbe(Array(6).fill(0)),
    shapedGainsImpulse:impulseProbe(shaped),
    flatIdentityToneResponseDb:frequencies.map(hz=>({hz,gainDb:responseDb(hz,Array(6).fill(0))})),
    shapedToneResponseDb:frequencies.map(hz=>({hz,gainDb:responseDb(hz,shaped)})),
    note:"No future input buffering; IIR filtering still introduces phase/frequency-dependent group delay, measured inadequately by impulse peak or tone RMS alone. Neither implementation is certified for hearing output."
  },
  measuredAcousticEndToEndBluetoothLatencyMs:null,
  measuredPhysicalOutputRouteAndHardMute:false,
  measuredPerEarSPLorMPO:false,
  hypotheticalLatencyEquation:
    "T_total=T_input_capture+T_input_OS+T_DSP_buffer+T_DSP_compute+T_output_OS+T_BT_codec_transport+T_earbud_render",
  decision:"GO for software-only filter/phase/artifact comparison; NO-GO for human ear playback or claims of calibrated acoustic safety"
};

function percentile(data,fraction){
  const sorted=data.slice().sort((a,b)=>a-b);
  return r4(sorted[Math.max(0,Math.ceil(sorted.length*fraction)-1)]);
}
function timeProcessor(label,factory){
  const p=factory(),input=Float32Array.from({length:256},(_,i)=>0.03*Math.sin(2*Math.PI*1100*i/sampleRate));
  const out=new Float32Array(512),times=[];
  for(let i=0;i<375;i++){
    const start=performance.now();
    const n=p.processInto(input,out);
    times.push(performance.now()-start);
    if(n<0||n>out.length)throw Error("unexpected synthetic output size");
  }
  return {processor:label,callbacks:375,chunkSamples:256,
    p50HostCallbackMs:percentile(times,.5),p95HostCallbackMs:percentile(times,.95),
    maxHostCallbackMs:percentile(times,1)};
}
if(process.argv.includes("--benchmark")){
  const stftConfig={sampleRate,ear:"left",crossoverMode:"smooth",
    syntheticRmsDbFSAt65DbSPL:-37,limiterCeiling:0.8,
    targets:fixtureTargets(()=>[0,0,0])};
  report.nonGatingHostTiming={
    nodeVersion:process.version,platform:process.platform,architecture:process.arch,
    probes:[
      timeProcessor("M03_STFT_reference",()=>createOfflineStatefulWDRC(stftConfig)),
      timeProcessor("SW2_one_pole_causal",()=>createOfflineCausalResearchDSP({sampleRate,crossoversHz:crossovers}))
    ],
    warning:"Node host wall-time is not Android callback scheduling or Bluetooth acoustic latency; STFT and causal filters differ in algorithm, parameters and behavior; values are not validated product speed ratios."
  };
}
console.log(JSON.stringify(report,null,2));
