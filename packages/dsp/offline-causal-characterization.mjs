/**
 * SW2-B analytical + synthetic-only characterization of SW2-A first-order
 * residual IIR. No device/recording/output/network interfaces are invoked.
 *
 * Linear response and phase/group delay are defined ONLY for a fixed-gain,
 * ratio=1 processor that never reaches its final digital limiter.
 * WDRC is nonlinear/time-varying; these LTI transfer metrics do NOT apply to
 * an actively compressing profile, to ear SPL or to an acoustic device path.
 */
import {createOfflineCausalResearchDSP} from "./offline-causal-wdrc.mjs";

export const SW2B_RATE=48000;
export const SW2B_CROSSOVERS=Object.freeze([350,700,1400,2800,5600]);
export const SW2B_STATIC_GAINS=Object.freeze([0,2,4,6,3,0]);

const c=(re,im=0)=>({re,im});
const add=(a,b)=>c(a.re+b.re,a.im+b.im);
const mul=(a,b)=>c(a.re*b.re-a.im*b.im,a.re*b.im+a.im*b.re);
const subtract=(a,b)=>c(a.re-b.re,a.im-b.im);
const amplitude=x=>Math.hypot(x.re,x.im);
const db=x=>20*Math.log10(Math.max(amplitude(x),1e-15));
const round=(n,d=5)=>Number(n.toFixed(d));

function validate(rate,boundaries,gains) {
  if (![16000,24000,48000].includes(rate))throw new RangeError("unsupported rate");
  if (!Array.isArray(boundaries)||![5,7].includes(boundaries.length)||
      !Array.isArray(gains)||gains.length!==boundaries.length+1){
    throw new RangeError("mismatched 6/8-band static response");
  }
  let prev=0;
  for(const hz of boundaries){
    if(!Number.isFinite(hz)||hz<=prev||hz<100||hz>rate*.4)throw new RangeError("invalid crossover");
    prev=hz;
  }
  for(const g of gains)if(!Number.isFinite(g)||g< -12||g>12)throw new RangeError("invalid gain");
}

/** Exact steady-state complex transfer function of SW2's sequential one-pole
 * low-pass / residual cascade with frozen linear per-band gains.
 * H_k(z)=(1-a_k)/(1-a_k z^-1), a_k=exp(-2*pi*f_k/Fs).
 */
export function staticCausalTransferAtHz({
  hz, sampleRate=SW2B_RATE, crossoversHz=SW2B_CROSSOVERS,
  gainsDb=SW2B_STATIC_GAINS,
}={}) {
  validate(sampleRate,crossoversHz,gainsDb);
  if(typeof hz!=="number"||!Number.isFinite(hz)||hz<0||hz>sampleRate/2){
    throw new RangeError("hz out of [0,Nyquist]");
  }
  const omega=2*Math.PI*hz/sampleRate;
  let residual=c(1),result=c(0);
  for(let b=0;b<crossoversHz.length;b++){
    const a=Math.exp(-2*Math.PI*crossoversHz[b]/sampleRate);
    const denRe=1-a*Math.cos(omega),denIm=a*Math.sin(omega);
    const divisor=denRe*denRe+denIm*denIm;
    const low=c((1-a)*denRe/divisor,-(1-a)*denIm/divisor);
    const part=mul(residual,low);
    const gain=Math.pow(10,gainsDb[b]/20);
    result=add(result,c(part.re*gain,part.im*gain));
    residual=mul(residual,subtract(c(1),low));
  }
  const finalGain=Math.pow(10,gainsDb.at(-1)/20);
  return add(result,c(residual.re*finalGain,residual.im*finalGain));
}

/** Finite-difference static-filter group delay. This is not a callback,
 * WDRC time-varying group delay or whole acoustic phone-to-ear latency.
 * Negative delay is possible for interference/nonminimum-phase-combination
 * frequency points; never clamp to zero or imply negative physical latency.
 */
