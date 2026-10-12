import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  SW2B_RATE,SW2B_CROSSOVERS,SW2B_STATIC_GAINS,
  staticCausalTransferAtHz,staticCausalGroupDelayAtHz,staticSweep,
  causalImpulse,impulseDftAtHz,impulseTransient,causalEnvelopeStep,
} from "./offline-causal-characterization.mjs";

const magnitude=z=>Math.hypot(z.re,z.im);

test("SW2-B frozen-gain identity has unity magnitude, zero phase/group delay (6- and 8-band)",()=>{
  for(const crossoversHz of [SW2B_CROSSOVERS,[300,500,800,1200,1900,3000,4600]]){
    const gainsDb=Array(crossoversHz.length+1).fill(0);
    for(const hz of [250,500,1000,1400,2000,4000,8000]){
      const transfer=staticCausalTransferAtHz({hz,crossoversHz,gainsDb});
      const delay=staticCausalGroupDelayAtHz({hz,crossoversHz,gainsDb});
      assert(Math.abs(transfer.re-1)<1e-10 && Math.abs(transfer.im)<1e-10);
      assert.equal(delay.reliable,true);
      assert(Math.abs(delay.groupDelaySamples)<1e-9);
    }
  }
});

test("SW2-B independent physical processor impulse DFT agrees with complex transfer on shaped profile",()=>{
  const impulse=causalImpulse({count:4096});
  for(const hz of [250,350,500,700,1000,1400,2000,2800,4000,5600,8000]){
    const expected=staticCausalTransferAtHz({hz});
    const observed=impulseDftAtHz(impulse,hz);
    const error=Math.hypot(observed.re-expected.re,observed.im-expected.im);
    assert(error<2e-4,"hz "+hz+" transfer mismatch "+error);
  }
});

test("SW2-B group delay equals negative static phase slope with careful units",()=>{
  for(const hz of [250,500,1000,2000,4000,8000]){
    const eps=0.5;
    const earlier=staticCausalTransferAtHz({hz:hz-eps});
    const later=staticCausalTransferAtHz({hz:hz+eps});
    const delta=Math.atan2(later.im*earlier.re-later.re*earlier.im,
      later.re*earlier.re+later.im*earlier.im);
    const finiteDifferenceSamples=-delta/(4*Math.PI*eps/SW2B_RATE);
    const reported=staticCausalGroupDelayAtHz({hz,deltaHz:eps});
    assert.equal(reported.reliable,true);
    assert(Math.abs(reported.groupDelaySamples-finiteDifferenceSamples)<1e-10);
    assert(Math.abs(reported.groupDelayMs-reported.groupDelaySamples/48)<1e-10);
  }
});

test("SW2-B band-boundary 10Hz sweeps are finite and log-frequency response is non-flat when shaped",()=>{
  const flat=staticSweep({gainsDb:Array(6).fill(0)}),shaped=staticSweep();
  assert.equal(flat.points,193);
  assert(Math.abs(flat.magnitudeMaxDb)<1e-8);
  assert(Math.abs(flat.magnitudeMinDb)<1e-8);
  assert(Math.abs(flat.maxAdjacentMagnitudeStepDb)<1e-8);
  assert(shaped.magnitudeMaxDb-shaped.magnitudeMinDb>2);
  assert.equal(shaped.crossovers.length,5);
  assert(shaped.crossovers.every(x=>Number.isFinite(x.localTenHzGainStepDb)));
  assert(shaped.samplePoints.every(x=>Number.isFinite(x.groupDelayMs)));
  assert(shaped.groupDelayRangeSamples.max>=shaped.groupDelayRangeSamples.min);
});

test("SW2-B impulse is strictly causal, with no pre-onset energy, but gain-shape postcursor exists",()=>{
  const flat=impulseTransient({gainDb:Array(6).fill(0)}),shaped=impulseTransient();
  assert.equal(flat.preOnsetEnergy,0);
  assert.equal(shaped.preOnsetEnergy,0);
  assert.equal(flat.peakIndex,flat.impulseIndex);
  assert(shaped.postAllEnergyFraction>0,"nonflat transfer has a postcursor");
  assert(flat.postAllEnergyFraction<1e-10);
  assert(shaped.post10msEnergyFraction<=shaped.postAllEnergyFraction+1e-12);
  assert(shaped.post50msEnergyFraction<=shaped.postAllEnergyFraction+1e-12);
});

test("SW2-B compressor 3-step synthetic temporal response is bounded, gain varies with input",()=>{
  const step=causalEnvelopeStep();
  for(const key of ["quietBeforeDb","loudEarlyDb","loudLateDb",
    "quietReturnEarlyDb","quietReturnLateDb"]){
    assert(Number.isFinite(step[key]),key);
    assert(step[key]<13 && step[key]>-24,key+": "+step[key]);
  }
  assert(step.quietBeforeDb>step.loudLateDb+2,"not enough downward compression");
  assert(step.quietReturnLateDb>step.quietReturnEarlyDb,
    "gain should recover after loud transition on this fixed offline input");
  assert.equal(step.limitedSamples,0);
});

test("SW2-B analysis rejects invalid frequency, phase step, gain topology and domain",()=>{
  assert.throws(()=>staticCausalTransferAtHz({hz:-1}),/hz/);
  assert.throws(()=>staticCausalTransferAtHz({hz:25000}),/hz/);
  assert.throws(()=>staticCausalGroupDelayAtHz({hz:0}),/deltaHz/);
  assert.throws(()=>staticCausalGroupDelayAtHz({hz:250,deltaHz:-1}),/deltaHz/);
  assert.throws(()=>staticSweep({points:0}),/grid/);
  assert.throws(()=>staticSweep({startHz:8000,endHz:250}),/grid/);
  assert.throws(()=>staticCausalTransferAtHz({hz:1000,crossoversHz:[350,700]}),/mismatched/);
  assert.throws(()=>causalImpulse({count:2}),/impulse count/);
});

test("SW2-B analysis module is synthetic-only with no device/transport/speech network API",()=>{
  const code=readFileSync(new URL("./offline-causal-characterization.mjs",import.meta.url),"utf8");
  for(const forbidden of [/\bAudioTrack\s*\(/,/\bAudioRecord\s*\(/,/\bgetUserMedia\s*\(/,
    /\bnew\s+AudioContext\s*\(/,/\bnew\s+WebSocket\s*\(/,/\bfetch\s*\(/,
    /\bnew\s+MediaRecorder\s*\(/]){
    assert.doesNotMatch(code,forbidden);
  }
});
