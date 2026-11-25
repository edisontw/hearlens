#include "callback_core.hpp"

#include <aaudio/AAudio.h>
#include <jni.h>
#include <sys/system_properties.h>

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
#include <new>
#include <sstream>
#include <string>
#include <thread>
#include <utility>
#include <vector>

namespace {
using namespace hearlens::research;
using namespace hearlens::research::aaudio_lab;
using Clock = CallbackCore::Clock;

constexpr std::uint32_t kFixtureMagic = 0x334e4c48U;
constexpr std::int32_t kFixtureSampleRate = 48'000;
constexpr std::size_t kMaximumRecords = 1'000'000;
constexpr int kFaultNone = 0;
constexpr int kFaultBackground = 1;
constexpr int kFaultDisconnect = 2;

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
  std::uint64_t wallNs = 0;
  std::uint64_t cpuNs = 0;
  std::uint64_t jitterNs = 0;
  std::uint32_t frames = 0;
  std::uint32_t deadlineBudgetFrames = 0;
};

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
  RunContext(const FixtureData& fixture, bool verifyOutput)
      : core(fixture.basis, fixture.targets, fixture.pcm),
        records(new CallbackRecord[kMaximumRecords]{}),
        verifyZeroOutput(verifyOutput) {}

  CallbackCore core;
  std::unique_ptr<CallbackRecord[]> records;
  std::atomic<std::uint32_t> callbacksInFlight{0};
  std::atomic<std::uint32_t> recordCount{0};
  std::array<std::uint64_t, kMaximumCallbackFrames + 1> frameCounts{};
  std::uint64_t frameCountOverflow = 0;
  std::uint64_t zeroSamplesVerified = 0;
  std::uint64_t nonZeroSamplesObserved = 0;
  std::uint64_t deadlineMisses = 0;
  std::uint64_t cpuSamples = 0;
  std::uint64_t cpuUnavailableSamples = 0;
  std::atomic<std::uint64_t> logOverflow{0};
  std::uint64_t previousStartNs = 0;
  std::uint32_t previousFrames = 0;
  std::int32_t sampleRate = 0;
  std::int32_t framesPerBurst = 0;
  std::atomic<std::int32_t> errorCallbackCode{AAUDIO_OK};
  const bool verifyZeroOutput;
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
  const auto disposition = context->core.processOutput(
      static_cast<float*>(audioData), numFrames, context->sampleRate,
      callbackStart, &Clock::now,
      std::max(numFrames, context->framesPerBurst));
  if (disposition == CallbackDisposition::kOverlap) {
    return AAUDIO_CALLBACK_RESULT_STOP;
  }

  if (context->verifyZeroOutput && audioData != nullptr && numFrames > 0) {
    const auto samples = static_cast<std::size_t>(numFrames) * 2;
    const auto* output = static_cast<const float*>(audioData);
    for (std::size_t index = 0; index < samples; ++index) {
      if (output[index] == 0.0F) {
        ++context->zeroSamplesVerified;
      } else {
        ++context->nonZeroSamplesObserved;
      }
    }
  }

  bool cpuEndAvailable = false;
  const auto cpuEnd = threadCpuNow(cpuEndAvailable);
  const auto callbackEnd = Clock::now();
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
    const auto endNs = timePointNs(callbackEnd);
    record.wallNs = endNs >= startNs ? endNs - startNs : 0;
    record.frames = numFrames > 0 ? static_cast<std::uint32_t>(numFrames) : 0;
    record.deadlineBudgetFrames = numFrames > 0
        ? static_cast<std::uint32_t>(std::max(numFrames, context->framesPerBurst))
        : 0;
    if (cpuStartAvailable && cpuEndAvailable && cpuEnd >= cpuStart) {
      record.cpuNs = cpuEnd - cpuStart;
      ++context->cpuSamples;
    } else {
      ++context->cpuUnavailableSamples;
    }
    if (context->previousStartNs != 0 && context->sampleRate > 0 &&
        context->previousFrames > 0) {
      const auto observed = startNs - context->previousStartNs;
      const auto expected = static_cast<std::uint64_t>(
          static_cast<double>(context->previousFrames) * 1'000'000'000.0 /
          static_cast<double>(context->sampleRate));
      record.jitterNs = observed >= expected ? observed - expected : expected - observed;
    }
    context->previousStartNs = startNs;
    context->previousFrames = record.frames;

    if (numFrames > 0 && context->sampleRate > 0) {
      const auto budgetNs = static_cast<std::uint64_t>(
          static_cast<double>(record.deadlineBudgetFrames) * 1'000'000'000.0 /
          static_cast<double>(context->sampleRate));
      if (record.wallNs > budgetNs) ++context->deadlineMisses;
    }
  } else {
    context->logOverflow.fetch_add(1, std::memory_order_relaxed);
    return AAUDIO_CALLBACK_RESULT_STOP;
  }
  return disposition == CallbackDisposition::kContinue
      ? AAUDIO_CALLBACK_RESULT_CONTINUE : AAUDIO_CALLBACK_RESULT_STOP;
}

