import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { verifyNativeOptimization } from './android/verify-native-optimization.mjs';

const repositoryRoot = new URL('../', import.meta.url);
const read = (relativePath) => readFile(new URL(relativePath, repositoryRoot), 'utf8');

test('compile command verifier accepts explicit O0 and O2 without relaxing float safeguards', () => {
  for (const level of ['0', '2']) {
    const entries = [
      'shadow_callback_bridge.cpp', 'auto_check.cpp', 'native_session_check.cpp',
    ].map((file) => ({
      file: `/tmp/${file}`,
      command: `clang++ -O${level} -fno-fast-math -ffp-contract=off -c ${file}`,
    }));
    assert.equal(verifyNativeOptimization(entries, `O${level}`).status, 'PASS');
  }
});

test('compile command verifier rejects implicit optimization and fast math', () => {
  const sources = ['shadow_callback_bridge.cpp', 'auto_check.cpp', 'native_session_check.cpp'];
  const implicit = sources.map((file) => ({
    file, command: `clang++ -fno-fast-math -ffp-contract=off -c ${file}`,
  }));
  assert.throws(() => verifyNativeOptimization(implicit, 'O2'), /expected final -O2/);
  const fast = sources.map((file) => ({
    file, command: `clang++ -O2 -ffast-math -fno-fast-math -ffp-contract=off -c ${file}`,
  }));
  assert.throws(() => verifyNativeOptimization(fast, 'O2'), /forbidden -ffast-math/);
});

test('DSP-shadow benchmark exposes a no-audio JNI path and explicit O2 production flags', async () => {
  const cpp = await read('apps/android-aaudio-physical-dsp-shadow-lab/app/src/main/cpp/shadow_callback_bridge.cpp');
  const match = cpp.match(/Java_org_hearlens_physicaldsp_NativeBridge_nativeRunNoAudioBenchmark\([\s\S]*?(?=\n}\s*\n)/);
  assert.ok(match, 'no-audio benchmark JNI entry point exists');
  assert.doesNotMatch(match[0], /AAudioStreamBuilder_openStream|AAudioStream_requestStart|runFixture\(/);
  assert.match(match[0], /runNoAudioBenchmark/);

  const cmake = await read('apps/android-aaudio-physical-dsp-shadow-lab/app/src/main/cpp/CMakeLists.txt');
  assert.match(cmake, /set\(HEARLENS_NATIVE_OPT_LEVEL "2"/);
  assert.match(cmake, /-O\$\{HEARLENS_NATIVE_OPT_LEVEL\}/);
  assert.match(cmake, /-fno-fast-math/);
  assert.match(cmake, /-ffp-contract=off/);

  const gradle = await read('apps/android-aaudio-physical-dsp-shadow-lab/app/build.gradle');
  assert.match(gradle, /nativeOptimizationLevel.*\?: '2'/);
  assert.match(gradle, /nativeOptimizationLevel in \['0', '2'\]/);
});

test('no-audio Android instrumentation checks fail-stop and zero-output records', async () => {
  const source = await read('apps/android-aaudio-physical-dsp-shadow-lab/app/src/androidTest/java/org/hearlens/physicaldsp/ShadowLabRuntimeTest.kt');
  assert.match(source, /nativeNoAudioBenchmarkMeasuresFirstSteadyControlAndGenerationCallbacks/);
  assert.match(source, /nativeRunNoAudioBenchmark\(fixture\)/);
  assert.match(source, /physical_stream_opened/);
  assert.match(source, /strict_callback_deadlines/);
  assert.match(source, /zero_samples_verified/);
  assert.match(source, /nonzero_samples_observed/);
});
