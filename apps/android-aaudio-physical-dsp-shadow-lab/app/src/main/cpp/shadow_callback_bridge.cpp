#include "callback_core.hpp"

#include <aaudio/AAudio.h>
#include <jni.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <ctime>
#include <limits>
#include <memory>
#include <mutex>
#include <new>
#include <sstream>
#include <string>
#include <thread>
#include <utility>
#include <vector>

bool runPortableFixture(std::istream& fixture, std::ostream& result);
int runNativeSessionCheck(std::ostream& result);

namespace {
using namespace hearlens::research;
using namespace hearlens::research::aaudio_lab;
using Clock = CallbackCore::Clock;

constexpr std::uint32_t kFixtureMagic = 0x334e4c48U;
constexpr std::int32_t kFixtureSampleRate = 48'000;
constexpr std::size_t kMaximumRecords = 65'536;
constexpr int kFaultNone = 0;
constexpr int kFaultBackground = 1;
constexpr int kFaultDisconnect = 2;
constexpr int kSharingShared = 0;
constexpr int kSharingExclusive = 1;
constexpr int kUsageMedia = 0;
constexpr int kUsageGame = 1;
constexpr int kBufferDefault = 0;
constexpr int kBufferTwoBursts = 1;

struct RequestedConfig {
  bool runNativeSession = true;
  std::int32_t sampleRate = kFixtureSampleRate;
  int sharingMode = kSharingShared;
  int usage = kUsageMedia;
  int bufferPolicy = kBufferDefault;
};

struct FixtureData {
  BandBasis basis{};
  std::array<BandTargets, 2> targets{};
  std::vector<float> pcm;
};

class FixtureReader {
 public:
  FixtureReader(const std::uint8_t* bytes, std::size_t size) noexcept
      : bytes_(bytes), size_(size) {}

  bool readU32(std::uint32_t& value) noexcept {
    if (remaining() < 4) return false;
    value = static_cast<std::uint32_t>(bytes_[offset_]) |
        (static_cast<std::uint32_t>(bytes_[offset_ + 1]) << 8U) |
        (static_cast<std::uint32_t>(bytes_[offset_ + 2]) << 16U) |
        (static_cast<std::uint32_t>(bytes_[offset_ + 3]) << 24U);
    offset_ += 4;
    return true;
  }

  bool readU64(std::uint64_t& value) noexcept {
    if (remaining() < 8) return false;
    value = 0;
    for (std::size_t index = 0; index < 8; ++index) {
      value |= static_cast<std::uint64_t>(bytes_[offset_ + index]) <<
          (8U * index);
    }
    offset_ += 8;
    return true;
  }

  bool readF64(double& value) noexcept {
    std::uint64_t bits = 0;
    if (!readU64(bits)) return false;
    std::memcpy(&value, &bits, sizeof(value));
    return std::isfinite(value);
  }

  bool readF32(float& value) noexcept {
    std::uint32_t bits = 0;
    if (!readU32(bits)) return false;
    std::memcpy(&value, &bits, sizeof(value));
    return std::isfinite(value) && value >= -16.0F && value <= 16.0F;
  }

  std::size_t remaining() const noexcept { return size_ - offset_; }

 private:
  const std::uint8_t* bytes_ = nullptr;
  std::size_t size_ = 0;
  std::size_t offset_ = 0;
};

bool parseFixture(const std::uint8_t* bytes, std::size_t size,
                  FixtureData& fixture) {
  if (bytes == nullptr || size == 0 ||
      !std::numeric_limits<float>::is_iec559 ||
      !std::numeric_limits<double>::is_iec559) return false;
  FixtureReader reader(bytes, size);
  std::uint32_t magic = 0, sampleCount = 0, callbackFrames = 0;
  std::uint32_t controlInterval = 0, logCapacity = 0, transitionSamples = 0;
  double attackMs = 0.0, releaseMs = 0.0, maxGainDb = 0.0, limiter = 0.0;
  if (!reader.readU32(magic) || !reader.readU32(sampleCount) ||
      !reader.readU32(callbackFrames) || !reader.readU32(controlInterval) ||
      !reader.readU32(logCapacity) || !reader.readF64(attackMs) ||
      !reader.readF64(releaseMs) || !reader.readF64(maxGainDb) ||
      !reader.readF64(limiter) || !reader.readU32(transitionSamples) ||
      magic != kFixtureMagic || sampleCount == 0 || sampleCount > 1'000'000 ||
      callbackFrames == 0 || callbackFrames > kMaximumCallbackFrames ||
      controlInterval != 480 || logCapacity > 10'000 || attackMs != 15.0 ||
      releaseMs != 400.0 || maxGainDb != 12.0 || limiter != 0.3 ||
      transitionSamples != 2400) return false;

  for (auto& band : fixture.basis) {
    for (double& coefficient : band) {
      if (!reader.readF64(coefficient)) return false;
    }
  }
  for (auto& ear : fixture.targets) {
    for (auto& band : ear) {
      for (double& gain : band) {
        if (!reader.readF64(gain)) return false;
      }
    }
  }
  fixture.pcm.resize(static_cast<std::size_t>(sampleCount) * 2);
  for (float& sample : fixture.pcm) {
    if (!reader.readF32(sample)) return false;
  }
  return reader.remaining() == 0;
}

struct CallbackRecord {
  std::uint64_t startNs = 0;
  std::uint64_t wallNs = 0;
  std::uint64_t cpuNs = 0;
  std::uint64_t dspWallNs = 0;
  std::uint64_t interArrivalNs = 0;
  std::uint64_t expectedInterArrivalNs = 0;
  std::uint64_t jitterNs = 0;
  std::uint64_t callbackBudgetNs = 0;
  std::uint64_t dspBudgetNs = 0;
  std::uint64_t controlUpdatesBefore = 0;
  std::uint64_t controlUpdatesAfter = 0;
  std::uint64_t zeroSamplesVerified = 0;
  std::uint32_t frames = 0;
  std::uint32_t deadlineBudgetFrames = 0;
  bool callbackOverrun = false;
  bool dspDeadlineFailure = false;
};

struct XrunObservation {
  std::uint64_t elapsedNs = 0;
  std::int32_t cumulativeCount = -1;
  bool sampledAfterStop = false;
};

struct PublishedRouteSnapshot {
  std::uint64_t runToken = 0;
  std::uint64_t generation = 0;
  std::int32_t speakerId = -1;
  std::int32_t invalidationReasonCode = 0;
  bool allowed = false;
};

constexpr std::int32_t kBridgeStopReasonRoutePolicy = 2;
constexpr std::int32_t kBridgeStopReasonLifecycle = 3;
std::mutex gRoutePolicyMutex;
PublishedRouteSnapshot gPublishedRouteSnapshot;
std::atomic<std::uint64_t> gStopRequestedToken{0};
std::atomic<std::int32_t> gStopRequestedReasonCode{0};
std::atomic_flag gPhysicalRunActive = ATOMIC_FLAG_INIT;

class PhysicalRunLease {
 public:
  PhysicalRunLease() noexcept
      : acquired_(!gPhysicalRunActive.test_and_set(std::memory_order_acquire)) {}
  ~PhysicalRunLease() {
    if (acquired_) gPhysicalRunActive.clear(std::memory_order_release);
  }
  bool acquired() const noexcept { return acquired_; }

 private:
  bool acquired_;
};

bool routePolicyMatches(std::uint64_t token, std::uint64_t generation,
                        std::int32_t speakerId) noexcept {
  std::lock_guard<std::mutex> lock(gRoutePolicyMutex);
  return gPublishedRouteSnapshot.allowed &&
      gPublishedRouteSnapshot.runToken == token &&
      gPublishedRouteSnapshot.generation == generation &&
      gPublishedRouteSnapshot.speakerId == speakerId;
}

const char* bridgeStopReasonName(std::int32_t reasonCode) noexcept {
  switch (reasonCode) {
    case kBridgeStopReasonRoutePolicy: return "ROUTE_POLICY_INVALIDATED";
    case kBridgeStopReasonLifecycle: return "LIFECYCLE_INVALIDATED";
    case 1: return "USER_STOP";
    default: return "NONE";
  }
}

std::uint64_t threadCpuNow(bool& available) noexcept {
  timespec value{};
  if (clock_gettime(CLOCK_THREAD_CPUTIME_ID, &value) != 0) {
    available = false;
    return 0;
  }
  available = true;
  return static_cast<std::uint64_t>(value.tv_sec) * 1'000'000'000ULL +
      static_cast<std::uint64_t>(value.tv_nsec);
}

std::uint64_t timePointNs(Clock::time_point value) noexcept {
  return static_cast<std::uint64_t>(
      std::chrono::duration_cast<std::chrono::nanoseconds>(
          value.time_since_epoch()).count());
}

struct RunContext {
  RunContext(const FixtureData& fixture, bool verifyOutput,
             const RequestedConfig& requested, int durationMs)
      : core(fixture.basis, fixture.targets, fixture.pcm),
        records(new CallbackRecord[kMaximumRecords]{}),
        xrunObservations(static_cast<std::size_t>(durationMs / 5) + 8),
        verifyZeroOutput(verifyOutput), requestedConfig(requested),
        runNativeSession(requested.runNativeSession) {}

