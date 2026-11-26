import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = "apps/android-aaudio-physical-zero-lab/app/";
const manifest = readFileSync(app + "src/main/AndroidManifest.xml", "utf8");
const gradle = readFileSync(app + "build.gradle", "utf8");
const native = readFileSync(app + "src/main/cpp/zero_callback.cpp", "utf8");
const core = readFileSync(app + "src/main/cpp/zero_output_core.hpp", "utf8");
const activity = readFileSync(app + "src/main/java/org/hearlens/physicalzero/MainActivity.kt", "utf8");
const build = readFileSync("scripts/android/Build-PhysicalZeroAAudioLab.ps1", "utf8");
const runner = readFileSync("scripts/android/Test-AndroidPhysicalZeroAAudioLab.ps1", "utf8");
const workflow = readFileSync(".github/workflows/android-aaudio-callback.yml", "utf8");

test("physical build is isolated, ARM64-only, permissionless, and has no DSP", () => {
  assert.doesNotMatch(manifest, /<uses-permission\b/i);
  assert.match(gradle, /applicationId 'org\.hearlens\.physicalzero'/);
  assert.match(gradle, /abiFilters 'arm64-v8a'/);
  assert.match(manifest, /android:exported="true"/);
  assert.doesNotMatch(native + activity, /AudioRecord|BluetoothAdapter|BluetoothA2dp|NativeSession|AutoFIR|AutoFir|fixture/i);
  assert.doesNotMatch(manifest, /RECORD_AUDIO|BLUETOOTH|INTERNET|MODIFY_AUDIO_SETTINGS/i);
  assert.match(native, /AAUDIO_DIRECTION_OUTPUT/);
  assert.match(native, /AAUDIO_FORMAT_PCM_FLOAT/);
  assert.match(native, /AAudioStreamBuilder_setDeviceId\(builder, expectedDeviceId\)/);
  assert.match(native, /actualDeviceId != expectedDeviceId/);
  assert.match(native, /AAudioStream_getDeviceId\(stream\)/);
  assert.match(native, /native_session_invocations\\":0/);
});

test("data callback zeroes and scans the entire actual frame span before metrics", () => {
  const callbackStart = native.indexOf("aaudio_data_callback_result_t dataCallback(");
  const callbackEnd = native.indexOf("void errorCallback(", callbackStart);
  assert.ok(callbackStart >= 0 && callbackEnd > callbackStart);
  const callback = native.slice(callbackStart, callbackEnd);
  assert.ok(callback.indexOf("callbacksInFlight.fetch_add") < callback.indexOf("clearAndVerifyZero"));
  assert.ok(callback.indexOf("clearAndVerifyZero") < callback.indexOf("callbackCount.fetch_add"));
  assert.match(core, /for \(std::size_t index = 0; index < sampleCount; \+\+index\) \{\s*output\[index\] = 0\.0F;/);
  assert.match(core, /nonZeroSamples/);
  assert.doesNotMatch(callback, /JNIEnv|new\s|malloc\s*\(|fstream|mutex|sleep_for|AudioRecord|NativeSession/);
  assert.match(callback, /callbackBudgetNs/);
  assert.match(callback, /kCallbackOverrun/);
  assert.match(callback, /kNonZeroOutput/);
  assert.match(callback, /kCallbackOverlap/);
  const errorStart = native.indexOf("void errorCallback(");
  const errorEnd = native.indexOf("const char* sharingModeName(", errorStart);
  const errorCallback = native.slice(errorStart, errorEnd);
  assert.match(errorCallback, /callbacksInFlight\.fetch_add[\s\S]*?errorCallbackCount\.fetch_add[\s\S]*?streamErrorCode\.store[\s\S]*?callbacksInFlight\.fetch_sub/);
});

test("physical route, foreground, stop, and teardown checks fail closed", () => {
  const requestedRoute = native.indexOf("AAudioStreamBuilder_setDeviceId(builder, expectedDeviceId)");
  const actualRouteCheck = native.indexOf("if (session->actualDeviceId != expectedDeviceId)");
  const startStream = native.indexOf("AAudioStream_requestStart(stream)");
  assert.ok(requestedRoute >= 0 && actualRouteCheck > requestedRoute && startStream > actualRouteCheck);
  assert.match(native, /kMaximumDurationMs = 60'000/);
  assert.match(native, /gStopRequestedToken/);
  assert.match(native, /gStopRequestedToken\.load\(std::memory_order_acquire\) == token/);
  assert.match(native, /AAudioStream_requestStop\(stream\)/);
  assert.match(native, /AAudioStream_close\(stream\)/);
  assert.match(native, /gDrainTimeoutFailStop\.store\(true/);
  assert.match(activity, /contentDescription = "Stop zero-only AAudio test"/);
  assert.match(activity, /onStop\(\)[\s\S]*?nativeRequestStop\(activeRunToken\)/);
  assert.match(activity, /TYPE_BUILTIN_SPEAKER/);
  assert.match(activity, /outputs\.any\s*\{/);
  assert.match(activity, /AAudio|zero-only/i);
});

test("physical runner pins the serial and requires matching owner and independent review records", () => {
  assert.match(runner, /ValidateSet\('ZY22FWGQTB'\)/);
  assert.match(runner, /ANDROID_ADB -s \$Serial/);
  assert.match(runner, /\$adbGatePassed = \$true/);
  assert.match(runner, /if \(\$adbGatePassed\)\s*\{\s*try \{ Save-TargetDiagnostics/);
  assert.match(runner, /OwnerAuthorizationRecord/);
  assert.match(runner, /IndependentReviewRecord/);
  assert.match(runner, /owner\.apkSha256\.ToLowerInvariant\(\) -ne \$expectedSha/);
  assert.match(runner, /review\.apkSha256\.ToLowerInvariant\(\) -ne \$expectedSha/);
  assert.match(runner, /review\.reviewedAreas/);
  assert.match(runner, /\[string\]\$review\.reviewer -eq \[string\]\$owner\.owner/);
  assert.match(runner, /aaudio_xrun_delta -gt 0/);
  assert.match(runner, /aaudio_stream_error_code -ne 0/);
  assert.match(runner, /aaudio_error_callback_count -gt 0/);
  assert.match(native, /streamErrorCode == AAUDIO_OK/);
  assert.match(native, /streamErrorCode != AAUDIO_OK/);
  assert.match(runner, /nonzero_output_samples_observed -ne 0/);
  assert.match(build, /aapt dump permissions/);
  assert.match(build, /installOrStreamStarted = \$false/);
  assert.match(build, /Get-FileHash -LiteralPath \$apk -Algorithm SHA256/);
  assert.match(workflow, /Build permissionless physical zero-only ARM64 APK/);
  assert.match(workflow, /hearlens-physical-zero-aaudio-arm64-apk/);
  assert.match(workflow, /physical_zero_output_core_test\.cpp/);
  assert.match(workflow, /Check out exact physical APK source revision/);
  assert.match(workflow, /path: physical-zero-source/);
  assert.match(workflow, /EXPECTED_SOURCE_COMMIT: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
  assert.match(workflow, /source_commit=\$\(git -C "\$source_root" rev-parse HEAD\)/);
  assert.match(workflow, /test "\$source_commit" = "\$EXPECTED_SOURCE_COMMIT"/);
  assert.match(workflow, /--project-dir "\$source_root\/apps\/android-aaudio-physical-zero-lab"/);
});
