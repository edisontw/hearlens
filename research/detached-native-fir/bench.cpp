#include "fir_core.hpp"

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <limits>
#include <new>
#include <vector>

namespace {

enum class AllocationKind : std::size_t {
  scalar,
  array,
  nothrowScalar,
  nothrowArray,
  aligned,
  alignedArray,
  nothrowAligned,
  nothrowAlignedArray,
  count,
};

struct AllocationCounts {
  std::array<std::size_t, static_cast<std::size_t>(AllocationKind::count)> values{};

  std::size_t get(AllocationKind kind) const noexcept {
    return values[static_cast<std::size_t>(kind)];
  }
};

bool trackingAllocations = false;
AllocationCounts allocationCounts{};
volatile double benchmarkSink = 0.0;

void recordAllocation(AllocationKind kind) noexcept {
  if (trackingAllocations) {
    ++allocationCounts.values[static_cast<std::size_t>(kind)];
  }
}

void* allocate(std::size_t size, AllocationKind kind) {
  recordAllocation(kind);
  if (void* memory = std::malloc(size == 0 ? 1 : size)) return memory;
  throw std::bad_alloc();
}

void* allocateAligned(std::size_t size, std::size_t alignment,
                      AllocationKind kind) {
  recordAllocation(kind);
  const std::size_t requested = size == 0 ? 1 : size;
  const std::size_t remainder = requested % alignment;
  if (remainder != 0 && requested > std::numeric_limits<std::size_t>::max() - (alignment - remainder)) {
    throw std::bad_alloc();
  }
  const std::size_t rounded = remainder == 0 ? requested : requested + alignment - remainder;
  if (void* memory = std::aligned_alloc(alignment, rounded)) return memory;
  throw std::bad_alloc();
}

struct AllocationTrackingScope {
  AllocationTrackingScope() noexcept { trackingAllocations = true; }
  ~AllocationTrackingScope() { trackingAllocations = false; }
  AllocationTrackingScope(const AllocationTrackingScope&) = delete;
  AllocationTrackingScope& operator=(const AllocationTrackingScope&) = delete;
};

using Frame = std::array<float, 2>;
using StereoCoefficients = std::array<hearlens::research::Coefficients, 2>;

constexpr std::size_t kFixtureSamples = 16'384;
constexpr std::size_t kWarmupCallbacks = 100;
constexpr std::size_t kMeasuredCallbacks = 2'000;
constexpr std::size_t kTotalCallbacks = kWarmupCallbacks + kMeasuredCallbacks;

void fillFixture(StereoCoefficients& coefficients, std::vector<Frame>& input) {
  for (std::size_t ear = 0; ear < coefficients.size(); ++ear) {
    for (std::size_t tap = 0; tap < hearlens::research::kUniqueTapCount; ++tap) {
      const int pattern = static_cast<int>((tap * 13 + ear * 7) % 31) - 15;
      coefficients[ear][tap] = static_cast<double>(pattern) / 8192.0;
    }
    for (std::size_t sample = 0; sample < input.size(); ++sample) {
      const int pattern = static_cast<int>((sample * 17 + ear * 101) % 997) - 498;
      input[sample][ear] = static_cast<float>(pattern) / 2048.0F;
    }
  }
}

void processCallback(std::array<hearlens::research::Fir, 2>& filters,
                     const StereoCoefficients& coefficients,
                     const Frame* input, Frame* output, std::size_t frames) {
  for (std::size_t frame = 0; frame < frames; ++frame) {
    for (std::size_t ear = 0; ear < filters.size(); ++ear) {
      output[frame][ear] = filters[ear].step(input[frame][ear], coefficients[ear]);
    }
  }
}

bool checkPartitions(const StereoCoefficients& coefficients,
                     const std::vector<Frame>& input,
                     std::vector<Frame>& reference,
                     std::vector<Frame>& output) {
  std::array<hearlens::research::Fir, 2> oneBlock{};
  processCallback(oneBlock, coefficients, input.data(), reference.data(), input.size());

  constexpr std::array<std::size_t, 5> blockSizes{64, 128, 192, 256, 480};
  for (const std::size_t blockSize : blockSizes) {
    std::array<hearlens::research::Fir, 2> partitioned{};
    for (std::size_t offset = 0; offset < input.size(); offset += blockSize) {
      const std::size_t frames = std::min(blockSize, input.size() - offset);
      processCallback(partitioned, coefficients, input.data() + offset,
                      output.data() + offset, frames);
    }
    if (output != reference) {
      for (std::size_t sample = 0; sample < output.size(); ++sample) {
        if (output[sample] != reference[sample]) {
          std::fprintf(stderr,
                       "partition mismatch: block=%zu sample=%zu left=%g/%g right=%g/%g\n",
                       blockSize, sample, output[sample][0], reference[sample][0],
                       output[sample][1], reference[sample][1]);
          return false;
        }
      }
      return false;
    }
    std::printf("partition block=%zu status=PASS frames=%zu\n", blockSize,
                input.size());
  }
  return true;
}

bool checkIsolationAndReset(const StereoCoefficients& coefficients,
                            const std::vector<Frame>& input) {
  std::array<hearlens::research::Fir, 2> independent{};
  std::vector<Frame> leftOnly(input.size());
  std::vector<Frame> rightOnly(input.size());
  std::vector<Frame> silence(input.size());
  std::vector<Frame> output(input.size());
  for (std::size_t sample = 0; sample < input.size(); ++sample) {
    leftOnly[sample][0] = input[sample][0];
    rightOnly[sample][1] = input[sample][1];
  }

  processCallback(independent, coefficients, leftOnly.data(), output.data(), leftOnly.size());
  if (!std::all_of(output.begin(), output.end(), [](const Frame& frame) {
        return frame[1] == 0.0F;
      }) || !std::any_of(output.begin(), output.end(), [](const Frame& frame) {
        return frame[0] != 0.0F;
      })) {
    std::fprintf(stderr, "left/right FIR state isolation check failed\n");
    return false;
  }

  independent[0].reset();
  independent[1].reset();
  processCallback(independent, coefficients, rightOnly.data(), output.data(), rightOnly.size());
  if (!std::all_of(output.begin(), output.end(), [](const Frame& frame) {
        return frame[0] == 0.0F;
      }) || !std::any_of(output.begin(), output.end(), [](const Frame& frame) {
        return frame[1] != 0.0F;
      })) {
    std::fprintf(stderr, "right/left FIR state isolation check failed\n");
    return false;
  }

  independent[0].reset();
  independent[1].reset();
  processCallback(independent, coefficients, silence.data(), output.data(), silence.size());
  if (!std::all_of(output.begin(), output.end(), [](const Frame& frame) {
        return frame[0] == 0.0F && frame[1] == 0.0F;
      })) {
    std::fprintf(stderr, "reset did not clear both FIR histories\n");
    return false;
  }

  std::array<hearlens::research::Fir, 2> used{};
  processCallback(used, coefficients, leftOnly.data(), output.data(), leftOnly.size());
  used[0].reset();
  std::array<hearlens::research::Fir, 2> fresh{};
  std::array<Frame, 16> afterReset{};
  std::array<Frame, 16> afterFresh{};
  processCallback(used, coefficients, leftOnly.data(), afterReset.data(), afterReset.size());
  processCallback(fresh, coefficients, leftOnly.data(), afterFresh.data(), afterFresh.size());
  if (afterReset != afterFresh) {
    std::fprintf(stderr, "reset state differs from a fresh FIR instance\n");
    return false;
  }

  std::puts("stereo-isolation=PASS reset=PASS");
  return true;
}

bool checkAllocationPositiveControls() {
  std::array<std::size_t, static_cast<std::size_t>(AllocationKind::count)> before{};
  for (std::size_t index = 0; index < before.size(); ++index) {
    before[index] = allocationCounts.values[index];
  }

  trackingAllocations = true;
  void* scalar = ::operator new(37);
  trackingAllocations = false;
  ::operator delete(scalar);

  trackingAllocations = true;
  void* array = ::operator new[](41);
  trackingAllocations = false;
  ::operator delete[](array);

  using NothrowScalarNew = void* (*)(std::size_t, const std::nothrow_t&) noexcept;
  NothrowScalarNew volatile allocateNothrowScalar =
      static_cast<NothrowScalarNew>(&::operator new);
  trackingAllocations = true;
  void* nothrowScalar = allocateNothrowScalar(43, std::nothrow);
  trackingAllocations = false;
  ::operator delete(nothrowScalar, std::nothrow);

  using NothrowArrayNew = void* (*)(std::size_t, const std::nothrow_t&) noexcept;
  NothrowArrayNew volatile allocateNothrowArray =
      static_cast<NothrowArrayNew>(&::operator new[]);
  trackingAllocations = true;
  void* nothrowArray = allocateNothrowArray(47, std::nothrow);
  trackingAllocations = false;
  ::operator delete[](nothrowArray, std::nothrow);

  trackingAllocations = true;
  void* aligned = ::operator new(53, std::align_val_t{64});
  trackingAllocations = false;
  ::operator delete(aligned, std::align_val_t{64});

  trackingAllocations = true;
  void* alignedArray = ::operator new[](59, std::align_val_t{64});
  trackingAllocations = false;
  ::operator delete[](alignedArray, std::align_val_t{64});

  using NothrowAlignedNew =
      void* (*)(std::size_t, std::align_val_t, const std::nothrow_t&) noexcept;
  NothrowAlignedNew volatile allocateNothrowAligned =
      static_cast<NothrowAlignedNew>(&::operator new);
  trackingAllocations = true;
  void* nothrowAligned = allocateNothrowAligned(61, std::align_val_t{64}, std::nothrow);
  trackingAllocations = false;
  ::operator delete(nothrowAligned, std::align_val_t{64}, std::nothrow);

  NothrowAlignedNew volatile allocateNothrowAlignedArray =
      static_cast<NothrowAlignedNew>(&::operator new[]);
  trackingAllocations = true;
  void* nothrowAlignedArray =
      allocateNothrowAlignedArray(67, std::align_val_t{64}, std::nothrow);
  trackingAllocations = false;
  ::operator delete[](nothrowAlignedArray, std::align_val_t{64}, std::nothrow);

  for (std::size_t index = 0; index < before.size(); ++index) {
    if (allocationCounts.values[index] != before[index] + 1) {
      std::fprintf(stderr, "allocation monitor positive control failed for kind=%zu\n", index);
      return false;
    }
  }
  std::puts("allocation-positive-controls=PASS scalar,array,nothrow,aligned,nothrow-aligned");
  return true;
}

std::size_t callbackAllocationCount(const AllocationCounts& start) {
  std::size_t total = 0;
  for (std::size_t index = 0; index < allocationCounts.values.size(); ++index) {
    total += allocationCounts.values[index] - start.values[index];
  }
  return total;
}

double percentile(const std::vector<double>& sortedValues, double fraction) {
  const std::size_t rank = static_cast<std::size_t>(
      std::ceil(static_cast<double>(sortedValues.size()) * fraction));
  const std::size_t index = rank == 0 ? 0 : rank - 1;
  return sortedValues[std::min(index, sortedValues.size() - 1)];
}

bool benchmarkBlockSize(std::size_t blockSize,
                        const StereoCoefficients& coefficients,
                        const std::vector<Frame>& input,
                        std::vector<Frame>& output) {
  std::array<hearlens::research::Fir, 2> filters{};
  std::vector<double> elapsedMicroseconds;
  elapsedMicroseconds.reserve(kMeasuredCallbacks);
  std::size_t deadlineMisses = 0;
  const double deadlineMicroseconds =
      static_cast<double>(blockSize) * 1'000'000.0 / 48'000.0;
  const AllocationCounts allocationStart = allocationCounts;

  for (std::size_t callbackIndex = 0; callbackIndex < kTotalCallbacks; ++callbackIndex) {
    const auto start = std::chrono::steady_clock::now();
    {
      AllocationTrackingScope trackingScope;
      processCallback(filters, coefficients, input.data(), output.data(), blockSize);
    }
    const auto end = std::chrono::steady_clock::now();
    const double elapsed = std::chrono::duration<double, std::micro>(end - start).count();

    // Consume every output outside the timed interval. The volatile sink keeps
    // the compiler from discarding the FIR work; this scan is excluded from timing.
    double checksum = 0.0;
    for (std::size_t frame = 0; frame < blockSize; ++frame) {
      checksum += static_cast<double>(output[frame][0]);
      checksum += static_cast<double>(output[frame][1]);
    }
    benchmarkSink = benchmarkSink + checksum;

    if (callbackIndex >= kWarmupCallbacks) {
      elapsedMicroseconds.push_back(elapsed);
      if (elapsed > deadlineMicroseconds) ++deadlineMisses;
    }
  }

  const std::size_t observedAllocations = callbackAllocationCount(allocationStart);
  if (observedAllocations != 0) {
    std::fprintf(stderr, "callback allocation monitor observed %zu allocation(s)\n",
                 observedAllocations);
    return false;
  }

  std::sort(elapsedMicroseconds.begin(), elapsedMicroseconds.end());
  std::printf(
      "block=%zu warmup=%zu callbacks=%zu deadline_us=%.3f p50=%.3f p95=%.3f "
      "p99=%.3f max=%.3f misses=%zu/%zu callback_new=0 checksum=%.9g\n",
      blockSize, kWarmupCallbacks, elapsedMicroseconds.size(), deadlineMicroseconds,
      percentile(elapsedMicroseconds, 0.50), percentile(elapsedMicroseconds, 0.95),
      percentile(elapsedMicroseconds, 0.99), elapsedMicroseconds.back(), deadlineMisses,
      elapsedMicroseconds.size(), static_cast<double>(benchmarkSink));
  return true;
}

}  // namespace

