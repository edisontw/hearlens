/**
 * M03 Part F — offline synthetic-only, deterministic Hard-vs-Smooth analysis.
 * Never maps dB HL to gain and never claims acoustic SPL, ear-level output,
 * hearing-aid fitting, latency, clinical safety, or perceptual quality.
 */
import { renderOfflineWDRC } from "./offline-wdrc.mjs";
import { fixtureTargets, projectedGainDb, testSine } from "./offline-wdrc.characterization.mjs";
import { PRESCRIPTION_TARGET_SCHEMA } from "../prescription-targets/prescription-targets.mjs";

export const M03F_SCHEMA = "hearlens-m03f-synthetic-ab-v1";
const SR = 16000;
const N = 32768;
const START = 16384;
const END = 32000;
export const SIX_CENTERS = Object.freeze([250,500,1000,2000,4000,6000]);
export const EIGHT_CENTERS = Object.freeze([250,375,500,750,1000,2000,4000,6000]);
const MODES = ["hard","smooth"];

const round = v => Math.round(v * 1000) / 1000;
const levelTargets = (centers, cutIndex, lowerDb = 0, upperDb = 9) => {
  if (!Array.isArray(centers) || centers.length < 6 || centers.length > 8) throw new TypeError("6–8 bands needed");
  const bands = centers.map((centerHz,index) => ({
    centerHz,
    gainDbByInputLevel: {
      50: index < cutIndex ? lowerDb : upperDb,
      65: index < cutIndex ? lowerDb : upperDb,
      80: index < cutIndex ? lowerDb : upperDb,
    }
  }));
  const makeEar = () => ({bands:bands.map(b=>({centerHz:b.centerHz,gainDbByInputLevel:{...b.gainDbByInputLevel}}))});
  return {schema:PRESCRIPTION_TARGET_SCHEMA,usage:"offline-research-only",
    origin:{kind:"synthetic-fixture",referenceId:null},
    ears:{left:makeEar(),right:makeEar()}};
};

function render(samples, targets, mode, options = {}) {
  return renderOfflineWDRC({samples,sampleRate:SR,targets,ear:"left",
    syntheticRmsDbFSAt65DbSPL:-37,maxGainDb:12,
    limiterCeiling:0.95,crossoverMode:mode,...options});
}

function toneDb(frequencyHz,targets,mode) {
  const input = testSine(frequencyHz,0.008,N,SR);
  const output = render(input,targets,mode);
  return round(projectedGainDb(input,output.samples,frequencyHz,N-8192,N-1024));
}

function stepRange(points) {
  return round(Math.max(...points.slice(1).map((v,i)=>Math.abs(v-points[i]))));
}

/**
 * Matched dense response probes across ALL adjacent-band midpoints in a grid.
 * Linear synthetic gain is fixed 0/9 dB; no automatic clinical preset.
 */
export function characterizeGrid(centers, steps = 11, spacingOctaves = 0.025) {
  if (![6,8].includes(centers?.length) || steps % 2 !== 1 || steps < 5 || steps > 15) {
    throw new RangeError("only fixed 6/8-band grids with odd 5–15 steps");
  }
  const half = (steps-1)/2;
  return centers.slice(1).map((upper,index)=>{
    const lower = centers[index], midpoint = Math.sqrt(lower*upper);
    const targets = levelTargets(centers,index+1);
    const readings = Array.from({length:steps},(_,i)=>{
      const offset = (i-half)*spacingOctaves;
      const frequencyHz = midpoint*Math.pow(2,offset);
      return {frequencyHz:round(frequencyHz),
        hardDb:toneDb(frequencyHz,targets,"hard"),
        smoothDb:toneDb(frequencyHz,targets,"smooth")};
    });
    const hard = readings.map(r=>r.hardDb), smooth=readings.map(r=>r.smoothDb);
    const hardMaxAdjacentJumpDb=stepRange(hard);
    const smoothMaxAdjacentJumpDb=stepRange(smooth);
    return {
      lowHz:lower,highHz:upper,midpointHz:round(midpoint),
      points:readings,hardMaxAdjacentJumpDb,smoothMaxAdjacentJumpDb,
      improvementDb:round(hardMaxAdjacentJumpDb-smoothMaxAdjacentJumpDb),
    };
  });
}

function projectedAmplitude(signal,frequencyHz,start=START,end=END) {
  let s=0,c=0;
  for(let i=start;i<end;i++){
    const angle=2*Math.PI*frequencyHz*i/SR;
    s+=signal[i]*Math.sin(angle);
    c+=signal[i]*Math.cos(angle);
  }
  return 2*Math.hypot(s,c)/(end-start);
}

/**
 * Harmonic-only projections, H2–H5, relative to fundamental. This is NOT
 * THD+N, intermodulation in general, phase response, or psychoacoustics.
 */
