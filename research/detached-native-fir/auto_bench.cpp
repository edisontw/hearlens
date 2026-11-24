#include "auto_fir_core.hpp"

#include <algorithm>
#include <array>
#include <cerrno>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <limits>
#include <new>
#include <numeric>
#include <sstream>
#include <string>
#include <sys/resource.h>
#include <time.h>
#include <vector>

namespace allocation_probe {
enum class Kind : std::size_t {
  scalar, array, nothrowScalar, nothrowArray, aligned, alignedArray,
  nothrowAligned, nothrowAlignedArray, count,
};
std::array<std::uint64_t, static_cast<std::size_t>(Kind::count)> counts{};
bool tracking = false;

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
  if (remainder != 0 && requested >
      std::numeric_limits<std::size_t>::max() - (alignment - remainder)) {
    throw std::bad_alloc();
  }
  const std::size_t rounded = remainder == 0
      ? requested : requested + alignment - remainder;
  if (void* memory = std::aligned_alloc(alignment, rounded)) return memory;
  throw std::bad_alloc();
}
}  // namespace allocation_probe

namespace {
using namespace hearlens::research;
using Frame = std::array<float, 2>;
constexpr std::uint32_t kFixtureMagic = 0x34424c48U;  // HLB4, little-endian.
constexpr std::size_t kRate = 48'000;
constexpr std::size_t kWarmupSamples = 96'000;
constexpr std::size_t kMeasuredSamples = 32 * kRate;
constexpr std::array<std::size_t, 5> kBlockSizes{64, 128, 192, 256, 480};

bool readU32(std::istream& in, std::uint32_t& value) {
  std::array<unsigned char, 4> b{};
  if (!in.read(reinterpret_cast<char*>(b.data()), 4)) return false;
  value = static_cast<std::uint32_t>(b[0]) |
      (static_cast<std::uint32_t>(b[1]) << 8U) |
      (static_cast<std::uint32_t>(b[2]) << 16U) |
      (static_cast<std::uint32_t>(b[3]) << 24U);
  return true;
}

bool readU64(std::istream& in, std::uint64_t& value) {
  std::array<unsigned char, 8> b{};
  if (!in.read(reinterpret_cast<char*>(b.data()), 8)) return false;
  value = 0;
  for (std::size_t i = 0; i < b.size(); ++i) {
    value |= static_cast<std::uint64_t>(b[i]) << (8U * i);
  }
  return true;
}

bool readF64(std::istream& in, double& value) {
  std::uint64_t bits = 0;
  if (!readU64(in, bits)) return false;
  std::memcpy(&value, &bits, sizeof(value));
  return std::isfinite(value);
}

bool readF32(std::istream& in, float& value) {
  std::uint32_t bits = 0;
  if (!readU32(in, bits)) return false;
  std::memcpy(&value, &bits, sizeof(value));
  return std::isfinite(value);
}

std::uint64_t clockNs(clockid_t clockId) noexcept {
  timespec value{};
  if (clock_gettime(clockId, &value) != 0) return 0;
  return static_cast<std::uint64_t>(value.tv_sec) * 1'000'000'000ULL +
      static_cast<std::uint64_t>(value.tv_nsec);
}

std::uint64_t steadyNs() noexcept {
  return static_cast<std::uint64_t>(std::chrono::duration_cast<
      std::chrono::nanoseconds>(std::chrono::steady_clock::now().time_since_epoch()).count());
}

struct CallbackSample {
  std::uint64_t wallNs = 0;
  std::uint64_t cpuNs = 0;
  bool update = false;
};

struct MetricSummary {
  std::size_t count = 0;
  std::array<double, 5> wallUs{};
  std::array<double, 5> cpuUs{};
  std::array<double, 5> utilizationPercent{};
};

std::array<double, 5> percentiles(std::vector<double>& values) {
  if (values.empty()) return {};
  std::sort(values.begin(), values.end());
  constexpr std::array<double, 5> p{0.50, 0.95, 0.99, 0.999, 1.0};
  std::array<double, 5> result{};
  for (std::size_t i = 0; i < p.size(); ++i) {
    const auto index = static_cast<std::size_t>(
        std::ceil(p[i] * static_cast<double>(values.size()))) - 1;
    result[i] = values[std::min(index, values.size() - 1)];
  }
  return result;
}

MetricSummary summarize(const std::vector<CallbackSample>& samples,
                        int updateFilter, double deadlineUs) {
  std::vector<double> wall, cpu, utilization;
  wall.reserve(samples.size());
  cpu.reserve(samples.size());
  utilization.reserve(samples.size());
  for (const auto& sample : samples) {
    if (updateFilter >= 0 && sample.update != (updateFilter != 0)) continue;
    const double wallUs = static_cast<double>(sample.wallNs) / 1000.0;
    const double cpuUs = static_cast<double>(sample.cpuNs) / 1000.0;
    wall.push_back(wallUs);
    cpu.push_back(cpuUs);
    utilization.push_back(100.0 * wallUs / deadlineUs);
  }
  MetricSummary result;
  result.count = wall.size();
  result.wallUs = percentiles(wall);
  result.cpuUs = percentiles(cpu);
  result.utilizationPercent = percentiles(utilization);
  return result;
}

void writePercentiles(std::ostream& out, const std::array<double, 5>& v) {
  out << "{\"p50\":" << v[0] << ",\"p95\":" << v[1]
      << ",\"p99\":" << v[2] << ",\"p99_9\":" << v[3]
      << ",\"max\":" << v[4] << '}';
}

void writeGroup(std::ostream& out, const MetricSummary& summary) {
  out << "{\"count\":" << summary.count << ",\"wallUs\":";
  writePercentiles(out, summary.wallUs);
  out << ",\"threadCpuUs\":";
  writePercentiles(out, summary.cpuUs);
  out << ",\"deadlineUtilizationPercent\":";
  writePercentiles(out, summary.utilizationPercent);
  out << '}';
}

template <typename Callback>
bool measure(std::size_t blockFrames, std::size_t warmupSamples,
             std::size_t measuredSamples, std::size_t totalSamples,
             Callback&& callback, std::vector<Frame>& output,
             std::string& jsonRow,
             double outputCeiling = std::numeric_limits<double>::infinity()) {
  const std::size_t warmCallbacks = warmupSamples / blockFrames;
  const std::size_t measuredCallbacks = measuredSamples / blockFrames;
  if (warmCallbacks * blockFrames != warmupSamples ||
      measuredCallbacks * blockFrames != measuredSamples ||
      warmupSamples + measuredSamples > totalSamples) return false;
  std::vector<CallbackSample> samples(measuredCallbacks);
  const auto allocationBefore = allocation_probe::counts;
  auto invoke = [&](std::size_t callbackIndex, bool record) {
    const std::size_t position = callbackIndex * blockFrames;
    bool update = false;
    if (!record) {
      allocation_probe::tracking = true;
      const bool ok = callback(position, blockFrames, update);
      allocation_probe::tracking = false;
      return ok;
    }
    const std::uint64_t wallStart = steadyNs();
    const std::uint64_t cpuStart = clockNs(CLOCK_THREAD_CPUTIME_ID);
    allocation_probe::tracking = true;
    const bool ok = callback(position, blockFrames, update);
    allocation_probe::tracking = false;
    const std::uint64_t cpuEnd = clockNs(CLOCK_THREAD_CPUTIME_ID);
    const std::uint64_t wallEnd = steadyNs();
    const std::size_t measuredIndex = callbackIndex - warmCallbacks;
    samples[measuredIndex] = {wallEnd - wallStart, cpuEnd - cpuStart, update};
    return ok;
  };

  for (std::size_t i = 0; i < warmCallbacks; ++i) {
    if (!invoke(i, false)) return false;
  }
  const std::uint64_t measuredWallStart = steadyNs();
  const std::uint64_t measuredCpuStart = clockNs(CLOCK_THREAD_CPUTIME_ID);
  for (std::size_t i = 0; i < measuredCallbacks; ++i) {
    if (!invoke(warmCallbacks + i, true)) return false;
  }
  const std::uint64_t measuredCpuEnd = clockNs(CLOCK_THREAD_CPUTIME_ID);
  const std::uint64_t measuredWallEnd = steadyNs();

  const double deadlineUs =
      static_cast<double>(blockFrames) * 1'000'000.0 / kRate;
  const auto all = summarize(samples, -1, deadlineUs);
  const auto updates = summarize(samples, 1, deadlineUs);
  const auto noUpdates = summarize(samples, 0, deadlineUs);
  std::size_t misses = 0, consecutive = 0, maxConsecutive = 0;
  for (const auto& sample : samples) {
    if (static_cast<double>(sample.wallNs) / 1000.0 > deadlineUs) {
      ++misses;
      ++consecutive;
      maxConsecutive = std::max(maxConsecutive, consecutive);
    } else {
      consecutive = 0;
    }
  }
  const std::size_t measuredBegin = warmupSamples;
  const std::size_t measuredEnd = warmupSamples + measuredSamples;
  double checksum = 0.0;
  double maxAbsOutput = 0.0;
  bool finite = true;
  for (std::size_t frame = measuredBegin; frame < measuredEnd; ++frame) {
    for (std::size_t ear = 0; ear < 2; ++ear) {
      const double value = output[frame][ear];
      finite = finite && std::isfinite(value);
      checksum += value * (ear == 0 ? 1.0 : -0.731);
      maxAbsOutput = std::max(maxAbsOutput, std::abs(value));
    }
  }
  if (!finite || !std::isfinite(checksum) || maxAbsOutput > outputCeiling) {
    return false;
  }
  std::uint64_t callbackAllocationCount = 0;
  for (std::size_t index = 0; index < allocationBefore.size(); ++index) {
    callbackAllocationCount += allocation_probe::counts[index] -
        allocationBefore[index];
  }
  if (callbackAllocationCount != 0) return false;
  volatile double checksumSink = checksum;
  (void)checksumSink;
  const double elapsedSeconds =
      static_cast<double>(measuredWallEnd - measuredWallStart) / 1.0e9;
  const double audioSeconds = static_cast<double>(measuredSamples) / kRate;
  const double threadCpuSeconds =
      static_cast<double>(measuredCpuEnd - measuredCpuStart) / 1.0e9;
  const std::uint64_t deadlineNs = static_cast<std::uint64_t>(
      static_cast<double>(blockFrames) * 1.0e9 / kRate);
  jsonRow.clear();
  std::ostringstream row;
  row << std::setprecision(10)
      << "{\"blockFrames\":" << blockFrames
      << ",\"deadlineUs\":" << deadlineUs
      << ",\"warmupCallbacks\":" << warmCallbacks
      << ",\"measuredCallbacks\":" << measuredCallbacks
      << ",\"samplesPerEar\":" << measuredSamples
      << ",\"wallElapsedSeconds\":" << elapsedSeconds
      << ",\"threadCpuSeconds\":" << threadCpuSeconds
      << ",\"threadCpuToWallRatio\":"
      << (elapsedSeconds > 0.0 ? threadCpuSeconds / elapsedSeconds : 0.0)
      << ",\"throughputFramesPerSecond\":"
      << (elapsedSeconds > 0.0 ? measuredSamples / elapsedSeconds : 0.0)
      << ",\"realTimeFactor\":"
      << (elapsedSeconds > 0.0 ? audioSeconds / elapsedSeconds : 0.0)
      << ",\"deadlineMisses\":" << misses
      << ",\"deadlineMissRate\":"
      << static_cast<double>(misses) / measuredCallbacks
      << ",\"maxConsecutiveDeadlineMisses\":" << maxConsecutive
      << ",\"deadlineUtilizationP99Percent\":"
      << all.utilizationPercent[2]
      << ",\"allocationCount\":" << callbackAllocationCount
      << ",\"finiteOutput\":true"
      << ",\"maxAbsOutput\":" << maxAbsOutput
      << ",\"checksum\":" << checksum
      << ",\"callbacks\":{";
  row << "\"all\":"; writeGroup(row, all);
  row << ",\"update\":"; writeGroup(row, updates);
  row << ",\"noUpdate\":"; writeGroup(row, noUpdates);
  row << "}}";
  jsonRow = row.str();
  (void)deadlineNs;
  return true;
}

bool runPaced(std::size_t blockFrames, std::size_t durationSeconds,
              const BandBasis& basis, const std::array<BandTargets, 2>& targets,
              double attackMs, double releaseMs, std::size_t controlInterval,
              double maxGainDb, double ceiling, std::size_t transitionSamples,
              const std::vector<Frame>& input) {
  if (durationSeconds == 0 || blockFrames == 0 ||
      blockFrames > kMaximumCallbackFrames ||
      input.size() % blockFrames != 0) return false;
  StereoAutoFirResearch processor(basis, targets, attackMs, releaseMs,
      controlInterval, maxGainDb, ceiling, transitionSamples);
  if (!processor.configValid()) return false;

  const std::uint64_t periodNs = static_cast<std::uint64_t>(
      static_cast<double>(blockFrames) * 1.0e9 / kRate);
  const double deadlineUs = static_cast<double>(periodNs) / 1000.0;
  const std::size_t expectedCallbacks = durationSeconds * kRate / blockFrames;
  std::vector<CallbackSample> samples;
  samples.reserve(expectedCallbacks + 1024);
  std::array<Frame, kMaximumCallbackFrames> output{};
  std::size_t position = 0;
  std::uint64_t acceptedFrames = 0;
  std::uint64_t allocationCount = 0;
  double checksum = 0.0;
  double maxAbsOutput = 0.0;
  bool finiteOutput = true;

  const std::uint64_t startNs = clockNs(CLOCK_MONOTONIC);
  const std::uint64_t stopNs = startNs + durationSeconds * 1'000'000'000ULL;
  std::uint64_t scheduledNs = startNs + periodNs;
  while (scheduledNs < stopNs) {
    timespec targetTime{};
    targetTime.tv_sec = static_cast<time_t>(scheduledNs / 1'000'000'000ULL);
    targetTime.tv_nsec = static_cast<long>(scheduledNs % 1'000'000'000ULL);
    int sleepResult = 0;
    do {
      sleepResult = clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME,
                                    &targetTime, nullptr);
    } while (sleepResult == EINTR);
    if (sleepResult != 0) return false;

    bool update = processor.left().sinceUpdate() + blockFrames >= controlInterval;
    const std::uint64_t wallStart = steadyNs();
    const std::uint64_t cpuStart = clockNs(CLOCK_THREAD_CPUTIME_ID);
    const auto allocationBefore = allocation_probe::counts;
    allocation_probe::tracking = true;
    const bool ok = processor.processInto(input[position].data(), output[0].data(),
                                          blockFrames);
    allocation_probe::tracking = false;
    const std::uint64_t cpuEnd = clockNs(CLOCK_THREAD_CPUTIME_ID);
    const std::uint64_t wallEnd = steadyNs();
    if (!ok) return false;
    samples.push_back({wallEnd - wallStart, cpuEnd - cpuStart, update});
    for (std::size_t index = 0; index < allocationBefore.size(); ++index) {
      allocationCount += allocation_probe::counts[index] - allocationBefore[index];
    }
    for (std::size_t frame = 0; frame < blockFrames; ++frame) {
      for (std::size_t ear = 0; ear < 2; ++ear) {
        const double value = output[frame][ear];
        finiteOutput = finiteOutput && std::isfinite(value);
        maxAbsOutput = std::max(maxAbsOutput, std::abs(value));
        checksum += value * (ear == 0 ? 1.0 : -0.731);
      }
    }
    acceptedFrames += blockFrames;
    position += blockFrames;
    if (position == input.size()) position = 0;
    scheduledNs += periodNs;
  }

  timespec stopTime{};
  stopTime.tv_sec = static_cast<time_t>(stopNs / 1'000'000'000ULL);
  stopTime.tv_nsec = static_cast<long>(stopNs % 1'000'000'000ULL);
  int stopSleepResult = 0;
  do {
    stopSleepResult = clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME,
                                      &stopTime, nullptr);
  } while (stopSleepResult == EINTR);
  if (stopSleepResult != 0) return false;

  const std::uint64_t endNs = clockNs(CLOCK_MONOTONIC);
  const double elapsedSeconds = static_cast<double>(endNs - startNs) / 1.0e9;
  const double audioSeconds = static_cast<double>(acceptedFrames) / kRate;
  const double threadCpuSeconds = std::accumulate(samples.begin(), samples.end(), 0.0,
      [](double total, const CallbackSample& sample) {
        return total + static_cast<double>(sample.cpuNs) / 1.0e9;
      });
  const auto all = summarize(samples, -1, deadlineUs);
  const auto updates = summarize(samples, 1, deadlineUs);
  const auto noUpdates = summarize(samples, 0, deadlineUs);
  std::size_t misses = 0, consecutive = 0, maxConsecutive = 0;
  for (const auto& sample : samples) {
    if (static_cast<double>(sample.wallNs) > deadlineUs * 1000.0) {
      ++misses;
      ++consecutive;
      maxConsecutive = std::max(maxConsecutive, consecutive);
    } else {
      consecutive = 0;
    }
  }
  if (!finiteOutput || !std::isfinite(checksum) || maxAbsOutput > ceiling ||
      allocationCount != 0 || samples.empty()) return false;

  struct rusage usage{};
  std::uint64_t peakRssBytes = 0;
  if (getrusage(RUSAGE_SELF, &usage) == 0 && usage.ru_maxrss > 0) {
    peakRssBytes = static_cast<std::uint64_t>(usage.ru_maxrss) * 1024ULL;
  }
#if defined(__aarch64__)
  constexpr const char* architecture = "aarch64";
#elif defined(__x86_64__)
  constexpr const char* architecture = "x86_64";
#else
  constexpr const char* architecture = "other";
#endif
  std::cout << std::setprecision(10)
      << "{\"architecture\":\"" << architecture
      << "\",\"compiler\":\"" << __VERSION__
      << "\",\"cplusplus\":" << __cplusplus
      << ",\"mode\":\"paced-complete-auto-fir\""
      << ",\"blockFrames\":" << blockFrames
      << ",\"deadlineUs\":" << deadlineUs
      << ",\"requestedSeconds\":" << durationSeconds
      << ",\"wallElapsedSeconds\":" << elapsedSeconds
      << ",\"threadCpuSeconds\":" << threadCpuSeconds
      << ",\"threadCpuToWallRatio\":" << threadCpuSeconds / elapsedSeconds
      << ",\"throughputFramesPerSecond\":" << acceptedFrames / elapsedSeconds
      << ",\"realTimeFactor\":" << audioSeconds / elapsedSeconds
      << ",\"measuredCallbacks\":" << samples.size()
      << ",\"controlUpdates\":" << processor.left().updates()
      << ",\"deadlineMisses\":" << misses
      << ",\"deadlineMissRate\":"
      << static_cast<double>(misses) / static_cast<double>(samples.size())
      << ",\"maxConsecutiveDeadlineMisses\":" << maxConsecutive
      << ",\"deadlineUtilizationP99Percent\":" << all.utilizationPercent[2]
      << ",\"allocationCount\":" << allocationCount
      << ",\"allocationProbePositiveControls\":true"
      << ",\"finiteOutput\":" << (finiteOutput ? "true" : "false")
      << ",\"maxAbsOutput\":" << maxAbsOutput
      << ",\"checksum\":" << checksum
      << ",\"peakRssBytes\":" << peakRssBytes
      << ",\"callbacks\":{\"all\":";
  writeGroup(std::cout, all);
  std::cout << ",\"update\":";
  writeGroup(std::cout, updates);
  std::cout << ",\"noUpdate\":";
  writeGroup(std::cout, noUpdates);
  std::cout << "}}\n";
  return true;
}

BandLevels syntheticLevels(std::uint64_t tick, std::size_t ear) {
  BandLevels levels{};
  for (std::size_t band = 0; band < kBandCount; ++band) {
    const std::uint64_t phase = (tick + band + ear * 2) % 4;
    levels[band] = 50.0 + 10.0 * static_cast<double>(phase);
  }
  return levels;
}

bool run(std::istream& fixture, std::size_t pacedSeconds = 0,
         std::size_t pacedBlockFrames = 128) {
  std::uint32_t magic = 0, totalSamples = 0, warmupSamples = 0;
  std::uint32_t measuredSamples = 0, controlInterval = 0;
  std::uint32_t transitionSamples = 0, sampleRate = 0;
  double attackMs = 0.0, releaseMs = 0.0, maxGainDb = 0.0, ceiling = 0.0;
  if (!readU32(fixture, magic) || !readU32(fixture, totalSamples) ||
      !readU32(fixture, warmupSamples) || !readU32(fixture, measuredSamples) ||
      !readU32(fixture, controlInterval) || !readU32(fixture, transitionSamples) ||
      !readU32(fixture, sampleRate) || !readF64(fixture, attackMs) ||
      !readF64(fixture, releaseMs) || !readF64(fixture, maxGainDb) ||
      !readF64(fixture, ceiling) || magic != kFixtureMagic ||
      sampleRate != kRate || totalSamples != warmupSamples + measuredSamples ||
      warmupSamples != kWarmupSamples || measuredSamples != kMeasuredSamples ||
      controlInterval != 480 || transitionSamples != 2400) {
    std::fprintf(stderr, "invalid full Auto-FIR benchmark fixture header\n");
    return false;
  }

  BandBasis basis{};
  std::array<BandTargets, 2> targets{};
  for (auto& band : basis) {
    for (double& coefficient : band) {
      if (!readF64(fixture, coefficient)) return false;
    }
  }
  for (auto& ear : targets) {
    for (auto& band : ear) {
      for (double& gain : band) {
        if (!readF64(fixture, gain)) return false;
      }
    }
  }
  std::vector<Frame> input(totalSamples), output(totalSamples);
  for (auto& frame : input) {
    for (float& sample : frame) {
      if (!readF32(fixture, sample) || std::abs(sample) > 16.0F) return false;
    }
  }
  char trailing = 0;
  if (fixture.read(&trailing, 1)) return false;

  // Confirm the allocation replacements observe all operator families.
  using namespace allocation_probe;
  const auto controlBefore = counts;
  tracking = true;
  auto* scalar = ::operator new(31);
  ::operator delete(scalar);
  auto* array = ::operator new[](33);
  ::operator delete[](array);
  using NothrowNew = void* (*)(std::size_t, const std::nothrow_t&) noexcept;
  NothrowNew volatile nothrowNew = static_cast<NothrowNew>(&::operator new);
  void* nScalar = nothrowNew(35, std::nothrow);
  ::operator delete(nScalar, std::nothrow);
  using NothrowArrayNew = void* (*)(std::size_t, const std::nothrow_t&) noexcept;
  NothrowArrayNew volatile nothrowArrayNew =
      static_cast<NothrowArrayNew>(&::operator new[]);
  void* nArray = nothrowArrayNew(37, std::nothrow);
  ::operator delete[](nArray, std::nothrow);
  auto* aligned = ::operator new(39, std::align_val_t{64});
  ::operator delete(aligned, std::align_val_t{64});
  auto* alignedArray = ::operator new[](41, std::align_val_t{64});
  ::operator delete[](alignedArray, std::align_val_t{64});
  using NothrowAligned = void* (*)(std::size_t, std::align_val_t,
      const std::nothrow_t&) noexcept;
  NothrowAligned volatile nAligned =
      static_cast<NothrowAligned>(&::operator new);
  void* nAlignedScalar = nAligned(43, std::align_val_t{64}, std::nothrow);
  ::operator delete(nAlignedScalar, std::align_val_t{64}, std::nothrow);
  NothrowAligned volatile nAlignedArray =
      static_cast<NothrowAligned>(&::operator new[]);
  void* nAlignedArrayValue =
      nAlignedArray(45, std::align_val_t{64}, std::nothrow);
  ::operator delete[](nAlignedArrayValue, std::align_val_t{64}, std::nothrow);
  tracking = false;
  bool controlsPass = true;
  for (std::size_t i = 0; i < counts.size(); ++i) {
    controlsPass = controlsPass && counts[i] == controlBefore[i] + 1;
  }
  if (!controlsPass) return false;

  if (pacedSeconds > 0) {
    return runPaced(pacedBlockFrames, pacedSeconds, basis, targets, attackMs,
        releaseMs, controlInterval, maxGainDb, ceiling, transitionSamples, input);
  }

  std::array<Coefficients, 2> fixedCoefficients{};
  for (std::size_t ear = 0; ear < 2; ++ear) {
    for (std::size_t tap = 0; tap < kUniqueTapCount; ++tap) {
      for (std::size_t band = 0; band < kBandCount; ++band) {
        const double gain = std::pow(10.0,
            std::min(targets[ear][band][1], maxGainDb) / 20.0);
        fixedCoefficients[ear][tap] += basis[band][tap] * gain;
      }
    }
  }

  std::vector<std::string> rows;
  rows.reserve(kBlockSizes.size() * 3);
  for (const std::size_t block : kBlockSizes) {
    {
      std::array<Fir, 2> filters{};
      std::fill(output.begin(), output.end(), Frame{});
      auto callback = [&](std::size_t position, std::size_t frames,
                          bool& update) {
        update = false;
        for (std::size_t i = 0; i < frames; ++i) {
          for (std::size_t ear = 0; ear < 2; ++ear) {
            output[position + i][ear] =
                filters[ear].step(input[position + i][ear], fixedCoefficients[ear]);
          }
        }
        return true;
      };
      std::string row;
      if (!measure(block, warmupSamples, measuredSamples, totalSamples,
                   callback, output, row)) return false;
      rows.push_back("{\"mode\":\"fixed-fir\",\"dynamicRetargets\":0," + row.substr(1));
    }
    {
      std::array<DynamicFir, 2> filters{
          DynamicFir(basis, targets[0], maxGainDb, ceiling, transitionSamples),
          DynamicFir(basis, targets[1], maxGainDb, ceiling, transitionSamples)};
      if (!filters[0].setSyntheticBandLevels(syntheticLevels(0, 0)) ||
          !filters[1].setSyntheticBandLevels(syntheticLevels(0, 1))) return false;
      std::array<std::array<float, kMaximumCallbackFrames>, 4> channels{};
      std::uint64_t sinceUpdate = 0, tick = 0, retargets = 2;
      std::fill(output.begin(), output.end(), Frame{});
      auto callback = [&](std::size_t position, std::size_t frames,
                          bool& update) {
        update = sinceUpdate + frames >= controlInterval;
        for (std::size_t i = 0; i < frames; ++i) {
          channels[0][i] = input[position + i][0];
          channels[1][i] = input[position + i][1];
        }
        std::size_t offset = 0;
        while (offset < frames) {
          const std::size_t count = std::min<std::size_t>(frames - offset,
              controlInterval - sinceUpdate);
          if (!filters[0].processInto(channels[0].data() + offset,
                                      channels[2].data() + offset, count) ||
              !filters[1].processInto(channels[1].data() + offset,
                                      channels[3].data() + offset, count)) return false;
          offset += count;
          sinceUpdate += count;
          if (sinceUpdate == controlInterval) {
            ++tick;
            if (!filters[0].setSyntheticBandLevels(syntheticLevels(tick, 0)) ||
                !filters[1].setSyntheticBandLevels(syntheticLevels(tick, 1))) return false;
            retargets += 2;
            sinceUpdate = 0;
          }
        }
        for (std::size_t i = 0; i < frames; ++i) {
          output[position + i] = {channels[2][i], channels[3][i]};
        }
        return true;
      };
      std::string row;
      if (!measure(block, warmupSamples, measuredSamples, totalSamples,
                   callback, output, row, ceiling)) return false;
      const std::size_t leftLimited = filters[0].limitedSamples();
      const std::size_t rightLimited = filters[1].limitedSamples();
      rows.push_back("{\"mode\":\"dynamic-fir\",\"controlUpdatesPerEar\":" +
          std::to_string(tick) + ",\"firRetargetsPerEarIncludingInitial\":" +
          std::to_string(retargets / 2) + ",\"limitedSamplesIncludingWarmupLR\":[" +
          std::to_string(leftLimited) + "," + std::to_string(rightLimited) + "]," +
          row.substr(1));
    }
    {
      StereoAutoFirResearch processor(basis, targets, attackMs, releaseMs,
          controlInterval, maxGainDb, ceiling, transitionSamples);
      std::fill(output.begin(), output.end(), Frame{});
      auto callback = [&](std::size_t position, std::size_t frames,
                          bool& update) {
        update = processor.left().sinceUpdate() + frames >= controlInterval;
        return processor.processInto(input[position].data(),
            output[position].data(), frames);
      };
      std::string row;
      if (!processor.configValid() ||
          !measure(block, warmupSamples, measuredSamples, totalSamples,
                   callback, output, row, ceiling)) return false;
      rows.push_back("{\"mode\":\"complete-auto-fir\",\"controlUpdates\":" +
          std::to_string(processor.left().updates()) +
          ",\"limitedSamplesIncludingWarmupLR\":[" +
          std::to_string(processor.left().fir().limitedSamples()) + "," +
          std::to_string(processor.right().fir().limitedSamples()) + "]," +
          row.substr(1));
    }
  }

  struct rusage usage{};
  std::uint64_t peakRssBytes = 0;
  if (getrusage(RUSAGE_SELF, &usage) == 0 && usage.ru_maxrss > 0) {
    peakRssBytes = static_cast<std::uint64_t>(usage.ru_maxrss) * 1024ULL;
  }
#if defined(__aarch64__)
  constexpr const char* architecture = "aarch64";
#elif defined(__x86_64__)
  constexpr const char* architecture = "x86_64";
#else
  constexpr const char* architecture = "other";
#endif
  std::printf("{\"architecture\":\"%s\",\"compiler\":\"%s\","
      "\"cplusplus\":%ld,\"sampleRate\":48000,"
      "\"warmupSamplesPerEar\":%u,\"measuredSamplesPerEar\":%u,"
      "\"controlIntervalSamples\":%u,\"transitionSamples\":%u,"
      "\"peakRssBytes\":%llu,\"callbackAllocations\":0,"
      "\"allocationProbePositiveControls\":true,\"rows\":[",
      architecture, __VERSION__, static_cast<long>(__cplusplus), warmupSamples,
      measuredSamples, controlInterval, transitionSamples,
      static_cast<unsigned long long>(peakRssBytes));
  for (std::size_t i = 0; i < rows.size(); ++i) {
    if (i) std::putchar(',');
    std::fputs(rows[i].c_str(), stdout);
  }
  std::puts("]}");
  return true;
}
}  // namespace

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
  try { return allocation_probe::allocateAligned(size,
      static_cast<std::size_t>(alignment), allocation_probe::Kind::nothrowAligned); }
  catch (...) { return nullptr; }
}
void* operator new[](std::size_t size, std::align_val_t alignment,
                     const std::nothrow_t&) noexcept {
  try { return allocation_probe::allocateAligned(size,
      static_cast<std::size_t>(alignment),
      allocation_probe::Kind::nothrowAlignedArray); }
  catch (...) { return nullptr; }
}
void operator delete(void* p) noexcept { std::free(p); }
void operator delete[](void* p) noexcept { std::free(p); }
void operator delete(void* p, std::size_t) noexcept { std::free(p); }
void operator delete[](void* p, std::size_t) noexcept { std::free(p); }
void operator delete(void* p, const std::nothrow_t&) noexcept { std::free(p); }
void operator delete[](void* p, const std::nothrow_t&) noexcept { std::free(p); }
void operator delete(void* p, std::align_val_t) noexcept { std::free(p); }
void operator delete[](void* p, std::align_val_t) noexcept { std::free(p); }
void operator delete(void* p, std::size_t, std::align_val_t) noexcept { std::free(p); }
void operator delete[](void* p, std::size_t, std::align_val_t) noexcept { std::free(p); }
void operator delete(void* p, std::align_val_t, const std::nothrow_t&) noexcept {
  std::free(p);
}
void operator delete[](void* p, std::align_val_t, const std::nothrow_t&) noexcept {
  std::free(p);
}

int main(int argc, char** argv) {
  if (argc != 2 && argc != 4) {
    std::fprintf(stderr,
        "usage: auto-bench FIXTURE.bin [--paced-seconds=N --paced-block=FRAMES]\n");
    return 1;
  }
  std::size_t pacedSeconds = 0;
  std::size_t pacedBlockFrames = 128;
  if (argc == 4) {
    const std::string secondsArgument(argv[2]);
    const std::string blockArgument(argv[3]);
    constexpr const char* secondsPrefix = "--paced-seconds=";
    constexpr const char* blockPrefix = "--paced-block=";
    if (secondsArgument.rfind(secondsPrefix, 0) != 0 ||
        blockArgument.rfind(blockPrefix, 0) != 0) return 1;
    try {
      pacedSeconds = static_cast<std::size_t>(
          std::stoull(secondsArgument.substr(std::strlen(secondsPrefix))));
      pacedBlockFrames = static_cast<std::size_t>(
          std::stoull(blockArgument.substr(std::strlen(blockPrefix))));
    } catch (...) {
      return 1;
    }
    if (pacedSeconds == 0 || pacedSeconds > 60 * 60 ||
        pacedBlockFrames == 0 || pacedBlockFrames > kMaximumCallbackFrames ||
        kMeasuredSamples % pacedBlockFrames != 0) return 1;
  }
  std::ifstream fixture(argv[1], std::ios::binary);
  if (!fixture || !run(fixture, pacedSeconds, pacedBlockFrames)) {
    std::fprintf(stderr, "full Auto-FIR benchmark failed\n");
    return 1;
  }
  return 0;
}
