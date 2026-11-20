import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createOfflineAutoFirResearch } from "./offline-auto-fir.mjs";

function fakeCores(ear = "left") {
  let firSamples = 0, firUpdates = [], firFault = false, firReady = false;
  let detectorSamples = 0, detectorFault = false;
  let current = 50;
  const fir = {
    setSyntheticBandLevels(levels) {
      if (firFault) throw Error("FIR faulted");
      assert.equal(levels.length, 6);
      firUpdates.push([...levels]); firReady = true;
    },
    processInto(input, output) {
      if (!firReady || firFault) throw Error("FIR unavailable");
      for (let i = 0; i < input.length; i++) output[i] = Math.min(0.5, Math.max(-0.5, input[i]));
      firSamples += input.length;
      return input.length;
    },
    reset() { firSamples = 0; firUpdates = []; firFault = false; firReady = false; },
    get diagnostics() { return { kind: "offline-synthetic-dynamic-fir-research-only",
      sampleRate: 48000, audioRoute: "none", hearingOutputAuthorized: false,
      nominalSyntheticInputOnly: true, acceptedSamples: firSamples, faulted: firFault,
      ready: firReady, updates: firUpdates.length, ear }; },
  };
  const detector = {
    process(input) {
      if (detectorFault) throw Error("detector faulted");
      detectorSamples += input.length;
      current = Math.max(50, Math.min(80, 50 + Math.abs(input[input.length - 1]) * 25));
    },
    readNominalLevelsInto(output) { output.fill(current); return output; },
    reset() { detectorSamples = 0; current = 50; detectorFault = false; },
    get diagnostics() { return { kind: "offline-synthetic-six-band-level-only",
      sampleRate: 48000, audioRoute: "none", hearingOutputAuthorized: false,
      syntheticMappingOnly: true, acceptedSamples: detectorSamples, faulted: detectorFault }; },
  };
  return { fir, detector, get updates() { return firUpdates; } };
}
const create = (cores = fakeCores(), extras = {}) => createOfflineAutoFirResearch({
  usage: "offline-synthetic-test-only", controlIntervalSamples: 480,
  fir: cores.fir, detector: cores.detector, ...extras,
});
const PCM = Float32Array.from({length: 12021}, (_,i) => i < 2000 ? .005 :
  i < 6900 ? .04*Math.sin(i*.11) : .8*Math.cos(i*.041));
function run(size, ear = "left") {
  const cores = fakeCores(ear), core = create(cores), out = new Float32Array(PCM.length);
  for (let i=0;i<PCM.length;i+=size) {
    const n=Math.min(size,PCM.length-i);
    core.processInto(PCM.subarray(i,i+n),out.subarray(i,i+n));
  }
  return {core,out,updates:cores.updates};
}

test("sample-clocked control and output are independent of callback boundaries", () => {
  const a=run(1), b=run(128), c=run(4096);
  assert.deepEqual(a.out,b.out); assert.deepEqual(b.out,c.out);
  assert.deepEqual(a.updates,b.updates); assert.deepEqual(b.updates,c.updates);
  assert.equal(a.core.diagnostics.updates,25);
  assert.equal(a.core.diagnostics.sinceUpdate,21);
  assert.equal(a.core.diagnostics.fir.acceptedSamples,PCM.length);
  assert.equal(a.core.diagnostics.detector.acceptedSamples,PCM.length);
});

test("initial synthetic 50 level, independently advancing ears, limiter, and reset", () => {
  const left=fakeCores("left"), right=fakeCores("right");
  const L=create(left), R=create(right);
  const one=new Float32Array(1000).fill(1), y=new Float32Array(one.length);
  L.processInto(one,y);
  assert(y.every(v=>v<=0.5));
  assert.equal(L.diagnostics.updates,2);assert.equal(R.diagnostics.updates,0);
  assert.deepEqual(left.updates[0],Array(6).fill(50));
  assert.deepEqual(left.updates[1],Array(6).fill(75));
  assert.equal(L.diagnostics.hearingOutputAuthorized,false);
  assert.equal(L.diagnostics.audioRoute,"none");
  L.reset();
  assert.equal(L.diagnostics.initialized,false);
  assert.equal(L.diagnostics.acceptedSamples,0);
  assert.equal(L.diagnostics.updates,0);
  assert.equal(R.diagnostics.acceptedSamples,0);
  L.processInto(new Float32Array(1),new Float32Array(1));
  assert.deepEqual(left.updates[0],Array(6).fill(50));
});

test("malformed synthetic PCM faults before changing destination; reset recovers", () => {
  const core=create();
  const dest=new Float32Array(3).fill(.25);
  assert.throws(()=>core.processInto(Float32Array.from([.1, NaN, .2]),dest),/finite/);
  assert.deepEqual(dest,new Float32Array(3).fill(.25));
  assert.equal(core.diagnostics.faulted,true);
  assert.throws(()=>core.processInto(new Float32Array(3),dest),/faulted/);
  core.reset();assert.equal(core.processInto(new Float32Array(3),dest),3);
  assert.throws(()=>core.processInto(dest,dest),/independent/);
});

test("rejects non-synthetic configuration and previously used or routed cores", () => {
  assert.throws(()=>create(fakeCores(),{usage:"live"}),/synthetic/);
  assert.throws(()=>create(fakeCores(),{controlIntervalSamples:1}),/interval/);
  assert.throws(()=>create(fakeCores(),{route:"headphones"}),/synthetic/);
  const used=fakeCores();used.detector.process(new Float32Array(1));
  assert.throws(()=>create(used),/fresh/);
});

test("source has no microphone, browser, playback, or network interfaces", () => {
  const text=readFileSync(new URL("./offline-auto-fir.mjs", import.meta.url),"utf8");
  for(const re of [/\bAudioTrack\b/,/\bgetUserMedia\b/,/\bAudioContext\b/,/\bWebSocket\b/,/\bfetch\s*\(/,/\bAudioWorklet\b/])
    assert.doesNotMatch(text,re);
});
