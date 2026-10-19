import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const dir="apps/android-acoustic-bench/";
const main=readFileSync(dir+"app/src/main/java/org/hearlens/acousticbench/MainActivity.java","utf8");
const signal=readFileSync(dir+"app/src/main/java/org/hearlens/acousticbench/BenchSelfTestSignal.java","utf8");
const gate=readFileSync(dir+"app/src/main/java/org/hearlens/acousticbench/BenchSessionGate.java","utf8");
const self=main.split("private void runSelfTestLoop(")[1]?.split("private void checkActualRoutes()")[0]??"";
test("D6 generated chirp never reads microphone or stores raw audio",()=>{
 assert.ok(self.length>2000);
 assert.doesNotMatch(self,/new AudioRecord|record\.read|startRecording|MediaRecorder/);
 assert.match(main,/mic = selfTest \? null : findBuiltinMic\(\)/);
 assert.match(main,/boolean needsMicPermission = !selfTestSelected\(\)/);
 assert.match(main,/input=NONE source=APP_GENERATED_CHIRP/);
 assert.doesNotMatch(main,/FileOutputStream|HttpURLConnection|getSharedPreferences\(/);
});
test("D6 is L1-only with digital limit, bounded session and media volume",()=>{
 assert.match(main,/selfTest && levelIndex != 1/);
 assert.match(main,/outputLevels\.check\(8001\)/);
 assert.match(self,/profile\.process\(signal\.sampleAt\(produced\+i\)\)/);
 assert.match(main,/current \* 5 <= max/);
 assert.match(self,/safeSelfTestMediaVolume\(\)/);
 assert.match(signal,/TOTAL_MS=6_500/);
 assert.match(signal,/CHIRP_COUNT=6/);
 assert.match(signal,/CHIRP_MS=160/);
});
test("D6 keeps off-ear checks and fail-stop A2DP safeguards",()=>{
 assert.match(main,/offEar\.isChecked\(\) && volumeLow\.isChecked\(\)/);
 assert.match(main,/self_test_requires_air31_product_name/);
 assert.match(self,/track\.getRoutedDevice\(\)/);
 assert.match(self,/gate\.checkOutputOnly/);
 assert.match(self,/track\.setVolume\(0f\)/);
 assert.match(main,/onAudioDevicesRemoved|a2dp_disconnected/);
 assert.match(main,/app_left_foreground/);
 assert.match(main,/user_pressed_stop/);
 assert.match(gate,/state\s*=\s*State\.STOPPED/);
});

test("D6.1 queues PCM against playback-head progress and never treats write completion as playback",()=>{
 assert.match(self,/new BenchPlaybackProgress\(/);
 assert.match(self,/track\.getPlaybackHeadPosition\(\)/);
 assert.match(self,/progress\.canQueue\(\)/);
 assert.match(self,/progress\.startDrain\(/);
 assert.match(self,/if\(progress\.drained\(\)\)/);
 assert.match(self,/self_test_drain_timeout/);
 assert.match(self,/self_test_playback_head_stalled/);
 assert.match(self,/self_test_android_playback_drain_confirmed=true/);
 assert.match(main,/android_drain_confirmed=/);
 assert.match(main,/acoustic_output_verified=false/);
 const completeIndex=self.indexOf('abort("self_test_complete")');
 const drainedIndex=self.indexOf("if(progress.drained())");
 assert.ok(completeIndex>drainedIndex && drainedIndex>=0);
 assert.doesNotMatch(self,/SystemClock\.elapsedRealtime\(\)-stallStart>500/);
});
