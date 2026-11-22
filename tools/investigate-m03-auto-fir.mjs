/** Synthetic PCM only. Linux with schedstat, Node 22+, and --expose-gc. */
import assert from "node:assert/strict";
import { closeSync, openSync, readFileSync, readSync } from "node:fs";
import { cpus } from "node:os";
import { PerformanceObserver } from "node:perf_hooks";
import { setImmediate } from "node:timers/promises";
import { core, makeDetector, makeFir, pcm } from "../packages/dsp/offline-auto-fir.testkit.mjs";

const rate = 48000;
const size = 128;
const interval = 480;
const ears = ["left", "right"];
const deadlineMs = 1000 * size / rate;

function schedulerSnapshot() {
  const read = path => {
    try { return readFileSync(path, "utf8").trim(); }
    catch { return null; }
  };
  return {
    quota: read("/sys/fs/cgroup/cpu.max"),
    cgroup: read("/sys/fs/cgroup/cpu.stat"),
    thread: read("/proc/thread-self/schedstat"),
  };
}

async function tail() {
  assert(global.gc, "Requires --expose-gc");
  const fd = openSync("/proc/thread-self/schedstat", "r");
  const statBuffer = Buffer.alloc(96);
  let runtimeNs, waitNs;
  function readThreadClock() {
    const bytes = readSync(fd, statBuffer, 0, statBuffer.length, 0);
    let pos = 0;
    runtimeNs = 0;
    while (pos < bytes && statBuffer[pos] !== 32) runtimeNs = runtimeNs * 10 + statBuffer[pos++] - 48;
    waitNs = 0;
    pos++;
    while (pos < bytes && statBuffer[pos] !== 32) waitNs = waitNs * 10 + statBuffer[pos++] - 48;
  }
  const gcEvents = [];
  const obs = new PerformanceObserver(list => {
    for (const event of list.getEntries()) gcEvents.push({
      start: event.startTime, end: event.startTime + event.duration, kind: event.detail.kind,
    });
  });
  obs.observe({ entryTypes: ["gc"] });
  const runs = [];
  for (let rep = 0; rep < 8; rep++) {
    const warmCallbacks = 1560, callbacks = 12000;
    const views = ears.map((_, ear) => {
      const input = Float32Array.from({length: size * (warmCallbacks + callbacks)},
        (_, i) => pcm[(i + ear * 137) % pcm.length]);
      return Array.from({length: warmCallbacks + callbacks}, (_, i) =>
        input.subarray(i * size, (i + 1) * size));
    });
    const dst = ears.map(() => new Float32Array(size));
    const processors = ears.map(ear => core(ear));
    function callback(i) {
      processors[0].processInto(views[0][i], dst[0]);
      processors[1].processInto(views[1][i], dst[1]);
    }
    for (let i = 0; i < warmCallbacks; i++) callback(i);
    global.gc();
    // Avoid per-callback log objects and defer attribution until the observer drains.
    const start = new Float64Array(callbacks), end = new Float64Array(callbacks);
    const cpu = new Float64Array(callbacks), schedulerWait = new Float64Array(callbacks);
    const schedulerBefore = schedulerSnapshot();
    for (let i = 0; i < callbacks; i++) {
      readThreadClock();
      const before = runtimeNs, beforeWait = waitNs;
      start[i] = performance.now();
      callback(i + warmCallbacks);
      end[i] = performance.now();
      readThreadClock();
      cpu[i] = (runtimeNs - before) / 1e6;
      schedulerWait[i] = (waitNs - beforeWait) / 1e6;
    }
    const schedulerAfter = schedulerSnapshot();
    await setImmediate();
    await setImmediate();
    const groups = { retarget: [], noRetarget: [] };
    const busy = { retarget: [], noRetarget: [] };
    const misses = [];
    let inconsistentCpuReadings = 0;
    const timedGcEvents = gcEvents.filter(e => e.start < end.at(-1) && e.end > start[0]);
    for (let i = 0; i < callbacks; i++) {
      const wall = end[i] - start[i];
      if (cpu[i] > wall + 0.25) inconsistentCpuReadings++;
      const first = size * (i + warmCallbacks);
      const retarget = Math.floor(first / interval) !== Math.floor((first + size) / interval);
      const group = retarget ? "retarget" : "noRetarget";
      groups[group].push(wall);
      busy[group].push(cpu[i]);
      if (wall > deadlineMs) {
        const overlaps = timedGcEvents.filter(e => e.start < end[i] && e.end > start[i]);
        const offCpuMs = Math.max(0, wall - cpu[i]);
        const waitMs = schedulerWait[i];
        const consistent = cpu[i] <= wall + 0.25 && cpu[i] + waitMs <= wall + 0.25;
        const cause = overlaps.length ? "gc-overlap" :
          !consistent ? "clock-inconsistent" :
          waitMs > 0.25 && wall - waitMs <= deadlineMs ? "runnable-scheduler-wait" :
          cpu[i] > deadlineMs ? "on-thread-budget-overrun" :
          offCpuMs > 0.25 ? "off-thread-gap" : "unresolved";
        misses.push({ i, retarget, wall, cpuMs: cpu[i], waitMs, offCpuMs, overlaps, cause });
      }
    }
    function summary(values) {
      values.sort((a, b) => a - b);
      return {
        count: values.length, mean: values.reduce((a, b) => a + b, 0) / values.length,
        p99: values[Math.ceil(values.length * .99) - 1], max: values.at(-1),
      };
    }
    const all = [...groups.retarget, ...groups.noRetarget];
    runs.push({ schedulerBefore, schedulerAfter, inconsistentCpuReadings, timedGcEvents, misses, allWall: summary(all),
      retarget: { wall: summary(groups.retarget), cpu: summary(busy.retarget) },
      noRetarget: { wall: summary(groups.noRetarget), cpu: summary(busy.noRetarget) },
    });
  }
  obs.disconnect();
  closeSync(fd);
  return runs;
}

