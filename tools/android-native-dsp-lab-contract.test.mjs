import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const appRoot = new URL("../apps/android-native-dsp-lab/", import.meta.url);
const read = path => readFileSync(new URL(path, appRoot), "utf8");
const nativeRoot = new URL("../research/detached-native-fir/", import.meta.url);

test("research APK manifest has no permissions or hardware features", () => {
  const manifest = read("app/src/main/AndroidManifest.xml");
  assert.doesNotMatch(manifest, /<uses-permission\b/i);
  assert.doesNotMatch(manifest, /<uses-feature\b/i);
  assert.doesNotMatch(manifest, /RECORD_AUDIO|MODIFY_AUDIO_SETTINGS|BLUETOOTH/i);
});

test("Kotlin and JNI harness contain no physical audio APIs", () => {
  const source = [
    read("app/src/main/java/org/hearlens/nativedsplab/MainActivity.kt"),
    read("app/src/main/java/org/hearlens/nativedsplab/NativeBridge.kt"),
    read("app/src/main/java/org/hearlens/nativedsplab/NativeSessionController.kt"),
    read("app/src/main/cpp/native_bridge_jni.cpp"),
  ].join("\n");
  assert.doesNotMatch(source, /AudioRecord|AudioTrack|AAudio|Oboe|MediaRecorder|RECORD_AUDIO|MODIFY_AUDIO_SETTINGS/i);
});

test("research-only disclosure keeps output authorization disabled", () => {
  const activity = read("app/src/main/java/org/hearlens/nativedsplab/MainActivity.kt");
  const session = read("app/src/main/java/org/hearlens/nativedsplab/NativeSessionController.kt");
  assert.match(activity, /Physical output authorization: false/);
  assert.match(activity, /M04 AIR31\/A2DP real hearing: BLOCKED/);
  assert.match(session, /synthetic-only/);
});

test("physical ARM64 runner requires a serial and has no audio-device path", () => {
  const script = readFileSync(new URL(
    "../scripts/android/Test-AndroidPhysicalArm64.ps1", import.meta.url), "utf8");
  assert.match(script, /\[Parameter\(Mandatory = \$true\)\][\s\S]*\$DeviceSerial/);
  assert.match(script, /\$adb -s \$DeviceSerial/);
  assert.match(script, /arm64-v8a/);
  assert.match(script, /hearingOutputAuthorized = \$false/);
  assert.match(script, /callbackCountDelta -gt 1/);
  assert.match(script, /wallElapsedSeconds/);
  assert.match(script, /function Get-DeadlineMissAnalysis/);
  assert.match(script, /if \(!\$threadCpuMaximumBelowDeadline\)/);
  assert.match(script, /elseif \(\$missCount -eq 0\)/);
  assert.match(script, /elseif \(\$maxConsecutiveMisses -ge 3\)/);
  assert.doesNotMatch(script, /Observed misses are sparse/);
  assert.doesNotMatch(script, /AudioRecord|AudioTrack|AAudio|Oboe|MediaRecorder/i);
});

test("paced benchmark fixture export does not execute a host benchmark", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "hearlens-bench-fixture-"));
  try {
    const fixturePath = join(temporaryDirectory, "auto-fir-benchmark-fixture.bin");
    const scriptPath = fileURLToPath(new URL("auto-bench.mjs", nativeRoot));
    const result = spawnSync(process.execPath, [scriptPath,
      "--fixture-output=" + fixturePath, "--fixture-only"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    const fixture = readFileSync(fixturePath);
    assert.equal(report.result, "FIXTURE_READY");
    assert.equal(report.bytes, fixture.length);
    assert.equal(report.sha256,
      createHash("sha256").update(fixture).digest("hex"));
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
