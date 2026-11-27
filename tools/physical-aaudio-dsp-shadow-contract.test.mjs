import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = "apps/android-aaudio-physical-dsp-shadow-lab/app/";
const manifest = readFileSync(app + "src/main/AndroidManifest.xml", "utf8");
const gradle = readFileSync(app + "build.gradle", "utf8");
const cmake = readFileSync(app + "src/main/cpp/CMakeLists.txt", "utf8");
const bridge = readFileSync(app + "src/main/cpp/shadow_callback_bridge.cpp", "utf8");
const core = readFileSync("research/android-aaudio-callback/callback_core.hpp", "utf8");
const activity = readFileSync(app + "src/main/java/org/hearlens/physicaldsp/MainActivity.kt", "utf8");
const api31Listener = readFileSync(app + "src/main/java/org/hearlens/physicaldsp/AudioModeChangedListenerApi31.kt", "utf8");
const reportStore = readFileSync(app + "src/main/java/org/hearlens/physicaldsp/PhysicalDspShadowReportStore.kt", "utf8");
const policy = readFileSync(app + "src/main/java/org/hearlens/physicaldsp/PhysicalSpeakerRoutePolicy.kt", "utf8");
const policyTests = readFileSync(app + "src/test/java/org/hearlens/physicaldsp/PhysicalSpeakerRoutePolicyTest.kt", "utf8");
const instrumentation = readFileSync(app + "src/androidTest/java/org/hearlens/physicaldsp/ShadowLabRuntimeTest.kt", "utf8");
const verifier = readFileSync(app + "src/androidTest/java/org/hearlens/physicaldsp/PortableOutputVerifier.kt", "utf8");
const build = readFileSync("scripts/android/Build-PhysicalDspShadowAAudioLab.ps1", "utf8");
const runner = readFileSync("scripts/android/Test-AndroidPhysicalDspShadowAAudioLab.ps1", "utf8");

test("physical shadow APK is a separate permissionless ARM64 package", () => {
  assert.doesNotMatch(manifest, /<uses-permission\b/i);
  assert.doesNotMatch(manifest, /RECORD_AUDIO|BLUETOOTH|MODIFY_AUDIO_SETTINGS/i);
  assert.match(gradle, /applicationId 'org\.hearlens\.physicaldsp'/);
  assert.match(gradle, /project\.findProperty\('targetAbis'\) \?: 'arm64-v8a'/);
  assert.match(gradle, /abiFilters\(\*targetAbis\)/);
  assert.match(gradle, /testInstrumentationRunner 'androidx\.test\.runner\.AndroidJUnitRunner'/);
  assert.match(cmake, /research\/detached-native-fir/);
  assert.match(cmake, /research\/android-aaudio-callback/);
  assert.match(cmake, /auto_check\.cpp/);
  assert.match(cmake, /native_session_check\.cpp/);
  assert.match(cmake, /HEARLENS_DISABLE_ALLOCATION_PROBE=1/);
  assert.doesNotMatch(bridge + activity, /AudioRecord|BluetoothAdapter|BluetoothA2dp/);
  assert.doesNotMatch(activity, /AudioManager\.OnModeChangedListener/);
  assert.match(api31Listener, /fun register\([\s\S]*\): Any/);
  assert.match(activity, /Build\.VERSION\.SDK_INT >= Build\.VERSION_CODES\.S/);
  assert.doesNotMatch(bridge, /isAndroidEmulator|ro\.kernel\.qemu/);
});

