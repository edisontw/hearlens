import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = "apps/android-aaudio-callback-lab/";
const manifest = readFileSync(root + "app/src/main/AndroidManifest.xml", "utf8");
const native = readFileSync(root + "app/src/main/cpp/aaudio_callback_bridge.cpp", "utf8");
const core = readFileSync("research/android-aaudio-callback/callback_core.hpp", "utf8");
const gradle = readFileSync(root + "app/build.gradle", "utf8");

test("AAudio callback research APK is separate and requests no permissions", () => {
  assert.doesNotMatch(manifest, /<uses-permission\b/i);
  assert.doesNotMatch(manifest, /RECORD_AUDIO|BLUETOOTH|MODIFY_AUDIO_SETTINGS/i);
  assert.match(gradle, /applicationId 'org\.hearlens\.aaudiocallback'/);
  assert.match(native, /AAUDIO_DIRECTION_OUTPUT/);
  assert.match(native, /AAudioStreamBuilder_setSampleRate\(builder, kFixtureSampleRate\)/);
  assert.match(native, /AAUDIO_FORMAT_PCM_FLOAT/);
  assert.match(native, /AAUDIO_SHARING_MODE_SHARED/);
  assert.match(native, /AAUDIO_PERFORMANCE_MODE_LOW_LATENCY/);
  assert.doesNotMatch(native, /AAUDIO_DIRECTION_INPUT|AAudioStream_read\s*\(/);
  assert.doesNotMatch(native, /AudioRecord|AudioTrack|BluetoothAdapter|BluetoothA2dp/);
  assert.match(native, /if \(!isAndroidEmulator\(\)\)[\s\S]*?physical-device AAudio stream is disabled/);
  assert.ok(native.indexOf("if (!isAndroidEmulator())") < native.indexOf("AAudio_createStreamBuilder"));
});

test("every native callback zeroes the output before private DSP and has no result copy", () => {
  const zeroStart = core.indexOf("if (outputBuffer != nullptr && frames > 0)");
  const zeroEnd = core.indexOf("if (outputBuffer == nullptr", zeroStart);
  const privateDsp = core.indexOf("session_.process(", zeroEnd);
  assert.ok(zeroStart >= 0 && zeroEnd > zeroStart && privateDsp > zeroEnd);
  assert.match(core.slice(zeroStart, zeroEnd), /std::fill_n\(outputBuffer,[\s\S]*?0\.0F\)/);
  assert.doesNotMatch(core.slice(privateDsp), /outputBuffer/);

  const callbackStart = native.indexOf("aaudio_data_callback_result_t dataCallback(");
  const callbackEnd = native.indexOf("void errorCallback(", callbackStart);
  assert.ok(callbackStart >= 0 && callbackEnd > callbackStart);
  const callback = native.slice(callbackStart, callbackEnd);
  assert.match(callback, /context->core\.processOutput/);
  assert.doesNotMatch(callback, /JNIEnv|new\s|malloc\s*\(|fstream|mutex|sleep_for|AAudioStream_requestStop|AAudioStream_close/);
  assert.doesNotMatch(native, /AAudioStreamBuilder_setFramesPerDataCallback/);
});

test("callback harness records actual negotiation and labels the five-minute design", () => {
  for (const field of [
    "actual_sample_rate", "requested_sample_rate", "sample_rate_matches_fixture",
    "frames_per_burst", "buffer_size_frames", "deadline_budget_basis",
    "actual_performance_mode", "actual_sharing_mode", "deadline_misses",
    "frame_count_distribution", "callback_interarrival_jitter",
    "callback_thread_cpu", "dsp_fail_stop_count", "xrun_count",
    "allocation_monitor", "requested_equivalent_frames\\\":128",
    "requested_equivalent_duration_ms\\\":300000",
  ]) assert.ok(native.includes(field), field);
  assert.match(native, /AAudioStream_getXRunCount/);
  assert.match(native, /clock_gettime\(CLOCK_THREAD_CPUTIME_ID/);
  assert.match(native, /duration_complete/);
  assert.match(native, /run_completion/);
  assert.match(native, /EARLY_FAIL_STOP/);
  assert.match(native, /callback stream stopped by NativeSession deadline fail-stop/);
  assert.match(native, /CALLBACK_LOG_OVERFLOW/);
  assert.match(native, /CALLBACK_OVERLAP/);
});

test("unscanned performance runs and fail-stop outcomes remain accurately reportable", () => {
  const instrumentation = readFileSync(
    root + "app/src/androidTest/java/org/hearlens/aaudiocallback/AAudioCallbackRuntimeTest.kt",
    "utf8",
  );
  const runner = readFileSync("scripts/android/Test-AndroidAAudioCallbackLab.ps1", "utf8");
  assert.match(instrumentation, /if \(report\.getBoolean\("zero_output_verification_enabled"\)\)/);
  assert.match(instrumentation, /"EARLY_FAIL_STOP" ->/);
  assert.match(instrumentation, /report\.getLong\("deadline_misses"\) > 0L/);
  assert.ok(runner.indexOf("$instrumentExitCode = $LASTEXITCODE") < runner.indexOf("measurement-logcat.log"));
  assert.match(runner, /RECORDED_FAIL_STOP/);
  assert.match(runner, /report \| ConvertTo-Json[\s\S]*?instrumentation failed/);
});
