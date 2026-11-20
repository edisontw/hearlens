import test from "node:test";
import assert from "node:assert/strict";
import { createOfflineSixBandLevelResearch } from "./offline-six-band-level.mjs";

// Synthetic PCM only: nominal 50..80 coordinates are not calibrated SPL.
const RATE=48000;
const CENTERS=[250,500,1000,2000,4000,8000];
const make=()=>createOfflineSixBandLevelResearch({
  usage:"offline-synthetic-test-only",sampleRate:RATE,attackMs:15,releaseMs:400,
});
function pcm(components,samples=RATE) {
  return Float32Array.from({length:samples},(_,i)=>components.reduce(
    (sum,[hz,rmsDbfs])=>sum+Math.SQRT2*10**(rmsDbfs/20)*
      Math.sin(2*Math.PI*hz*i/RATE),0));
}
function feed(detector,input,quantum=128) {
  for(let pos=0;pos<input.length;pos+=quantum)
    detector.process(input.subarray(pos,Math.min(pos+quantum,input.length)));
}
const levels=detector=>[...detector.readNominalLevelsInto(new Float64Array(6))];

// A 50..80 floor hides stopband rejection; only compare unclamped neighbors.
test("center tones: nearest-band rejection without brick-wall assumption",()=>{
  for(let i=0;i<CENTERS.length;i++){
    const detector=make();
    feed(detector,pcm([[CENTERS[i],-28]]));
    const observed=levels(detector);
    assert(Math.abs(observed[i]-74)<0.5,
      String(CENTERS[i])+"Hz center nominal "+observed[i]);
    for(const j of [i-1,i+1].filter(index=>index>=0&&index<6)){
      const rejection=observed[i]-observed[j];
      assert(rejection>14&&rejection<19,
        String(CENTERS[i])+"->"+CENTERS[j]+"Hz rejection "+rejection);
    }
    assert.equal(detector.diagnostics.physicalMicCalibrated,false);
    assert.equal(detector.diagnostics.hearingOutputAuthorized,false);
  }
});

test("geometric crossover tones excite both neighboring bands",()=>{
  for(let i=0;i<CENTERS.length-1;i++){
    const hz=Math.sqrt(CENTERS[i]*CENTERS[i+1]),detector=make();
    feed(detector,pcm([[hz,-28]]));
    const observed=levels(detector);
    assert(observed[i]>65&&observed[i+1]>65);
    assert(Math.abs(observed[i]-observed[i+1])<1,
      "crossover "+hz+" skew "+(observed[i]-observed[i+1]));
  }
});

test("20dB two-tone contrast records existing weak-band masking ceiling",()=>{
  const weak=make(),mixed=make();
  feed(weak,pcm([[2000,-42]]));
  feed(mixed,pcm([[1000,-22],[2000,-42]]));
  const baseline=levels(weak)[3],added=levels(mixed)[3]-baseline;
  // Current implementation has about +5.7dB bias; the goal is less, not more.
  // Do not lock current bias as a minimum when the detector improves.
  assert(baseline>59&&baseline<61,"weak-only nominal "+baseline);
  assert(added>=0&&added<7,"strong-tone leakage "+added+"dB");
  assert.equal(mixed.diagnostics.audioRoute,"none");
});

test("attack, power averaging, release and reset under PCM step",()=>{
  const detector=make();
  assert.deepEqual(levels(detector),Array(6).fill(50));
  const signal=pcm([[1000,-32]]);
  feed(detector,signal.subarray(0,480));
  const after10=levels(detector)[2];
  feed(detector,signal.subarray(480,4800));
  const after100=levels(detector)[2];
  feed(detector,signal.subarray(4800));
  const steady=levels(detector)[2];
  assert(after10<after100&&after100<steady+0.1);
  assert(steady>69&&steady<71);
  feed(detector,new Float32Array(RATE));
  const afterSilence=levels(detector)[2];
  assert(afterSilence<steady-9&&afterSilence>50);
  detector.reset();
  assert.deepEqual(levels(detector),Array(6).fill(50));
});