  CallbackCore core;
  std::unique_ptr<CallbackRecord[]> records;
  std::vector<XrunObservation> xrunObservations;
  std::size_t xrunObservationCount = 0;
  std::atomic<std::uint32_t> callbacksInFlight{0};
  std::atomic<std::uint32_t> recordCount{0};
  std::array<std::uint64_t, kMaximumCallbackFrames + 1> frameCounts{};
  std::uint64_t frameCountOverflow = 0;
  std::uint64_t zeroSamplesVerified = 0;
  std::uint64_t nonZeroSamplesObserved = 0;
  std::uint64_t deadlineMisses = 0;
  std::uint64_t callbackOverruns = 0;
  std::uint64_t cpuSamples = 0;
  std::uint64_t cpuUnavailableSamples = 0;
  std::atomic<std::uint64_t> logOverflow{0};
  std::atomic<bool> callbackOverrunObserved{false};
  std::atomic<bool> nonzeroOutputObserved{false};
  std::atomic<bool> xrunObserved{false};
  std::uint64_t previousStartNs = 0;
  std::uint32_t previousFrames = 0;
  std::int32_t sampleRate = 0;
  std::int32_t framesPerBurst = 0;
  std::int32_t xrunStartCount = -1;
  std::int32_t expectedDeviceId = -1;
  std::uint64_t runToken = 0;
  std::uint64_t routeGeneration = 0;
  std::int32_t actualDeviceId = -1;
  std::int32_t actualDeviceIdBeforeStart = -1;
  std::int32_t lastObservedDeviceId = -1;
  std::uint64_t routePolicyChecks = 0;
  std::uint64_t actualDeviceIdChecks = 0;
  std::uint64_t routeMismatchNs = 0;
  bool routeValidBeforeOpen = false;
  bool routeValidBeforeStart = false;
  bool streamStarted = false;
  std::int32_t requestedBufferFrames = 0;
  aaudio_result_t setBufferSizeResult = AAUDIO_OK;
  std::atomic<std::int32_t> errorCallbackCode{AAUDIO_OK};
  std::atomic<bool> routeMismatchObserved{false};
  std::atomic<bool> routePolicyInvalidated{false};
  std::atomic<bool> lifecycleInvalidated{false};
  std::atomic<bool> streamDisconnectObserved{false};
  const bool verifyZeroOutput;
  const RequestedConfig requestedConfig;
  bool runNativeSession;
};
static_assert(std::atomic<std::uint32_t>::is_always_lock_free);

struct CallbackInFlight {
  explicit CallbackInFlight(std::atomic<std::uint32_t>& count) noexcept
      : count_(count) {
    count_.fetch_add(1, std::memory_order_acq_rel);
  }
  ~CallbackInFlight() { count_.fetch_sub(1, std::memory_order_acq_rel); }

