#!/usr/bin/env node
/**
 * Research-only offline throughput probe. Wall-clock CPU and JS heap are
 * runner-specific and MUST NOT be treated as live callback/latency guarantees.
 */
import {performance} from "node:perf_hooks";
import {createOfflineTimedWDRC} from "../packages/dsp/offline-wdrc.timed.mjs";
import {fixtureTargets} from "../packages/dsp/offline-wdrc.characterization.mjs";

const args=process.argv.slice(2);
const seconds=args.length===0?6:Number(args[0]);
const sampleRate=args.length<2?16000:Number(args[1]);
const chunkSamples=args.length<3?256:Number(args[2]);
if(!Number.isInteger(seconds)||seconds<1||seconds>12||
   ![16000,24000,48000].includes(sampleRate)||
   ![128,256,1024,4096].includes(chunkSamples)){
  console.error("Usage: node tools/benchmark-offline-stream.mjs [seconds 1–12] [sampleRate 16000|24000|48000] [chunk 128|256|1024|4096]");
  process.exitCode=2;
}else{
  const config={
    sampleRate,ear:"left",crossoverMode:"smooth",targets:fixtureTargets(f=>f>=2000?[12,8,4]:[9,6,3]),
    syntheticRmsDbFSAt65DbSPL:-37,limiterCeiling:0.5,
  };
  const stream=createOfflineTimedWDRC(config,{deadlineSlackSamples:chunkSamples});
  const samples=Float32Array.from({length:chunkSamples},(_,i)=>0.015*Math.sin(2*Math.PI*1000*i/sampleRate));
  const totalSamples=seconds*sampleRate;
  const pushMs=[];
  let count=0,outputSamples=0,heapHigh=process.memoryUsage().heapUsed;
  const heapBefore=heapHigh;
  const start=performance.now();
  while(count<totalSamples){
    const length=Math.min(chunkSamples,totalSamples-count);
    const payload=length===chunkSamples?samples:samples.slice(0,length);
    const t0=performance.now();
    const output=stream.push({startSample:count,samples:payload});
    const elapsed=performance.now()-t0;
    pushMs.push(elapsed);
    outputSamples+=output.length;
    count+=length;
    stream.observeCaptureClock(count);
    if(pushMs.length%32===0)heapHigh=Math.max(heapHigh,process.memoryUsage().heapUsed);
  }
  outputSamples+=stream.finish().length;
  const totalMs=performance.now()-start;
  const sorted=[...pushMs].sort((a,b)=>a-b);
  const rank=p=>sorted[Math.min(sorted.length-1,Math.max(0,Math.ceil(p*sorted.length)-1))];
  const heapAfter=process.memoryUsage().heapUsed;
  heapHigh=Math.max(heapHigh,heapAfter);
  const data={
    schema:"hearlens-m03i-offline-throughput-v1",
    offlineSyntheticOnly:true,nonGatingEnvironmentDependent:true,
    sampleRateHz:sampleRate,clipDurationSeconds:seconds,chunkSamples,
    chunks:pushMs.length,totalInputSamples:totalSamples,totalOutputSamples:outputSamples,
    cpuWallMs:Number(totalMs.toFixed(3)),
    pushP50Ms:Number(rank(0.5).toFixed(3)),
    pushP95Ms:Number(rank(0.95).toFixed(3)),
    maxPushMs:Number(sorted.at(-1).toFixed(3)),
    heapBeforeBytes:heapBefore,heapHighObservedBytes:heapHigh,
    heapAfterBytes:heapAfter,
    fixedInputRingSamples:stream.diagnostics.inputCapacitySamples,
    fixedWolaRingSamples:stream.diagnostics.wolaCapacitySamples,
    faultCount:stream.diagnostics.faultCount,
    note:"Not microphone-to-ear latency, production real-time determinism, callback allocation or acoustic safety",
  };
  if(outputSamples!==totalSamples||stream.diagnostics.faultCount!==0)throw new Error("offline benchmark data mismatch");
  console.log(JSON.stringify(data,null,2));
}