export function staticCausalGroupDelayAtHz({
  hz, sampleRate=SW2B_RATE,crossoversHz=SW2B_CROSSOVERS,
  gainsDb=SW2B_STATIC_GAINS,deltaHz=1,
}={}) {
  const base={sampleRate,crossoversHz,gainsDb};
  const center=staticCausalTransferAtHz({...base,hz});
  if(!Number.isFinite(deltaHz)||deltaHz<=0||hz-deltaHz<0||
      hz+deltaHz>sampleRate/2)throw new RangeError("deltaHz outside safe central-difference domain");
  if(amplitude(center)<1e-5){
    return {groupDelaySamples:null,groupDelayMs:null,reliable:false,reason:"frequency_notch"};
  }
  const earlier=staticCausalTransferAtHz({...base,hz:hz-deltaHz});
  const later=staticCausalTransferAtHz({...base,hz:hz+deltaHz});
  // arg(H(f+d)*conj(H(f-d))): small unwrapped phase difference
  const phaseDiff=Math.atan2(
    later.im*earlier.re-later.re*earlier.im,
    later.re*earlier.re+later.im*earlier.im);
  const samples=-phaseDiff/(4*Math.PI*deltaHz/sampleRate);
  return {groupDelaySamples:samples,groupDelayMs:samples*1000/sampleRate,
    reliable:true,reason:"local_static_LTI_phase_derivative_only"};
}

export function staticSweep({
  sampleRate=SW2B_RATE,crossoversHz=SW2B_CROSSOVERS,gainsDb=SW2B_STATIC_GAINS,
  startHz=250,endHz=8000,points=193,
}={}) {
  if(!Number.isInteger(points)||points<8||points>5000||
     !Number.isFinite(startHz)||!Number.isFinite(endHz)||
     startHz<=1||endHz>=sampleRate/2||startHz>=endHz){
    throw new RangeError("invalid sweep grid");
  }
  const data=[];
  for(let i=0;i<points;i++){
    const hz=startHz*Math.pow(endHz/startHz,i/(points-1));
    const h=staticCausalTransferAtHz({hz,sampleRate,crossoversHz,gainsDb});
    const phase=Math.atan2(h.im,h.re);
    const delay=staticCausalGroupDelayAtHz({hz,sampleRate,crossoversHz,gainsDb});
    data.push({hz,magnitudeDb:db(h),phaseRad:phase,...delay});
  }
  const crossovers=crossoversHz.filter(x=>x>startHz&&x<endHz).map(hz=>{
    const before=db(staticCausalTransferAtHz({hz:hz-5,sampleRate,crossoversHz,gainsDb}));
    const after=db(staticCausalTransferAtHz({hz:hz+5,sampleRate,crossoversHz,gainsDb}));
    return {hz,localTenHzGainStepDb:after-before};
  });
  const reliable=data.filter(x=>x.reliable);
  return {
    sampleRateHz:sampleRate,points,startHz,endHz,crossovers,
    magnitudeMinDb:Math.min(...data.map(x=>x.magnitudeDb)),
    magnitudeMaxDb:Math.max(...data.map(x=>x.magnitudeDb)),
    maxAdjacentMagnitudeStepDb:Math.max(...data.slice(1).map((x,i)=>
      Math.abs(x.magnitudeDb-data[i].magnitudeDb))),
    groupDelayRangeSamples:reliable.length?{
      min:Math.min(...reliable.map(x=>x.groupDelaySamples)),
      max:Math.max(...reliable.map(x=>x.groupDelaySamples))
    }:null,
    groupDelayRangeMs:reliable.length?{
      min:Math.min(...reliable.map(x=>x.groupDelayMs)),
      max:Math.max(...reliable.map(x=>x.groupDelayMs))
    }:null,
    samplePoints:[250,500,1000,1400,2000,2800,4000,5600,8000]
      .filter(x=>x>=startHz&&x<=endHz)
      .map(hz=>{
        const response=staticCausalTransferAtHz({hz,sampleRate,crossoversHz,gainsDb});
        const delay=staticCausalGroupDelayAtHz({hz,sampleRate,crossoversHz,gainsDb});
        return {hz,magnitudeDb:round(db(response)),phaseRad:round(Math.atan2(response.im,response.re)),
          groupDelaySamples:delay.reliable?round(delay.groupDelaySamples):null,
          groupDelayMs:delay.reliable?round(delay.groupDelayMs,6):null};
      })
  };
}

/** Impulse response of *actual processor*, with frozen gains and no limiting.
 * Used for independent frequency/phase parity tests with transfer function.
 */
export function causalImpulse({sampleRate=SW2B_RATE,
  crossoversHz=SW2B_CROSSOVERS,gainsDb=SW2B_STATIC_GAINS,
  count=2048}={}) {
  if(!Number.isInteger(count)||count<32||count>32768)throw new RangeError("bad impulse count");
  const processor=createOfflineCausalResearchDSP({sampleRate,crossoversHz,
    baseGainsDb:gainsDb,ratios:Array(gainsDb.length).fill(1),limiterCeiling:0.9});
  const input=new Float32Array(count),output=new Float32Array(count);
  input[0]=0.01;
  processor.processInto(input,output);
  return Float32Array.from(output,x=>x/0.01);
}

