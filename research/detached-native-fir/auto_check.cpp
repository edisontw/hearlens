#include "auto_fir_core.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <iostream>
#include <limits>
#include <new>
#include <vector>

namespace allocation_probe {

enum class Kind : std::size_t {
  scalar, array, nothrowScalar, nothrowArray,
  aligned, alignedArray, nothrowAligned, nothrowAlignedArray, count,
};
std::array<std::size_t, static_cast<std::size_t>(Kind::count)> counts{};
bool tracking = false;

#ifndef HEARLENS_DISABLE_ALLOCATION_PROBE
void record(Kind kind) noexcept {
  if (tracking) ++counts[static_cast<std::size_t>(kind)];
}

void* allocate(std::size_t size, Kind kind) {
  record(kind);
  if (void* memory = std::malloc(size == 0 ? 1 : size)) return memory;
  throw std::bad_alloc();
}

void* allocateAligned(std::size_t size, std::size_t alignment, Kind kind) {
  record(kind);
  const std::size_t requested = size == 0 ? 1 : size;
  const std::size_t remainder = requested % alignment;
  if (remainder != 0 &&
      requested > std::numeric_limits<std::size_t>::max() -
          (alignment - remainder)) throw std::bad_alloc();
  const std::size_t rounded = remainder == 0
      ? requested : requested + alignment - remainder;
  if (void* memory = std::aligned_alloc(alignment, rounded)) return memory;
  throw std::bad_alloc();
}
#endif

}  // namespace allocation_probe

