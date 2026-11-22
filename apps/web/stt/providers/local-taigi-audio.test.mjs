import assert from "node:assert/strict";
import test from "node:test";

import { encodePcm16Wav, resampleMonoLinear } from "./local-taigi-audio.mjs";

test("local Taigi audio converts 48 kHz mono clips to 16 kHz", () => {
  const input = new Float32Array(48_000).fill(0.25);
  const output = resampleMonoLinear(input, 48_000, 16_000);
  assert.equal(output.length, 16_000);
  assert.ok(Math.abs(output[0] - 0.25) < 1e-6);
  assert.ok(Math.abs(output.at(-1) - 0.25) < 1e-6);
});

test("local Taigi WAV encoder writes a mono PCM16 RIFF header and bounded samples", () => {
  const wav = encodePcm16Wav(new Float32Array([-2, -0.5, 0, 0.5, 2, Number.NaN]));
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const ascii = offset => String.fromCharCode(...wav.subarray(offset, offset + 4));

  assert.equal(ascii(0), "RIFF");
  assert.equal(ascii(8), "WAVE");
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 16_000);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getInt16(44, true), -32_768);
  assert.equal(view.getInt16(46, true), -16_384);
  assert.equal(view.getInt16(52, true), 32_767);
  assert.equal(view.getInt16(54, true), 0);
  assert.equal(wav.byteLength, 44 + 6 * 2);
});

test("local Taigi audio helpers reject empty or invalid-rate input", () => {
  assert.throws(() => resampleMonoLinear(new Float32Array(), 48_000), /non-empty/);
  assert.throws(() => resampleMonoLinear(new Float32Array([0]), 1_000), /sample rate/);
  assert.throws(() => encodePcm16Wav(new Float32Array([0]), 96_000), /sample rate/);
});
