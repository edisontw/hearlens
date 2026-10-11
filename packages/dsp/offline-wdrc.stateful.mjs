/**
 * M03H — incremental synthetic-only offline STFT/WOLA research stream.
 * Fixed 1024-sample input/overlap/weight rings; no device or live audio route.
 */
import {
  OFFLINE_WDRC_FRAME_SIZE as N, OFFLINE_WDRC_HOP_SIZE as HOP,
  renderOfflineWDRC, offlineFFT, offlineFrequencyBins,
} from "./offline-wdrc.mjs";
import {INPUT_LEVELS_DB_SPL, normalizePrescriptionTargets, targetGainAtInput} from "../prescription-targets/prescription-targets.mjs";

export const STREAM_MAX_CHUNK_SAMPLES = 4096;
export const STREAM_LOOKAHEAD_SAMPLES = N - HOP;

export function createOfflineStatefulWDRC(config) {
  if (!config || typeof config !== "object" || Array.isArray(config) ||
      Object.hasOwn(config, "samples")) throw new TypeError("config must omit samples");
  const cfg = {
    sampleRate: config.sampleRate, targets: normalizePrescriptionTargets(config.targets),
    ear: config.ear, syntheticRmsDbFSAt65DbSPL: config.syntheticRmsDbFSAt65DbSPL,
    maxGainDb: config.maxGainDb === undefined ? 12 : config.maxGainDb, limiterCeiling: config.limiterCeiling === undefined ? 0.8 : config.limiterCeiling,
    attackMs: config.attackMs === undefined ? 15 : config.attackMs, releaseMs: config.releaseMs === undefined ? 500 : config.releaseMs,
    crossoverMode: config.crossoverMode === undefined ? "hard" : config.crossoverMode,
  };
  // Same parameter and provenance guards as authoritative full-clip renderer.
  renderOfflineWDRC({...cfg, samples: new Float32Array(1)});
  const {sampleRate, targets, ear, maxGainDb, limiterCeiling,
    syntheticRmsDbFSAt65DbSPL, attackMs, releaseMs, crossoverMode} = cfg;
  const centers = targets.ears[ear].bands.map(x=>x.centerHz);
  const bins = offlineFrequencyBins(centers,sampleRate,crossoverMode);
  const window = Float64Array.from({length:N},(_,i)=>
    0.5-0.5*Math.cos(2*Math.PI*(i+0.5)/N));
  const windowPower=window.reduce((sum,w)=>sum+w*w,0);
  const attackAlpha=Math.exp(-HOP/(sampleRate*attackMs/1000));
  const releaseAlpha=Math.exp(-HOP/(sampleRate*releaseMs/1000));
  const ceilingSafe=limiterCeiling-1e-7;

  const input=new Float32Array(N);
  const overlap=new Float64Array(N);
  const weights=new Float64Array(N);
  const gainDb=new Float64Array(centers.length);
  let accepted=0,emitted=0,nextStart=-N+HOP,frames=0,limited=0,capped=0;
  let faulted=false,closed=false,maxPending=0;
  function diagnostic() {
    return Object.freeze({
      kind:"offline-stateful-synthetic-only",ear,crossoverMode,sampleRate,
      acceptedSamples:accepted,emittedSamples:emitted,pendingSamples:accepted-emitted,
      maxPendingSamplesObserved:maxPending,frames,limitedSamples:limited,
      cappedBandFrames:capped,inputCapacitySamples:N,wolaCapacitySamples:N,
      maxChunkSamples:STREAM_MAX_CHUNK_SAMPLES,
      algorithmicLookaheadSamples:STREAM_LOOKAHEAD_SAMPLES,
      theoreticalLookaheadMs:1000*STREAM_LOOKAHEAD_SAMPLES/sampleRate,
      faulted,finalized:closed,
    });
  }
  function emitUntil(end,result) {
    while(emitted<end) {
      const slot=emitted%N;
      const pre=weights[slot]>0?overlap[slot]/weights[slot]:0;
      if(!Number.isFinite(pre))throw new Error("nonfinite WOLA output");
      if(Math.abs(pre)>limiterCeiling)limited++;
      result.push(Math.fround(Math.max(-ceilingSafe,Math.min(ceilingSafe,pre))));
      overlap[slot]=0;weights[slot]=0;emitted++;
    }
  }
  function frame(padded,result) {
    const start=nextStart;
    const real=new Float64Array(N),imag=new Float64Array(N);
    for(let i=0;i<N;i++){
      const index=start+i;
      if(index>=0&&index<accepted)real[i]=input[index%N]*window[i];
    }
    offlineFFT(real,imag);
    const energy=new Float64Array(centers.length);
    for(let k=0;k<=N/2;k++){
      const factor=(k===0||k===N/2)?1:2;
      const power=factor*(real[k]*real[k]+imag[k]*imag[k]);
      const w=bins.highWeight[k];
      energy[bins.lowBand[k]]+=power*(1-w);
      if(w>0)energy[bins.highBand[k]]+=power*w;
    }
    const gains=new Float64Array(centers.length);
    for(let b=0;b<centers.length;b++){
      const rms=Math.sqrt(energy[b]/(N*windowPower));
      const dbfs=20*Math.log10(Math.max(rms,1e-12));
      const nominal=Math.max(INPUT_LEVELS_DB_SPL[0],Math.min(INPUT_LEVELS_DB_SPL.at(-1),
        65+dbfs-syntheticRmsDbFSAt65DbSPL));
      const lookup=targetGainAtInput(targets,ear,centers[b],nominal);
      if(lookup.targetGainDb===null)throw new Error("missing synthetic target");
      if(lookup.targetGainDb>maxGainDb)capped++;
      const requested=Math.min(lookup.targetGainDb,maxGainDb);
      const alpha=requested<gainDb[b]?attackAlpha:releaseAlpha;
      gainDb[b]=alpha*gainDb[b]+(1-alpha)*requested;
      gains[b]=Math.pow(10,gainDb[b]/20);
    }
    for(let k=0;k<=N/2;k++){
      const g=gains[bins.lowBand[k]]*(1-bins.highWeight[k])
        +gains[bins.highBand[k]]*bins.highWeight[k];
      real[k]*=g;imag[k]*=g;
      if(k>0&&k<N/2){real[N-k]*=g;imag[N-k]*=g;}
    }
    offlineFFT(real,imag,true);
    for(let i=0;i<N;i++){
      const index=start+i;
      if(index>=0&&(!padded||index<accepted)){
        const slot=index%N;
        overlap[slot]+=real[i]*window[i];
        weights[slot]+=window[i]*window[i];
      }
    }
    frames++;nextStart+=HOP;
    emitUntil(Math.max(0,Math.min(nextStart,accepted)),result);
  }
  function push(chunk) {
    if(faulted||closed)throw new Error("stream faulted/finalized; reset required");
    if(!(chunk instanceof Float32Array)||chunk.length<1||
       chunk.length>STREAM_MAX_CHUNK_SAMPLES){
      faulted=true;throw new TypeError("chunk must be Float32Array length 1–4096; reset required");
    }
    for(const sample of chunk)if(!Number.isFinite(sample)||Math.abs(sample)>16){
      faulted=true;throw new RangeError("invalid synthetic PCM; reset required");
    }
    const result=[];
    try{
      for(let i=0;i<chunk.length;i++){
        input[accepted%N]=chunk[i];accepted++;
        while(nextStart+N<=accepted)frame(false,result);
        maxPending=Math.max(maxPending,accepted-emitted);
      }
      return Float32Array.from(result);
    }catch(error){faulted=true;throw error;}
  }
  function finish(){
    if(faulted||closed)throw new Error("stream faulted/finalized; reset required");
    if(accepted===0)throw new Error("cannot flush empty stream");
    const result=[];
    try{
      while(nextStart<accepted)frame(true,result);
      emitUntil(accepted,result);
      closed=true;
      return Float32Array.from(result);
    }catch(error){faulted=true;throw error;}
  }
  function reset(){
    input.fill(0);overlap.fill(0);weights.fill(0);gainDb.fill(0);
    accepted=0;emitted=0;nextStart=-N+HOP;frames=0;limited=0;capped=0;
    closed=false;faulted=false;maxPending=0;
  }
  return Object.freeze({push,finish,reset,get diagnostics(){return diagnostic();}});
}
