const TARGET_SAMPLE_RATE = 16_000;

export function resampleMonoLinear(input, sourceRate, targetRate = TARGET_SAMPLE_RATE) {
  if (!(input instanceof Float32Array) || input.length === 0) {
    throw new TypeError("input must be a non-empty Float32Array");
  }
  if (!Number.isFinite(sourceRate) || sourceRate < 8_000 || sourceRate > 192_000 ||
      !Number.isFinite(targetRate) || targetRate < 8_000 || targetRate > 48_000) {
    throw new RangeError("unsupported sample rate");
  }
  if (sourceRate === targetRate) return input.slice();

  const ratio = sourceRate / targetRate;
  const output = new Float32Array(Math.max(1, Math.round(input.length / ratio)));
  for (let index = 0; index < output.length; index += 1) {
    const sourcePosition = index * ratio;
    const left = Math.min(input.length - 1, Math.floor(sourcePosition));
    const right = Math.min(input.length - 1, left + 1);
    const fraction = sourcePosition - left;
    output[index] = input[left] * (1 - fraction) + input[right] * fraction;
  }
  return output;
}

export function encodePcm16Wav(samples, sampleRate = TARGET_SAMPLE_RATE) {
  if (!(samples instanceof Float32Array) || samples.length === 0) {
    throw new TypeError("samples must be a non-empty Float32Array");
  }
  if (!Number.isInteger(sampleRate) || sampleRate < 8_000 || sampleRate > 48_000) {
    throw new RangeError("unsupported sample rate");
  }

  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const writeAscii = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, bytes.byteLength - 8, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, samples.length * 2, true);

  for (let index = 0; index < samples.length; index += 1) {
    const sample = Number.isFinite(samples[index]) ? Math.max(-1, Math.min(1, samples[index])) : 0;
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Uint8Array(bytes);
}