function harmonicProbe(mode, frequencyHz, target) {
  const input=testSine(frequencyHz,0.05,N,SR);
  const output=render(input,target,mode);
  const fundamental=projectedAmplitude(output.samples,frequencyHz);
  const harmonics=[];
  for(let order=2;order<=5;order++){
    if(order*frequencyHz>=SR/2)break;
    harmonics.push({order,
      relativeDb:round(20*Math.log10(Math.max(1e-12,projectedAmplitude(output.samples,order*frequencyHz))/fundamental))});
  }
  const energy=harmonics.reduce((v,r)=>v+Math.pow(10,r.relativeDb/10),0);
  return {mode,frequencyHz,
    fundamentalGainDb:round(projectedGainDb(input,output.samples,frequencyHz,START,END)),
    projectedHarmonicPercent:round(100*Math.sqrt(energy)),harmonics};
}

/**
 * Two-tone symmetric 10-Hz difference: deliberate 1-second coherent projection
 * of 1400 and 1430 Hz sidebands against 1410/1420 input tones.
 * This is a narrow synthetic intermodulation probe, not IMD compliance.
 */
function twoToneProbe(mode) {
  const input=Float32Array.from({length:N},(_,i)=>0.025*(
    Math.sin(2*Math.PI*1410*i/SR)+Math.sin(2*Math.PI*1420*i/SR)));
  const out=render(input,levelTargets(SIX_CENTERS,3),mode);
  // One-second window supports exact orthogonal 10-Hz spaced components.
  const from=SR,to=2*SR;
  const fundamental=Math.max(projectedAmplitude(out.samples,1410,from,to),projectedAmplitude(out.samples,1420,from,to));
  return {mode,sidebands:[1400,1430].map(hz=>({
    frequencyHz:hz,relativeDb:round(20*Math.log10(Math.max(1e-12,projectedAmplitude(out.samples,hz,from,to))/fundamental)),
  }))};
}

/** Pre/post click energy is a synthetic transient-artifact proxy, not group delay. */
function transientProbe(mode) {
  const input=new Float32Array(8192);
  const index=4096;input[index]=0.04;
  const out=render(input,levelTargets(SIX_CENTERS,3),mode).samples;
  let total=0,pre=0,post=0;
  for(let i=0;i<out.length;i++){
    const e=out[i]*out[i];
    total+=e;
    if(i<index)pre+=e;
    if(i>index)post+=e;
  }
  return {mode,
    preEnergyPercent:round(total>0?100*pre/total:0),
    postEnergyPercent:round(total>0?100*post/total:0),
    peak:round(Math.max(...out.map(Math.abs)))};
}

function finalLimiterProbe(mode) {
  const targets=levelTargets(SIX_CENTERS,3,80,80);
  const signals=[
    Float32Array.from({length:8192},(_,i)=>8*Math.sin(2*Math.PI*500*i/SR)),
    Float32Array.from({length:8192},(_,i)=>8*Math.sin(2*Math.PI*2000*i/SR)),
  ];
  const result=signals.map(samples=>render(samples,targets,mode,{limiterCeiling:0.1,maxGainDb:24}));
  return {mode,
    limitedSamples:result.map(x=>x.diagnostics.limitedSamples),
    maxAbsOutput:round(Math.max(...result.map(x=>x.diagnostics.maxAbsOutput))),
    ceiling:0.1};
}

/** Stable, bounded JSON report; no wall-clock time, network, recording or device access. */
export function characterizeCrossoverAB() {
  const six=characterizeGrid(SIX_CENTERS,11,0.025);
  const eight=characterizeGrid(EIGHT_CENTERS,7,0.04);
  const uniformTarget=fixtureTargets(()=>[6,6,6]);
  const uniform=MODES.map(mode=>({mode,gainsDb:SIX_CENTERS.map(f=>toneDb(f,uniformTarget,mode))}));
  const harmonicTarget=levelTargets(SIX_CENTERS,3);
  return {
    schema:M03F_SCHEMA,offlineSyntheticOnly:true,sampleRateHz:SR,
    testedBandCounts:[6,8],
    grids:{six,eight},
    summary:{
      improvedCrossovers:six.filter(r=>r.improvementDb>0).length+eight.filter(r=>r.improvementDb>0).length,
      totalCrossovers:six.length+eight.length,
      worstHardJumpDb:round(Math.max(...[...six,...eight].map(r=>r.hardMaxAdjacentJumpDb))),
      worstSmoothJumpDb:round(Math.max(...[...six,...eight].map(r=>r.smoothMaxAdjacentJumpDb))),
    },
    uniform,
    harmonics:MODES.map(mode=>harmonicProbe(mode,1000,harmonicTarget)),
    twoTone:MODES.map(twoToneProbe),
    transient:MODES.map(transientProbe),
    limiter:MODES.map(finalLimiterProbe),
    defaultDecision:"hard-retained-pending-broader-validation",
  };
}
