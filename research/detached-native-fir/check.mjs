import { spawnSync } from "node:child_process";

const samplesPerEar = 16_384;
const earCount = 2;
const expectedSamples = samplesPerEar * earCount;
const expectedBytes = expectedSamples * Float32Array.BYTES_PER_ELEMENT;
const executable = process.env.HEARLENS_NATIVE_FIR_BIN ?? "./fir";
const result = spawnSync(executable, { maxBuffer: expectedBytes + 1024 });

if (result.signal !== null || result.status !== 0) {
  const detail = result.stderr?.toString("utf8").trim();
  const launchError = result.error ? `, launch error=${result.error.message}` : "";
  throw new Error(`FIR process failed (status=${result.status}, signal=${result.signal}${launchError}): ${detail}`);
}
if (!result.stdout || result.stdout.length !== expectedBytes) {
  throw new Error(`expected ${expectedBytes} output bytes, received ${result.stdout?.length ?? 0}`);
}

const histories = Array.from({ length: earCount }, () => new Float32Array(513));
const writeIndices = new Uint16Array(earCount);
let mismatches = 0;
let prematurePairMismatches = 0;
let prematureAccumulatorMismatches = 0;
let prematureFloatMismatches = 0;
let maxAbsoluteError = 0;
let squaredError = 0;

for (let sampleIndex = 0; sampleIndex < samplesPerEar; sampleIndex++) {
  for (let ear = 0; ear < earCount; ear++) {
    const history = histories[ear];
    const writeIndex = writeIndices[ear];
    const pattern = ((sampleIndex * 619 + ear * 1_543) % 131_071) - 65_535;
    const input = Math.fround(pattern / 131_071);
    const coefficients = (tap) =>
      (((tap * 811 + ear * 1_237) % 4_093) - 2_046) / 1_048_573;
    history[writeIndex] = input;

    let output = 0;
    let prematurePairOutput = 0;
    let prematureAccumulatorOutput = 0;
    let prematureFloatOutput = 0;
    for (let tap = 0; tap < 256; tap++) {
      const newestIndex = (writeIndex - tap + 513) % 513;
      const oldestIndex = (writeIndex + 1 + tap) % 513;
      const pair = Number(history[newestIndex]) + Number(history[oldestIndex]);
      const coefficient = coefficients(tap);
      output += coefficient * pair;
      const float32Pair = Math.fround(Number(history[newestIndex]) + Number(history[oldestIndex]));
      prematurePairOutput += coefficient * float32Pair;
      prematureAccumulatorOutput = Math.fround(prematureAccumulatorOutput + coefficient * pair);
      prematureFloatOutput = Math.fround(prematureFloatOutput + coefficient * float32Pair);
    }
    const centerIndex = (writeIndex - 256 + 513) % 513;
    const centerCoefficient = coefficients(256);
    output += centerCoefficient * Number(history[centerIndex]);
    prematurePairOutput += centerCoefficient * Number(history[centerIndex]);
    prematureAccumulatorOutput = Math.fround(
      prematureAccumulatorOutput + centerCoefficient * Number(history[centerIndex]),
    );
    prematureFloatOutput = Math.fround(
      prematureFloatOutput + centerCoefficient * Number(history[centerIndex]),
    );
    const expected = Math.fround(output);
    const prematurePairExpected = Math.fround(prematurePairOutput);
    const prematureAccumulatorExpected = prematureAccumulatorOutput;
    const prematureFloatExpected = prematureFloatOutput;
    const outputIndex = sampleIndex * earCount + ear;
    const actual = result.stdout.readFloatLE(outputIndex * Float32Array.BYTES_PER_ELEMENT);
    const error = Math.abs(expected - actual);

    if (!Object.is(expected, actual)) mismatches++;
    if (!Object.is(expected, prematurePairExpected)) prematurePairMismatches++;
    if (!Object.is(expected, prematureAccumulatorExpected)) prematureAccumulatorMismatches++;
    if (!Object.is(expected, prematureFloatExpected)) prematureFloatMismatches++;
    maxAbsoluteError = Math.max(maxAbsoluteError, error);
    squaredError += error * error;
    writeIndices[ear] = (writeIndex + 1) % 513;
  }
}

const rmsError = Math.sqrt(squaredError / expectedSamples);
console.log(JSON.stringify({
  samples: expectedSamples,
  samplesPerEar,
  outputEncoding: "IEEE-754 float32 little-endian, interleaved L/R",
  mismatches,
  prematurePairMismatches,
  prematureAccumulatorMismatches,
  prematureFloatMismatches,
  maxAbsoluteError,
  rmsError,
  launchWarning: result.error?.message ?? null,
}));

if (mismatches !== 0 || prematurePairMismatches === 0 ||
    prematureAccumulatorMismatches === 0 || prematureFloatMismatches === 0) {
  process.exitCode = 1;
}
