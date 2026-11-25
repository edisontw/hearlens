#include "callback_core.hpp"

#include <atomic>
#include <chrono>
#include <cstddef>
#include <cstdlib>
#include <iostream>
#include <limits>
#include <new>
#include <thread>
#include <vector>

namespace {
thread_local bool trackAllocations = false;
thread_local std::size_t callbackAllocations = 0;

void* trackedAllocate(std::size_t size) {
  if (trackAllocations) ++callbackAllocations;
  if (void* memory = std::malloc(size == 0 ? 1 : size)) return memory;
  throw std::bad_alloc();
}

using namespace hearlens::research;
using namespace hearlens::research::aaudio_lab;
using Clock = CallbackCore::Clock;

const BandBasis basis{};
const std::array<BandTargets, 2> targets{};

auto fixture(float sample = 0.02F) -> std::vector<float> {
  return std::vector<float>(8192, sample);
}

auto fixedClock() noexcept -> Clock::time_point {
  return Clock::time_point{};
}

auto expiredClock() noexcept -> Clock::time_point {
  return Clock::time_point{} + std::chrono::seconds(1);
}

bool isZero(const std::vector<float>& output) {
  for (const float sample : output) {
    if (sample != 0.0F) return false;
  }
  return true;
}

bool variableFrameCountsStayZeroAndAllocationFree() {
  CallbackCore core(basis, targets, fixture());
  if (!core.start()) return false;
  for (const auto frames : {64, 128, 192, 256, 480}) {
    std::vector<float> output(static_cast<std::size_t>(frames) * 2, 0.75F);
    callbackAllocations = 0;
    trackAllocations = true;
    const auto result = core.processOutput(output.data(), frames, 48'000,
                                           Clock::time_point{}, &fixedClock);
    trackAllocations = false;
    if (result != CallbackDisposition::kContinue || !isZero(output) ||
        callbackAllocations != 0) return false;
  }
  return core.callbackCount() == 5 && core.failStopCount() == 0;
}

bool partialCallbackUsesNegotiatedBurstDeadlineQuantum() {
  CallbackCore core(basis, targets, fixture());
  if (!core.start()) return false;
  std::vector<float> output(12, 0.5F);
  const auto result = core.processOutput(output.data(), 6, 48'000,
                                         Clock::time_point{}, &fixedClock, 960);
  return result == CallbackDisposition::kContinue && isZero(output) &&
      core.callbackCount() == 1 && core.failStopCount() == 0;
}

bool nonFiniteInputsFailStopAndRemainSilent() {
  for (const float invalid : {std::numeric_limits<float>::quiet_NaN(),
                              std::numeric_limits<float>::infinity()}) {
    auto input = fixture();
    input[26] = invalid;
    CallbackCore core(basis, targets, std::move(input));
    if (!core.start()) return false;
    std::vector<float> output(256, 0.4F);
    const auto result = core.processOutput(output.data(), 128, 48'000,
                                           Clock::time_point{}, &fixedClock);
    if (result != CallbackDisposition::kRejected || !isZero(output) ||
        core.isActive() || core.failStopCount() != 1) return false;
  }
  return true;
}

bool deadlineOverrunFailsStopAndRemainsSilent() {
  CallbackCore core(basis, targets, fixture());
  if (!core.start()) return false;
  std::vector<float> output(512, 0.8F);
  const auto result = core.processOutput(output.data(), 256, 48'000,
                                         Clock::time_point{}, &expiredClock);
  return result == CallbackDisposition::kRejected && isZero(output) &&
      !core.isActive() && core.failStopCount() == 1;
}

struct OverlapGate {
  std::atomic<bool> entered{false};
  std::atomic<bool> release{false};
};

void waitAtGate(void* opaque) noexcept {
  auto& gate = *static_cast<OverlapGate*>(opaque);
  gate.entered.store(true, std::memory_order_release);
  while (!gate.release.load(std::memory_order_acquire)) std::this_thread::yield();
}

bool overlappingCallbacksFailClosed() {
  OverlapGate gate;
  CallbackCore core(basis, targets, fixture(), &waitAtGate, &gate);
  if (!core.start()) return false;
  std::vector<float> firstOutput(256, 0.5F);
  std::vector<float> secondOutput(256, 0.5F);
  CallbackDisposition firstResult = CallbackDisposition::kContinue;
  std::thread first([&] {
    firstResult = core.processOutput(firstOutput.data(), 128, 48'000,
                                     Clock::time_point{}, &fixedClock);
  });
  while (!gate.entered.load(std::memory_order_acquire)) std::this_thread::yield();
  const auto secondResult = core.processOutput(secondOutput.data(), 128, 48'000,
                                                Clock::time_point{}, &fixedClock);
  gate.release.store(true, std::memory_order_release);
  first.join();
  return secondResult == CallbackDisposition::kOverlap &&
      firstResult != CallbackDisposition::kContinue && isZero(firstOutput) &&
      isZero(secondOutput) && core.overlapCount() == 1 && !core.isActive();
}

bool staleDisconnectCannotInvalidateRestartedGeneration() {
  CallbackCore core(basis, targets, fixture());
  if (!core.start()) return false;
  const auto retiredTicket = core.currentTicket();
  core.stop();
  if (!core.start()) return false;
  core.invalidateAsyncFailure(retiredTicket);
  if (!core.isActive()) return false;
  std::vector<float> output(128, 0.5F);
  const auto result = core.processOutput(output.data(), 64, 48'000,
                                         Clock::time_point{}, &fixedClock);
  return result == CallbackDisposition::kContinue && isZero(output);
}

bool stopRestartDisconnectAndBackgroundInvalidation() {
  CallbackCore core(basis, targets, fixture());
  if (!core.start()) return false;
  std::vector<float> output(256, 0.6F);
  auto result = core.processOutput(output.data(), 128, 48'000,
                                   Clock::time_point{}, &fixedClock);
  if (result != CallbackDisposition::kContinue || !isZero(output)) return false;
  core.stop();
  std::fill(output.begin(), output.end(), 0.6F);
  result = core.processOutput(output.data(), 128, 48'000,
                             Clock::time_point{}, &fixedClock);
  if (result != CallbackDisposition::kStopped || !isZero(output) || !core.start()) {
    return false;
  }
  core.invalidateBackground();
  std::fill(output.begin(), output.end(), 0.6F);
  result = core.processOutput(output.data(), 128, 48'000,
                             Clock::time_point{}, &fixedClock);
  if (result != CallbackDisposition::kStopped || !isZero(output) || !core.start()) {
    return false;
  }
  core.invalidateStreamDisconnect();
  std::fill(output.begin(), output.end(), 0.6F);
  result = core.processOutput(output.data(), 128, 48'000,
                             Clock::time_point{}, &fixedClock);
  const bool stoppedWithoutAutoResume = result == CallbackDisposition::kStopped &&
      isZero(output) && !core.isActive();
  return stoppedWithoutAutoResume && core.start();
}

bool oversizedCallbackIsZeroedBeforeFailStop() {
  CallbackCore core(basis, targets, fixture());
  if (!core.start()) return false;
  const auto frames = static_cast<std::int32_t>(kMaximumCallbackFrames + 1);
  std::vector<float> output(static_cast<std::size_t>(frames) * 2, 0.9F);
  const auto result = core.processOutput(output.data(), frames, 48'000,
                                         Clock::time_point{}, &fixedClock);
  return result == CallbackDisposition::kRejected && isZero(output) &&
      !core.isActive();
}
}  // namespace