void errorCallback(AAudioStream*, void* userData, aaudio_result_t error) {
  auto* context = static_cast<RunContext*>(userData);
  if (context == nullptr) return;
  const CallbackInFlight inFlight(context->callbacksInFlight);
  context->errorCallbackCode.store(error, std::memory_order_release);
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
  aaudio_performance_mode_t performance = AAUDIO_PERFORMANCE_MODE_NONE;
  aaudio_sharing_mode_t sharing = AAUDIO_SHARING_MODE_SHARED;
  std::int32_t xrunCount = -1;
};

StreamSnapshot snapshotStream(AAudioStream* stream) noexcept {
  if (stream == nullptr) return {};
  return {
      AAudioStream_getSampleRate(stream),
      AAudioStream_getFramesPerBurst(stream),
      AAudioStream_getBufferSizeInFrames(stream),
      AAudioStream_getPerformanceMode(stream),
      AAudioStream_getSharingMode(stream),
      AAudioStream_getXRunCount(stream),
  };
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

  std::ostringstream json;
  json << "{\"status\":\"" << status << "\",\"reason\":\"" << reason
       << "\",\"requested_duration_ms\":" << durationMs
       << ",\"duration_complete\":" <<
          (durationComplete ? "true" : "false")
       << ",\"run_completion\":\"" << runCompletion << "\""
       << ",\"requested_equivalent_frames\":128"
       << ",\"requested_equivalent_duration_ms\":300000"
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
       << ",\"successful_dsp_callbacks\":" << context.core.callbackCount()
       << ",\"dsp_fail_stop_count\":" << context.core.failStopCount()
       << ",\"callback_overlap_count\":" << context.core.overlapCount()
       << ",\"deadline_misses\":" << context.deadlineMisses
       << ",\"deadline_budget_basis\":\"max(callback numFrames, negotiated framesPerBurst)\""
       << ",\"deadline_budget_min_frames\":" << minimumBudgetFrames
       << ",\"deadline_budget_max_frames\":" << maximumBudgetFrames
       << ",\"callback_log_overflow\":" <<
          context.logOverflow.load(std::memory_order_relaxed)
       << ",\"callback_cpu_samples\":" << context.cpuSamples
       << ",\"callback_cpu_unavailable_samples\":" <<
          context.cpuUnavailableSamples
       << ",\"dsp_thread_cpu_percent\":" << cpuPercent
       << ",\"actual_sample_rate\":" << stream.sampleRate
       << ",\"requested_sample_rate\":" << kFixtureSampleRate
       << ",\"dsp_fixture_sample_rate\":" << kFixtureSampleRate
       << ",\"sample_rate_matches_fixture\":"
       << (stream.sampleRate == kFixtureSampleRate ? "true" : "false")
       << ",\"frames_per_burst\":" << stream.framesPerBurst
       << ",\"buffer_size_frames\":" << stream.bufferSize
       << ",\"requested_performance_mode\":\"LOW_LATENCY\""
       << ",\"actual_performance_mode\":\""
       << performanceModeName(stream.performance) << "\""
       << ",\"requested_sharing_mode\":\"SHARED\""
       << ",\"actual_sharing_mode\":\"" << sharingModeName(stream.sharing)
       << "\",\"format\":\"FLOAT\",\"channels\":2"
       << ",\"callback_frames_request\":\"UNSPECIFIED_VARIABLE\""
       << ",\"xrun_count\":" << stream.xrunCount
       << ",\"xrun_source\":\"AAudioStream_getXRunCount on output stream\""
       << ",\"allocation_monitor\":\"callback source path contains no allocation/I/O/JNI/mutex/sleep; AAudio and Bionic internal allocations are not instrumented\""
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
  json << "\"frame_count_distribution\":{";
  bool first = true;
  for (std::size_t frames = 1; frames < context.frameCounts.size(); ++frames) {
    if (context.frameCounts[frames] == 0) continue;
    if (!first) json << ',';
    first = false;
    json << '"' << frames << "\":" << context.frameCounts[frames];
  }
  json << "},\"frame_count_overflow\":" << context.frameCountOverflow
       << ",\"physical_audio_stream_started\":false"
       << ",\"microphone_used\":false,\"bluetooth_api_used\":false"
       << ",\"dsp_to_audio_buffer_path\":false"
       << ",\"test_semantics\":\"zero-only AAudio output callback; synthetic DSP output is private and discarded\"}"
       ;
  return json.str();
}

