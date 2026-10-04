const FLOOR = 1e-8;

function dbfs(value) {
  return 20 * Math.log10(Math.max(FLOOR, value));
}

export function processInputAudio(input, gain = 1) {
  const safeGain = Math.min(8, Math.max(1, Number(gain) || 1));
  const output = new Float32Array(input.length);

  let sumSquares = 0;
  let rawPeak = 0;
  let outputPeak = 0;
  let clipped = 0;

  for (let i = 0; i < input.length; i += 1) {
    const raw = Number.isFinite(input[i]) ? input[i] : 0;
    const absRaw = Math.abs(raw);
    sumSquares += raw * raw;
    rawPeak = Math.max(rawPeak, absRaw);

    const amplified = raw * safeGain;
    if (Math.abs(amplified) > 0.98) clipped += 1;
    const limited = Math.max(-0.98, Math.min(0.98, amplified));
    output[i] = limited;
    outputPeak = Math.max(outputPeak, Math.abs(limited));
  }

  const rms = input.length
    ? Math.sqrt(sumSquares / input.length)
    : 0;

  return {
    samples: output,
    rawRmsDbfs: dbfs(rms),
    rawPeakDbfs: dbfs(rawPeak),
    outputPeakDbfs: dbfs(outputPeak),
    clippedPercent: input.length ? (clipped / input.length) * 100 : 0,
  };
}
