import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const root="apps/android-acoustic-bench/";
const main=readFileSync(root+"app/src/main/java/org/hearlens/acousticbench/MainActivity.java","utf8");
const gate=readFileSync(root+"app/src/main/java/org/hearlens/acousticbench/BenchSessionGate.java","utf8");
const manifest=readFileSync(root+"app/src/main/AndroidManifest.xml","utf8");
const sw4=readFileSync("apps/android-mic-probe/app/src/main/java/org/hearlens/micprobe/MainActivity.java","utf8");

test("M04-D4 separate debug-only APK must never modify existing SW4 input probe",()=>{
  assert.match(main,/HearLens M04-D4/);
  assert.match(sw4,/SW4_OUTPUT_ACTUAL_ROUTE=UNOBSERVABLE_NO_PLAYBACK|SW3_OUTPUT_ACTUAL_ROUTE=UNOBSERVABLE_NO_PLAYBACK/);
  assert.doesNotMatch(sw4,/new\s+AudioTrack\s*\(/);
  assert.doesNotMatch(manifest,/android\.permission\.INTERNET/);
  assert.doesNotMatch(manifest,/<service\b/);
  assert.match(manifest,/android\.permission\.RECORD_AUDIO/);
  assert.match(manifest,/android\.permission\.BLUETOOTH_CONNECT/);
});
test("M04-D4 nonhuman PCM path defaults to weak, bounded, time-limited and manually stopped",()=>{
  assert.match(main,/DIGITAL_LIMIT\s*=\s*384/);
  assert.match(main,/TRACK_VOLUME\s*=\s*0\.15f/);
  assert.match(main,/DIGITAL_GAIN\s*=\s*8/);
  assert.match(main,/Math\.max\(-DIGITAL_LIMIT,Math\.min\(DIGITAL_LIMIT,sample\)\)/);
  assert.match(main,/track\.setVolume\(0f\)/);
  assert.match(main,/track\.setVolume\(TRACK_VOLUME\)/);
  assert.match(main,/setText\("立即停止"\)/);
  assert.match(main,/offEar\.isChecked\(\)/);
  assert.match(main,/volumeLow\.isChecked\(\)/);
  assert.match(gate,/SESSION_MS\s*=\s*40_000/);
  assert.match(gate,/State\.SILENT_ROUTE_CHECK/);
  assert.match(gate,/state\s*=\s*State\.STOPPED/);
});
test("M04-D4 requires the *actual playing A2DP* rather than a preferred route alone",()=>{
  assert.match(main,/track\.play\(\)/);
  assert.match(main,/track\.getRoutedDevice\(\)/);
  assert.match(main,/record\.getRoutedDevice\(\)/);
  assert.match(main,/TYPE_BLUETOOTH_A2DP/);
  assert.match(main,/TYPE_BUILTIN_MIC/);
  assert.match(main,/setPreferredDevice\(bt\)/);
  assert.match(main,/setPreferredDevice\(mic\)/);
  assert.match(main,/silent_route_not_air31/);
  assert.match(main,/active_route=A2DP/);
});
test("M04-D4 stops on lost route, call/focus, mic error, timeout, background and manual Stop",()=>{
  for(const term of [
    "onAudioDevicesRemoved","route_changed","audio_focus_interrupted",
    "audio_focus_denied","getMode() == AudioManager.MODE_NORMAL",
    "onPause()","app_left_foreground","READ_NON_BLOCKING","WRITE_NON_BLOCKING",
    "timeout_call_or_mic_watchdog","capture.stop()","playback.flush()",
    "active.compareAndSet(true,false)"
  ]) assert.ok(main.includes(term),term);
  assert.doesNotMatch(main,/getSharedPreferences\(/);
  assert.doesNotMatch(main,/AudioManager\.setMode\(/);
  assert.doesNotMatch(main,/HttpURLConnection|WebSocket|FileOutputStream/);
  assert.doesNotMatch(gate,/reset\(/);
});
