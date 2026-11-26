import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = "apps/android-aaudio-physical-zero-lab/app/";
const manifest = readFileSync(app + "src/main/AndroidManifest.xml", "utf8");
const gradle = readFileSync(app + "build.gradle", "utf8");
const native = readFileSync(app + "src/main/cpp/zero_callback.cpp", "utf8");
const core = readFileSync(app + "src/main/cpp/zero_output_core.hpp", "utf8");
const activity = readFileSync(app + "src/main/java/org/hearlens/physicalzero/MainActivity.kt", "utf8");
const policy = readFileSync(app + "src/main/java/org/hearlens/physicalzero/ZeroOnlyRoutePolicy.kt", "utf8");
const policyTests = readFileSync(app + "src/test/java/org/hearlens/physicalzero/ZeroOnlyRoutePolicyTest.kt", "utf8");
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

test("data callback only writes and verifies zero samples without control-plane work", () => {
  const callbackStart = native.indexOf("aaudio_data_callback_result_t dataCallback(");
  const callbackEnd = native.indexOf("void errorCallback(", callbackStart);
  assert.ok(callbackStart >= 0 && callbackEnd > callbackStart);
  const callback = native.slice(callbackStart, callbackEnd);
  assert.ok(callback.indexOf("callbacksInFlight.fetch_add") < callback.indexOf("clearAndVerifyZero"));
  assert.ok(callback.indexOf("clearAndVerifyZero") < callback.indexOf("callbackCount.fetch_add"));
  assert.match(core, /for \(std::size_t index = 0; index < sampleCount; \+\+index\) \{\s*output\[index\] = 0\.0F;/);
  assert.match(core, /nonZeroSamples/);
  assert.doesNotMatch(callback, /JNIEnv|new\s|malloc\s*\(|fstream|mutex|sleep_for|AudioRecord|NativeSession|AAudioStream_getDeviceId/);
  assert.match(callback, /callbackBudgetNs/);
  assert.match(callback, /kCallbackOverrun/);
  assert.match(callback, /kNonZeroOutput/);
  assert.match(callback, /kCallbackOverlap/);
  const errorStart = native.indexOf("void errorCallback(");
  const errorEnd = native.indexOf("const char* sharingModeName(", errorStart);
  const errorCallback = native.slice(errorStart, errorEnd);
  assert.match(errorCallback, /callbacksInFlight\.fetch_add[\s\S]*?errorCallbackCount\.fetch_add[\s\S]*?streamErrorCode\.store[\s\S]*?callbacksInFlight\.fetch_sub/);
  assert.match(errorCallback, /AAUDIO_ERROR_DISCONNECTED/);
});

test("zero-only route policy recognizes but never targets the telephony inventory endpoint", () => {
  assert.match(activity, /getAudioDevicesForAttributes\(mediaAttributes\)/);
  assert.match(activity, /AudioAttributes\.USAGE_MEDIA/);
  assert.match(activity, /AudioDeviceInfo\.TYPE_TELEPHONY -> RouteDeviceKind\.TELEPHONY/);
  assert.match(activity, /addOnModeChangedListener\(routeExecutor, modeChangedListener\)/);
  assert.match(activity, /ROUTE_POLL_INTERVAL_MS = 100L/);
  assert.match(activity, /nativePublishRouteSnapshot\(/);
  assert.doesNotMatch(activity, /device\.id\s*==\s*9|id\s*==\s*9/);
  assert.match(policy, /RouteDeviceKind\.TELEPHONY/);
  assert.match(policy, /predictedDevice\.kind != RouteDeviceKind\.BUILTIN_SPEAKER/);
  assert.match(policy, /predicted\.size != 1/);
  assert.match(policy, /snapshot\.audioModeBeforeQueries != MODE_NORMAL/);
  assert.match(policy, /expected\.routeGeneration/);
  assert.match(policyTests, /attachedTelephonyEndpointIsInventoryOnly/);
  assert.match(policyTests, /communicationOrOtherAudioModeIsRejected/);
  assert.match(policyTests, /bluetoothUsbWiredAndUnknownInventoryAreRejected/);
  assert.match(policyTests, /multipleSpeakerIDsAndMultiplePredictedRoutesAreRejected/);
  assert.match(policyTests, /nonSpeakerPredictedRoutesAndMismatchedIDsAreRejected/);
  assert.match(policyTests, /emptyFailedAndUnavailableRouteQueriesAreRejected/);
  assert.match(policyTests, /openStartAndRuntimeRouteChangesFailTheAnchoredGeneration/);
  assert.match(policyTests, /staleGenerationAndStopRestartTokensAreRejected/);
});

test("native route generation and actual device checks bracket open/start and poll during run", () => {
  const builderRoute = native.indexOf("AAudioStreamBuilder_setDeviceId(builder, expectedDeviceId)");
  const policyBeforeOpen = native.indexOf("session->routePolicyValidBeforeOpen = routePolicyMatches", builderRoute);
  const streamOpen = native.indexOf("AAudioStreamBuilder_openStream(builder, &stream)", policyBeforeOpen);
  const actualRouteCheck = native.indexOf("if (session->actualDeviceId != expectedDeviceId)", streamOpen);
  const policyBeforeStart = native.indexOf("session->routePolicyValidBeforeStart = routePolicyMatches", actualRouteCheck);
  const startStream = native.indexOf("AAudioStream_requestStart(stream)", policyBeforeStart);
  const routePoll = native.indexOf("if (!routePolicyMatches(token, routeGeneration, expectedDeviceId))", startStream);
  const actualIdPoll = native.indexOf("session->lastObservedDeviceId = AAudioStream_getDeviceId(stream)", routePoll);
  assert.ok(builderRoute >= 0 && policyBeforeOpen > builderRoute && streamOpen > policyBeforeOpen);
  assert.ok(actualRouteCheck > streamOpen && policyBeforeStart > actualRouteCheck);
  assert.ok(startStream > policyBeforeStart && routePoll > startStream && actualIdPoll > routePoll);
  assert.match(native, /routePolicyInvalidationMonotonicNs/);
  assert.match(native, /routeMismatchMonotonicNs/);
  assert.match(native, /AAUDIO_STREAM_STATE_DISCONNECTED/);
  assert.match(native, /AAudioStream_requestStop\(stream\)/);
  assert.match(native, /AAudioStream_close\(stream\)/);
  assert.match(native, /gDrainTimeoutFailStop\.store\(true/);
  assert.match(native, /kRoutePolicyInvalidated/);
  assert.match(native, /kLifecycleInvalidated/);
  assert.doesNotMatch(native.slice(native.indexOf("aaudio_data_callback_result_t dataCallback("), native.indexOf("void errorCallback(")), /routePolicyMatches|gRoutePolicyMutex/);
});

test("route changes, mode transitions, device inventory changes, and lifecycle fail-stop without reopening", () => {
  assert.match(activity, /audioManager\.mode/);
  assert.match(activity, /onAudioDevicesAdded/);
  assert.match(activity, /onAudioDevicesRemoved/);
  assert.match(activity, /STOP_REASON_ROUTE_POLICY/);
  assert.match(activity, /STOP_REASON_LIFECYCLE/);
  assert.match(activity, /route snapshot changed during the run/);
  assert.match(activity, /nativeRequestStop\(context\.runToken, reasonCode\)/);
  assert.doesNotMatch(activity, /nativeRunBuiltInSpeaker\([^\n]*\).*nativeRunBuiltInSpeaker/);
  assert.match(activity, /route_policy_hardware_guarantee.*false/);
});

test("physical runner pins the serial, exact hash, route evidence, stop, and teardown gates", () => {
  assert.match(runner, /ValidateSet\('ZY22FWGQTB'\)/);
  assert.match(runner, /ANDROID_ADB -s \$Serial/);
  assert.match(runner, /\$adbGatePassed = \$true/);
  assert.match(runner, /if \(\$adbGatePassed\)\s*\{\s*try \{ Save-TargetDiagnostics/);
  assert.match(runner, /OwnerAuthorizationRecord/);
  assert.match(runner, /IndependentReviewRecord/);
  assert.match(runner, /OwnerReviewWaiverRecord/);
  assert.match(runner, /owner\.apkSha256\.ToLowerInvariant\(\) -ne \$expectedSha/);
  assert.match(runner, /actual_output_device_id_before_start/);
  assert.match(runner, /route_policy_valid_before_open/);
  assert.match(runner, /mediaPredictedRoute\[0\]\.kind -ne 'BUILTIN_SPEAKER'/);
  assert.match(runner, /aaudio_stop_result -ne 0/);
  assert.match(runner, /aaudio_close_result -ne 0/);
  assert.match(runner, /callback_drain_confirmed/);
  assert.match(build, /API33_MEDIA_PREDICTION_GENERATION_AND_AAUDIO_ID_MONITOR/);
  assert.match(build, /ZeroOnlyRoutePolicy\.kt/);
  assert.match(build, /aapt dump permissions/);
  assert.match(build, /installOrStreamStarted = \$false/);
  assert.match(build, /Get-FileHash -LiteralPath \$apk -Algorithm SHA256/);
  assert.match(workflow, /Run physical zero-only route policy host tests/);
  assert.match(workflow, /:app:testDebugUnitTest/);
  assert.match(workflow, /hearlens-physical-zero-aaudio-arm64-apk/);
  assert.match(workflow, /Check out exact physical APK source revision/);
  assert.match(workflow, /EXPECTED_SOURCE_COMMIT: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
  assert.match(workflow, /test "\$source_commit" = "\$EXPECTED_SOURCE_COMMIT"/);
});
