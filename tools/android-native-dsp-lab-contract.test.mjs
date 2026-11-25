import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appRoot = new URL("../apps/android-native-dsp-lab/", import.meta.url);
const read = path => readFileSync(new URL(path, appRoot), "utf8");

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