/** Direct DFT of a finite impulse response, deliberately independent of the
 * analytic complex transfer. Frequencies need not land on DFT bins.
 */
export function impulseDftAtHz(impulse,hz,sampleRate=SW2B_RATE){
  if(!(impulse instanceof Float32Array)||!Number.isFinite(hz)||hz<0||hz>sampleRate/2){
    throw new RangeError("invalid impulse DFT");
  }
  let real=0,imag=0;
  const theta=2*Math.PI*hz/sampleRate;
  for(let i=0;i<impulse.length;i++){
    real+=impulse[i]*Math.cos(theta*i);
    imag-=impulse[i]*Math.sin(theta*i);
  }
  return c(real,imag);
}

/** Nonlinear synthetic WDRC envelope response: 0.25s quiet, 0.25s loud,
 * 0.6s quiet. Only segment-level gain statistics, not attack/release
 * time-constant calibration, speech benefit or hearing-output safety.
 */
export function causalEnvelopeStep({
  sampleRate=SW2B_RATE,attackMs=8,releaseMs=180,
}={}){
  const seg=[0.25,0.25,0.6].map(sec=>Math.round(sec*sampleRate));
  const n=seg.reduce((a,b)=>a+b,0),input=new Float32Array(n),out=new Float32Array(n);
  for(let i=0;i<n;i++){
    const high=i>=seg[0]&&i<seg[0]+seg[1];
    input[i]=(high?0.16:0.003)*Math.sin(2*Math.PI*1100*i/sampleRate);
  }
  const dsp=createOfflineCausalResearchDSP({sampleRate,
    baseGainsDb:Array(6).fill(10),ratios:Array(6).fill(2),
    thresholdDbfs:-46,attackMs,releaseMs,limiterCeiling:0.9});
  dsp.processInto(input,out);
  const rms=(start,end,arr)=>{
    let sum=0;
    for(let i=start;i<end;i++)sum+=arr[i]*arr[i];
    return Math.sqrt(sum/(end-start));
  };
  function gain(startSec,endSec) {
    const start=Math.round(startSec*sampleRate),end=Math.round(endSec*sampleRate);
    return 20*Math.log10(Math.max(rms(start,end,out),1e-12)/
      Math.max(rms(start,end,input),1e-12));
  }
  const early=seg[0]/sampleRate,late=(seg[0]+seg[1])/sampleRate;
  return {
    sampleRateHz:sampleRate,attackMsRequested:attackMs,releaseMsRequested:releaseMs,
    quietBeforeDb:gain(0.16,0.24),
    loudEarlyDb:gain(early+0.005,early+0.025),
    loudLateDb:gain(late-0.08,late-0.01),
    quietReturnEarlyDb:gain(late+0.005,late+0.025),
    quietReturnLateDb:gain(late+0.45,late+0.58),
    limitedSamples:dsp.diagnostics.limitedSamples,
    note:"RMS window-relative synthetic gain; requested exponential constants are not measured hearing aid attack/release times"
  };
}

/** A causal algorithm cannot have output before an impulse arrives. Unlike
 * a zero-phase noncausal FFT filter, it may have POST-cursor decay.
 */
export function impulseTransient({gainDb=SW2B_STATIC_GAINS}={}){
  const p=createOfflineCausalResearchDSP({sampleRate:SW2B_RATE,
    baseGainsDb:gainDb,ratios:Array(6).fill(1),limiterCeiling:0.9});
  const input=new Float32Array(4096),out=new Float32Array(4096),at=512;
  input[at]=0.01;p.processInto(input,out);
  let pre=0,post10ms=0,post50ms=0,postAll=0,total=0,peakIndex=0,peak=0;
  const tenMs=480,fiftyMs=2400;
  for(let i=0;i<out.length;i++){
    const energy=out[i]*out[i];total+=energy;
    if(i<at)pre+=energy;
    if(i>at){
      postAll+=energy;
      if(i<=at+tenMs)post10ms+=energy;
      if(i<=at+fiftyMs)post50ms+=energy;
    }
    if(Math.abs(out[i])>peak){peak=Math.abs(out[i]);peakIndex=i}
  }
  return {impulseIndex:at,peakIndex,
    preOnsetEnergy:pre,post10msEnergyFraction:post10ms/total,
    post50msEnergyFraction:post50ms/total,
    postAllEnergyFraction:postAll/total,
    note:"Energy fractions in synthetic digital impulse, no listening/acoustic consequence established"};
}
