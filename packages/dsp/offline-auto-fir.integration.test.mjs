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


test("fixed-horizon retarget mode keeps stereo isolation, partitions, limiter and reset", () => {
  const policy = { transitionRetargetPolicy: "fixed-horizon" };
  function run(ear, size, input = pcm) {
    const processor = core(ear, undefined, policy), output = new Float32Array(input.length);
    for (let pos = 0; pos < input.length; pos += size) {
      const count = Math.min(size, input.length - pos);
      processor.processInto(input.subarray(pos, pos + count), output.subarray(pos, pos + count));
    }
    return { processor, output };
  }
  const reference = run("left", 480);
  for (const size of [1, 128, 1024, 4096]) {
    assert.deepEqual(run("left", size).output, reference.output);
  }
  const right = run("right", 480);
  assert.notDeepEqual(reference.processor.diagnostics.fir.lastTargetGainsDb,
    right.processor.diagnostics.fir.lastTargetGainsDb);
  assert.equal(reference.processor.diagnostics.fir.algorithmicFutureLookaheadSamples, 0);
  assert.equal(reference.processor.diagnostics.fir.frozenGainLinearPhaseDelaySamples, 256);
  assert(reference.output.every(sample => Number.isFinite(sample) && Math.abs(sample) <= 0.3));
  assert(right.output.every(sample => Number.isFinite(sample) && Math.abs(sample) <= 0.3));

  const active = core("left", undefined, policy), silent = core("right", undefined, policy);
  const silentInput = new Float32Array(480), silentOutput = new Float32Array(480);
  const activeOutput = new Float32Array(480);
  for (let pos = 0; pos < pcm.length; pos += 480) {
    const chunk = pcm.subarray(pos, pos + 480);
    active.processInto(chunk, activeOutput);
    const written = silent.processInto(silentInput, silentOutput);
    assert(silentOutput.subarray(0, written).every(sample => sample === 0));
  }

  const guarded = core("right", undefined, policy);
  const loud = new Float32Array(1024).fill(8), limited = new Float32Array(1024);
  guarded.processInto(loud, limited);
  assert(limited.every(sample => Math.abs(sample) <= 0.3));
  assert(guarded.diagnostics.fir.limitedSamples > 0);
  assert.throws(() => guarded.processInto(Float32Array.of(0, NaN), new Float32Array(2)), /finite/);
  assert.equal(guarded.diagnostics.faulted, true);
  guarded.reset();
  assert.equal(guarded.diagnostics.acceptedSamples, 0);
  assert.equal(guarded.processInto(new Float32Array(1), new Float32Array(1)), 1);
});


test("mixed strong/weak bands: 180ms strong-tone pulse tracks weak-tone gain without changing policy", () => {
  // Entirely synthetic PCM. Nominal detector coordinates are not calibrated SPL.
  // Novel relative to the existing single-tone step: a continuous -42dBFS RMS
  // 2kHz weak tone overlaps a 180ms -22dBFS RMS 1kHz strong-tone pulse.
  const rate = 48000, count = 3 * rate, delay = 256, window = 480;
  const weakAmp = Math.SQRT2 * 10 ** (-42 / 20);
  const strongAmp = Math.SQRT2 * 10 ** (-22 / 20);
  const input = Float32Array.from({ length: count }, (_, n) =>
    weakAmp * Math.sin(2 * Math.PI * 2000 * n / rate) +
    (n >= rate && n < 1.18 * rate ?
      strongAmp * Math.sin(2 * Math.PI * 1000 * n / rate) : 0));

  function render(policy) {
    const processor = core("left", undefined, { transitionRetargetPolicy: policy });
    const output = new Float32Array(count);
    for (let pos = 0; pos < count; pos += window) {
      processor.processInto(input.subarray(pos, pos + window),
        output.subarray(pos, pos + window));
    }
    const diagnostics = processor.diagnostics;
    assert.equal(diagnostics.audioRoute, "none");
    assert.equal(diagnostics.hearingOutputAuthorized, false);
    assert.equal(diagnostics.fir.algorithmicFutureLookaheadSamples, 0);
    assert(output.every(sample => Number.isFinite(sample) && Math.abs(sample) <= 0.3));
    assert.equal(diagnostics.fir.limitedSamples, 0);
    return output;
  }
  function weakGainDb(output, ms) {
    // 10 ms holds exactly 20 cycles at 2 kHz. Project the delayed output
    // onto the weak tone to exclude the coincident 1 kHz fundamental.
    const start = Math.round(ms * rate / 1000) + delay;
    let sine = 0, cosine = 0;
    for (let n = start; n < start + window; n++) {
      const phase = 2 * Math.PI * 2000 * (n - delay) / rate;
      sine += output[n] * Math.sin(phase);
      cosine += output[n] * Math.cos(phase);
    }
    return 20 * Math.log10((2 * Math.hypot(sine, cosine) / window) / weakAmp);
  }
  function stats(output, fromMs, toMs) {
    const values = [];
    for (let ms = fromMs; ms + 10 <= toMs; ms += 10) {
      values.push(weakGainDb(output, ms));
    }
    assert(values.length > 0 && values.every(Number.isFinite));
    return {
      meanDb: values.reduce((total, gain) => total + gain, 0) / values.length,
      rangeDb: Math.max(...values) - Math.min(...values),
    };
  }
  const measured = Object.fromEntries(["restart", "fixed-horizon"].map(policy => {
    const output = render(policy);
    return [policy, {
      baseline: stats(output, 700, 900),
      pulse: stats(output, 1000, 1180),
      earlyRelease: stats(output, 1190, 1450),
      lateRelease: stats(output, 2100, 2400),
    }];
  }));
  for (const record of Object.values(measured)) {
    assert(Math.abs(record.baseline.meanDb - 5.332) < 0.02);
    assert(record.pulse.meanDb < record.baseline.meanDb);
  }
  // Descriptive characterization, not a quality pass threshold:
  // do not enshrine either candidate's current ripple as the desired behavior.
  console.log("M03 synthetic strong/weak pulse " + JSON.stringify(measured));
});