  std::atomic<std::uint32_t>& count_;
};

aaudio_data_callback_result_t dataCallback(
    AAudioStream*, void* userData, void* audioData, std::int32_t numFrames) {
  auto* context = static_cast<RunContext*>(userData);
  if (context == nullptr) return AAUDIO_CALLBACK_RESULT_STOP;
  const CallbackInFlight inFlight(context->callbacksInFlight);
  const auto callbackStart = Clock::now();
  bool cpuStartAvailable = false;
  const auto cpuStart = threadCpuNow(cpuStartAvailable);
  const auto controlUpdatesBefore = context->core.nativeControlUpdates();
  const auto dspDeadlineFailuresBefore =
      context->core.dspDeadlineFailureCount();
  const auto disposition = context->core.processOutput(
      static_cast<float*>(audioData), numFrames, context->sampleRate,
      callbackStart, &Clock::now,
      std::max(numFrames, context->framesPerBurst),
      context->runNativeSession);
  // An overlapping invocation must not touch callback-owned histograms,
  // timestamps, or percentile records. The core has already zeroed this
  // output buffer and invalidated the active generation.
  if (disposition == CallbackDisposition::kOverlap) {
    return AAUDIO_CALLBACK_RESULT_STOP;
  }

  std::uint64_t callbackZeroSamplesVerified = 0;
  if (context->verifyZeroOutput && audioData != nullptr && numFrames > 0) {
    const auto samples = static_cast<std::size_t>(numFrames) * 2;
    const auto* output = static_cast<const float*>(audioData);
    for (std::size_t index = 0; index < samples; ++index) {
      if (output[index] == 0.0F) {
        ++context->zeroSamplesVerified;
        ++callbackZeroSamplesVerified;
      } else {
        ++context->nonZeroSamplesObserved;
      }
    }
  }
  if (context->nonZeroSamplesObserved > 0) {
    context->nonzeroOutputObserved.store(true, std::memory_order_release);
    context->core.invalidateBackground();
  }

  if (numFrames > 0 && static_cast<std::size_t>(numFrames) <
          context->frameCounts.size()) {
    ++context->frameCounts[static_cast<std::size_t>(numFrames)];
  } else if (numFrames > 0) {
    ++context->frameCountOverflow;
  }

  const auto index = context->recordCount.fetch_add(1, std::memory_order_relaxed);
  if (index < kMaximumRecords) {
    auto& record = context->records[index];
    const auto startNs = timePointNs(callbackStart);
    record.startNs = startNs;
    record.dspWallNs = context->core.lastDspProcessingNs();
    record.frames = numFrames > 0 ? static_cast<std::uint32_t>(numFrames) : 0;
    record.deadlineBudgetFrames = numFrames > 0
        ? static_cast<std::uint32_t>(std::max(numFrames, context->framesPerBurst))
        : 0;
    record.controlUpdatesBefore = controlUpdatesBefore;
    record.controlUpdatesAfter = context->core.nativeControlUpdates();
    record.zeroSamplesVerified = callbackZeroSamplesVerified;
    if (context->previousStartNs != 0 && context->sampleRate > 0 &&
        context->previousFrames > 0) {
      record.interArrivalNs = startNs >= context->previousStartNs
          ? startNs - context->previousStartNs : 0;
      record.expectedInterArrivalNs = static_cast<std::uint64_t>(
          static_cast<double>(context->previousFrames) * 1'000'000'000.0 /
          static_cast<double>(context->sampleRate));
      record.jitterNs = record.interArrivalNs >= record.expectedInterArrivalNs
          ? record.interArrivalNs - record.expectedInterArrivalNs
          : record.expectedInterArrivalNs - record.interArrivalNs;
    }
    context->previousStartNs = startNs;
    context->previousFrames = record.frames;

    if (numFrames > 0 && context->sampleRate > 0) {
      const auto budgetNs = static_cast<std::uint64_t>(
          static_cast<double>(record.deadlineBudgetFrames) * 1'000'000'000.0 /
          static_cast<double>(context->sampleRate));
      const auto callbackBudgetNs = static_cast<std::uint64_t>(
          static_cast<double>(record.frames) * 1'000'000'000.0 /
          static_cast<double>(context->sampleRate));
      record.dspBudgetNs = budgetNs;
      record.callbackBudgetNs = callbackBudgetNs;
      record.dspDeadlineFailure =
          context->core.dspDeadlineFailureCount() > dspDeadlineFailuresBefore;
    }

    // Stop the measurement only after frame histogram, record, jitter, and
    // deadline-budget bookkeeping have completed. Final overrun classification
    // and the callback-return tail necessarily follow the end-clock reads.
    bool cpuEndAvailable = false;
    const auto cpuEnd = threadCpuNow(cpuEndAvailable);
    const auto callbackEnd = Clock::now();
    const auto endNs = timePointNs(callbackEnd);
    record.wallNs = endNs >= startNs ? endNs - startNs : 0;
    if (cpuStartAvailable && cpuEndAvailable && cpuEnd >= cpuStart) {
      record.cpuNs = cpuEnd - cpuStart;
      ++context->cpuSamples;
    } else {
      ++context->cpuUnavailableSamples;
    }
    record.callbackOverrun = record.callbackBudgetNs > 0 &&
        record.wallNs > record.callbackBudgetNs;
    if (record.dspDeadlineFailure) ++context->deadlineMisses;
    if (record.callbackOverrun) {
      ++context->callbackOverruns;
      context->callbackOverrunObserved.store(true, std::memory_order_release);
      context->core.invalidateBackground();
    }
  } else {
    context->logOverflow.fetch_add(1, std::memory_order_relaxed);
    return AAUDIO_CALLBACK_RESULT_STOP;
  }
  return disposition == CallbackDisposition::kContinue &&
          !context->callbackOverrunObserved.load(std::memory_order_acquire) &&
          !context->nonzeroOutputObserved.load(std::memory_order_acquire)
      ? AAUDIO_CALLBACK_RESULT_CONTINUE : AAUDIO_CALLBACK_RESULT_STOP;
}

void errorCallback(AAudioStream*, void* userData, aaudio_result_t error) {
  auto* context = static_cast<RunContext*>(userData);
  if (context == nullptr) return;
  const CallbackInFlight inFlight(context->callbacksInFlight);
  context->errorCallbackCode.store(error, std::memory_order_release);
  if (error == AAUDIO_ERROR_DISCONNECTED) {
    context->streamDisconnectObserved.store(true, std::memory_order_release);
  }
  context->core.invalidateStreamDisconnect();
}

const char* performanceModeName(aaudio_performance_mode_t mode) noexcept {
  switch (mode) {
    case AAUDIO_PERFORMANCE_MODE_NONE: return "NONE";
    case AAUDIO_PERFORMANCE_MODE_POWER_SAVING: return "POWER_SAVING";
    case AAUDIO_PERFORMANCE_MODE_LOW_LATENCY: return "LOW_LATENCY";
    default: return "UNKNOWN";
  }
}

const char* sharingModeName(aaudio_sharing_mode_t mode) noexcept {
  switch (mode) {
    case AAUDIO_SHARING_MODE_EXCLUSIVE: return "EXCLUSIVE";
    case AAUDIO_SHARING_MODE_SHARED: return "SHARED";
    default: return "UNKNOWN";
  }
}

struct Quantiles {
  std::uint64_t p50 = 0;
  std::uint64_t p95 = 0;
  std::uint64_t p99 = 0;
  std::uint64_t maximum = 0;
};

struct StreamSnapshot {
  std::int32_t sampleRate = 0;
  std::int32_t framesPerBurst = 0;
  std::int32_t bufferSize = 0;
  std::int32_t bufferCapacity = 0;
  aaudio_performance_mode_t performance = AAUDIO_PERFORMANCE_MODE_NONE;
  aaudio_sharing_mode_t sharing = AAUDIO_SHARING_MODE_SHARED;
  aaudio_usage_t usage = AAUDIO_USAGE_MEDIA;
  std::int32_t deviceId = -1;
  std::int32_t xrunCount = -1;
};

StreamSnapshot snapshotStream(AAudioStream* stream) noexcept {
  if (stream == nullptr) return {};
  return {
      AAudioStream_getSampleRate(stream),
      AAudioStream_getFramesPerBurst(stream),
      AAudioStream_getBufferSizeInFrames(stream),
      AAudioStream_getBufferCapacityInFrames(stream),
      AAudioStream_getPerformanceMode(stream),
      AAudioStream_getSharingMode(stream),
      AAudioStream_getUsage(stream),
      AAudioStream_getDeviceId(stream),
      AAudioStream_getXRunCount(stream),
  };
}

const char* usageName(aaudio_usage_t usage) noexcept {
  switch (usage) {
    case AAUDIO_USAGE_MEDIA: return "MEDIA";
    case AAUDIO_USAGE_GAME: return "GAME";
    default: return "OTHER";
  }
}

const char* requestedUsageName(int usage) noexcept {
  return usage == kUsageGame ? "GAME" : "MEDIA";
}

const char* requestedSharingName(int mode) noexcept {
  return mode == kSharingExclusive ? "EXCLUSIVE" : "SHARED";
}

const char* bufferPolicyName(int policy) noexcept {
  return policy == kBufferTwoBursts ? "TWO_BURSTS" : "DEFAULT";
}

const char* workloadName(bool runNativeSession) noexcept {
  return runNativeSession ? "NATIVE_SESSION" : "ZERO_ONLY";
}

Quantiles quantiles(RunContext& context, std::uint32_t count,
                    std::uint64_t CallbackRecord::*field) {
  std::vector<std::uint64_t> values;
  values.reserve(count);
  for (std::uint32_t index = 0; index < count; ++index) {
    if (field != &CallbackRecord::cpuNs || context.records[index].cpuNs != 0) {
      values.push_back(context.records[index].*field);
    }
  }
  if (values.empty()) return {};
  std::sort(values.begin(), values.end());
  const auto percentile = [&values](double p) {
    const auto index = static_cast<std::size_t>(
        std::ceil(p * static_cast<double>(values.size()))) - 1;
    return values[std::min(index, values.size() - 1)];
  };
  return {percentile(0.50), percentile(0.95), percentile(0.99), values.back()};
}

void appendQuantiles(std::ostringstream& json, const char* name,
                     const Quantiles& values) {
  json << '"' << name << "\":{";
  json << "\"p50_ns\":" << values.p50 << ",\"p95_ns\":" << values.p95
       << ",\"p99_ns\":" << values.p99 << ",\"max_ns\":"
       << values.maximum << "},";
}

std::string buildReport(const char* status, const char* reason,
                        RunContext& context, const StreamSnapshot& stream,
                        int durationMs, int faultMode, int faultAfterMs,
                        aaudio_result_t openResult, aaudio_result_t startResult,
                        aaudio_result_t stopResult, std::uint64_t runWallNs,
                        std::int32_t errorCode, bool streamStopConfirmed,
                        aaudio_result_t closeResult) {
  const auto count = std::min<std::uint32_t>(
      context.recordCount.load(std::memory_order_acquire),
      static_cast<std::uint32_t>(kMaximumRecords));
  const auto wall = quantiles(context, count, &CallbackRecord::wallNs);
  const auto cpu = quantiles(context, count, &CallbackRecord::cpuNs);
  const auto jitter = quantiles(context, count, &CallbackRecord::jitterNs);
  std::uint64_t totalCpuNs = 0;
  std::uint32_t minimumBudgetFrames = std::numeric_limits<std::uint32_t>::max();
  std::uint32_t maximumBudgetFrames = 0;
  for (std::uint32_t index = 0; index < count; ++index) {
    totalCpuNs += context.records[index].cpuNs;
    minimumBudgetFrames = std::min(minimumBudgetFrames,
                                   context.records[index].deadlineBudgetFrames);
    maximumBudgetFrames = std::max(maximumBudgetFrames,
                                   context.records[index].deadlineBudgetFrames);
  }
  if (count == 0) minimumBudgetFrames = 0;
  const double cpuPercent = runWallNs == 0 ? 0.0 :
      100.0 * static_cast<double>(totalCpuNs) / static_cast<double>(runWallNs);
  const auto requestedRunNs = static_cast<std::uint64_t>(durationMs) *
      1'000'000ULL;
  const bool durationComplete = count > 0 && runWallNs >=
      (requestedRunNs * 99ULL) / 100ULL;
  const char* runCompletion =
      std::strcmp(status, "PASS") == 0 ? "COMPLETE" : status;
  const bool sampleRateMatches = stream.sampleRate == kFixtureSampleRate;
  const auto sessionCalls = context.core.nativeSessionInvocations();
  const char* dspStatus = !context.requestedConfig.runNativeSession
      ? "NOT_REQUESTED_ZERO_ONLY"
      : !sampleRateMatches ? "SKIPPED_SAMPLE_RATE_MISMATCH"
      : sessionCalls == 0 ? "NOT_RUN" :
          context.core.failStopCount() > 0 ? "FAIL_STOP" : "EXECUTED";
  const auto xrunDelta = context.xrunStartCount >= 0 && stream.xrunCount >=
          context.xrunStartCount
      ? stream.xrunCount - context.xrunStartCount : -1;
  const bool bufferPolicyAchieved =
      context.requestedConfig.bufferPolicy == kBufferDefault ||
      (context.requestedBufferFrames > 0 &&
       stream.bufferSize == context.requestedBufferFrames);

  std::ostringstream json;
  json << "{\"status\":\"" << status << "\",\"reason\":\"" << reason
       << "\",\"requested_duration_ms\":" << durationMs
       << ",\"duration_complete\":" <<
          (durationComplete ? "true" : "false")
       << ",\"run_completion\":\"" << runCompletion << "\""
       << ",\"requested_equivalent_frames\":128"
       << ",\"requested_equivalent_duration_ms\":300000"
       << ",\"workload\":\"" << workloadName(context.requestedConfig.runNativeSession)
       << "\",\"dsp_execution_status\":\"" << dspStatus << "\""
       << ",\"dsp_measurement_eligible\":"
       << (context.requestedConfig.runNativeSession && sampleRateMatches
               ? "true" : "false")
       << ",\"dsp_benchmark_valid\":"
       << (std::strcmp(status, "PASS") == 0 &&
                   context.requestedConfig.runNativeSession && sampleRateMatches &&
                   sessionCalls > 0 ? "true" : "false")
       << ",\"run_wall_ns\":" << runWallNs
       << ",\"aaudio_open_result\":" << openResult
       << ",\"aaudio_start_result\":" << startResult
       << ",\"aaudio_stop_result\":" << stopResult
       << ",\"aaudio_close_result\":" << closeResult
       << ",\"stream_stop_confirmed\":" <<
          (streamStopConfirmed ? "true" : "false")
       << ",\"callbacks_in_flight_after_close\":" <<
          context.callbacksInFlight.load(std::memory_order_acquire)
       << ",\"actual_callback_observed\":" << (count > 0 ? "true" : "false")
       << ",\"callback_records\":" << count
       << ",\"callback_workload_iterations\":" << context.core.callbackCount()
       << ",\"successful_dsp_callbacks\":"
       << (context.runNativeSession ? context.core.callbackCount() : 0)
       << ",\"zero_only_callbacks\":"
       << (context.runNativeSession ? 0 : context.core.callbackCount())
       << ",\"native_session_invocations\":" << sessionCalls
       << ",\"native_control_updates\":" << context.core.nativeControlUpdates()
       << ",\"native_session_fail_stop_count\":"
       << context.core.nativeSessionFailStopCount()
       << ",\"callback_core_fail_stop_count\":" << context.core.failStopCount()
       << ",\"callback_overlap_count\":" << context.core.overlapCount()
       << ",\"dsp_deadline_failure_count\":" << context.deadlineMisses
       << ",\"deadline_misses\":" << context.deadlineMisses
       << ",\"callback_overrun_count\":" << context.callbackOverruns
       << ",\"dsp_deadline_budget_basis\":\"max(callback numFrames, negotiated framesPerBurst) / negotiated sample rate\""
       << ",\"callback_overrun_budget_basis\":\"callback numFrames / negotiated sample rate\""
       << ",\"deadline_budget_min_frames\":" << minimumBudgetFrames
       << ",\"deadline_budget_max_frames\":" << maximumBudgetFrames
       << ",\"callback_log_overflow\":" <<
          context.logOverflow.load(std::memory_order_relaxed)
       << ",\"callback_cpu_samples\":" << context.cpuSamples
       << ",\"callback_cpu_unavailable_samples\":" <<
          context.cpuUnavailableSamples
       << ",\"callback_thread_cpu_percent\":" << cpuPercent
       << ",\"actual_sample_rate\":" << stream.sampleRate
       << ",\"requested_sample_rate\":" << context.requestedConfig.sampleRate
       << ",\"requested_sample_rate_policy\":\""
       << (context.requestedConfig.sampleRate == AAUDIO_UNSPECIFIED
               ? "SYSTEM_NATIVE_UNSPECIFIED" : "EXPLICIT") << "\""
       << ",\"dsp_fixture_sample_rate\":" << kFixtureSampleRate
       << ",\"sample_rate_matches_fixture\":"
       << (sampleRateMatches ? "true" : "false")
       << ",\"frames_per_burst\":" << stream.framesPerBurst
       << ",\"buffer_size_frames\":" << stream.bufferSize
       << ",\"buffer_capacity_frames\":" << stream.bufferCapacity
       << ",\"requested_buffer_policy\":\""
       << bufferPolicyName(context.requestedConfig.bufferPolicy) << "\""
       << ",\"requested_buffer_size_frames\":" << context.requestedBufferFrames
       << ",\"buffer_size_set_result_frames\":" << context.setBufferSizeResult
       << ",\"requested_buffer_policy_achieved\":"
       << (bufferPolicyAchieved ? "true" : "false")
       << ",\"requested_performance_mode\":\"LOW_LATENCY\""
       << ",\"actual_performance_mode\":\""
       << performanceModeName(stream.performance) << "\""
       << ",\"requested_performance_mode_achieved\":"
       << (stream.performance == AAUDIO_PERFORMANCE_MODE_LOW_LATENCY
               ? "true" : "false")
       << ",\"requested_sharing_mode\":\""
       << requestedSharingName(context.requestedConfig.sharingMode) << "\""
       << ",\"actual_sharing_mode\":\"" << sharingModeName(stream.sharing)
       << "\",\"requested_sharing_mode_achieved\":"
       << ((context.requestedConfig.sharingMode == kSharingExclusive &&
            stream.sharing == AAUDIO_SHARING_MODE_EXCLUSIVE) ||
           (context.requestedConfig.sharingMode == kSharingShared &&
            stream.sharing == AAUDIO_SHARING_MODE_SHARED) ? "true" : "false")
       << ",\"requested_usage\":\""
       << requestedUsageName(context.requestedConfig.usage) << "\""
       << ",\"actual_usage\":\"" << usageName(stream.usage)
       << "\",\"requested_usage_achieved\":"
       << ((context.requestedConfig.usage == kUsageGame &&
            stream.usage == AAUDIO_USAGE_GAME) ||
           (context.requestedConfig.usage == kUsageMedia &&
            stream.usage == AAUDIO_USAGE_MEDIA) ? "true" : "false")
       << ",\"format\":\"FLOAT\",\"channels\":2"
       << ",\"callback_frames_request\":\"UNSPECIFIED_VARIABLE\""
       << ",\"xrun_count\":" << stream.xrunCount
       << ",\"xrun_start_count\":" << context.xrunStartCount
       << ",\"xrun_delta\":" << xrunDelta
       << ",\"requested_output_device_id\":" << context.expectedDeviceId
       << ",\"run_token\":" << context.runToken
       << ",\"route_generation\":" << context.routeGeneration
       << ",\"actual_output_device_id\":" << stream.deviceId
       << ",\"actual_output_device_id_before_start\":"
       << context.actualDeviceIdBeforeStart
       << ",\"last_observed_output_device_id\":" << context.lastObservedDeviceId
       << ",\"route_policy_valid_before_open\":"
       << (context.routeValidBeforeOpen ? "true" : "false")
       << ",\"route_policy_valid_before_start\":"
       << (context.routeValidBeforeStart ? "true" : "false")
       << ",\"route_policy_control_checks\":" << context.routePolicyChecks
       << ",\"actual_device_id_control_checks\":" << context.actualDeviceIdChecks
       << ",\"route_mismatch_observed\":"
       << (context.routeMismatchObserved.load(std::memory_order_acquire)
               ? "true" : "false")
       << ",\"route_policy_invalidated\":"
       << (context.routePolicyInvalidated.load(std::memory_order_acquire)
               ? "true" : "false")
       << ",\"lifecycle_invalidated\":"
       << (context.lifecycleInvalidated.load(std::memory_order_acquire)
               ? "true" : "false")
       << ",\"native_stop_request_reason\":\""
       << bridgeStopReasonName(
              gStopRequestedToken.load(std::memory_order_acquire) == context.runToken
                  ? gStopRequestedReasonCode.load(std::memory_order_acquire) : 0)
       << "\""
       << ",\"route_mismatch_monotonic_ns\":" << context.routeMismatchNs
       << ",\"stream_disconnect_observed\":"
       << (context.streamDisconnectObserved.load(std::memory_order_acquire)
               ? "true" : "false")
       << ",\"xrun_source\":\"AAudioStream_getXRunCount on output stream\""
       << ",\"xrun_timestamp_resolution\":\"control-thread cumulative-count snapshots every 5 ms; AAudio exposes no per-event timestamps\""
       << ",\"allocation_monitor\":\"callback source path contains no allocation/I/O/JNI/mutex/sleep; AAudio and Bionic internal allocations are not instrumented\""
       << ",\"callback_timing_scope\":\"wall and thread CPU clocks are read after zero scan, frame histogram, record, jitter, and budget bookkeeping; final overrun classification and callback-return tail follow the end-clock reads\""
       << ",\"zero_output_verification_enabled\":"
       << (context.verifyZeroOutput ? "true" : "false")
       << ",\"zero_samples_verified\":" << context.zeroSamplesVerified
       << ",\"nonzero_output_samples_observed\":" <<
          context.nonZeroSamplesObserved
       << ",\"fault_mode\":" << faultMode
       << ",\"fault_after_ms\":" << faultAfterMs
       << ",\"error_callback_code\":" << errorCode << ',';
  appendQuantiles(json, "callback_wall", wall);
  appendQuantiles(json, "callback_thread_cpu", cpu);
  appendQuantiles(json, "callback_interarrival_jitter", jitter);
  std::uint64_t deadlineEventCount = 0;
  for (std::uint32_t index = 0; index < count; ++index) {
    const auto& record = context.records[index];
    if (record.callbackOverrun || record.dspDeadlineFailure) {
      ++deadlineEventCount;
    }
  }
  json << "\"deadline_event_count\":" << deadlineEventCount
       << ",\"deadline_events\":[";
  bool firstDeadlineEvent = true;
  std::uint64_t reportedDeadlineEvents = 0;
  for (std::uint32_t index = 0; index < count; ++index) {
    const auto& record = context.records[index];
    if (!record.callbackOverrun && !record.dspDeadlineFailure) continue;
    if (reportedDeadlineEvents >= 128 && !record.dspDeadlineFailure) continue;
    if (!firstDeadlineEvent) json << ',';
    firstDeadlineEvent = false;
    ++reportedDeadlineEvents;
    json << "{\"callback_index\":" << index
         << ",\"frame_count\":" << record.frames
         << ",\"control_updates_before\":" << record.controlUpdatesBefore
         << ",\"control_updates_after\":" << record.controlUpdatesAfter
         << ",\"dsp_deadline_budget_ns\":" << record.dspBudgetNs
         << ",\"callback_budget_ns\":" << record.callbackBudgetNs
         << ",\"callback_wall_ns\":" << record.wallNs
         << ",\"dsp_deadline_failure\":"
         << (record.dspDeadlineFailure ? "true" : "false")
         << ",\"callback_overrun\":"
         << (record.callbackOverrun ? "true" : "false") << '}';
  }
  json << "],\"deadline_events_truncated\":"
       << (reportedDeadlineEvents < deadlineEventCount ? "true" : "false")
       << ",\"xrun_observations\":[";
  for (std::size_t index = 0; index < context.xrunObservationCount; ++index) {
    if (index > 0) json << ',';
    const auto& observation = context.xrunObservations[index];
    json << "{\"elapsed_ns\":" << observation.elapsedNs
         << ",\"cumulative_count\":" << observation.cumulativeCount
         << ",\"sampled_after_stop\":"
         << (observation.sampledAfterStop ? "true" : "false") << '}';
  }
  json << "],\"frame_count_distribution\":{";
  bool first = true;
  for (std::size_t frames = 1; frames < context.frameCounts.size(); ++frames) {
    if (context.frameCounts[frames] == 0) continue;
    if (!first) json << ',';
    first = false;
    json << '"' << frames << "\":" << context.frameCounts[frames];
  }
  json << "},\"frame_count_overflow\":" << context.frameCountOverflow
       << ",\"callback_record_capacity\":" << kMaximumRecords
       << ",\"callback_records_detail\":[";
  for (std::uint32_t index = 0; index < count; ++index) {
    if (index > 0) json << ',';
    const auto& record = context.records[index];
    json << "{\"callback_index\":" << index
         << ",\"start_monotonic_ns\":" << record.startNs
         << ",\"frame_count\":" << record.frames
         << ",\"callback_wall_ns\":" << record.wallNs
         << ",\"callback_thread_cpu_ns\":" << record.cpuNs
         << ",\"dsp_processing_wall_ns\":" << record.dspWallNs
         << ",\"control_updates_before\":" << record.controlUpdatesBefore
         << ",\"control_updates_after\":" << record.controlUpdatesAfter
         << ",\"dsp_deadline_budget_ns\":" << record.dspBudgetNs
         << ",\"dsp_deadline_failure\":"
         << (record.dspDeadlineFailure ? "true" : "false")
         << ",\"callback_budget_ns\":" << record.callbackBudgetNs
         << ",\"callback_overrun\":"
         << (record.callbackOverrun ? "true" : "false")
         << ",\"inter_arrival_ns\":" << record.interArrivalNs
         << ",\"expected_inter_arrival_ns\":" << record.expectedInterArrivalNs
         << ",\"inter_arrival_jitter_ns\":" << record.jitterNs
         << ",\"zero_samples_verified\":" << record.zeroSamplesVerified
         << '}';
  }
  std::uint32_t maximumGapIndex = 0;
  for (std::uint32_t index = 1; index < count; ++index) {
    if (context.records[index].interArrivalNs >
        context.records[maximumGapIndex].interArrivalNs) {
      maximumGapIndex = index;
    }
  }
  json << "],\"maximum_interarrival_event\":";
  if (count < 2) {
    json << "null";
  } else {
    const auto& maximumGap = context.records[maximumGapIndex];
    json << "{\"callback_index\":" << maximumGapIndex
         << ",\"inter_arrival_ns\":" << maximumGap.interArrivalNs
         << ",\"expected_inter_arrival_ns\":"
         << maximumGap.expectedInterArrivalNs
         << ",\"jitter_ns\":" << maximumGap.jitterNs
         << ",\"surrounding_records\":[";
    const auto first = maximumGapIndex > 2 ? maximumGapIndex - 2 : 0;
    const auto last = std::min<std::uint32_t>(count - 1, maximumGapIndex + 2);
    for (std::uint32_t index = first; index <= last; ++index) {
      if (index > first) json << ',';
      const auto& record = context.records[index];
      json << "{\"callback_index\":" << index
           << ",\"start_monotonic_ns\":" << record.startNs
           << ",\"frame_count\":" << record.frames
           << ",\"inter_arrival_ns\":" << record.interArrivalNs
           << ",\"callback_wall_ns\":" << record.wallNs
           << ",\"callback_thread_cpu_ns\":" << record.cpuNs
           << ",\"dsp_processing_wall_ns\":" << record.dspWallNs
           << ",\"control_updates_before\":" << record.controlUpdatesBefore
           << ",\"control_updates_after\":" << record.controlUpdatesAfter
           << '}';
    }
    json << "]}";
  }
  json << ",\"physical_audio_stream_started\":"
       << (context.streamStarted ? "true" : "false")
       << ",\"microphone_used\":false,\"bluetooth_api_used\":false"
       << ",\"dsp_to_audio_buffer_path\":false"
       << ",\"test_semantics\":\"synthetic Auto-FIR/NativeSession DSP shadow in private memory; AAudio output is zero-only\"}"
       ;
  return json.str();
}

std::string simpleReport(const char* reason, int durationMs,
                         aaudio_result_t openResult,
                         aaudio_result_t startResult = AAUDIO_ERROR_INVALID_STATE,
                         const RequestedConfig* requested = nullptr) {
  std::ostringstream json;
  json << "{\"status\":\"NOT_RUN\",\"reason\":\"" << reason
       << "\",\"requested_duration_ms\":" << durationMs
       << ",\"duration_complete\":false,\"run_completion\":\"NOT_RUN\""
       << ",\"aaudio_open_result\":" << openResult
       << ",\"aaudio_start_result\":" << startResult
       << ",\"actual_callback_observed\":false"
       << ",\"physical_audio_stream_started\":false"
       << ",\"microphone_used\":false,\"bluetooth_api_used\":false"
       << ",\"dsp_to_audio_buffer_path\":false";
  if (requested != nullptr) {
    json << ",\"workload\":\"" << workloadName(requested->runNativeSession)
         << "\",\"requested_sample_rate\":" << requested->sampleRate
         << ",\"requested_sample_rate_policy\":\""
         << (requested->sampleRate == AAUDIO_UNSPECIFIED
                 ? "SYSTEM_NATIVE_UNSPECIFIED" : "EXPLICIT") << "\""
         << ",\"requested_sharing_mode\":\""
         << requestedSharingName(requested->sharingMode) << "\""
         << ",\"requested_usage\":\"" << requestedUsageName(requested->usage)
         << "\",\"requested_buffer_policy\":\""
         << bufferPolicyName(requested->bufferPolicy) << "\""
         << ",\"dsp_benchmark_valid\":false";
  }
  json << '}';
  return json.str();
}

std::string runFixture(JNIEnv* env, jbyteArray fixtureBytes, int durationMs,
                       bool verifyZeroOutput, int faultMode, int faultAfterMs,
                       const RequestedConfig& requested,
                       std::int32_t expectedDeviceId, std::uint64_t runToken,
                       std::uint64_t routeGeneration) {
  PhysicalRunLease runLease;
  if (!runLease.acquired()) {
    return simpleReport("another physical DSP-shadow callback run is active",
                        durationMs, AAUDIO_ERROR_INVALID_STATE,
                        AAUDIO_ERROR_INVALID_STATE, &requested);
  }
  if (fixtureBytes == nullptr || durationMs < 100 || durationMs > 300'000 ||
      faultMode < kFaultNone || faultMode > kFaultDisconnect ||
      (faultMode != kFaultNone &&
       (faultAfterMs < 100 || faultAfterMs >= durationMs)) ||
      (requested.sampleRate != AAUDIO_UNSPECIFIED &&
       requested.sampleRate != kFixtureSampleRate) ||
      (requested.sharingMode != kSharingShared &&
       requested.sharingMode != kSharingExclusive) ||
      (requested.usage != kUsageMedia && requested.usage != kUsageGame) ||
      (requested.bufferPolicy != kBufferDefault &&
       requested.bufferPolicy != kBufferTwoBursts)) {
    return simpleReport("invalid benchmark arguments", durationMs,
                        AAUDIO_ERROR_ILLEGAL_ARGUMENT,
                        AAUDIO_ERROR_INVALID_STATE, &requested);
  }
  if (expectedDeviceId <= 0 || runToken == 0 || routeGeneration == 0 ||
      !routePolicyMatches(runToken, routeGeneration, expectedDeviceId)) {
    return simpleReport("exact built-in speaker route snapshot missing or stale before AAudio open",
                        durationMs, AAUDIO_ERROR_UNAVAILABLE,
                        AAUDIO_ERROR_INVALID_STATE, &requested);
  }
  const auto byteCount = env->GetArrayLength(fixtureBytes);
  if (byteCount <= 0) {
    return simpleReport("empty portable fixture", durationMs,
                        AAUDIO_ERROR_ILLEGAL_ARGUMENT,
                        AAUDIO_ERROR_INVALID_STATE, &requested);
  }
  std::vector<std::uint8_t> fixtureBuffer(static_cast<std::size_t>(byteCount));
  env->GetByteArrayRegion(fixtureBytes, 0, byteCount,
                          reinterpret_cast<jbyte*>(fixtureBuffer.data()));
  if (env->ExceptionCheck()) {
    env->ExceptionClear();
    return simpleReport("failed reading fixture bytes", durationMs,
                        AAUDIO_ERROR_INTERNAL, AAUDIO_ERROR_INVALID_STATE,
                        &requested);
  }
  FixtureData fixture;
  if (!parseFixture(fixtureBuffer.data(), fixtureBuffer.size(), fixture)) {
    return simpleReport("portable fixture rejected", durationMs,
                        AAUDIO_ERROR_INVALID_FORMAT,
                        AAUDIO_ERROR_INVALID_STATE, &requested);
  }

  RunContext context(fixture, verifyZeroOutput, requested, durationMs);
  context.expectedDeviceId = expectedDeviceId;
  context.runToken = runToken;
  context.routeGeneration = routeGeneration;
  ++context.routePolicyChecks;
  context.routeValidBeforeOpen = routePolicyMatches(
      runToken, routeGeneration, expectedDeviceId);
  if (!context.routeValidBeforeOpen ||
      gStopRequestedToken.load(std::memory_order_acquire) == runToken) {
    context.routePolicyInvalidated.store(!context.routeValidBeforeOpen,
                                          std::memory_order_release);
    context.core.stop();
    return simpleReport("route generation or stop token changed before AAudio open",
                        durationMs, AAUDIO_ERROR_UNAVAILABLE,
                        AAUDIO_ERROR_INVALID_STATE, &requested);
  }
  if (!context.core.start()) {
    return simpleReport("NativeSession authorization failed", durationMs,
                        AAUDIO_ERROR_INVALID_STATE,
                        AAUDIO_ERROR_INVALID_STATE, &requested);
  }
  AAudioStreamBuilder* builder = nullptr;
  const auto builderResult = AAudio_createStreamBuilder(&builder);
  if (builderResult != AAUDIO_OK || builder == nullptr) {
    context.core.stop();
    return simpleReport("AAudio builder unavailable", durationMs,
                        builderResult, AAUDIO_ERROR_INVALID_STATE, &requested);
  }
  AAudioStreamBuilder_setDirection(builder, AAUDIO_DIRECTION_OUTPUT);
  AAudioStreamBuilder_setDeviceId(builder, expectedDeviceId);
  AAudioStreamBuilder_setSampleRate(builder, requested.sampleRate);
  AAudioStreamBuilder_setChannelCount(builder, 2);
  AAudioStreamBuilder_setFormat(builder, AAUDIO_FORMAT_PCM_FLOAT);
  AAudioStreamBuilder_setUsage(builder, requested.usage == kUsageGame
                                            ? AAUDIO_USAGE_GAME
                                            : AAUDIO_USAGE_MEDIA);
  AAudioStreamBuilder_setSharingMode(
      builder, requested.sharingMode == kSharingExclusive
          ? AAUDIO_SHARING_MODE_EXCLUSIVE : AAUDIO_SHARING_MODE_SHARED);
  AAudioStreamBuilder_setPerformanceMode(builder,
                                         AAUDIO_PERFORMANCE_MODE_LOW_LATENCY);
  // Sample rate and callback frame count remain unspecified. We record the
  // negotiated sample rate and accept each actual numFrames value.
  AAudioStreamBuilder_setDataCallback(builder, &dataCallback, &context);
  AAudioStreamBuilder_setErrorCallback(builder, &errorCallback, &context);
  ++context.routePolicyChecks;
  context.routeValidBeforeOpen = routePolicyMatches(
      runToken, routeGeneration, expectedDeviceId);
  if (!context.routeValidBeforeOpen ||
      gStopRequestedToken.load(std::memory_order_acquire) == runToken) {
    context.routePolicyInvalidated.store(!context.routeValidBeforeOpen,
                                          std::memory_order_release);
    context.core.stop();
    AAudioStreamBuilder_delete(builder);
    return simpleReport("route generation or stop token changed immediately before AAudio open",
                        durationMs, AAUDIO_ERROR_UNAVAILABLE,
                        AAUDIO_ERROR_INVALID_STATE, &requested);
  }
  AAudioStream* stream = nullptr;
  const auto openResult = AAudioStreamBuilder_openStream(builder, &stream);
  AAudioStreamBuilder_delete(builder);
  if (openResult != AAUDIO_OK || stream == nullptr) {
    context.core.stop();
    return simpleReport("AAudio output stream open failed", durationMs,
                        openResult, AAUDIO_ERROR_INVALID_STATE, &requested);
  }
  context.sampleRate = AAudioStream_getSampleRate(stream);
  context.framesPerBurst = AAudioStream_getFramesPerBurst(stream);
  context.actualDeviceId = AAudioStream_getDeviceId(stream);
  context.lastObservedDeviceId = context.actualDeviceId;
  ++context.actualDeviceIdChecks;
  if (context.actualDeviceId != expectedDeviceId) {
    context.routeMismatchObserved.store(true, std::memory_order_release);
    context.routeMismatchNs = timePointNs(Clock::now());
    context.core.stop();
    const auto closeResult = AAudioStream_close(stream);
    std::ostringstream report;
    report << "{\"status\":\"ROUTE_REFUSED\",\"reason\":\"AAudio device ID did not match the selected built-in speaker before start\""
           << ",\"expected_device_id\":" << expectedDeviceId
           << ",\"actual_device_id\":" << context.actualDeviceId
           << ",\"aaudio_open_result\":" << openResult
           << ",\"aaudio_close_result\":" << closeResult
           << ",\"physical_audio_stream_started\":false"
           << ",\"dsp_benchmark_valid\":false,\"dsp_to_audio_buffer_path\":false} ";
    return report.str();
  }
  ++context.routePolicyChecks;
  context.routeValidBeforeStart = routePolicyMatches(
      runToken, routeGeneration, expectedDeviceId);
  context.actualDeviceIdBeforeStart = AAudioStream_getDeviceId(stream);
  context.lastObservedDeviceId = context.actualDeviceIdBeforeStart;
  ++context.actualDeviceIdChecks;
  if (!context.routeValidBeforeStart ||
      context.actualDeviceIdBeforeStart != expectedDeviceId ||
      gStopRequestedToken.load(std::memory_order_acquire) == runToken) {
    context.routeMismatchObserved.store(context.actualDeviceIdBeforeStart != expectedDeviceId,
                                         std::memory_order_release);
    context.routePolicyInvalidated.store(!context.routeValidBeforeStart,
                                          std::memory_order_release);
    context.routeMismatchNs = timePointNs(Clock::now());
    context.core.stop();
    const auto closeResult = AAudioStream_close(stream);
    std::ostringstream report;
    report << "{\"status\":\"ROUTE_REFUSED\",\"reason\":\"route policy, generation, stop token, or AAudio device ID changed before start\""
           << ",\"expected_device_id\":" << expectedDeviceId
           << ",\"actual_device_id\":" << context.actualDeviceIdBeforeStart
           << ",\"aaudio_open_result\":" << openResult
           << ",\"aaudio_close_result\":" << closeResult
           << ",\"route_policy_valid_before_open\":true"
           << ",\"route_policy_valid_before_start\":"
           << (context.routeValidBeforeStart ? "true" : "false")
           << ",\"physical_audio_stream_started\":false"
           << ",\"dsp_benchmark_valid\":false,\"dsp_to_audio_buffer_path\":false} ";
    return report.str();
  }
  if (context.sampleRate <= 0 || AAudioStream_getChannelCount(stream) != 2 ||
      AAudioStream_getFormat(stream) != AAUDIO_FORMAT_PCM_FLOAT) {
    context.core.stop();
    AAudioStream_close(stream);
    return simpleReport("unsupported negotiated AAudio format", durationMs,
                        openResult, AAUDIO_ERROR_INVALID_STATE, &requested);
  }

  if (context.sampleRate != kFixtureSampleRate) {
    context.core.stop();
    const auto closeResult = AAudioStream_close(stream);
    std::ostringstream report;
    report << "{\"status\":\"SAMPLE_RATE_REFUSED\",\"reason\":\"negotiated sample rate does not match the 48 kHz synthetic DSP fixture; stream closed before start\""
           << ",\"requested_sample_rate\":" << kFixtureSampleRate
           << ",\"actual_sample_rate\":" << context.sampleRate
           << ",\"frames_per_burst\":" << context.framesPerBurst
           << ",\"aaudio_open_result\":" << openResult
           << ",\"aaudio_close_result\":" << closeResult
           << ",\"physical_audio_stream_started\":false"
           << ",\"dsp_benchmark_valid\":false,\"dsp_to_audio_buffer_path\":false} ";
    return report.str();
  }

  context.runNativeSession = requested.runNativeSession &&
      context.sampleRate == kFixtureSampleRate;
  if (requested.bufferPolicy == kBufferTwoBursts &&
      context.framesPerBurst > 0 && context.framesPerBurst <=
          std::numeric_limits<std::int32_t>::max() / 2) {
    context.requestedBufferFrames = context.framesPerBurst * 2;
    context.setBufferSizeResult = AAudioStream_setBufferSizeInFrames(
        stream, context.requestedBufferFrames);
  } else if (requested.bufferPolicy == kBufferTwoBursts) {
    context.setBufferSizeResult = AAUDIO_ERROR_OUT_OF_RANGE;
  }
  context.xrunStartCount = AAudioStream_getXRunCount(stream);

  const auto startResult = AAudioStream_requestStart(stream);
  if (startResult != AAUDIO_OK) {
    context.core.stop();
    AAudioStream_close(stream);
    return simpleReport("AAudio stream start failed", durationMs, openResult,
                        startResult, &requested);
  }
  context.streamStarted = true;
  const auto runStart = Clock::now();
  const auto runDeadline = runStart + std::chrono::milliseconds(durationMs);
  auto previousXrunCount = context.xrunStartCount;
  bool faultInjected = false;
  while (Clock::now() < runDeadline) {
    const auto error = context.errorCallbackCode.load(std::memory_order_acquire);
    if (error != AAUDIO_OK || context.core.failStopCount() > 0 ||
        context.core.overlapCount() > 0 ||
        context.logOverflow.load(std::memory_order_relaxed) > 0 ||
        context.callbackOverrunObserved.load(std::memory_order_acquire) ||
        context.nonzeroOutputObserved.load(std::memory_order_acquire) ||
        !context.core.isActive()) break;
    if (gStopRequestedToken.load(std::memory_order_acquire) == runToken) {
      const auto stopReasonCode =
          gStopRequestedReasonCode.load(std::memory_order_acquire);
      context.routePolicyInvalidated.store(
          stopReasonCode == kBridgeStopReasonRoutePolicy,
          std::memory_order_release);
      context.lifecycleInvalidated.store(
          stopReasonCode == kBridgeStopReasonLifecycle,
          std::memory_order_release);
      context.core.invalidateBackground();
      break;
    }
    ++context.routePolicyChecks;
    if (!routePolicyMatches(runToken, routeGeneration, expectedDeviceId)) {
      context.routeMismatchNs = timePointNs(Clock::now());
      context.routePolicyInvalidated.store(true, std::memory_order_release);
      context.core.invalidateBackground();
      break;
    }
    context.lastObservedDeviceId = AAudioStream_getDeviceId(stream);
    ++context.actualDeviceIdChecks;
    if (context.lastObservedDeviceId != expectedDeviceId) {
      context.routeMismatchNs = timePointNs(Clock::now());
      context.routeMismatchObserved.store(true, std::memory_order_release);
      context.core.invalidateBackground();
      break;
    }
    if (AAudioStream_getState(stream) == AAUDIO_STREAM_STATE_DISCONNECTED) {
      context.streamDisconnectObserved.store(true, std::memory_order_release);
      context.core.invalidateStreamDisconnect();
      break;
    }
    if (!faultInjected && faultMode != kFaultNone &&
        Clock::now() - runStart >= std::chrono::milliseconds(faultAfterMs)) {
      if (faultMode == kFaultBackground) context.core.invalidateBackground();
      if (faultMode == kFaultDisconnect) context.core.invalidateStreamDisconnect();
      faultInjected = true;
      break;
    }
    const auto observedXrunCount = AAudioStream_getXRunCount(stream);
    if (observedXrunCount >= 0 && previousXrunCount >= 0 &&
        observedXrunCount > previousXrunCount) {
      if (context.xrunObservationCount < context.xrunObservations.size()) {
        const auto elapsed = std::chrono::duration_cast<std::chrono::nanoseconds>(
            Clock::now() - runStart).count();
        context.xrunObservations[context.xrunObservationCount++] = {
            static_cast<std::uint64_t>(std::max<std::int64_t>(elapsed, 0)),
            observedXrunCount, false};
      }
      previousXrunCount = observedXrunCount;
      context.xrunObserved.store(true, std::memory_order_release);
      context.core.invalidateBackground();
      break;
    }
    // This is the control-plane wait. Only AAudio's data callback processes
    // PCM; no timer or worker thread simulates callback frames.
    std::this_thread::sleep_for(std::chrono::milliseconds(5));
  }
  const auto callbacksEnd = Clock::now();
  const auto runWallNs = static_cast<std::uint64_t>(
      std::chrono::duration_cast<std::chrono::nanoseconds>(
          callbacksEnd - runStart).count());
  const auto stopResult = AAudioStream_requestStop(stream);
  const auto waitDeadline = Clock::now() + std::chrono::seconds(1);
  auto state = AAudioStream_getState(stream);
  while (state != AAUDIO_STREAM_STATE_STOPPED &&
         state != AAUDIO_STREAM_STATE_DISCONNECTED && Clock::now() < waitDeadline) {
    aaudio_stream_state_t next = AAUDIO_STREAM_STATE_UNKNOWN;
    AAudioStream_waitForStateChange(stream, state, &next, 100'000'000LL);
    state = next;
  }
  const bool disconnectedAtStop = state == AAUDIO_STREAM_STATE_DISCONNECTED;
  if (disconnectedAtStop) {
    context.streamDisconnectObserved.store(true, std::memory_order_release);
  }
  const bool terminalStateReached = state == AAUDIO_STREAM_STATE_STOPPED ||
      disconnectedAtStop;
  const auto drainDeadline = Clock::now() + std::chrono::seconds(1);
  while (context.callbacksInFlight.load(std::memory_order_acquire) > 0 &&
         Clock::now() < drainDeadline) std::this_thread::yield();
  const bool streamStopConfirmed = terminalStateReached &&
      state == AAUDIO_STREAM_STATE_STOPPED &&
      context.callbacksInFlight.load(std::memory_order_acquire) == 0;
  const auto streamSnapshot = snapshotStream(stream);
  const auto closeResult = AAudioStream_close(stream);
  const auto finalXrunCount = streamSnapshot.xrunCount;
  if (finalXrunCount >= 0 && previousXrunCount >= 0 &&
      finalXrunCount > previousXrunCount &&
      context.xrunObservationCount < context.xrunObservations.size()) {
    context.xrunObservations[context.xrunObservationCount++] = {
        runWallNs, finalXrunCount, true};
    context.xrunObserved.store(true, std::memory_order_release);
  }
  // Close outside both callback functions, then wait for their guards before
  // retiring the NativeSession generation or reading callback-owned metrics.
  while (context.callbacksInFlight.load(std::memory_order_acquire) > 0) {
    std::this_thread::yield();
  }
  context.core.stop();
  const auto errorCode = context.errorCallbackCode.load(std::memory_order_acquire);
  const auto count = context.recordCount.load(std::memory_order_acquire);
  const auto logOverflow = context.logOverflow.load(std::memory_order_relaxed);
  const auto overlapCount = context.core.overlapCount();
  const auto failStopCount = context.core.failStopCount();
  const bool durationComplete = count > 0 && runWallNs >=
      (static_cast<std::uint64_t>(durationMs) * 1'000'000ULL * 99ULL) / 100ULL;
  const char* status = "INCOMPLETE";
  const char* reason = "callback stopped before requested duration without an injected fault";
  if (count == 0) {
    status = "NOT_RUN";
    reason = "stream started without an observed AAudio data callback";
  } else if (context.streamDisconnectObserved.load(std::memory_order_acquire)) {
    status = "STREAM_DISCONNECTED";
    reason = "AAudio stream disconnected and was closed without automatic reopen";
  } else if (!streamStopConfirmed) {
    status = "STREAM_STOP_TIMEOUT";
    reason = "AAudio stream did not reach a drained STOPPED or DISCONNECTED state before close";
  } else if (closeResult != AAUDIO_OK) {
    status = "STREAM_CLOSE_ERROR";
    reason = "AAudioStream_close returned an error";
  } else if (logOverflow > 0) {
    status = "CALLBACK_LOG_OVERFLOW";
    reason = "callback stopped after the preallocated metrics record capacity was exhausted";
  } else if (overlapCount > 0) {
    status = "CALLBACK_OVERLAP";
    reason = "AAudio delivered overlapping callbacks; callback core failed closed";
  } else if (context.nonzeroOutputObserved.load(std::memory_order_acquire)) {
    status = "NONZERO_OUTPUT_FAIL_STOP";
    reason = "output verification observed a nonzero sample and stopped the callback";
  } else if (context.routeMismatchObserved.load(std::memory_order_acquire)) {
    status = "ROUTE_MISMATCH";
    reason = "actual AAudio device ID changed during the run";
  } else if (context.routePolicyInvalidated.load(std::memory_order_acquire)) {
    status = "ROUTE_POLICY_INVALIDATED";
    reason = "route inventory, MEDIA prediction, AudioManager mode, or generation was invalidated during the run";
  } else if (context.lifecycleInvalidated.load(std::memory_order_acquire)) {
    status = "LIFECYCLE_INVALIDATED";
    reason = "activity lifecycle invalidated the run; stream was closed without restart";
  } else if (context.streamDisconnectObserved.load(std::memory_order_acquire)) {
    status = "STREAM_DISCONNECTED";
    reason = "AAudio stream disconnected and was closed without automatic reopen";
  } else if (context.xrunObserved.load(std::memory_order_acquire)) {
    status = "XRUN_FAIL_STOP";
    reason = "AAudio XRun counter increased and the run stopped";
  } else if (context.callbackOverrunObserved.load(std::memory_order_acquire)) {
    status = "CALLBACK_OVERRUN";
    reason = "complete callback exceeded the actual frame-count deadline";
  } else if (faultInjected) {
    status = "FAULT_INJECTED";
    reason = "callback observed; lifecycle fault injection completed";
  } else if (failStopCount > 0) {
    status = "EARLY_FAIL_STOP";
    reason = context.deadlineMisses > 0 ?
        "callback stream stopped by NativeSession deadline fail-stop" :
        "callback stream stopped by NativeSession fail-stop";
  } else if (errorCode != AAUDIO_OK) {
    status = "STREAM_ERROR";
    reason = "AAudio error callback stopped the stream";
  } else if (gStopRequestedToken.load(std::memory_order_acquire) == runToken) {
    const auto stopReason = gStopRequestedReasonCode.load(std::memory_order_acquire);
    status = stopReason == kBridgeStopReasonLifecycle
        ? "LIFECYCLE_INVALIDATED"
        : stopReason == kBridgeStopReasonRoutePolicy
            ? "ROUTE_POLICY_INVALIDATED" : "STOPPED_BY_USER";
    reason = "control-plane stop request was drained and the stream was closed";
  } else if (durationComplete &&
             context.xrunStartCount >= 0 && streamSnapshot.xrunCount >= 0 &&
             streamSnapshot.xrunCount == context.xrunStartCount &&
             !context.streamDisconnectObserved.load(std::memory_order_acquire) &&
             streamSnapshot.deviceId == context.expectedDeviceId &&
             context.routeValidBeforeOpen && context.routeValidBeforeStart &&
             !context.routeMismatchObserved.load(std::memory_order_acquire) &&
             context.core.nativeSessionInvocations() > 0) {
    status = "PASS";
    reason = "60-second variable-frame DSP-shadow callback completed with zero output and clean teardown";
  } else if (durationComplete) {
    status = "ACCEPTANCE_GATE_FAILED";
    reason = "duration completed but one or more route, XRun, DSP, callback, or teardown acceptance gates were unavailable or failed";
  }
  const auto report = buildReport(status, reason, context, streamSnapshot, durationMs,
                                  faultMode, faultAfterMs, openResult,
                                  startResult, stopResult, runWallNs, errorCode,
                                  streamStopConfirmed, closeResult);
  return report;
}

}  // namespace

