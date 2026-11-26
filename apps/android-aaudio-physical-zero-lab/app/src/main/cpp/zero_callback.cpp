#include "zero_output_core.hpp"

#include <aaudio/AAudio.h>
#include <jni.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <ctime>
#include <memory>
#include <mutex>
#include <new>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

namespace {
using Clock = std::chrono::steady_clock;
constexpr std::int32_t kMaximumDurationMs = 60'000;
constexpr std::size_t kMaximumCallbackRecords = 65'536;
constexpr std::size_t kMaximumHistogramFrames = 8'192;
constexpr std::size_t kMaximumXrunObservations = 12'008;

enum class StopReason : std::int32_t {
  kNone = 0,
  kUser = 1,
  kDuration = 2,
  kCallbackOverrun = 3,
  kXrun = 4,
  kNonZeroOutput = 5,
  kCallbackOverlap = 6,
  kInvalidCallback = 7,
  kStreamError = 8,
  kRouteMismatch = 9,
  kMetricCapacity = 10,
};

const char* reasonName(StopReason reason) noexcept {
  switch (reason) {
    case StopReason::kNone: return "NONE";
    case StopReason::kUser: return "USER_STOP";
    case StopReason::kDuration: return "MAX_DURATION_REACHED";
    case StopReason::kCallbackOverrun: return "CALLBACK_DEADLINE_OVERRUN";
    case StopReason::kXrun: return "AAUDIO_XRUN";
    case StopReason::kNonZeroOutput: return "NONZERO_OUTPUT_FAIL_STOP";
    case StopReason::kCallbackOverlap: return "CALLBACK_OVERLAP_FAIL_STOP";
    case StopReason::kInvalidCallback: return "INVALID_CALLBACK_BUFFER";
    case StopReason::kStreamError: return "AAUDIO_STREAM_ERROR";
    case StopReason::kRouteMismatch: return "BUILTIN_SPEAKER_ROUTE_MISMATCH";
    case StopReason::kMetricCapacity: return "METRIC_CAPACITY_EXHAUSTED";
  }
  return "UNKNOWN";
}

void setFailStopReason(std::atomic<StopReason>& destination,
                       StopReason reason) noexcept {
  auto expected = StopReason::kNone;
  destination.compare_exchange_strong(expected, reason,
      std::memory_order_acq_rel, std::memory_order_acquire);
}

std::uint64_t nowNs(Clock::time_point time) noexcept {
  return static_cast<std::uint64_t>(
      std::chrono::duration_cast<std::chrono::nanoseconds>(
          time.time_since_epoch()).count());
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

struct CallbackRecord {
  std::uint64_t wallNs = 0;
  std::uint64_t threadCpuNs = 0;
  std::uint64_t interArrivalNs = 0;
  std::uint64_t callbackBudgetNs = 0;
  std::uint32_t frames = 0;
};

struct XrunObservation {
  std::uint64_t elapsedNs = 0;
  std::int32_t cumulativeCount = -1;
};

struct Session {
  explicit Session(std::int32_t expectedDeviceId, std::uint64_t runToken)
      : records(new (std::nothrow) CallbackRecord[kMaximumCallbackRecords]),
        xrunObservations(new (std::nothrow) XrunObservation[kMaximumXrunObservations]),
        expectedOutputDeviceId(expectedDeviceId), token(runToken) {
    for (auto& count : frameHistogram) {
      count.store(0, std::memory_order_relaxed);
    }
  }

  std::unique_ptr<CallbackRecord[]> records;
  std::unique_ptr<XrunObservation[]> xrunObservations;
  std::array<std::atomic<std::uint64_t>, kMaximumHistogramFrames + 1> frameHistogram{};
  std::atomic<std::uint32_t> callbacksInFlight{0};
  std::atomic<std::uint64_t> callbackInvocationCount{0};
  std::atomic<std::uint64_t> errorCallbackCount{0};
  std::atomic<std::uint64_t> callbackCount{0};
  std::atomic<std::uint64_t> zeroSamplesVerified{0};
  std::atomic<std::uint64_t> nonZeroSamplesObserved{0};
  std::atomic<std::uint64_t> callbackOverruns{0};
  std::atomic<std::uint64_t> firstOverrunWallNs{0};
  std::atomic<std::uint64_t> firstOverrunBudgetNs{0};
  std::atomic<std::uint64_t> firstOverrunElapsedNs{0};
  std::atomic<std::uint32_t> firstOverrunFrames{0};
  std::atomic<std::uint64_t> callbackOverlapCount{0};
  std::atomic<std::uint64_t> invalidCallbackCount{0};
  std::atomic<std::uint64_t> histogramOverflowFrames{0};
  std::atomic<std::uint64_t> recordOverflowCount{0};
  std::atomic<std::uint64_t> cpuUnavailableCount{0};
  std::atomic<StopReason> stopReason{StopReason::kNone};
  std::atomic<bool> stopRequested{false};
  std::atomic<std::int32_t> streamErrorCode{AAUDIO_OK};
  std::uint64_t previousCallbackStartNs = 0;
  std::atomic<std::uint64_t> runStartNs{0};
  std::uint64_t xrunObservationCount = 0;
  std::int32_t expectedOutputDeviceId;
  std::uint64_t token;
  std::int32_t sampleRate = 0;
  std::int32_t channelCount = 0;
  std::int32_t framesPerBurst = 0;
  std::int32_t bufferSizeFrames = 0;
  std::int32_t bufferCapacityFrames = 0;
  std::int32_t actualDeviceId = -1;
  std::int32_t xrunStartCount = -1;
  std::int32_t xrunFinalCount = -1;
  std::uint64_t cpuAvailableSamples = 0;
  std::uint64_t totalThreadCpuNs = 0;
  aaudio_sharing_mode_t sharingMode = AAUDIO_SHARING_MODE_SHARED;
  aaudio_performance_mode_t performanceMode = AAUDIO_PERFORMANCE_MODE_NONE;
  aaudio_result_t openResult = AAUDIO_ERROR_INVALID_STATE;
  aaudio_result_t startResult = AAUDIO_ERROR_INVALID_STATE;
  aaudio_result_t stopResult = AAUDIO_ERROR_INVALID_STATE;
  aaudio_result_t closeResult = AAUDIO_ERROR_INVALID_STATE;
  bool streamStarted = false;
  bool streamStopConfirmed = false;
};

static_assert(std::atomic<std::uint64_t>::is_always_lock_free);
static_assert(std::atomic<std::uint32_t>::is_always_lock_free);
static_assert(std::atomic<StopReason>::is_always_lock_free);

std::mutex gSessionMutex;
Session* gCurrentSession = nullptr;
std::atomic<std::uint64_t> gStopRequestedToken{0};
std::atomic<bool> gDrainTimeoutFailStop{false};

void requestStop(Session& session, StopReason reason) noexcept {
  setFailStopReason(session.stopReason, reason);
  session.stopRequested.store(true, std::memory_order_release);
}

aaudio_data_callback_result_t dataCallback(AAudioStream*, void* userData,
                                           void* audioData,
                                           std::int32_t numFrames) noexcept {
  auto* session = static_cast<Session*>(userData);
  if (session == nullptr) return AAUDIO_CALLBACK_RESULT_STOP;
  const auto inFlight = session->callbacksInFlight.fetch_add(
      1, std::memory_order_acq_rel);
  session->callbackInvocationCount.fetch_add(1, std::memory_order_relaxed);
  const auto callbackStart = Clock::now();
  const auto callbackStartNs = nowNs(callbackStart);
  bool cpuAvailable = false;
  const auto cpuStart = threadCpuNow(cpuAvailable);
  const auto zeroCheck = hearlens::physical_zero::clearAndVerifyZero(
      static_cast<float*>(audioData), numFrames, 2);
  if (!zeroCheck.valid) {
    session->invalidCallbackCount.fetch_add(1, std::memory_order_relaxed);
    requestStop(*session, StopReason::kInvalidCallback);
    session->callbacksInFlight.fetch_sub(1, std::memory_order_acq_rel);
    return AAUDIO_CALLBACK_RESULT_STOP;
  }
  if (zeroCheck.nonZeroSamples > 0) {
    session->nonZeroSamplesObserved.fetch_add(zeroCheck.nonZeroSamples,
                                               std::memory_order_relaxed);
    requestStop(*session, StopReason::kNonZeroOutput);
    session->callbacksInFlight.fetch_sub(1, std::memory_order_acq_rel);
    return AAUDIO_CALLBACK_RESULT_STOP;
  }
  const auto sampleCount = static_cast<std::uint64_t>(numFrames) * 2ULL;
  session->zeroSamplesVerified.fetch_add(sampleCount, std::memory_order_relaxed);
  const auto frameIndex = static_cast<std::size_t>(numFrames) <=
      kMaximumHistogramFrames ? static_cast<std::size_t>(numFrames) :
      kMaximumHistogramFrames;
  session->frameHistogram[frameIndex].fetch_add(1, std::memory_order_relaxed);
  if (static_cast<std::size_t>(numFrames) > kMaximumHistogramFrames) {
    session->histogramOverflowFrames.fetch_add(1, std::memory_order_relaxed);
  }

  if (inFlight != 0) {
    session->callbackOverlapCount.fetch_add(1, std::memory_order_relaxed);
    requestStop(*session, StopReason::kCallbackOverlap);
    session->callbacksInFlight.fetch_sub(1, std::memory_order_acq_rel);
    return AAUDIO_CALLBACK_RESULT_STOP;
  }

  const auto recordIndex = session->callbackCount.fetch_add(
      1, std::memory_order_relaxed);

  const auto interArrival = session->previousCallbackStartNs == 0 ? 0 :
      callbackStartNs - session->previousCallbackStartNs;
  session->previousCallbackStartNs = callbackStartNs;
  const auto callbackBudgetNs = session->sampleRate > 0
      ? (static_cast<std::uint64_t>(numFrames) * 1'000'000'000ULL) /
            static_cast<std::uint64_t>(session->sampleRate)
      : 0;

  bool cpuEndAvailable = false;
  const auto cpuEnd = threadCpuNow(cpuEndAvailable);
  const auto callbackEnd = Clock::now();
  const auto wallNs = nowNs(callbackEnd) - callbackStartNs;
  const auto cpuNs = cpuAvailable && cpuEndAvailable && cpuEnd >= cpuStart
      ? cpuEnd - cpuStart : 0;
  if (cpuNs > 0) {
    session->cpuAvailableSamples++;
    session->totalThreadCpuNs += cpuNs;
  } else {
    session->cpuUnavailableCount.fetch_add(1, std::memory_order_relaxed);
  }

  if (recordIndex >= kMaximumCallbackRecords) {
    session->recordOverflowCount.fetch_add(1, std::memory_order_relaxed);
    requestStop(*session, StopReason::kMetricCapacity);
  } else {
    session->records[recordIndex] = {
        wallNs, cpuNs, interArrival, callbackBudgetNs,
        static_cast<std::uint32_t>(numFrames)};
  }
  if (callbackBudgetNs > 0 && wallNs > callbackBudgetNs) {
    session->firstOverrunFrames.store(static_cast<std::uint32_t>(numFrames),
                                      std::memory_order_relaxed);
    session->firstOverrunWallNs.store(wallNs, std::memory_order_relaxed);
    session->firstOverrunBudgetNs.store(callbackBudgetNs,
                                        std::memory_order_relaxed);
    const auto startNs = session->runStartNs.load(std::memory_order_relaxed);
    session->firstOverrunElapsedNs.store(
        startNs > 0 && callbackStartNs >= startNs ? callbackStartNs - startNs : 0,
        std::memory_order_relaxed);
    session->callbackOverruns.fetch_add(1, std::memory_order_relaxed);
    requestStop(*session, StopReason::kCallbackOverrun);
  }
  session->callbacksInFlight.fetch_sub(1, std::memory_order_acq_rel);
  return session->stopRequested.load(std::memory_order_acquire)
      ? AAUDIO_CALLBACK_RESULT_STOP : AAUDIO_CALLBACK_RESULT_CONTINUE;
}

void errorCallback(AAudioStream*, void* userData,
                   aaudio_result_t error) noexcept {
  auto* session = static_cast<Session*>(userData);
  if (session == nullptr) return;
  session->callbacksInFlight.fetch_add(1, std::memory_order_acq_rel);
  session->errorCallbackCount.fetch_add(1, std::memory_order_relaxed);
  session->streamErrorCode.store(error, std::memory_order_release);
  requestStop(*session, StopReason::kStreamError);
  session->callbacksInFlight.fetch_sub(1, std::memory_order_acq_rel);
}

const char* sharingModeName(aaudio_sharing_mode_t mode) noexcept {
  switch (mode) {
    case AAUDIO_SHARING_MODE_SHARED: return "SHARED";
    case AAUDIO_SHARING_MODE_EXCLUSIVE: return "EXCLUSIVE";
    default: return "UNSPECIFIED";
  }
}

const char* performanceModeName(aaudio_performance_mode_t mode) noexcept {
  switch (mode) {
    case AAUDIO_PERFORMANCE_MODE_LOW_LATENCY: return "LOW_LATENCY";
    case AAUDIO_PERFORMANCE_MODE_POWER_SAVING: return "POWER_SAVING";
    default: return "NONE";
  }
}

std::uint64_t percentile(std::vector<std::uint64_t>& samples,
                         std::size_t numerator,
                         std::size_t denominator) {
  if (samples.empty()) return 0;
  std::sort(samples.begin(), samples.end());
  const auto rank = (samples.size() * numerator + denominator - 1) /
      denominator;
  return samples[std::min(samples.size() - 1,
      rank == 0 ? 0 : rank - 1)];
}

std::vector<std::uint64_t> valuesFor(const Session& session,
                                     std::uint64_t count,
                                     std::uint64_t CallbackRecord::*field) {
  std::vector<std::uint64_t> values;
  values.reserve(static_cast<std::size_t>(std::min<std::uint64_t>(
      count, kMaximumCallbackRecords)));
  const auto recordCount = std::min<std::uint64_t>(
      count, kMaximumCallbackRecords);
  for (std::uint64_t index = 0; index < recordCount; ++index) {
    values.push_back(session.records[index].*field);
  }
  return values;
}

std::string report(Session& session, const char* status,
                   const char* reason, std::uint64_t elapsedNs,
                   bool durationComplete) {
  const auto count = session.callbackCount.load(std::memory_order_acquire);
  const auto invocations = session.callbackInvocationCount.load(std::memory_order_acquire);
  const auto streamErrorCode = session.streamErrorCode.load(std::memory_order_acquire);
  const auto storedStopReason = session.stopReason.load(std::memory_order_acquire);
  const auto reportedStopReason = streamErrorCode != AAUDIO_OK
      ? StopReason::kStreamError : storedStopReason;
  auto wall = valuesFor(session, count, &CallbackRecord::wallNs);
  auto cpu = valuesFor(session, count, &CallbackRecord::threadCpuNs);
  auto interArrival = valuesFor(session, count,
                                &CallbackRecord::interArrivalNs);
  auto budget = valuesFor(session, count,
                          &CallbackRecord::callbackBudgetNs);
  const auto wallP50 = percentile(wall, 50, 100);
  const auto wallP95 = percentile(wall, 95, 100);
  const auto wallP99 = percentile(wall, 99, 100);
  const auto cpuP50 = percentile(cpu, 50, 100);
  const auto cpuP95 = percentile(cpu, 95, 100);
  const auto cpuP99 = percentile(cpu, 99, 100);
  const auto interP50 = percentile(interArrival, 50, 100);
  const auto interP95 = percentile(interArrival, 95, 100);
  const auto interP99 = percentile(interArrival, 99, 100);
  const auto maxWall = wall.empty() ? 0 : *std::max_element(wall.begin(), wall.end());
  const auto maxCpu = cpu.empty() ? 0 : *std::max_element(cpu.begin(), cpu.end());
  const auto maxInter = interArrival.empty() ? 0 :
      *std::max_element(interArrival.begin(), interArrival.end());
  const auto maxBudget = budget.empty() ? 0 :
      *std::max_element(budget.begin(), budget.end());
  const auto xrunDelta = session.xrunStartCount >= 0 &&
      session.xrunFinalCount >= session.xrunStartCount
      ? session.xrunFinalCount - session.xrunStartCount : -1;
  const auto cpuPercent = elapsedNs == 0 ? 0.0 :
      (static_cast<double>(session.totalThreadCpuNs) * 100.0 /
       static_cast<double>(elapsedNs));
  std::ostringstream json;
  json << "{\"status\":\"" << status << "\",\"reason\":\""
       << reason << "\",\"workload\":\"ZERO_ONLY\""
       << ",\"requested_duration_ms\":" << kMaximumDurationMs
       << ",\"duration_complete\":" << (durationComplete ? "true" : "false")
       << ",\"run_completion\":\"" << (durationComplete ? "COMPLETE" : status)
       << "\",\"run_wall_ns\":" << elapsedNs
       << ",\"requested_sample_rate\":0"
       << ",\"requested_sample_rate_policy\":\"SYSTEM_NATIVE_UNSPECIFIED\""
       << ",\"actual_sample_rate\":" << session.sampleRate
       << ",\"requested_channel_count\":2,\"actual_channel_count\":"
       << session.channelCount << ",\"requested_format\":\"PCM_FLOAT\""
       << ",\"requested_sharing_mode\":\"SHARED\",\"actual_sharing_mode\":\""
       << sharingModeName(session.sharingMode) << "\""
       << ",\"requested_performance_mode\":\"LOW_LATENCY\""
       << ",\"actual_performance_mode\":\""
       << performanceModeName(session.performanceMode) << "\""
       << ",\"requested_usage\":\"MEDIA\""
       << ",\"requested_output_device_id\":" << session.expectedOutputDeviceId
       << ",\"requested_output_device_type\":\"TYPE_BUILTIN_SPEAKER\""
       << ",\"actual_output_device_id\":" << session.actualDeviceId
       << ",\"actual_output_device_type\":\""
       << (session.actualDeviceId == session.expectedOutputDeviceId
               ? "TYPE_BUILTIN_SPEAKER" : "NOT_VERIFIED") << "\""
       << ",\"requested_route\":\"BUILTIN_SPEAKER_ONLY\""
       << ",\"frames_per_burst\":" << session.framesPerBurst
       << ",\"buffer_size_frames\":" << session.bufferSizeFrames
       << ",\"buffer_capacity_frames\":" << session.bufferCapacityFrames
       << ",\"aaudio_open_result\":" << session.openResult
       << ",\"aaudio_start_result\":" << session.startResult
       << ",\"aaudio_stop_result\":" << session.stopResult
       << ",\"aaudio_close_result\":" << session.closeResult
       << ",\"aaudio_stream_error_code\":"
       << streamErrorCode
       << ",\"aaudio_error_callback_count\":"
       << session.errorCallbackCount.load(std::memory_order_acquire)
       << ",\"physical_audio_stream_started\":"
       << (session.streamStarted ? "true" : "false")
       << ",\"stream_stop_confirmed\":"
       << (session.streamStopConfirmed ? "true" : "false")
       << ",\"actual_callback_observed\":" << (invocations > 0 ? "true" : "false")
       << ",\"callback_count\":" << invocations
       << ",\"callback_records_count\":" << count
       << ",\"zero_samples_verified\":"
       << session.zeroSamplesVerified.load(std::memory_order_relaxed)
       << ",\"nonzero_output_samples_observed\":"
       << session.nonZeroSamplesObserved.load(std::memory_order_relaxed)
       << ",\"callback_overrun_count\":"
       << session.callbackOverruns.load(std::memory_order_relaxed)
       << ",\"callback_deadline_event\":{"
       << "\"frames\":" << session.firstOverrunFrames.load(std::memory_order_relaxed)
       << ",\"wall_ns\":" << session.firstOverrunWallNs.load(std::memory_order_relaxed)
       << ",\"budget_ns\":" << session.firstOverrunBudgetNs.load(std::memory_order_relaxed)
       << ",\"elapsed_ns\":" << session.firstOverrunElapsedNs.load(std::memory_order_relaxed)
       << "}"
       << ",\"callback_overlap_count\":"
       << session.callbackOverlapCount.load(std::memory_order_relaxed)
       << ",\"invalid_callback_count\":"
       << session.invalidCallbackCount.load(std::memory_order_relaxed)
       << ",\"callback_records_overflow\":"
       << session.recordOverflowCount.load(std::memory_order_relaxed)
       << ",\"callback_cpu_samples_available\":" << session.cpuAvailableSamples
       << ",\"callback_cpu_samples_unavailable\":"
       << session.cpuUnavailableCount.load(std::memory_order_relaxed)
       << ",\"dsp_benchmark_valid\":false"
       << ",\"native_session_invocations\":0"
       << ",\"dsp_to_audio_buffer_path\":false"
       << ",\"microphone_used\":false,\"bluetooth_api_used\":false"
       << ",\"audio_route_policy\":\"AAudio pinned to the selected Android built-in speaker device id; no fallback accepted\""
       << ",\"callback_allocation_claim\":\"source-audited only; runtime allocation instrumentation is not available\""
       << ",\"dsp_thread_cpu_percent\":0.0"
       << ",\"aaudio_xrun_counter_available\":"
       << (xrunDelta >= 0 ? "true" : "false")
       << ",\"aaudio_xrun_start_count\":" << session.xrunStartCount
       << ",\"aaudio_xrun_final_count\":" << session.xrunFinalCount
       << ",\"aaudio_xrun_delta\":" << xrunDelta
       << ",\"thread_cpu_percent\":" << cpuPercent
       << ",\"callback_wall_ns\":{\"p50\":" << wallP50
       << ",\"p95\":" << wallP95 << ",\"p99\":" << wallP99
       << ",\"max\":" << maxWall << "}"
       << ",\"callback_thread_cpu_ns\":{\"p50\":" << cpuP50
       << ",\"p95\":" << cpuP95 << ",\"p99\":" << cpuP99
       << ",\"max\":" << maxCpu << "}"
       << ",\"callback_interarrival_ns\":{\"p50\":" << interP50
       << ",\"p95\":" << interP95 << ",\"p99\":" << interP99
       << ",\"max\":" << maxInter << "}"
       << ",\"callback_budget_ns_max\":" << maxBudget
       << ",\"frame_histogram\":{";
  bool first = true;
  for (std::size_t index = 1; index <= kMaximumHistogramFrames; ++index) {
    const auto frequency = session.frameHistogram[index].load(
        std::memory_order_relaxed);
    if (frequency == 0) continue;
    if (!first) json << ',';
    first = false;
    json << '"' << index << "\":" << frequency;
  }
  json << "},\"frame_histogram_overflow_callbacks\":"
       << session.histogramOverflowFrames.load(std::memory_order_relaxed)
       << ",\"xrun_observations\":[";
  for (std::uint64_t index = 0; index < session.xrunObservationCount; ++index) {
    if (index != 0) json << ',';
    const auto& observation = session.xrunObservations[index];
    json << "{\"elapsed_ns\":" << observation.elapsedNs
         << ",\"cumulative_count\":" << observation.cumulativeCount << '}';
  }
  json << "],\"stop_reason\":\"" << reasonName(reportedStopReason)
       << "\"} ";
  return json.str();
}

jstring javaString(JNIEnv* env, const std::string& value) {
  return env->NewStringUTF(value.c_str());
}

std::string notRun(const char* reason, std::int32_t expectedDeviceId) {
  std::ostringstream json;
  json << "{\"status\":\"NOT_RUN\",\"reason\":\"" << reason
       << "\",\"workload\":\"ZERO_ONLY\",\"requested_duration_ms\":"
       << kMaximumDurationMs << ",\"duration_complete\":false"
       << ",\"run_completion\":\"NOT_RUN\",\"actual_callback_observed\":false"
       << ",\"physical_audio_stream_started\":false"
       << ",\"requested_output_device_id\":" << expectedDeviceId
       << ",\"actual_output_device_id\":-1,\"nonzero_output_samples_observed\":0"
       << ",\"actual_output_device_type\":\"NOT_VERIFIED\""
       << ",\"dsp_benchmark_valid\":false,\"native_session_invocations\":0"
       << ",\"dsp_to_audio_buffer_path\":false,\"microphone_used\":false"
       << ",\"bluetooth_api_used\":false} ";
  return json.str();
}

std::string drainTimeoutReport(const Session& session, std::uint64_t elapsedNs) {
  std::ostringstream json;
  json << "{\"status\":\"STREAM_DRAIN_TIMEOUT\""
       << ",\"reason\":\"callback remained in flight after bounded stop, drain and close waits; session memory retained until process exit\""
       << ",\"workload\":\"ZERO_ONLY\",\"requested_duration_ms\":"
       << kMaximumDurationMs << ",\"duration_complete\":false"
       << ",\"run_completion\":\"STREAM_DRAIN_TIMEOUT\""
       << ",\"run_wall_ns\":" << elapsedNs
       << ",\"physical_audio_stream_started\":true"
       << ",\"stream_stop_confirmed\":false"
       << ",\"aaudio_close_result\":" << session.closeResult
       << ",\"aaudio_stream_error_code\":"
       << session.streamErrorCode.load(std::memory_order_acquire)
       << ",\"aaudio_error_callback_count\":"
       << session.errorCallbackCount.load(std::memory_order_acquire)
       << ",\"callback_count\":"
       << session.callbackInvocationCount.load(std::memory_order_acquire)
       << ",\"callback_records_count\":"
       << session.callbackCount.load(std::memory_order_acquire)
       << ",\"zero_samples_verified\":"
       << session.zeroSamplesVerified.load(std::memory_order_relaxed)
       << ",\"nonzero_output_samples_observed\":"
       << session.nonZeroSamplesObserved.load(std::memory_order_relaxed)
       << ",\"requested_output_device_id\":" << session.expectedOutputDeviceId
       << ",\"actual_output_device_id\":" << session.actualDeviceId
       << ",\"requested_output_device_type\":\"TYPE_BUILTIN_SPEAKER\""
       << ",\"dsp_benchmark_valid\":false,\"native_session_invocations\":0"
       << ",\"dsp_to_audio_buffer_path\":false,\"microphone_used\":false"
       << ",\"bluetooth_api_used\":false} ";
  return json.str();
}

std::string run(std::int32_t expectedDeviceId, std::uint64_t token) {
  if (expectedDeviceId <= 0 || token == 0) {
    return notRun("invalid built-in speaker id or run token", expectedDeviceId);
  }
  if (gDrainTimeoutFailStop.load(std::memory_order_acquire)) {
    return notRun("process fail-stop latched after a prior callback drain timeout", expectedDeviceId);
  }
  std::unique_ptr<Session> session(new (std::nothrow) Session(expectedDeviceId, token));
  if (!session || !session->records || !session->xrunObservations) {
    return notRun("preallocated callback metrics could not be allocated", expectedDeviceId);
  }
  {
    std::lock_guard<std::mutex> lock(gSessionMutex);
    if (gCurrentSession != nullptr) {
      return notRun("another physical zero-only run is already active", expectedDeviceId);
    }
    if (gStopRequestedToken.load(std::memory_order_acquire) == token) {
      return notRun("stop or foreground invalidation arrived before stream open", expectedDeviceId);
    }
    gCurrentSession = session.get();
  }

  AAudioStreamBuilder* builder = nullptr;
  session->openResult = AAudio_createStreamBuilder(&builder);
  if (session->openResult != AAUDIO_OK || builder == nullptr) {
    session->stopReason.store(StopReason::kStreamError, std::memory_order_release);
    std::lock_guard<std::mutex> lock(gSessionMutex);
    gCurrentSession = nullptr;
    return report(*session, "OPEN_FAILED", "AAudio stream builder unavailable", 0, false);
  }
  if (session->stopRequested.load(std::memory_order_acquire) ||
      gStopRequestedToken.load(std::memory_order_acquire) == token) {
    requestStop(*session, StopReason::kUser);
    AAudioStreamBuilder_delete(builder);
    {
      std::lock_guard<std::mutex> lock(gSessionMutex);
      if (gCurrentSession == session.get()) gCurrentSession = nullptr;
    }
    return report(*session, "STOPPED_BEFORE_OPEN",
        "visible Stop action or foreground invalidation arrived before AAudio open", 0, false);
  }
  AAudioStreamBuilder_setDirection(builder, AAUDIO_DIRECTION_OUTPUT);
  AAudioStreamBuilder_setDeviceId(builder, expectedDeviceId);
  AAudioStreamBuilder_setSampleRate(builder, AAUDIO_UNSPECIFIED);
  AAudioStreamBuilder_setChannelCount(builder, 2);
  AAudioStreamBuilder_setFormat(builder, AAUDIO_FORMAT_PCM_FLOAT);
  AAudioStreamBuilder_setUsage(builder, AAUDIO_USAGE_MEDIA);
  AAudioStreamBuilder_setSharingMode(builder, AAUDIO_SHARING_MODE_SHARED);
  AAudioStreamBuilder_setPerformanceMode(builder,
      AAUDIO_PERFORMANCE_MODE_LOW_LATENCY);
  AAudioStreamBuilder_setDataCallback(builder, &dataCallback, session.get());
  AAudioStreamBuilder_setErrorCallback(builder, &errorCallback, session.get());
  AAudioStream* stream = nullptr;
  session->openResult = AAudioStreamBuilder_openStream(builder, &stream);
  AAudioStreamBuilder_delete(builder);
  if (session->openResult != AAUDIO_OK || stream == nullptr) {
    requestStop(*session, StopReason::kStreamError);
    if (stream != nullptr) session->closeResult = AAudioStream_close(stream);
    std::lock_guard<std::mutex> lock(gSessionMutex);
    gCurrentSession = nullptr;
    return report(*session, "OPEN_FAILED", "AAudio output stream open failed", 0, false);
  }

  session->sampleRate = AAudioStream_getSampleRate(stream);
  session->channelCount = AAudioStream_getChannelCount(stream);
  session->framesPerBurst = AAudioStream_getFramesPerBurst(stream);
  session->bufferSizeFrames = AAudioStream_getBufferSizeInFrames(stream);
  session->bufferCapacityFrames = AAudioStream_getBufferCapacityInFrames(stream);
  session->actualDeviceId = AAudioStream_getDeviceId(stream);
  session->sharingMode = AAudioStream_getSharingMode(stream);
  session->performanceMode = AAudioStream_getPerformanceMode(stream);
  if (session->actualDeviceId != expectedDeviceId) {
    requestStop(*session, StopReason::kRouteMismatch);
    session->closeResult = AAudioStream_close(stream);
    std::lock_guard<std::mutex> lock(gSessionMutex);
    gCurrentSession = nullptr;
    return report(*session, "ROUTE_REFUSED",
        "negotiated AAudio device id did not match the selected built-in speaker", 0, false);
  }
  if (session->sampleRate <= 0 || session->channelCount != 2 ||
      AAudioStream_getFormat(stream) != AAUDIO_FORMAT_PCM_FLOAT) {
    requestStop(*session, StopReason::kInvalidCallback);
    session->closeResult = AAudioStream_close(stream);
    std::lock_guard<std::mutex> lock(gSessionMutex);
    gCurrentSession = nullptr;
    return report(*session, "FORMAT_REFUSED",
        "negotiated output format is not stereo PCM_FLOAT", 0, false);
  }
  if (gStopRequestedToken.load(std::memory_order_acquire) == token) {
    requestStop(*session, StopReason::kUser);
    session->closeResult = AAudioStream_close(stream);
    std::lock_guard<std::mutex> lock(gSessionMutex);
    gCurrentSession = nullptr;
    return report(*session, "STOPPED_BEFORE_START",
        "stop or foreground invalidation arrived before AAudio start", 0, false);
  }

  session->xrunStartCount = AAudioStream_getXRunCount(stream);
  const auto runStart = Clock::now();
  session->runStartNs.store(nowNs(runStart), std::memory_order_release);
  session->startResult = AAudioStream_requestStart(stream);
  if (session->startResult != AAUDIO_OK) {
    requestStop(*session, StopReason::kStreamError);
    session->closeResult = AAudioStream_close(stream);
    std::lock_guard<std::mutex> lock(gSessionMutex);
    gCurrentSession = nullptr;
    return report(*session, "START_FAILED", "AAudio stream start failed", 0, false);
  }
  session->streamStarted = true;
  const auto deadline = runStart + std::chrono::milliseconds(kMaximumDurationMs);
  auto previousXrunCount = session->xrunStartCount;
  while (Clock::now() < deadline &&
         !session->stopRequested.load(std::memory_order_acquire)) {
    if (gStopRequestedToken.load(std::memory_order_acquire) == token) {
      requestStop(*session, StopReason::kUser);
      break;
    }
    const auto currentXrunCount = AAudioStream_getXRunCount(stream);
    if (currentXrunCount >= 0 && previousXrunCount >= 0 &&
        currentXrunCount > previousXrunCount) {
      if (session->xrunObservationCount < kMaximumXrunObservations) {
        session->xrunObservations[session->xrunObservationCount++] = {
            nowNs(Clock::now()) - nowNs(runStart), currentXrunCount};
      }
      previousXrunCount = currentXrunCount;
      requestStop(*session, StopReason::kXrun);
      break;
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(5));
  }
  const auto callbacksEnd = Clock::now();
  const auto elapsedNs = nowNs(callbacksEnd) - nowNs(runStart);
  if (!session->stopRequested.load(std::memory_order_acquire)) {
    requestStop(*session, StopReason::kDuration);
  }

  session->stopResult = AAudioStream_requestStop(stream);
  const auto waitDeadline = Clock::now() + std::chrono::seconds(1);
  auto state = AAudioStream_getState(stream);
  while (state != AAUDIO_STREAM_STATE_STOPPED &&
         state != AAUDIO_STREAM_STATE_DISCONNECTED &&
         Clock::now() < waitDeadline) {
    aaudio_stream_state_t next = AAUDIO_STREAM_STATE_UNKNOWN;
    AAudioStream_waitForStateChange(stream, state, &next, 100'000'000LL);
    state = next;
  }
  const bool terminalState = state == AAUDIO_STREAM_STATE_STOPPED ||
      state == AAUDIO_STREAM_STATE_DISCONNECTED;
  const auto drainDeadline = Clock::now() + std::chrono::seconds(1);
  while (session->callbacksInFlight.load(std::memory_order_acquire) > 0 &&
         Clock::now() < drainDeadline) std::this_thread::yield();
  session->streamStopConfirmed = terminalState &&
      session->callbacksInFlight.load(std::memory_order_acquire) == 0;
  session->xrunFinalCount = AAudioStream_getXRunCount(stream);
  if (session->xrunFinalCount >= 0 && previousXrunCount >= 0 &&
      session->xrunFinalCount > previousXrunCount &&
      session->xrunObservationCount < kMaximumXrunObservations) {
    session->xrunObservations[session->xrunObservationCount++] = {
        elapsedNs, session->xrunFinalCount};
    if (session->stopReason.load(std::memory_order_acquire) == StopReason::kNone) {
      requestStop(*session, StopReason::kXrun);
    }
  }
  session->closeResult = AAudioStream_close(stream);
  const auto finalDrainDeadline = Clock::now() + std::chrono::seconds(1);
  while (session->callbacksInFlight.load(std::memory_order_acquire) > 0 &&
         Clock::now() < finalDrainDeadline) {
    std::this_thread::yield();
  }
  if (session->callbacksInFlight.load(std::memory_order_acquire) > 0) {
    session->streamStopConfirmed = false;
    gDrainTimeoutFailStop.store(true, std::memory_order_release);
    {
      std::lock_guard<std::mutex> lock(gSessionMutex);
      if (gCurrentSession == session.get()) gCurrentSession = nullptr;
    }
    auto* retainedSession = session.release();
    return drainTimeoutReport(*retainedSession, elapsedNs);
  }

  auto reason = session->stopReason.load(std::memory_order_acquire);
  const auto streamErrorCode = session->streamErrorCode.load(std::memory_order_acquire);
  const auto callbacks = session->callbackCount.load(std::memory_order_acquire);
  bool durationComplete = reason == StopReason::kDuration && callbacks > 0 &&
      streamErrorCode == AAUDIO_OK &&
      elapsedNs >= static_cast<std::uint64_t>(kMaximumDurationMs) * 990'000ULL;
  const char* status = "FAIL_STOP";
  const char* reasonText = reasonName(reason);
  if (!session->streamStopConfirmed) {
    status = "STREAM_STOP_TIMEOUT";
    reasonText = "AAudio did not reach a drained terminal state within one second";
  } else if (session->closeResult != AAUDIO_OK) {
    status = "STREAM_CLOSE_ERROR";
    reasonText = "AAudioStream_close returned an error";
  } else if (streamErrorCode != AAUDIO_OK) {
    status = "STREAM_ERROR";
    reasonText = "AAudio error callback reported a stream failure";
  } else if (reason == StopReason::kStreamError) {
    status = "STREAM_ERROR";
    reasonText = "AAudio error callback or stream setup requested fail-stop";
  } else if (reason == StopReason::kUser) {
    status = "STOPPED_BY_USER";
    reasonText = "visible Stop action or foreground invalidation requested stop";
  } else if (session->callbackInvocationCount.load(std::memory_order_acquire) == 0 &&
             reason == StopReason::kDuration) {
    status = "NOT_RUN";
    reasonText = "AAudio stream completed without an observed data callback";
  } else if (durationComplete) {
    status = "PASS";
    reasonText = "60-second zero-only callback completed and stream teardown was confirmed";
  }
  {
    std::lock_guard<std::mutex> lock(gSessionMutex);
    if (gCurrentSession == session.get()) gCurrentSession = nullptr;
  }
  return report(*session, status, reasonText, elapsedNs, durationComplete);
}
}  // namespace

extern "C" JNIEXPORT jstring JNICALL
Java_org_hearlens_physicalzero_NativeBridge_nativeRunBuiltInSpeaker(
    JNIEnv* env, jobject, jint deviceId, jlong runToken) {
  if (runToken <= 0) return javaString(env, notRun("invalid run token", deviceId));
  return javaString(env, run(deviceId, static_cast<std::uint64_t>(runToken)));
}

extern "C" JNIEXPORT void JNICALL
Java_org_hearlens_physicalzero_NativeBridge_nativeRequestStop(
    JNIEnv*, jobject, jlong runToken) {
  if (runToken <= 0) return;
  const auto token = static_cast<std::uint64_t>(runToken);
  gStopRequestedToken.store(token, std::memory_order_release);
  std::lock_guard<std::mutex> lock(gSessionMutex);
  if (gCurrentSession != nullptr && gCurrentSession->token == token) {
    requestStop(*gCurrentSession, StopReason::kUser);
  }
}
