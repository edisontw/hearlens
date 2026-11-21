import test from "node:test";
import assert from "node:assert/strict";
import {core, pcm, targets} from "./offline-auto-fir.testkit.mjs";

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

test("concurrent ears keep independent delay lines and control state", () => {
  for (const active of ["left", "right"]) {
    const quiet = active === "left" ? "right" : "left";
    const processors = { [active]: core(active), [quiet]: core(quiet) };
    const output = new Float32Array(pcm.length);
    const silence = new Float32Array(480);
    const quietOutput = new Float32Array(480);
    for (let pos = 0; pos < pcm.length; pos += 480) {
      const chunk = pcm.subarray(pos, pos + 480);
      processors[active].processInto(chunk, output.subarray(pos, pos + chunk.length));
      quietOutput.fill(1);
      const written = processors[quiet].processInto(silence.subarray(0, chunk.length), quietOutput);
      assert(quietOutput.subarray(0, written).every(sample => sample === 0));
    }
    assert.deepEqual(output, stream(active, 480).out);
    assert.deepEqual(processors[quiet].diagnostics.fir.lastTargetGainsDb,
      targets.ears[quiet].bands.map(band => band.gainDbByInputLevel[50]));
  }
});