extern "C" JNIEXPORT jstring JNICALL
Java_org_hearlens_physicaldsp_NativeBridge_nativeRunDspShadow(
    JNIEnv* env, jobject, jbyteArray fixture, jint deviceId,
    jlong runToken, jlong routeGeneration) {
  const RequestedConfig requested{true, kFixtureSampleRate, kSharingShared,
                                  kUsageMedia, kBufferDefault};
  std::string report;
  try {
    report = runFixture(env, fixture, 60'000, true, kFaultNone, 0, requested,
        deviceId, static_cast<std::uint64_t>(runToken),
        static_cast<std::uint64_t>(routeGeneration));
  } catch (const std::exception& error) {
    report = simpleReport(error.what(), 60'000, AAUDIO_ERROR_INTERNAL,
                          AAUDIO_ERROR_INVALID_STATE, &requested);
  } catch (...) {
    report = simpleReport("unhandled native exception", 60'000,
                          AAUDIO_ERROR_INTERNAL,
                          AAUDIO_ERROR_INVALID_STATE, &requested);
  }
  return env->NewStringUTF(report.c_str());
}

extern "C" JNIEXPORT jbyteArray JNICALL
Java_org_hearlens_physicaldsp_NativeBridge_nativeRunPortableFixture(
    JNIEnv* env, jobject, jbyteArray fixtureBytes) {
  if (fixtureBytes == nullptr) return nullptr;
  const jsize size = env->GetArrayLength(fixtureBytes);
  if (size <= 0) return nullptr;
  try {
    std::string fixture(static_cast<std::size_t>(size), '\0');
    env->GetByteArrayRegion(fixtureBytes, 0, size,
                            reinterpret_cast<jbyte*>(fixture.data()));
    if (env->ExceptionCheck()) return nullptr;
    std::istringstream input(fixture,
        std::ios_base::in | std::ios_base::binary);
    std::ostringstream output(std::ios_base::out | std::ios_base::binary);
    if (!runPortableFixture(input, output)) return nullptr;
    const std::string result = output.str();
    if (result.size() >
        static_cast<std::size_t>(std::numeric_limits<jsize>::max())) return nullptr;
    jbyteArray bytes = env->NewByteArray(static_cast<jsize>(result.size()));
    if (bytes == nullptr) return nullptr;
    env->SetByteArrayRegion(bytes, 0, static_cast<jsize>(result.size()),
        reinterpret_cast<const jbyte*>(result.data()));
    return env->ExceptionCheck() ? nullptr : bytes;
  } catch (...) {
    return nullptr;
  }
}