test("DSP scratch never reaches AAudio output and every callback verifies zero output", () => {
  const clear = core.indexOf("std::fill_n(outputBuffer");
  const native = core.indexOf("session_.process(", clear);
  assert.ok(clear >= 0 && native > clear, "clear system output before any DSP work");
  assert.match(core, /session_\.process\(\s*ticket_,\s*kSyntheticRouteStamp,\s*inputScratch_\.data\(\)/);
  assert.doesNotMatch(core.slice(native), /outputBuffer|audioData/);
  assert.match(bridge, /const auto disposition = context->core\.processOutput\(\s*static_cast<float\*>\(audioData\)/);
  assert.match(bridge, /if \(output\[index\] == 0\.0F\)/);
  assert.match(bridge, /nonzeroOutputObserved\.store\(true/);
  assert.match(bridge, /dsp_to_audio_buffer_path[^\n]*false/);
  assert.match(instrumentation, /nativeAutoFirMatchesCanonicalJavascriptOracleAndManifest/);
  assert.match(verifier, /pcmMaxErrorThreshold/);
  assert.match(verifier, /controlUpdatesPerEar/);
  assert.match(verifier, /assertEquals\("Portable result protocol length"/);
});

test("real AAudio callback is variable-frame, bounded, measured, and free of control-plane work", () => {
  const begin = bridge.indexOf("aaudio_data_callback_result_t dataCallback(");
  const end = bridge.indexOf("void errorCallback(", begin);
  assert.ok(begin >= 0 && end > begin);
  const callback = bridge.slice(begin, end);
  assert.match(callback, /processOutput\([\s\S]*numFrames/);
  assert.match(callback, /lastDspProcessingNs\(\)/);
  assert.match(callback, /controlUpdatesBefore/);
  assert.match(callback, /callbackOverrunObserved/);
  assert.ok(
    callback.indexOf("record.jitterNs =") < callback.indexOf("threadCpuNow(cpuEndAvailable)") &&
      callback.indexOf("threadCpuNow(cpuEndAvailable)") < callback.indexOf("record.callbackOverrun ="),
    "callback wall/CPU clocks must include histogram and record/jitter bookkeeping",
  );
  assert.doesNotMatch(callback, /JNIEnv|\bnew\s|malloc\s*\(|fstream|mutex|sleep_for|AudioRecord|Bluetooth/);
  assert.match(bridge, /callback_frames_request[^\n]*UNSPECIFIED_VARIABLE/);
  assert.match(bridge, /callback_records_detail/);
  assert.match(bridge, /maximum_interarrival_event/);
  assert.match(bridge, /surrounding_records/);
  assert.match(bridge, /callback_thread_cpu_ns/);
  assert.match(bridge, /dsp_processing_wall_ns/);
  assert.match(bridge, /xrun_timestamp_resolution/);
  assert.match(bridge, /allocation_monitor/);
  assert.match(bridge, /callback_timing_scope[^\n]*final overrun classification/);
  assert.match(bridge, /callbackRecordCapacity|kMaximumRecords = 65'536/);
});

test("route and generation checks bracket stream open and start, then poll on control plane", () => {
  assert.match(activity, /getAudioDevicesForAttributes\(mediaAttributes\)/);
  assert.match(activity, /AudioModeChangedListenerApi31\.register\(/);
  assert.match(api31Listener, /addOnModeChangedListener\(executor, listener\)/);
  assert.match(activity, /AudioDeviceInfo\.TYPE_TELEPHONY -> RouteDeviceKind\.TELEPHONY/);
  assert.match(activity, /nativePublishRouteSnapshot\(/);
  assert.match(activity, /nativeRequestStop\(context\.runToken, reasonCode\)/);
  assert.match(activity, /PhysicalDspShadowReportStore\.publish\(filesDir, resultFileName, persistedReport\)/);
  assert.match(reportStore, /temporaryFile\.writeText\(report, Charsets\.UTF_8\)/);
  assert.match(reportStore, /Files\.move\([\s\S]*StandardCopyOption\.ATOMIC_MOVE/);
  assert.match(instrumentation, /callbackReportIsAtomicallyPublishedOnlyAsACompleteFinalFile/);
  assert.match(policy, /predicted\.size != 1/);
  assert.match(policy, /predictedDevice\.kind != RouteDeviceKind\.BUILTIN_SPEAKER/);
  assert.match(policy, /expected\.routeGeneration/);
  for (const testName of [
    "attachedTelephonyEndpointIsInventoryOnly",
    "communicationOrOtherAudioModeIsRejected",
    "bluetoothUsbWiredAndUnknownInventoryAreRejected",
    "multipleSpeakerIDsAndMultiplePredictedRoutesAreRejected",
    "nonSpeakerPredictedRoutesAndMismatchedIDsAreRejected",
    "emptyFailedAndUnavailableRouteQueriesAreRejected",
    "openStartAndRuntimeRouteChangesFailTheAnchoredGeneration",
    "staleGenerationAndStopRestartTokensAreRejected",
  ]) assert.ok(policyTests.includes(testName), `route policy test missing: ${testName}`);

  const target = bridge.indexOf("AAudioStreamBuilder_setDeviceId(builder, expectedDeviceId)");
  const openGate = bridge.indexOf("context.routeValidBeforeOpen = routePolicyMatches", target);
  const open = bridge.indexOf("AAudioStreamBuilder_openStream(builder, &stream)", openGate);
  const actual = bridge.indexOf("context.actualDeviceId = AAudioStream_getDeviceId(stream)", open);
  const preStart = bridge.indexOf("context.routeValidBeforeStart = routePolicyMatches", actual);
  const start = bridge.indexOf("AAudioStream_requestStart(stream)", preStart);
  const loop = bridge.indexOf("while (Clock::now() < runDeadline)", start);
  const poll = bridge.indexOf("routePolicyMatches(runToken, routeGeneration, expectedDeviceId)", loop);
  const idPoll = bridge.indexOf("context.lastObservedDeviceId = AAudioStream_getDeviceId(stream)", poll);
  assert.ok(target >= 0 && openGate > target && open > openGate);
  assert.ok(actual > open && preStart > actual && start > preStart && loop > start && idPoll > poll);
  assert.match(bridge, /AAudioStreamBuilder_setDeviceId\(builder, expectedDeviceId\)/);
  assert.match(bridge, /routePolicyInvalidated/);
  assert.match(bridge, /AAUDIO_STREAM_STATE_DISCONNECTED/);
  assert.match(bridge, /AAudioStream_requestStop\(stream\)/);
  assert.match(bridge, /AAudioStream_close\(stream\)/);
  assert.doesNotMatch(callbackSlice(bridge), /routePolicyMatches|gRoutePolicyMutex|AAudioStream_getDeviceId/);
});

test("48 kHz mismatch closes before start; first-run native cap and offline artifact build are fixed", () => {
  const mismatch = bridge.indexOf("if (context.sampleRate != kFixtureSampleRate)");
  const close = bridge.indexOf("AAudioStream_close(stream)", mismatch);
  const start = bridge.indexOf("AAudioStream_requestStart(stream)", mismatch);
  assert.ok(mismatch >= 0 && close > mismatch && start > close);
  assert.match(bridge, /SAMPLE_RATE_REFUSED/);
  assert.match(bridge, /runFixture\(env, fixture, 60'000, true, kFaultNone/);
  assert.match(build, /nativeAbi = 'arm64-v8a'/);
  assert.match(build, /maxDurationMs = 60000/);
  assert.match(build, /installOrStreamStarted = \$false/);
  assert.match(build, /aapt dump permissions/);
  assert.match(build, /libhearlens_physical_dsp_shadow\.so/);
  assert.match(instrumentation, /nativeSessionFaultRegressionPassesInTheAndroidProcess/);
});

test("physical runner requires exact artifact owner authorization and one review or waiver", () => {
  assert.match(runner, /ValidateSet\('ZY22FWGQTB'\)/);
  assert.match(runner, /ANDROID_ADB -s \$Serial/);
  assert.match(runner, /ExpectedArchiveSha256/);
  assert.match(runner, /owner\.artifactId -ne \$ArtifactId/);
  assert.match(runner, /owner\.apkSha256\.ToLowerInvariant\(\) -ne \$expectedApk/);
  assert.match(runner, /owner\.archiveSha256\.ToLowerInvariant\(\) -ne \$expectedArchive/);
  assert.match(runner, /IndependentReviewRecord/);
  assert.match(runner, /OwnerReviewWaiverRecord/);
  assert.match(runner, /review\.requestedRoute -ne 'BUILTIN_SPEAKER_ONLY'/);
  assert.match(runner, /review\.allowSyntheticDspProcessing -ne \$true/);
  assert.match(runner, /waiver\.requestedRoute -ne 'BUILTIN_SPEAKER_ONLY'/);
  assert.match(runner, /waiver\.allowSyntheticDspProcessing -ne \$true/);
  assert.match(runner, /OWNER_WAIVER_NO_INDEPENDENT_REVIEW/);
  assert.match(runner, /maxDurationSeconds -ne \$maxDurationSeconds/);
  assert.match(runner, /maxExtensionSeconds -ne 0/);
  assert.match(runner, /allowNonzeroPcmOutput -ne \$false/);
  assert.match(runner, /owner\.allowSyntheticDspProcessing -ne \$true/);
  assert.match(runner, /\$record\.zero_samples_verified -ne \(2L \* \[long\]\$record\.frame_count\)/);
  assert.match(runner, /\$native\.native_control_updates -le 0/);
  assert.match(runner, /\$native\.frame_count_overflow -ne 0/);
  assert.match(runner, /callback_cpu_unavailable_samples/);
  assert.match(runner, /maximum_interarrival_event\.surrounding_records/);
  assert.match(runner, /dsp_deadline_failure_count -ne 0/);
  assert.match(runner, /callback_overrun_count -ne 0/);
  assert.match(runner, /xrun_delta -ne 0/);
  assert.match(runner, /dsp_benchmark_valid/);
  assert.match(runner, /route_policy_final_snapshot/);
  assert.match(runner, /am', 'force-stop', \$packageName/);
  assert.match(runner, /adb -s \$Serial shell am force-stop/);
  assert.match(runner, /Save-TargetDiagnostics -Directory \$runDir/);
});

function callbackSlice(source) {
  const begin = source.indexOf("aaudio_data_callback_result_t dataCallback(");
  const end = source.indexOf("void errorCallback(", begin);
  return source.slice(begin, end);
}