namespace {

constexpr std::uint32_t kFixtureMagic = 0x334e4c48U;  // "HLN3" little-endian.
constexpr std::uint32_t kOutputMagic = 0x334f4c48U;   // "HLO3" little-endian.
constexpr std::size_t kEarCount = 2;
using Frame = std::array<float, kEarCount>;
using namespace hearlens::research;

bool readU32(std::istream& input, std::uint32_t& value) {
  std::array<unsigned char, 4> bytes{};
  if (!input.read(reinterpret_cast<char*>(bytes.data()),
                  static_cast<std::streamsize>(bytes.size()))) return false;
  value = static_cast<std::uint32_t>(bytes[0]) |
      (static_cast<std::uint32_t>(bytes[1]) << 8U) |
      (static_cast<std::uint32_t>(bytes[2]) << 16U) |
      (static_cast<std::uint32_t>(bytes[3]) << 24U);
  return true;
}

bool readU64(std::istream& input, std::uint64_t& value) {
  std::array<unsigned char, 8> bytes{};
  if (!input.read(reinterpret_cast<char*>(bytes.data()),
                  static_cast<std::streamsize>(bytes.size()))) return false;
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

void appendU32(std::vector<unsigned char>& output, std::size_t& offset,
               std::uint32_t value) {
  for (std::size_t byte = 0; byte < 4; ++byte) {
    output[offset++] = static_cast<unsigned char>((value >> (8U * byte)) & 0xffU);
  }
}

void appendU64(std::vector<unsigned char>& output, std::size_t& offset,
               std::uint64_t value) {
  for (std::size_t byte = 0; byte < 8; ++byte) {
    output[offset++] = static_cast<unsigned char>((value >> (8U * byte)) & 0xffU);
  }
}

void appendF64(std::vector<unsigned char>& output, std::size_t& offset,
               double value) {
  std::uint64_t bits = 0;
  std::memcpy(&bits, &value, sizeof(bits));
  appendU64(output, offset, bits);
}

void appendF32(std::vector<unsigned char>& output, std::size_t& offset,
               float value) {
  std::uint32_t bits = 0;
  std::memcpy(&bits, &value, sizeof(bits));
  appendU32(output, offset, bits);
}

bool checkDetectorResetAndFailure() {
  std::array<float, 480> input{};
  for (std::size_t frame = 0; frame < input.size(); ++frame) {
    input[frame] = static_cast<float>(
        0.3 * std::sin(2.0 * 3.14159265358979323846 * 1000.0 *
                       static_cast<double>(frame) / kDetectorRate));
  }
  SixBandLevelDetector reused;
  DetectorLevels first{}, afterReset{};
  if (!reused.configValid() || !reused.process(input.data(), input.size()) ||
      !reused.readNominalLevelsInto(first)) return false;
  reused.reset();
  if (!reused.process(input.data(), input.size()) ||
      !reused.readNominalLevelsInto(afterReset) || first != afterReset ||
      reused.acceptedSamples() != input.size()) return false;

  SixBandLevelDetector invalidBlock;
  std::array<float, 4> bad{0.1F, -0.2F,
      std::numeric_limits<float>::quiet_NaN(), 0.3F};
  if (invalidBlock.process(bad.data(), bad.size()) || !invalidBlock.faulted() ||
      invalidBlock.acceptedSamples() != 0 ||
      invalidBlock.readNominalLevelsInto(afterReset) ||
      invalidBlock.process(input.data(), 1)) return false;
  invalidBlock.reset();
  if (invalidBlock.faulted() ||
      !invalidBlock.process(input.data(), input.size())) return false;

  const SixBandLevelDetector badAttack(4.99, 400.0);
  const SixBandLevelDetector badRelease(15.0, 2000.1);
  const SixBandLevelDetector badOrder(100.0, 99.0);
  const SixBandLevelDetector validMinimum(5.0, 100.0);
  const SixBandLevelDetector validMaximum(100.0, 2000.0);
  return validMinimum.configValid() && validMaximum.configValid() &&
      !badAttack.configValid() && badAttack.faulted() &&
      !badRelease.configValid() && !badOrder.configValid();
}

bool checkStereoContract(const BandBasis& basis,
                         const std::array<BandTargets, 2>& targets) {
  StereoAutoFirResearch processor(basis, targets);
  if (!processor.configValid()) return false;
  std::array<Frame, 16> input{}, output{};
  input.fill(Frame{0.02F, -0.015F});
  output.fill(Frame{0.11F, 0.12F});
  input[7][1] = std::numeric_limits<float>::quiet_NaN();
  if (processor.processInto(input[0].data(), output[0].data(), input.size()) ||
      !processor.faulted() ||
      !std::all_of(output.begin(), output.end(), [](const Frame& frame) {
        return frame[0] == 0.0F && frame[1] == 0.0F;
      }) ||
      !processor.left().faulted() || !processor.right().faulted() ||
      !processor.left().detector().faulted() ||
      !processor.right().detector().faulted()) return false;

  processor.reset();
  if (processor.faulted() || !processor.configValid()) return false;
  input.fill(Frame{0.02F, -0.015F});
  output.fill(Frame{});
  if (!processor.processInto(input[0].data(), output[0].data(), input.size())) {
    return false;
  }
  StereoAutoFirResearch fresh(basis, targets);
  std::array<Frame, 16> freshOutput{};
  if (!fresh.processInto(input[0].data(), freshOutput[0].data(), input.size()) ||
      output != freshOutput) return false;

  for (const float invalidSample : {
           std::numeric_limits<float>::infinity(), 16.0001F}) {
    StereoAutoFirResearch invalidInput(basis, targets);
    input.fill(Frame{0.02F, -0.015F});
    input[7][1] = invalidSample;
    output.fill(Frame{0.11F, 0.12F});
    if (invalidInput.processInto(input[0].data(), output[0].data(),
                                 input.size()) ||
        !invalidInput.faulted() ||
        !invalidInput.left().faulted() || !invalidInput.right().faulted() ||
        !std::all_of(output.begin(), output.end(), [](const Frame& frame) {
          return frame[0] == 0.0F && frame[1] == 0.0F;
        })) return false;
  }

  StereoAutoFirResearch overlap(basis, targets);
  std::array<float, 32> shared{};
  if (overlap.processInto(shared.data(), shared.data() + 1, 8) ||
      !overlap.faulted() ||
      !std::all_of(shared.begin() + 1, shared.begin() + 17,
                   [](float value) { return value == 0.0F; })) return false;

  StereoAutoFirResearch badInterval(
      basis, targets, 15.0, 400.0, kMinimumControlInterval - 1);
  StereoAutoFirResearch validMinimumInterval(
      basis, targets, 15.0, 400.0, kMinimumControlInterval);
  StereoAutoFirResearch validMaximumInterval(
      basis, targets, 15.0, 400.0, kMaximumControlInterval);
  StereoAutoFirResearch badMaximumInterval(
      basis, targets, 15.0, 400.0, kMaximumControlInterval + 1);
  return !badInterval.configValid() && badInterval.faulted() &&
      validMinimumInterval.configValid() && validMaximumInterval.configValid() &&
      !badMaximumInterval.configValid();
}

bool writeOutput(std::ostream& output, const StereoAutoFirResearch& processor,
                 const std::vector<Frame>& pcm,
                 const std::array<std::vector<std::uint64_t>, 2>& sampleIndices,
                 const std::array<std::vector<DetectorLevels>, 2>& levelLogs,
                 std::size_t callbackAllocations) {
  if (processor.left().updates() != processor.right().updates() ||
      processor.left().updates() > std::numeric_limits<std::uint32_t>::max()) {
    return false;
  }
  const std::uint32_t logCount =
      static_cast<std::uint32_t>(processor.left().updates());
  std::size_t outputBytes = 3 * sizeof(std::uint32_t) +
      pcm.size() * kEarCount * sizeof(float) +
      kEarCount * (11 * sizeof(std::uint64_t) + sizeof(double)) +
      sizeof(std::uint64_t) +
      logCount * kEarCount *
          (sizeof(std::uint64_t) + kDetectorBandCount * sizeof(double));
  std::vector<unsigned char> bytes(outputBytes);
  std::size_t offset = 0;
  appendU32(bytes, offset, kOutputMagic);
  appendU32(bytes, offset, static_cast<std::uint32_t>(pcm.size()));
  appendU32(bytes, offset, logCount);
  for (const auto& frame : pcm) {
    appendF32(bytes, offset, frame[0]);
    appendF32(bytes, offset, frame[1]);
  }
  for (const AutoFirResearch* ear : {&processor.left(), &processor.right()}) {
    appendU64(bytes, offset, ear->acceptedSamples());
    appendU64(bytes, offset, ear->sinceUpdate());
    appendU64(bytes, offset, ear->updates());
    appendU64(bytes, offset, ear->initialized() ? 1 : 0);
    appendU64(bytes, offset, ear->faulted() ? 1 : 0);
    appendU64(bytes, offset, ear->detector().acceptedSamples());
    appendU64(bytes, offset, ear->detector().faulted() ? 1 : 0);
    appendU64(bytes, offset, ear->fir().acceptedSamples());
    appendU64(bytes, offset, ear->fir().updates());
    appendU64(bytes, offset, ear->fir().limitedSamples());
    appendU64(bytes, offset, ear->fir().transitionRemainingSamples());
    appendF64(bytes, offset, ear->fir().maxAbsOutput());
  }
  appendU64(bytes, offset, callbackAllocations);
  for (std::size_t ear = 0; ear < kEarCount; ++ear) {
    if (sampleIndices[ear].size() < logCount ||
        levelLogs[ear].size() < logCount) return false;
    for (std::size_t event = 0; event < logCount; ++event) {
      appendU64(bytes, offset, sampleIndices[ear][event]);
      for (double level : levelLogs[ear][event]) appendF64(bytes, offset, level);
    }
  }
  if (offset != bytes.size() ||
      !output.write(reinterpret_cast<const char*>(bytes.data()),
                    static_cast<std::streamsize>(bytes.size()))) return false;
  output.flush();
  return static_cast<bool>(output);
}

#ifndef HEARLENS_DISABLE_ALLOCATION_PROBE
bool checkAllocationPositiveControls() {
  using allocation_probe::Kind;
  const auto before = allocation_probe::counts;
  allocation_probe::tracking = true;
  void* scalar = ::operator new(37);
  allocation_probe::tracking = false;
  ::operator delete(scalar);
  allocation_probe::tracking = true;
  void* array = ::operator new[](41);
  allocation_probe::tracking = false;
  ::operator delete[](array);
  using NothrowScalarNew =
      void* (*)(std::size_t, const std::nothrow_t&) noexcept;
  NothrowScalarNew volatile newNothrowScalar =
      static_cast<NothrowScalarNew>(&::operator new);
  allocation_probe::tracking = true;
  void* nothrowScalar = newNothrowScalar(43, std::nothrow);
  allocation_probe::tracking = false;
  ::operator delete(nothrowScalar, std::nothrow);
  using NothrowArrayNew =
      void* (*)(std::size_t, const std::nothrow_t&) noexcept;
  NothrowArrayNew volatile newNothrowArray =
      static_cast<NothrowArrayNew>(&::operator new[]);
  allocation_probe::tracking = true;
  void* nothrowArray = newNothrowArray(47, std::nothrow);
  allocation_probe::tracking = false;
  ::operator delete[](nothrowArray, std::nothrow);
  allocation_probe::tracking = true;
  void* aligned = ::operator new(53, std::align_val_t{64});
  allocation_probe::tracking = false;
  ::operator delete(aligned, std::align_val_t{64});
  allocation_probe::tracking = true;
  void* alignedArray = ::operator new[](59, std::align_val_t{64});
  allocation_probe::tracking = false;
  ::operator delete[](alignedArray, std::align_val_t{64});
  using NothrowAlignedNew =
      void* (*)(std::size_t, std::align_val_t, const std::nothrow_t&) noexcept;
  NothrowAlignedNew volatile newNothrowAligned =
      static_cast<NothrowAlignedNew>(&::operator new);
  allocation_probe::tracking = true;
  void* nothrowAligned =
      newNothrowAligned(61, std::align_val_t{64}, std::nothrow);
  allocation_probe::tracking = false;
  ::operator delete(nothrowAligned, std::align_val_t{64}, std::nothrow);
  NothrowAlignedNew volatile newNothrowAlignedArray =
      static_cast<NothrowAlignedNew>(&::operator new[]);
  allocation_probe::tracking = true;
  void* nothrowAlignedArray =
      newNothrowAlignedArray(67, std::align_val_t{64}, std::nothrow);
  allocation_probe::tracking = false;
  ::operator delete[](nothrowAlignedArray, std::align_val_t{64}, std::nothrow);
  for (std::size_t index = 0; index < before.size(); ++index) {
    if (allocation_probe::counts[index] != before[index] + 1) return false;
  }
  return true;
}
#endif

bool run(std::istream& fixture, std::ostream& result) {
  static_assert(sizeof(double) == sizeof(std::uint64_t));
  static_assert(sizeof(float) == sizeof(std::uint32_t));
  if (!std::numeric_limits<double>::is_iec559 ||
      !std::numeric_limits<float>::is_iec559) {
    std::fprintf(stderr, "unsupported IEEE-754 float/double representation\n");
    return false;
  }

  std::uint32_t magic = 0, sampleCount = 0, callbackFrames = 0;
  std::uint32_t controlInterval = 0, logCapacity = 0, transitionSamples = 0;
  double attackMs = 0.0, releaseMs = 0.0, maxGainDb = 0.0, limiterCeiling = 0.0;
  if (!readU32(fixture, magic) || !readU32(fixture, sampleCount) ||
      !readU32(fixture, callbackFrames) || !readU32(fixture, controlInterval) ||
      !readU32(fixture, logCapacity) || !readF64(fixture, attackMs) ||
      !readF64(fixture, releaseMs) || !readF64(fixture, maxGainDb) ||
      !readF64(fixture, limiterCeiling) ||
      !readU32(fixture, transitionSamples) || magic != kFixtureMagic ||
      sampleCount == 0 || sampleCount > 1'000'000 || callbackFrames == 0 ||
      callbackFrames > kMaximumCallbackFrames ||
      controlInterval < kMinimumControlInterval ||
      controlInterval > kMaximumControlInterval || logCapacity > 10000) {
    std::fprintf(stderr, "invalid Native Auto-FIR fixture header\n");
    return false;
  }

  BandBasis basis{};
  for (auto& band : basis) {
    for (double& coefficient : band) {
      if (!readF64(fixture, coefficient)) return false;
    }
  }
  std::array<BandTargets, kEarCount> targets{};
  for (auto& ear : targets) {
    for (auto& band : ear) {
      for (double& gain : band) {
        if (!readF64(fixture, gain)) return false;
      }
    }
  }

  std::vector<Frame> input(sampleCount), output(sampleCount);
  for (Frame& frame : input) {
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
    std::fprintf(stderr, "Native Auto-FIR fixture contains trailing bytes\n");
    return false;
  }

  const std::size_t expectedUpdates = sampleCount / controlInterval;
  if (logCapacity < expectedUpdates) {
    std::fprintf(stderr, "update log capacity too small\n");
    return false;
  }
  std::array<std::vector<std::uint64_t>, kEarCount> sampleIndices{
      std::vector<std::uint64_t>(logCapacity),
      std::vector<std::uint64_t>(logCapacity)};
  std::array<std::vector<DetectorLevels>, kEarCount> levelLogs{
      std::vector<DetectorLevels>(logCapacity),
      std::vector<DetectorLevels>(logCapacity)};
  const std::array<UpdateLogView, kEarCount> logViews{{
      {sampleIndices[0].data(), levelLogs[0].data(), logCapacity},
      {sampleIndices[1].data(), levelLogs[1].data(), logCapacity},
  }};
#ifndef HEARLENS_DISABLE_ALLOCATION_PROBE
  const bool allocationControlsValid = checkAllocationPositiveControls();
#else
  const bool allocationControlsValid = true;
#endif
  if (!allocationControlsValid || !checkDetectorResetAndFailure() ||
      !checkStereoContract(basis, targets)) {
    std::fprintf(stderr, "detector or stereo fail-stop/reset controls failed\n");
    return false;
  }

  StereoAutoFirResearch processor(
      basis, targets, attackMs, releaseMs, controlInterval, maxGainDb,
      limiterCeiling, transitionSamples, logViews);
  if (!processor.configValid()) {
    std::fprintf(stderr, "Native Auto-FIR rejected fixture config\n");
    return false;
  }
#ifndef HEARLENS_DISABLE_ALLOCATION_PROBE
  const auto allocationsBefore = allocation_probe::counts;
#endif
  for (std::size_t position = 0; position < sampleCount;) {
    const std::size_t frames =
        std::min<std::size_t>(callbackFrames, sampleCount - position);
    allocation_probe::tracking = true;
    const bool processed = processor.processInto(input[position].data(),
                                                  output[position].data(),
                                                  frames);
    allocation_probe::tracking = false;
    if (!processed) {
      std::fprintf(stderr, "Native stereo Auto-FIR failed at sample %zu\n",
                   position);
      return false;
    }
    position += frames;
  }
  std::size_t callbackAllocations = 0;
#ifndef HEARLENS_DISABLE_ALLOCATION_PROBE
  for (std::size_t index = 0; index < allocationsBefore.size(); ++index) {
    callbackAllocations += allocation_probe::counts[index] - allocationsBefore[index];
  }
  if (callbackAllocations != 0) {
    std::fprintf(stderr, "callback allocation probe saw %zu allocations\n",
                 callbackAllocations);
    return false;
  }
#else
  // The JNI library deliberately avoids replacing process-wide operator new.
  // Mark its protocol field as unavailable instead of reporting a false zero.
  callbackAllocations = std::numeric_limits<std::size_t>::max();
#endif
  if (processor.acceptedSamples() != sampleCount ||
      processor.left().updates() != expectedUpdates ||
      processor.right().updates() != expectedUpdates ||
      processor.left().fir().updates() != expectedUpdates + 1 ||
      processor.right().fir().updates() != expectedUpdates + 1 ||
      processor.left().detector().acceptedSamples() != sampleCount ||
      processor.right().detector().acceptedSamples() != sampleCount) {
    std::fprintf(stderr, "Native Auto-FIR diagnostic invariant failed\n");
    return false;
  }
  return writeOutput(result, processor, output, sampleIndices, levelLogs,
                     callbackAllocations);
}

}  // namespace

bool runPortableFixture(std::istream& fixture, std::ostream& result) {
  return run(fixture, result);
}

#ifndef HEARLENS_DISABLE_ALLOCATION_PROBE
void* operator new(std::size_t size) {
  return allocation_probe::allocate(size, allocation_probe::Kind::scalar);
}
void* operator new[](std::size_t size) {
  return allocation_probe::allocate(size, allocation_probe::Kind::array);
}
void* operator new(std::size_t size, const std::nothrow_t&) noexcept {
  try { return allocation_probe::allocate(size, allocation_probe::Kind::nothrowScalar); }
  catch (...) { return nullptr; }
}
void* operator new[](std::size_t size, const std::nothrow_t&) noexcept {
  try { return allocation_probe::allocate(size, allocation_probe::Kind::nothrowArray); }
  catch (...) { return nullptr; }
}
void* operator new(std::size_t size, std::align_val_t alignment) {
  return allocation_probe::allocateAligned(size, static_cast<std::size_t>(alignment),
      allocation_probe::Kind::aligned);
}
void* operator new[](std::size_t size, std::align_val_t alignment) {
  return allocation_probe::allocateAligned(size, static_cast<std::size_t>(alignment),
      allocation_probe::Kind::alignedArray);
}
void* operator new(std::size_t size, std::align_val_t alignment,
                   const std::nothrow_t&) noexcept {
  try { return allocation_probe::allocateAligned(size, static_cast<std::size_t>(alignment),
      allocation_probe::Kind::nothrowAligned); }
  catch (...) { return nullptr; }
}
void* operator new[](std::size_t size, std::align_val_t alignment,
                     const std::nothrow_t&) noexcept {
  try { return allocation_probe::allocateAligned(size, static_cast<std::size_t>(alignment),
      allocation_probe::Kind::nothrowAlignedArray); }
  catch (...) { return nullptr; }
}
void operator delete(void* memory) noexcept { std::free(memory); }
void operator delete[](void* memory) noexcept { std::free(memory); }
void operator delete(void* memory, std::size_t) noexcept { std::free(memory); }
void operator delete[](void* memory, std::size_t) noexcept { std::free(memory); }
void operator delete(void* memory, const std::nothrow_t&) noexcept { std::free(memory); }
void operator delete[](void* memory, const std::nothrow_t&) noexcept { std::free(memory); }
void operator delete(void* memory, std::align_val_t) noexcept { std::free(memory); }
void operator delete[](void* memory, std::align_val_t) noexcept { std::free(memory); }
void operator delete(void* memory, std::size_t, std::align_val_t) noexcept {
  std::free(memory);
}
void operator delete[](void* memory, std::size_t, std::align_val_t) noexcept {
  std::free(memory);
}
void operator delete(void* memory, std::align_val_t, const std::nothrow_t&) noexcept {
  std::free(memory);
}
void operator delete[](void* memory, std::align_val_t, const std::nothrow_t&) noexcept {
  std::free(memory);
}
#endif

#ifndef HEARLENS_ANDROID_JNI
int main(int argc, char** argv) {
  if (argc != 2) {
    std::fprintf(stderr, "usage: auto-check FIXTURE.bin\n");
    return 1;
  }
  std::ifstream fixture(argv[1], std::ios::binary);
  if (!fixture) {
    std::fprintf(stderr, "failed to open Native Auto-FIR fixture\n");
    return 1;
  }
  return runPortableFixture(fixture, std::cout) ? 0 : 1;
}
#endif