void* operator new(std::size_t size) {
  return allocate(size, AllocationKind::scalar);
}

void* operator new[](std::size_t size) {
  return allocate(size, AllocationKind::array);
}

void* operator new(std::size_t size, const std::nothrow_t&) noexcept {
  try {
    return allocate(size, AllocationKind::nothrowScalar);
  } catch (...) {
    return nullptr;
  }
}

void* operator new[](std::size_t size, const std::nothrow_t&) noexcept {
  try {
    return allocate(size, AllocationKind::nothrowArray);
  } catch (...) {
    return nullptr;
  }
}

void* operator new(std::size_t size, std::align_val_t alignment) {
  return allocateAligned(size, static_cast<std::size_t>(alignment), AllocationKind::aligned);
}

void* operator new[](std::size_t size, std::align_val_t alignment) {
  return allocateAligned(size, static_cast<std::size_t>(alignment), AllocationKind::alignedArray);
}

void* operator new(std::size_t size, std::align_val_t alignment,
                   const std::nothrow_t&) noexcept {
  try {
    return allocateAligned(size, static_cast<std::size_t>(alignment),
                           AllocationKind::nothrowAligned);
  } catch (...) {
    return nullptr;
  }
}

void* operator new[](std::size_t size, std::align_val_t alignment,
                     const std::nothrow_t&) noexcept {
  try {
    return allocateAligned(size, static_cast<std::size_t>(alignment),
                           AllocationKind::nothrowAlignedArray);
  } catch (...) {
    return nullptr;
  }
}

