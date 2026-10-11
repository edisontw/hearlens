import assert from "node:assert/strict";
import test from "node:test";
import {
  M03F_SCHEMA,SIX_CENTERS,EIGHT_CENTERS,
  characterizeCrossoverAB,characterizeGrid,
} from "./offline-wdrc.ab.testkit.mjs";
import {renderOfflineWDRC} from "./offline-wdrc.mjs";
import {fixtureTargets} from "./offline-wdrc.characterization.mjs";

const data=characterizeCrossoverAB();
const seams=[...data.grids.six,...data.grids.eight];

test("dense A/B covers every crossover on both 6 and 8 band grids",()=>{
  assert.equal(data.schema,M03F_SCHEMA);
  assert.equal(data.offlineSyntheticOnly,true);
  assert.equal(data.defaultDecision,"hard-retained-pending-broader-validation");
  assert.equal(data.grids.six.length,SIX_CENTERS.length-1);
  assert.equal(data.grids.eight.length,EIGHT_CENTERS.length-1);
  assert.equal(data.summary.totalCrossovers,12);
  assert(data.grids.six.every(row=>row.points.length===11));
  assert(data.grids.eight.every(row=>row.points.length===7));
  assert(seams.every(row=>row.points.every(p=>p.frequencyHz>0&&Number.isFinite(p.hardDb)&&Number.isFinite(p.smoothDb))));
});

test("fixed 1000/2000 seam improves under smooth option",()=>{
  const seam=data.grids.six.find(r=>r.lowHz===1000&&r.highHz===2000);
  assert(seam.hardMaxAdjacentJumpDb>1);
  assert(seam.smoothMaxAdjacentJumpDb<seam.hardMaxAdjacentJumpDb);
});

test("all crossover responses and comparison summary are finite and internally consistent",()=>{
  for(const row of seams){
    assert(Number.isFinite(row.improvementDb));
    assert(row.hardMaxAdjacentJumpDb>=0);
    assert(row.smoothMaxAdjacentJumpDb>=0);
    assert(Math.abs((row.hardMaxAdjacentJumpDb-row.smoothMaxAdjacentJumpDb)-row.improvementDb)<0.002);
  }
  // Empirical synthetic-only regression thresholds from the M03F baseline.
  // NOT pre-registered perceptual safety tolerances or clinical claims.
  assert(data.summary.improvedCrossovers===12);
  assert(seams.every(row=>row.improvementDb>0.4));
  assert(seams.every(row=>row.smoothMaxAdjacentJumpDb<2.0));
  assert(data.summary.worstHardJumpDb>=0&&data.summary.worstSmoothJumpDb>=0);
});

test("uniform targets do not introduce a large hard/smooth difference at six centers",()=>{
  const [hard,smooth]=data.uniform;
  assert.deepEqual(hard.gainsDb.length,6);
  assert.deepEqual(smooth.gainsDb.length,6);
  for(let i=0;i<6;i++)assert(Math.abs(hard.gainsDb[i]-smooth.gainsDb[i])<0.5);
});

test("harmonic-only and two-tone sideband probes are coherent and finite",()=>{
  assert.equal(data.harmonics.length,6);
  assert(data.harmonics.filter(r=>r.frequencyHz===1700).every(r=>r.fundamentalGainDb>1));
  for(const r of data.harmonics){
    assert(r.projectedHarmonicPercent>=0&&Number.isFinite(r.projectedHarmonicPercent));
    assert(r.harmonics.length>=3);
    assert(r.harmonics.every(h=>Number.isFinite(h.relativeDb)));
  }
  assert.deepEqual(data.twoTone.map(r=>r.sidebands.map(v=>v.frequencyHz)),[[1400,1430],[1400,1430]]);
  assert(data.twoTone.every(r=>r.sidebands.every(h=>Number.isFinite(h.relativeDb))));
});

test("transient proxy records nonnegative pre/post ring energy for both modes",()=>{
  for(const row of data.transient){
    assert(row.preEnergyPercent>=0&&row.postEnergyPercent>=0);
    assert(row.preEnergyPercent+row.postEnergyPercent<=100.01);
    assert(row.peak>=0&&row.peak<=0.95);
  }
});

test("final limiter remains after both modes and prevents Float32 bypass",()=>{
  for(const row of data.limiter){
    assert(row.limitedSamples.every(n=>n>0));
    assert(row.maxAbsOutput<=row.ceiling);
  }
  for(const mode of ["hard","smooth"]){
    const output=renderOfflineWDRC({
      samples:Float32Array.from({length:8192},(_,i)=>i%2?16:-16),
      sampleRate:16000,targets:fixtureTargets(()=>[80,80,80]),
      ear:"right",syntheticRmsDbFSAt65DbSPL:-37,crossoverMode:mode,limiterCeiling:0.05,maxGainDb:24,
    }).samples;
    assert(output.every(s=>Number.isFinite(s)&&Math.abs(s)<=0.05));
  }
});

test("synthetic characterization is deterministic and invalid grid settings are rejected",()=>{
  assert.deepEqual(characterizeCrossoverAB(),data);
  assert.throws(()=>characterizeGrid([250,500,1000]));
  assert.throws(()=>characterizeGrid(SIX_CENTERS,4));
});
