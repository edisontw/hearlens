import assert from "node:assert/strict";
import test from "node:test";
import { createCaptionNoTextMonitor } from "./caption-stt-health.mjs";

test("does not warn for silence or short sessions even with sent PCM", () => {
  const monitor = createCaptionNoTextMonitor();
  monitor.onAudioSent(1000);
  for (let i = 0; i < 20; i++) monitor.onAudioLevel("active=0");
  assert.equal(monitor.shouldWarn(60000), false);
  for (let i = 0; i < 5; i++) monitor.onAudioLevel("mode=adaptive active=1 out-peak=-20");
  assert.equal(monitor.shouldWarn(60000), false);
  monitor.onAudioLevel("mode=adaptive active=1 out-peak=-20");
  assert.equal(monitor.shouldWarn(15999), false);
  assert.equal(monitor.shouldWarn(16000), true);
  assert.equal(monitor.shouldWarn(80000), false);
});

test("any meaningful caption suppresses missing-text hint", () => {
  const monitor = createCaptionNoTextMonitor();
  monitor.onAudioSent(0);
  for (let i = 0; i < 7; i++) monitor.onAudioLevel("active=1 out-peak=-30");
  monitor.onRecognizedText(" ");
  assert.equal(monitor.shouldWarn(16000), true);
  monitor.reset();
  monitor.onAudioSent(0);
  for (let i = 0; i < 7; i++) monitor.onAudioLevel("active=1 out-peak=-30");
  monitor.onRecognizedText("測試字幕");
  assert.equal(monitor.shouldWarn(16000), false);
});

test("reset isolates sessions; noise cannot fake active=1", () => {
  const monitor = createCaptionNoTextMonitor();
  monitor.onAudioSent(100);
  for (let i = 0; i < 8; i++) monitor.onAudioLevel("mode=adaptive inactive=1 active=0");
  assert.equal(monitor.shouldWarn(20000), false);
  for (let i = 0; i < 6; i++) monitor.onAudioLevel("active=1");
  assert.equal(monitor.shouldWarn(20000), true);
  monitor.reset();
  assert.equal(monitor.shouldWarn(20000), false);
  monitor.onAudioSent(21000);
  assert.equal(monitor.shouldWarn(40000), false);
});