extern "C" JNIEXPORT jstring JNICALL
Java_org_hearlens_physicaldsp_NativeBridge_nativeRunSessionMatrix(
    JNIEnv* env, jobject) {
  try {
    std::ostringstream output;
    if (runNativeSessionCheck(output) != 0) return nullptr;
    return env->NewStringUTF(output.str().c_str());
  } catch (...) {
    return nullptr;
  }
}

extern "C" JNIEXPORT void JNICALL
Java_org_hearlens_physicaldsp_NativeBridge_nativePublishRouteSnapshot(
    JNIEnv*, jobject, jlong runToken, jlong generation, jint speakerId,
    jboolean allowed, jint invalidationReasonCode) {
  if (runToken <= 0 || generation <= 0) return;
  const auto token = static_cast<std::uint64_t>(runToken);
  const auto routeGeneration = static_cast<std::uint64_t>(generation);
  std::lock_guard<std::mutex> lock(gRoutePolicyMutex);
  if (token < gPublishedRouteSnapshot.runToken ||
      (token == gPublishedRouteSnapshot.runToken &&
       routeGeneration < gPublishedRouteSnapshot.generation)) {
    return;
  }
  gPublishedRouteSnapshot = {
      token,
      routeGeneration,
      static_cast<std::int32_t>(speakerId),
      static_cast<std::int32_t>(invalidationReasonCode),
      allowed == JNI_TRUE && speakerId > 0,
  };
}

extern "C" JNIEXPORT void JNICALL
Java_org_hearlens_physicaldsp_NativeBridge_nativeRequestStop(
    JNIEnv*, jobject, jlong runToken, jint reasonCode) {
  if (runToken <= 0) return;
  gStopRequestedReasonCode.store(reasonCode, std::memory_order_release);
  gStopRequestedToken.store(static_cast<std::uint64_t>(runToken),
                            std::memory_order_release);
}
