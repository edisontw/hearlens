#include "dynamic_fir_core.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <iostream>
#include <limits>
#include <vector>

namespace {

constexpr std::uint32_t kFixtureMagic = 0x324e4c48U;  // "HLN2" in little-endian.
constexpr std::size_t kEarCount = 2;
using Frame = std::array<float, kEarCount>;

struct Event {
  std::uint32_t sampleIndex = 0;
  std::array<hearlens::research::BandLevels, kEarCount> levels{};
};

bool readU32(std::istream& input, std::uint32_t& value) {
  std::array<unsigned char, 4> bytes{};
  if (!input.read(reinterpret_cast<char*>(bytes.data()), bytes.size())) return false;
  value = static_cast<std::uint32_t>(bytes[0]) |
      (static_cast<std::uint32_t>(bytes[1]) << 8U) |
      (static_cast<std::uint32_t>(bytes[2]) << 16U) |
      (static_cast<std::uint32_t>(bytes[3]) << 24U);
  return true;
}

bool readU64(std::istream& input, std::uint64_t& value) {
  std::array<unsigned char, 8> bytes{};
  if (!input.read(reinterpret_cast<char*>(bytes.data()), bytes.size())) return false;
  value = 0;
  for (std::size_t index = 0; index < bytes.size(); ++index) {
    value |= static_cast<std::uint64_t>(bytes[index]) << (8U * index);
  }
  return true;
}

bool readF64(std::istream& input, double& value) {
  std::uint64_t bits = 0;
  if (!readU64(input, bits)) return false;
  std::memcpy(&value, &bits, sizeof(value));
  return true;
}

bool readF32(std::istream& input, float& value) {
  std::uint32_t bits = 0;
  if (!readU32(input, bits)) return false;
  std::memcpy(&value, &bits, sizeof(value));
  return true;
}

void appendU64(std::vector<unsigned char>& output, std::size_t& offset,
               std::uint64_t value) {
  for (std::size_t byte = 0; byte < 8; ++byte) {
    output[offset++] = static_cast<unsigned char>((value >> (8U * byte)) & 0xffU);
  }
}

void appendF32(std::vector<unsigned char>& output, std::size_t& offset,
               float value) {
  std::uint32_t bits = 0;
  std::memcpy(&bits, &value, sizeof(bits));
  for (std::size_t byte = 0; byte < 4; ++byte) {
    output[offset++] = static_cast<unsigned char>((bits >> (8U * byte)) & 0xffU);
  }
}

bool checkIsolation(const hearlens::research::BandBasis& basis,
                    const std::array<hearlens::research::BandTargets, kEarCount>& targets,
                    double maxGainDb, double limiterCeiling,
                    std::size_t transitionSamples) {
  using hearlens::research::BandLevels;
  using hearlens::research::DynamicFir;
  constexpr std::size_t kFrames = 64;
  const BandLevels leftLevels{50, 57.5, 65, 72.5, 80, 65};
  const BandLevels rightLevels{80, 72.5, 65, 57.5, 50, 65};
  std::array<float, kFrames> signal{};
  std::array<float, kFrames> silence{};
  std::array<float, kFrames> leftOutput{};
  std::array<float, kFrames> rightOutput{};
  for (std::size_t index = 0; index < signal.size(); ++index) {
    signal[index] = static_cast<float>((static_cast<int>(index) - 31) / 2'048.0);
  }

  DynamicFir left(basis, targets[0], maxGainDb, limiterCeiling, transitionSamples);
  DynamicFir right(basis, targets[1], maxGainDb, limiterCeiling, transitionSamples);
  if (!left.configValid() || !right.configValid() ||
      !left.setSyntheticBandLevels(leftLevels) ||
      !right.setSyntheticBandLevels(rightLevels) ||
      !left.processInto(signal.data(), leftOutput.data(), signal.size()) ||
      !right.processInto(silence.data(), rightOutput.data(), silence.size())) {
    return false;
  }
  if (std::any_of(rightOutput.begin(), rightOutput.end(), [](float x) { return x != 0.0F; }) ||
      std::none_of(leftOutput.begin(), leftOutput.end(), [](float x) { return x != 0.0F; })) {
    return false;
  }

  left.reset();
  right.reset();
  leftOutput.fill(0.0F);
  rightOutput.fill(0.0F);
  if (!left.setSyntheticBandLevels(leftLevels) ||
      !right.setSyntheticBandLevels(rightLevels) ||
      !left.processInto(silence.data(), leftOutput.data(), silence.size()) ||
      !right.processInto(signal.data(), rightOutput.data(), signal.size())) {
    return false;
  }
  return std::all_of(leftOutput.begin(), leftOutput.end(), [](float x) { return x == 0.0F; }) &&
      std::any_of(rightOutput.begin(), rightOutput.end(), [](float x) { return x != 0.0F; });
}

bool checkResetAndFailStop(
    const hearlens::research::BandBasis& basis,
    const std::array<hearlens::research::BandTargets, kEarCount>& targets,
    double maxGainDb, double limiterCeiling, std::size_t transitionSamples) {
  using hearlens::research::BandLevels;
  using hearlens::research::DynamicFir;
  constexpr std::size_t kFrames = 32;
  const BandLevels low{50, 55, 60, 65, 70, 75};
  const BandLevels high{80, 75, 70, 65, 60, 55};
  std::array<float, kFrames> input{};
  std::array<float, kFrames> firstOutput{};
  std::array<float, kFrames> secondOutput{};
  input.fill(0.01F);

  DynamicFir used(basis, targets[0], maxGainDb, limiterCeiling, transitionSamples);
  if (!used.setSyntheticBandLevels(low) ||
      !used.processInto(input.data(), firstOutput.data(), input.size()) ||
      !used.setSyntheticBandLevels(high) ||
      !used.processInto(input.data(), secondOutput.data(), input.size())) {
    return false;
  }
  used.reset();
  if (!used.setSyntheticBandLevels(low) ||
      !used.processInto(input.data(), firstOutput.data(), input.size())) {
    return false;
  }
  DynamicFir fresh(basis, targets[0], maxGainDb, limiterCeiling, transitionSamples);
  std::array<float, kFrames> freshOutput{};
  if (!fresh.setSyntheticBandLevels(low) ||
      !fresh.processInto(input.data(), freshOutput.data(), input.size()) ||
      firstOutput != freshOutput || used.acceptedSamples() != input.size() ||
      used.updates() != 1) {
    return false;
  }

  DynamicFir failStop(basis, targets[0], maxGainDb, limiterCeiling, transitionSamples);
  if (!failStop.setSyntheticBandLevels(low)) return false;
  std::array<float, 4> invalidInput{0.01F, 0.02F,
      std::numeric_limits<float>::quiet_NaN(), 0.03F};
  std::array<float, 4> untouchedOutput{0.11F, 0.12F, 0.13F, 0.14F};
  const auto beforeInvalid = untouchedOutput;
  if (failStop.processInto(invalidInput.data(), untouchedOutput.data(), invalidInput.size()) ||
      untouchedOutput != beforeInvalid || !failStop.faulted() ||
      failStop.processInto(input.data(), firstOutput.data(), 1)) {
    return false;
  }
  failStop.reset();
  if (failStop.ready() || failStop.faulted()) return false;
  if (!failStop.setSyntheticBandLevels(low) ||
      !failStop.processInto(input.data(), firstOutput.data(), 1)) {
    return false;
  }

  DynamicFir overlappingBuffers(basis, targets[0], maxGainDb, limiterCeiling,
                                 transitionSamples);
  if (!overlappingBuffers.setSyntheticBandLevels(low)) return false;
  std::array<float, 8> overlap{0.01F, 0.02F, 0.03F, 0.04F,
      0.05F, 0.06F, 0.07F, 0.08F};
  const auto overlapBefore = overlap;
  if (overlappingBuffers.processInto(overlap.data(), overlap.data() + 1, 4) ||
      overlap != overlapBefore || !overlappingBuffers.faulted()) {
    return false;
  }

  DynamicFir invalidLevels(basis, targets[0], maxGainDb, limiterCeiling, transitionSamples);
  BandLevels outOfRange = low;
  outOfRange[2] = 80.01;
  if (invalidLevels.setSyntheticBandLevels(outOfRange) || !invalidLevels.faulted()) return false;
  invalidLevels.reset();
  return !invalidLevels.faulted() && !invalidLevels.ready();
}

bool checkLimiter(const hearlens::research::BandBasis& basis,
                  const std::array<hearlens::research::BandTargets, kEarCount>& targets,
                  double maxGainDb, double limiterCeiling,
                  std::size_t transitionSamples) {
  using hearlens::research::BandLevels;
  using hearlens::research::DynamicFir;
  constexpr std::size_t kFrames = 512;
  const BandLevels high{80, 80, 80, 80, 80, 80};
  std::array<float, kFrames> input{};
  std::array<float, kFrames> output{};
  input.fill(0.75F);
  DynamicFir processor(basis, targets[0], maxGainDb, limiterCeiling, transitionSamples);
  if (!processor.setSyntheticBandLevels(high) ||
      !processor.processInto(input.data(), output.data(), input.size())) {
    return false;
  }
  return processor.limitedSamples() > 0 &&
      std::all_of(output.begin(), output.end(), [limiterCeiling](float sample) {
        return std::isfinite(sample) && std::abs(sample) <= limiterCeiling;
      });
}

bool checkGainLimit(const hearlens::research::BandBasis& basis,
                    const std::array<hearlens::research::BandTargets, kEarCount>& targets,
                    double limiterCeiling, std::size_t transitionSamples) {
  using hearlens::research::BandLevels;
  using hearlens::research::BandTargets;
  using hearlens::research::DynamicFir;
  constexpr std::size_t kFrames = 256;
  BandTargets overLimit = targets[0];
  BandTargets exactlyAtLimit = targets[0];
  for (auto& band : overLimit) band.fill(24.0);
  for (auto& band : exactlyAtLimit) band.fill(12.0);
  const BandLevels high{80, 80, 80, 80, 80, 80};
  std::array<float, kFrames> input{};
  std::array<float, kFrames> overLimitOutput{};
  std::array<float, kFrames> cappedOutput{};
  input.fill(0.01F);

  DynamicFir requestedAboveLimit(basis, overLimit, 12.0, limiterCeiling, transitionSamples);
  DynamicFir exactMaximum(basis, exactlyAtLimit, 12.0, limiterCeiling, transitionSamples);
  return requestedAboveLimit.configValid() && exactMaximum.configValid() &&
      requestedAboveLimit.setSyntheticBandLevels(high) &&
      exactMaximum.setSyntheticBandLevels(high) &&
      requestedAboveLimit.processInto(input.data(), overLimitOutput.data(), input.size()) &&
      exactMaximum.processInto(input.data(), cappedOutput.data(), input.size()) &&
      overLimitOutput == cappedOutput;
}

bool run(std::istream& fixture) {
  static_assert(sizeof(double) == sizeof(std::uint64_t));
  static_assert(sizeof(float) == sizeof(std::uint32_t));
  if (!std::numeric_limits<double>::is_iec559 || !std::numeric_limits<float>::is_iec559) {
    std::fprintf(stderr, "unsupported IEEE-754 float/double representation\n");
    return false;
  }

  std::uint32_t magic = 0, sampleCount = 0, callbackFrames = 0, transitionSamples = 0;
  double maxGainDb = 0.0, limiterCeiling = 0.0;
  if (!readU32(fixture, magic) || !readU32(fixture, sampleCount) ||
      !readU32(fixture, callbackFrames) || !readU32(fixture, transitionSamples) ||
      !readF64(fixture, maxGainDb) || !readF64(fixture, limiterCeiling) ||
      magic != kFixtureMagic || sampleCount == 0 || sampleCount > 1'000'000 ||
      callbackFrames == 0 || callbackFrames > hearlens::research::kMaximumCallbackFrames) {
    std::fprintf(stderr, "invalid dynamic FIR fixture header\n");
    return false;
  }

  hearlens::research::BandBasis basis{};
  for (auto& band : basis) {
    for (double& coefficient : band) {
      if (!readF64(fixture, coefficient)) return false;
    }
  }

  std::array<hearlens::research::BandTargets, kEarCount> targets{};
  for (auto& ear : targets) {
    for (auto& band : ear) {
      for (double& gain : band) {
        if (!readF64(fixture, gain)) return false;
      }
    }
  }

  std::uint32_t eventCount = 0;
  if (!readU32(fixture, eventCount) || eventCount == 0 || eventCount > 1000) {
    std::fprintf(stderr, "invalid dynamic FIR event count\n");
    return false;
  }
  std::vector<Event> events(eventCount);
  for (Event& event : events) {
    if (!readU32(fixture, event.sampleIndex)) return false;
    for (auto& earLevels : event.levels) {
      for (double& level : earLevels) {
        if (!readF64(fixture, level)) return false;
      }
    }
  }
  if (events.front().sampleIndex != 0) {
    std::fprintf(stderr, "first dynamic FIR target must start at sample zero\n");
    return false;
  }
  for (std::size_t index = 0; index < events.size(); ++index) {
    if (events[index].sampleIndex >= sampleCount ||
        (index > 0 && events[index - 1].sampleIndex >= events[index].sampleIndex)) {
      std::fprintf(stderr, "dynamic FIR events must be sorted and within the fixture\n");
      return false;
    }
  }

  std::vector<Frame> interleavedInput(sampleCount);
  std::vector<Frame> interleavedOutput(sampleCount);
  std::array<std::vector<float>, kEarCount> earInput{
      std::vector<float>(sampleCount), std::vector<float>(sampleCount)};
  std::array<std::vector<float>, kEarCount> earOutput{
      std::vector<float>(sampleCount), std::vector<float>(sampleCount)};
  for (Frame& frame : interleavedInput) {
    for (float& sample : frame) {
      if (!readF32(fixture, sample) || !std::isfinite(sample) ||
          sample < -16.0F || sample > 16.0F) {
        std::fprintf(stderr, "invalid synthetic PCM fixture\n");
        return false;
      }
    }
  }
  char trailingByte = 0;
  if (fixture.read(&trailingByte, 1)) {
    std::fprintf(stderr, "dynamic FIR fixture contains trailing bytes\n");
    return false;
  }
  for (std::size_t sample = 0; sample < sampleCount; ++sample) {
    for (std::size_t ear = 0; ear < kEarCount; ++ear) {
      earInput[ear][sample] = interleavedInput[sample][ear];
    }
  }

  if (!checkIsolation(basis, targets, maxGainDb, limiterCeiling, transitionSamples) ||
      !checkResetAndFailStop(basis, targets, maxGainDb, limiterCeiling, transitionSamples) ||
      !checkLimiter(basis, targets, maxGainDb, limiterCeiling, transitionSamples) ||
      !checkGainLimit(basis, targets, limiterCeiling, transitionSamples)) {
    std::fprintf(stderr, "dynamic FIR isolation/reset/fail-stop/limiter/gain-cap checks failed\n");
    return false;
  }

  hearlens::research::DynamicFir left(
      basis, targets[0], maxGainDb, limiterCeiling, transitionSamples);
  hearlens::research::DynamicFir right(
      basis, targets[1], maxGainDb, limiterCeiling, transitionSamples);
  if (!left.configValid() || !right.configValid()) return false;

  std::size_t position = 0;
  std::size_t nextEvent = 0;
  while (position < sampleCount) {
    if (nextEvent < events.size() && events[nextEvent].sampleIndex == position) {
      if (!left.setSyntheticBandLevels(events[nextEvent].levels[0]) ||
          !right.setSyntheticBandLevels(events[nextEvent].levels[1])) {
        std::fprintf(stderr, "native FIR rejected valid target levels\n");
        return false;
      }
      ++nextEvent;
    }
    std::size_t frames = std::min<std::size_t>(callbackFrames, sampleCount - position);
    if (nextEvent < events.size()) {
      frames = std::min<std::size_t>(frames, events[nextEvent].sampleIndex - position);
    }
    if (frames == 0 ||
        !left.processInto(earInput[0].data() + position,
                          earOutput[0].data() + position, frames) ||
        !right.processInto(earInput[1].data() + position,
                           earOutput[1].data() + position, frames)) {
      std::fprintf(stderr, "native FIR callback failed at sample %zu\n", position);
      return false;
    }
    position += frames;
  }
  if (nextEvent != events.size()) return false;

  const std::size_t outputBytes = sampleCount * kEarCount * sizeof(float) + 6 * sizeof(std::uint64_t);
  std::vector<unsigned char> output(outputBytes);
  std::size_t offset = 0;
  for (std::size_t sample = 0; sample < sampleCount; ++sample) {
    appendF32(output, offset, earOutput[0][sample]);
    appendF32(output, offset, earOutput[1][sample]);
  }
  appendU64(output, offset, left.acceptedSamples());
  appendU64(output, offset, right.acceptedSamples());
  appendU64(output, offset, left.limitedSamples());
  appendU64(output, offset, right.limitedSamples());
  appendU64(output, offset, left.updates());
  appendU64(output, offset, right.updates());
  if (offset != output.size() ||
      !std::cout.write(reinterpret_cast<const char*>(output.data()),
                       static_cast<std::streamsize>(output.size())) ||
      !std::cout.flush()) {
    std::fprintf(stderr, "failed to write complete dynamic FIR output\n");
    return false;
  }
  return true;
}

}  // namespace

int main(int argc, char** argv) {
  if (argc != 2) {
    std::fprintf(stderr, "usage: dynamic-check FIXTURE.bin\n");
    return 1;
  }
  std::ifstream fixture(argv[1], std::ios::binary);
  if (!fixture) {
    std::fprintf(stderr, "failed to open dynamic FIR fixture\n");
    return 1;
  }
  if (!run(fixture)) return 1;
  return 0;
}
