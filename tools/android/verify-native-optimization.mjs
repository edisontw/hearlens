import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const REQUIRED_SOURCES = [
  'shadow_callback_bridge.cpp',
  'auto_check.cpp',
  'native_session_check.cpp',
];

export function verifyNativeOptimization(compileCommands, expectedProfile) {
  if (!['O0', 'O2'].includes(expectedProfile)) {
    throw new Error(`unsupported optimization profile: ${expectedProfile}`);
  }
  if (!Array.isArray(compileCommands) || compileCommands.length === 0) {
    throw new Error('compile_commands.json must contain C++ entries');
  }

  const selected = compileCommands.filter((entry) =>
    REQUIRED_SOURCES.some((source) => String(entry.file ?? '').endsWith(source)));
  const missing = REQUIRED_SOURCES.filter((source) =>
    !selected.some((entry) => String(entry.file ?? '').endsWith(source)));
  if (missing.length) throw new Error(`missing native compile entries: ${missing.join(', ')}`);

  const commands = selected.map((entry) => {
    const command = typeof entry.command === 'string'
      ? entry.command
      : Array.isArray(entry.arguments) ? entry.arguments.join(' ') : '';
    const optimizationFlags = command.match(/(?:^|\s)-O(?:[0-3]|s|z)(?=\s|$)/g)
      ?.map((flag) => flag.trim()) ?? [];
    const effectiveOptimization = optimizationFlags.at(-1) ?? '(compiler default)';
    if (effectiveOptimization !== `-${expectedProfile}`) {
      throw new Error(`${entry.file}: expected final -${expectedProfile}, got ${effectiveOptimization}`);
    }
    if (!/(?:^|\s)-fno-fast-math(?:\s|$)/.test(command)) {
      throw new Error(`${entry.file}: missing -fno-fast-math`);
    }
    if (!/(?:^|\s)-ffp-contract=off(?:\s|$)/.test(command)) {
      throw new Error(`${entry.file}: missing -ffp-contract=off`);
    }
    if (/(?:^|\s)-ffast-math(?:\s|$)/.test(command)) {
      throw new Error(`${entry.file}: forbidden -ffast-math`);
    }
    if (!/clang\+\+/.test(command)) {
      throw new Error(`${entry.file}: expected the pinned Clang C++ driver`);
    }
    return {
      source: String(entry.file),
      effectiveOptimization,
      optimizationFlags,
      floatingPointSafetyFlags: ['-fno-fast-math', '-ffp-contract=off'],
    };
  });

  return { status: 'PASS', optimizationProfile: expectedProfile, commands };
}

async function main() {
  const [compileCommandsPath, expectedProfile, outputPath] = process.argv.slice(2);
  if (!compileCommandsPath || !expectedProfile) {
    throw new Error('usage: verify-native-optimization.mjs <compile_commands.json> <O0|O2> [output.json]');
  }
  const raw = await readFile(compileCommandsPath);
  const parsed = JSON.parse(raw.toString('utf8'));
  const verified = verifyNativeOptimization(parsed, expectedProfile);
  const report = {
    ...verified,
    compileCommandsPath,
    compileCommandsSha256: createHash('sha256').update(raw).digest('hex'),
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) await writeFile(outputPath, json, 'utf8');
  process.stdout.write(json);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
