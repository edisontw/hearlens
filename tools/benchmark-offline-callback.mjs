#!/usr/bin/env node
/** M03K synthetic-only CPU/heap observation; not a realtime or acoustic gate. */
import {performance} from "node:perf_hooks";
import {createOfflineStatefulWDRC} from "../packages/dsp/offline-wdrc.stateful.mjs";
import {fixtureTargets} from "../packages/dsp/offline-wdrc.characterization.mjs";

const seconds=process.argv[2]===undefined?6:Number(process.argv[2]);
const sampleRate=process.argv[3]===undefined?16000:Number(process.argv[3]);
if(!Number.isInteger(seconds)||seconds<1||seconds>12||
   ![16000,24000,48000].includes(sampleRate)){
  console.error("Usage: node tools/benchmark-offline-callback.mjs [seconds 1–12] [sampleRate 16000|24000|48000]");
  process.exitCode=2;
}else{
  const config={sampleRate,ear:"left",crossoverMode:"smooth",
    syntheticRmsDbFSAt65DbSPL:-37,limiterCeiling:0.5,
    targets:fixtureTargets(f=>f>=2000?[12,8,4]:[9,6,3])};
  const input=Float32Array.from({length:256},(_,i)=>
    0.015*Math.sin(2*Math.PI*1000*i/sampleRate));
  const dst=new Float32Array(512);
  const passes=seconds*sampleRate/256;
  function measure(mode){
    const stream=createOfflineStatefulWDRC(config);
    let written=0,checksum=0,high=process.memoryUsage().heapUsed;
    const before=high,timings=[];
    for(let k=0;k<passes;k++){
      const start=performance.now();
      let part,count;
      if(mode==="processInto"){
        count=stream.processInto(input,dst);
        part=dst;
      }else{
        part=stream.push(input);
        count=part.length;
      }
      timings.push(performance.now()-start);
      for(let i=0;i<count;i++)checksum+=part[i];
      written+=count;
      if(k%32===0)high=Math.max(high,process.memoryUsage().heapUsed);
    }
    const tail=stream.finish();
    written+=tail.length;
    for(let i=0;i<tail.length;i++)checksum+=tail[i];
    const after=process.memoryUsage().heapUsed;
    high=Math.max(high,after);
    const sorted=timings.slice().sort((a,b)=>a-b);
    const rank=p=>sorted[Math.max(0,Math.ceil(p*sorted.length)-1)];
    return {mode,callbacks:passes,outputSamples:written,
      checksum:Number(checksum.toPrecision(14)),
      p50Ms:Number(rank(.5).toFixed(4)),p95Ms:Number(rank(.95).toFixed(4)),
      maxMs:Number(sorted.at(-1).toFixed(4)),
      observedHeapBeforeBytes:before,observedHeapHighBytes:high,observedHeapAfterBytes:after,
      limitedSamples:stream.diagnostics.limitedSamples,
      faulted:stream.diagnostics.faulted};
  }
  const legacy=measure("push");
  const reused=measure("processInto");
  if(legacy.outputSamples!==seconds*sampleRate||
     reused.outputSamples!==legacy.outputSamples||
     legacy.checksum!==reused.checksum||
     legacy.faulted||reused.faulted)throw new Error("benchmark output mismatch");
  console.log(JSON.stringify({
    schema:"hearlens-m03k-offline-callback-probe-v1",
    offlineSyntheticOnly:true,nonGatingEnvironmentDependent:true,
    nodeVersion:process.version,platform:process.platform,arch:process.arch,
    sampleRateHz:sampleRate,chunkSamples:256,seconds,
    results:[legacy,reused],
    note:"Node wall-time samples and heap snapshots are NOT per-callback allocations, GC guarantees, device latency or calibrated ear SPL"
  },null,2));
}
