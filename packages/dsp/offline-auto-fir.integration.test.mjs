import test from "node:test";
import assert from "node:assert/strict";
import { createOfflineAutoFirResearch } from "./offline-auto-fir.mjs";
import { createOfflineSixBandLevelResearch } from "./offline-six-band-level.mjs";
import { createOfflineDynamicFirResearch } from "./offline-dynamic-fir.mjs";

const centers = [250, 500, 1000, 2000, 4000, 8000];
const targets = {
  schema: "hearlens-prescription-targets-v1", usage: "offline-research-only",
  origin: { kind: "synthetic-fixture", referenceId: null },
  ears: Object.fromEntries(["left","right"].map(ear => [ear, {
    bands: centers.map((centerHz,i) => ({
      centerHz, gainDbByInputLevel: {
        50: ear === "left" ? i + 3 : i + 6,
        65: ear === "left" ? i + 2 : i + 5,
        80: ear === "left" ? i + 1 : i + 4,
      },
    })),
  }])),
};
function core(ear) {
  const fir = createOfflineDynamicFirResearch({
    usage: "offline-synthetic-test-only", targets, ear, sampleRate: 48000,
    maxGainDb: 12, limiterCeiling: 0.3, transitionMs: 50,
  });
  const detector = createOfflineSixBandLevelResearch({
    usage: "offline-synthetic-test-only", sampleRate: 48000,
    attackMs: 15, releaseMs: 400,
  });
  return createOfflineAutoFirResearch({
    usage: "offline-synthetic-test-only", fir, detector, controlIntervalSamples: 480,
  });
}
const pcm = Float32Array.from({length: 5281}, (_,i) =>
  i < 600 ? 0 : (i < 3000 ? .006 : .65) * Math.sin(2*Math.PI*1000*i/48000));
function stream(ear, size) {
  const p = core(ear), out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i += size) {
    const n = Math.min(size,pcm.length-i);
    p.processInto(pcm.subarray(i,i+n),out.subarray(i,i+n));
  }
  return {p,out};
}

test("real offline detector + FIR automatic retarget remains callback-partition invariant", () => {
  const a=stream("left",1), b=stream("left",128), c=stream("left",4096);
  assert.deepEqual(a.out,b.out);assert.deepEqual(b.out,c.out);
  assert.equal(a.p.diagnostics.updates,11);
  assert.equal(a.p.diagnostics.acceptedSamples,pcm.length);
  assert.equal(a.p.diagnostics.detector.acceptedSamples,pcm.length);
  assert.equal(a.p.diagnostics.fir.acceptedSamples,pcm.length);
  assert.equal(a.p.diagnostics.fir.updates,12); // initial synthetic 50 plus 11 automatic updates
  assert.equal(a.p.diagnostics.hearingOutputAuthorized,false);
  assert.equal(a.p.diagnostics.audioRoute,"none");
});

test("real left/right profiles remain distinct; limiter, reset and fail-stop remain enforced", () => {
  const left=stream("left",128), right=stream("right",128);
  assert.notDeepEqual(left.p.diagnostics.fir.lastTargetGainsDb,
    right.p.diagnostics.fir.lastTargetGainsDb);
  assert(left.out.every(x => Number.isFinite(x) && Math.abs(x) <= 0.3));
  assert(right.out.every(x => Number.isFinite(x) && Math.abs(x) <= 0.3));
  const bad = Float32Array.of(0,NaN,0), dst = new Float32Array(3).fill(.25);
  assert.throws(() => left.p.processInto(bad,dst),/finite/);
  assert.deepEqual(dst,new Float32Array(3).fill(.25));
  assert.equal(left.p.diagnostics.faulted,true);
  left.p.reset();
  assert.equal(left.p.diagnostics.acceptedSamples,0);
  assert.equal(left.p.diagnostics.fir.ready,false);
  assert.equal(left.p.processInto(new Float32Array(1),new Float32Array(1)),1);
});