void* operator new(std::size_t size) { return trackedAllocate(size); }
void* operator new[](std::size_t size) { return trackedAllocate(size); }
void operator delete(void* memory) noexcept { std::free(memory); }
void operator delete[](void* memory) noexcept { std::free(memory); }
void operator delete(void* memory, std::size_t) noexcept { std::free(memory); }
void operator delete[](void* memory, std::size_t) noexcept { std::free(memory); }

int main() {
  const bool checks[] = {
      variableFrameCountsStayZeroAndAllocationFree(),
      partialCallbackUsesNegotiatedBurstDeadlineQuantum(),
      nonFiniteInputsFailStopAndRemainSilent(),
      deadlineOverrunFailsStopAndRemainsSilent(),
      overlappingCallbacksFailClosed(),
      staleDisconnectCannotInvalidateRestartedGeneration(),
      stopRestartDisconnectAndBackgroundInvalidation(),
      oversizedCallbackIsZeroedBeforeFailStop(),
  };
  for (const bool check : checks) {
    if (!check) {
      std::cerr << "Android AAudio callback core fault matrix FAIL\n";
      return 1;
    }
  }
  std::cout << "Android AAudio callback core: variable frames, zero-only output, "
               "allocation probe, NaN/Inf, deadline, overlap, stale generation, "
               "stop/restart, disconnect, background invalidation and negotiated "
               "burst deadline quantum PASS\n";
  return 0;
}