std::string simpleReport(const char* reason, int durationMs,
                         aaudio_result_t openResult,
                         aaudio_result_t startResult = AAUDIO_ERROR_INVALID_STATE) {
  std::ostringstream json;
  json << "{\"status\":\"NOT_RUN\",\"reason\":\"" << reason
       << "\",\"requested_duration_ms\":" << durationMs
       << ",\"duration_complete\":false,\"run_completion\":\"NOT_RUN\""
       << ",\"aaudio_open_result\":" << openResult
       << ",\"aaudio_start_result\":" << startResult
       << ",\"actual_callback_observed\":false"
       << ",\"physical_audio_stream_started\":false"
       << ",\"microphone_used\":false,\"bluetooth_api_used\":false"
       << ",\"dsp_to_audio_buffer_path\":false}"
       ;
  return json.str();
}

bool isAndroidEmulator() noexcept {
  char value[PROP_VALUE_MAX]{};
  const auto length = __system_property_get("ro.kernel.qemu", value);
  return length > 0 && value[0] == '1';
}

std::string runFixture(JNIEnv* env, jbyteArray fixtureBytes, int durationMs,
                       bool verifyZeroOutput, int faultMode, int faultAfterMs) {
  if (!isAndroidEmulator()) {
    return simpleReport("physical-device AAudio stream is disabled in this harness",
                        durationMs, AAUDIO_ERROR_UNAVAILABLE);
  }
  if (fixtureBytes == nullptr || durationMs < 100 || durationMs > 300'000 ||
      faultMode < kFaultNone || faultMode > kFaultDisconnect ||
      (faultMode != kFaultNone &&
       (faultAfterMs < 100 || faultAfterMs >= durationMs))) {
    return simpleReport("invalid benchmark arguments", durationMs,
                        AAUDIO_ERROR_ILLEGAL_ARGUMENT);
  }
  const auto byteCount = env->GetArrayLength(fixtureBytes);
  if (byteCount <= 0) {
    return simpleReport("empty portable fixture", durationMs,
                        AAUDIO_ERROR_ILLEGAL_ARGUMENT);
  }
  std::vector<std::uint8_t> fixtureBuffer(static_cast<std::size_t>(byteCount));
  env->GetByteArrayRegion(fixtureBytes, 0, byteCount,
                          reinterpret_cast<jbyte*>(fixtureBuffer.data()));
  if (env->ExceptionCheck()) {
    env->ExceptionClear();
    return simpleReport("failed reading fixture bytes", durationMs,
                        AAUDIO_ERROR_INTERNAL);
  }
  FixtureData fixture;
  if (!parseFixture(fixtureBuffer.data(), fixtureBuffer.size(), fixture)) {
    return simpleReport("portable fixture rejected", durationMs,
                        AAUDIO_ERROR_INVALID_FORMAT);
  }

  RunContext context(fixture, verifyZeroOutput);
  if (!context.core.start()) {
    return simpleReport("NativeSession authorization failed", durationMs,
                        AAUDIO_ERROR_INVALID_STATE);
  }
  AAudioStreamBuilder* builder = nullptr;
  const auto builderResult = AAudio_createStreamBuilder(&builder);
  if (builderResult != AAUDIO_OK || builder == nullptr) {
    context.core.stop();
    return simpleReport("AAudio builder unavailable", durationMs,
                        builderResult);
  }
  AAudioStreamBuilder_setDirection(builder, AAUDIO_DIRECTION_OUTPUT);
  AAudioStreamBuilder_setSampleRate(builder, kFixtureSampleRate);
  AAudioStreamBuilder_setChannelCount(builder, 2);
  AAudioStreamBuilder_setFormat(builder, AAUDIO_FORMAT_PCM_FLOAT);
  AAudioStreamBuilder_setUsage(builder, AAUDIO_USAGE_MEDIA);
  AAudioStreamBuilder_setSharingMode(builder, AAUDIO_SHARING_MODE_SHARED);
  AAudioStreamBuilder_setPerformanceMode(builder,
                                         AAUDIO_PERFORMANCE_MODE_LOW_LATENCY);
  // Sample rate and callback frame count remain unspecified. We record the
  // negotiated sample rate and accept each actual numFrames value.
  AAudioStreamBuilder_setDataCallback(builder, &dataCallback, &context);
  AAudioStreamBuilder_setErrorCallback(builder, &errorCallback, &context);
  AAudioStream* stream = nullptr;
  const auto openResult = AAudioStreamBuilder_openStream(builder, &stream);
  AAudioStreamBuilder_delete(builder);
  if (openResult != AAUDIO_OK || stream == nullptr) {
    context.core.stop();
    return simpleReport("AAudio output stream open failed", durationMs,
                        openResult);
  }
  context.sampleRate = AAudioStream_getSampleRate(stream);
  context.framesPerBurst = AAudioStream_getFramesPerBurst(stream);
  if (context.sampleRate <= 0 || AAudioStream_getChannelCount(stream) != 2 ||
      AAudioStream_getFormat(stream) != AAUDIO_FORMAT_PCM_FLOAT) {
    context.core.stop();
    AAudioStream_close(stream);
    return simpleReport("unsupported negotiated AAudio format", durationMs,
                        openResult);
  }

  const auto startResult = AAudioStream_requestStart(stream);
  if (startResult != AAUDIO_OK) {
    context.core.stop();
    AAudioStream_close(stream);
    return simpleReport("AAudio stream start failed", durationMs, openResult,
                        startResult);
  }
  const auto runStart = Clock::now();
  const auto runDeadline = runStart + std::chrono::milliseconds(durationMs);
  bool faultInjected = false;
  while (Clock::now() < runDeadline) {
    const auto error = context.errorCallbackCode.load(std::memory_order_acquire);
    if (error != AAUDIO_OK || context.core.failStopCount() > 0 ||
        context.core.overlapCount() > 0 ||
        context.logOverflow.load(std::memory_order_relaxed) > 0 ||
        !context.core.isActive()) break;
    if (!faultInjected && faultMode != kFaultNone &&
        Clock::now() - runStart >= std::chrono::milliseconds(faultAfterMs)) {
      if (faultMode == kFaultBackground) context.core.invalidateBackground();
      if (faultMode == kFaultDisconnect) context.core.invalidateStreamDisconnect();
      faultInjected = true;
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
  const bool terminalStateReached = state == AAUDIO_STREAM_STATE_STOPPED ||
      state == AAUDIO_STREAM_STATE_DISCONNECTED;
  const auto drainDeadline = Clock::now() + std::chrono::seconds(1);
  while (context.callbacksInFlight.load(std::memory_order_acquire) > 0 &&
         Clock::now() < drainDeadline) std::this_thread::yield();
  const bool streamStopConfirmed = terminalStateReached &&
      context.callbacksInFlight.load(std::memory_order_acquire) == 0;
  const auto streamSnapshot = snapshotStream(stream);
  const auto closeResult = AAudioStream_close(stream);
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
  } else if (durationComplete) {
    status = "PASS";
    reason = "AAudio data callback observed for requested duration";
  }
  const auto report = buildReport(status, reason, context, streamSnapshot, durationMs,
                                  faultMode, faultAfterMs, openResult,
                                  startResult, stopResult, runWallNs, errorCode,
                                  streamStopConfirmed, closeResult);
  return report;
}

}  // namespace

extern "C" JNIEXPORT jstring JNICALL
Java_org_hearlens_aaudiocallback_NativeBridge_nativeRunFixture(
    JNIEnv* env, jobject, jbyteArray fixture, jint durationMs,
    jboolean verifyZeroOutput, jint faultMode, jint faultAfterMs) {
  const auto report = runFixture(env, fixture, durationMs,
                                 verifyZeroOutput == JNI_TRUE, faultMode,
                                 faultAfterMs);
  return env->NewStringUTF(report.c_str());
}