void operator delete(void* memory) noexcept { std::free(memory); }
void operator delete[](void* memory) noexcept { std::free(memory); }
void operator delete(void* memory, std::size_t) noexcept { std::free(memory); }
void operator delete[](void* memory, std::size_t) noexcept { std::free(memory); }
void operator delete(void* memory, const std::nothrow_t&) noexcept { std::free(memory); }
void operator delete[](void* memory, const std::nothrow_t&) noexcept { std::free(memory); }
void operator delete(void* memory, std::align_val_t) noexcept { std::free(memory); }
void operator delete[](void* memory, std::align_val_t) noexcept { std::free(memory); }
void operator delete(void* memory, std::size_t, std::align_val_t) noexcept { std::free(memory); }
void operator delete[](void* memory, std::size_t, std::align_val_t) noexcept { std::free(memory); }
void operator delete(void* memory, std::align_val_t, const std::nothrow_t&) noexcept {
  std::free(memory);
}
void operator delete[](void* memory, std::align_val_t, const std::nothrow_t&) noexcept {
  std::free(memory);
}

int main() {
  std::printf("compiler=%s cplusplus=%ld architecture=", __VERSION__, __cplusplus);
#if defined(__x86_64__)
  std::puts("x86_64 operating_system=linux");
#elif defined(__aarch64__)
  std::puts("aarch64 operating_system=linux");
#else
  std::puts("other operating_system=linux");
#endif
  std::puts("flags=-std=c++17 -O2 -fno-fast-math -ffp-contract=off -Wall -Wextra -Wpedantic -Werror");

  StereoCoefficients coefficients{};
  std::vector<Frame> input(kFixtureSamples), reference(kFixtureSamples), output(kFixtureSamples);
  fillFixture(coefficients, input);

  if (!checkPartitions(coefficients, input, reference, output)) return 2;
  if (!checkIsolationAndReset(coefficients, input)) return 3;
  if (!checkAllocationPositiveControls()) return 4;

  constexpr std::array<std::size_t, 5> blockSizes{64, 128, 192, 256, 480};
  for (const std::size_t blockSize : blockSizes) {
    if (!benchmarkBlockSize(blockSize, coefficients, input, output)) return 5;
  }
  std::printf("benchmark-result-sink=%.12g\n", static_cast<double>(benchmarkSink));
  return 0;
}
