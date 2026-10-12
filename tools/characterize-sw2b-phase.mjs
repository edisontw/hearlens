#!/usr/bin/env node
/**
 * SW2-B deterministic offline filter artifact report.
 * LTI group delay belongs ONLY to frozen gains ratio=1 (not dynamic WDRC).
 * None of these are physical Bluetooth/device timing or sound pressure.
 */
import {
  SW2B_RATE,SW2B_CROSSOVERS,SW2B_STATIC_GAINS,staticSweep,
  impulseTransient,causalEnvelopeStep,causalImpulse,
  staticCausalTransferAtHz,impulseDftAtHz
} from "../packages/dsp/offline-causal-characterization.mjs";

const r=(n,d=5)=>n===null?null:Number(n.toFixed(d));
const flat=staticSweep({gainsDb:Array(6).fill(0)});
const shaped=staticSweep();
const ltiImpulse=causalImpulse({count:4096});
const parity=[250,500,1000,2000,4000,8000].map(hz=>{
  const h=staticCausalTransferAtHz({hz}),p=impulseDftAtHz(ltiImpulse,hz);
  return {hz,complexAbsError:r(Math.hypot(h.re-p.re,h.im-p.im),8)};
});
const report={
  schema:"hearlens-sw2b-filter-artifact-v1",
  syntheticOfflineOnly:true,actualHeadphoneOutput:false,rawSpeechUsed:false,
  fixedFilterTest:{rateHz:SW2B_RATE,crossoversHz:SW2B_CROSSOVERS,
    frozenBandGainsDb:SW2B_STATIC_GAINS,compressorRatios:Array(6).fill(1),
    flatIdentity:{maxMagnitudeDb:r(flat.magnitudeMaxDb),
      maxGroupDelayMs:r(flat.groupDelayRangeMs.max,8),
      maxAdjacentDb:r(flat.maxAdjacentMagnitudeStepDb)},
    shapedStatic:{
      magnitudeRangeDb:[r(shaped.magnitudeMinDb),r(shaped.magnitudeMaxDb)],
      maxAdjacentLogGridGainChangeDb:r(shaped.maxAdjacentMagnitudeStepDb),
      groupDelayRangeSamples:{
        min:r(shaped.groupDelayRangeSamples.min),max:r(shaped.groupDelayRangeSamples.max)
      },
      groupDelayRangeMs:{
        min:r(shaped.groupDelayRangeMs.min,8),max:r(shaped.groupDelayRangeMs.max,8)
      },
      crossoverTenHzLocalGainStepsDb:shaped.crossovers.map(x=>({
        hz:x.hz,stepDb:r(x.localTenHzGainStepDb)})),
      samplePoints:shaped.samplePoints.map(x=>({hz:x.hz,
        magnitudeDb:r(x.magnitudeDb),phaseRad:r(x.phaseRad),
        groupDelaySamples:r(x.groupDelaySamples),
        groupDelayMs:r(x.groupDelayMs,8)}))
    },
    transferVsImpulseDftParity:parity,
    unverifiedClaims:["filter perceptual naturalness","real-ear frequency response",
      "actual Bluetooth group delay","dB SPL and per-ear MPO"]
  },
  impulseTransient:{
    flatIdentity:impulseTransient({gainDb:Array(6).fill(0)}),
    shaped:impulseTransient()
  },
  nonlinearDynamicWDRC:{
    syntheticAmplitudeStep:causalEnvelopeStep(),
    note:"time-varying gain: static group delay/complex transfer does NOT describe this dynamic input"
  },
  referenceComparison:{
    m03StftLookaheadSamples:768,m03StftLookaheadMsAt48kHz:16,
    sw2BAdditionalFutureInputLookaheadSamples:0,
    sw2BStaticFrequencyDependentGroupDelayExists:true,
    measuredBluetoothMicrophoneToEarMs:null,
    warning:"group delay can vary by frequency and sign under mixed-band interference; not absolute output/acoustic latency"
  },
  decision:"KEEP causal DSP as research-only candidate; GO to stricter offline crossover/phase and dynamics if needed; NO live ear output"
};
console.log(JSON.stringify(report,null,2));