function dynamics() {
  const low = 0.006, high = 0.08;
  const signal = Float32Array.from({length: 12 * rate}, (_, i) =>
    (i >= 4 * rate && i < 6 * rate ? high : low) * Math.sin(2 * Math.PI * 1000 * i / rate));
  function levelsAtSteady(amplitude) {
    const detector = makeDetector();
    const cycle = Float32Array.from({length: interval}, (_, i) =>
      amplitude * Math.sin(2 * Math.PI * 1000 * i / rate));
    for (let i = 0; i < 600; i++) detector.process(cycle);
    return detector.readNominalLevelsInto(new Float64Array(6));
  }
  const steadyLow = levelsAtSteady(low), steadyHigh = levelsAtSteady(high);
  const windows = [-100, 0, 10, 30, 50, 100, 200, 400, 900, 1500, 2500];
  const left = ears[0];
  const realAuto = core(left);
  const referenceOutput = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i += interval) {
    realAuto.processInto(signal.subarray(i, i + interval), referenceOutput.subarray(i, i + interval));
  }
  const rows = [];
  for (const smoothDetector of [false, true]) {
    for (const morphFir of [false, true]) {
      const detector = makeDetector(), fir = makeFir(left);
      const levels = new Float64Array(6);
      const scratch = new Float32Array(512);
      const output = new Float32Array(signal.length);
      fir.setSyntheticBandLevels(smoothDetector ? Array(6).fill(50) : Array.from(steadyLow));
      for (let i = 0; i < signal.length; i += interval) {
        const chunk = signal.subarray(i, i + interval);
        if (!morphFir) {
          // A fresh, frozen kernel sees exactly the previous 512 input samples.
          // Starting at the latest target makes the transition instantaneous.
          fir.reset();
          fir.setSyntheticBandLevels(Array.from(i && smoothDetector ? levels :
            i > 4 * rate && i <= 6 * rate ? steadyHigh : steadyLow));
          const history = signal.subarray(Math.max(0, i - 512), i);
          if (history.length) fir.processInto(history, scratch);
        }
        fir.processInto(chunk, output.subarray(i, i + interval));
        detector.process(chunk);
        detector.readNominalLevelsInto(levels);
        if (morphFir) fir.setSyntheticBandLevels(Array.from(smoothDetector ? levels :
          i >= 4 * rate && i < 6 * rate ? steadyHigh : steadyLow));
      }
      if (smoothDetector && morphFir) assert.deepEqual(output, referenceOutput);
      function gainDb(ms) {
        let power = 0, inputPower = 0;
        for (let i = 48 * ms; i < 48 * ms + interval; i++) {
          inputPower += signal[i] ** 2;
          power += output[i + 256] ** 2;
        }
        return 10 * Math.log10(power / inputPower);
      }
      // Use a dense 10 ms grid for the first midpoint crossing, while keeping
      // the tabulated traces compact. Both directions steady at these anchors.
      const midpoint = (gainDb(3900) + gainDb(5900)) / 2;
      const crossing = (start, crossed) => {
        for (let ms = 0; ms <= 2500; ms += 10) {
          if (crossed(gainDb(start + ms), midpoint)) return ms;
        }
        return null;
      };
      rows.push({ smoothDetector, morphFir,
        attackMidpointMs: crossing(4000, (gain, target) => gain <= target),
        releaseMidpointMs: crossing(6000, (gain, target) => gain >= target),
        attack: windows.filter(ms => ms < 2000).map(ms => ({ ms, db: gainDb(4000 + ms) })),
        release: windows.map(ms => ({ ms, db: gainDb(6000 + ms) })),
      });
    }
  }
  return { steadyLow: Array.from(steadyLow), steadyHigh: Array.from(steadyHigh), rows };
}
if (process.argv.includes("--dynamics")) {
  console.log(JSON.stringify(dynamics(), null, 2));
} else {
  console.log(JSON.stringify({ node: process.version, arch: process.arch,
    cpu: cpus()[0]?.model, deadlineMs, runs: await tail() }, null, 2));
}
