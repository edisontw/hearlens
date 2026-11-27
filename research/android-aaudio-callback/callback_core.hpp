#pragma once

#include "../detached-native-fir/native_session.hpp"

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <utility>
#include <vector>

namespace hearlens::research::aaudio_lab {

enum class CallbackDisposition {
  kContinue,
  kStopped,
  kRejected,
  kOverlap,
};

class CallbackCore {
 public:
  using Clock = NativeSession::Clock;
  using ReadClock = NativeSession::ReadClock;
  using Hook = void (*)(void*) noexcept;
  static constexpr std::uint64_t kSyntheticRouteStamp = 1;

  CallbackCore(const BandBasis& basis,
               const std::array<BandTargets, 2>& targets,
               std::vector<float> fixturePcm, Hook afterEnter = nullptr,
               void* hookContext = nullptr) noexcept
      : session_(basis, targets), fixturePcm_(std::move(fixturePcm)),
        afterEnter_(afterEnter), hookContext_(hookContext) {}

  CallbackCore(const CallbackCore&) = delete;
  auto operator=(const CallbackCore&) -> CallbackCore& = delete;

  bool start() noexcept {
    if (active_.load(std::memory_order_acquire) || fixturePcm_.empty() ||
        fixturePcm_.size() % 2 != 0) {
      return false;
    }
    const auto expected = session_.generation();
    ticket_ = session_.authorizeSynthetic(
        expected, kSyntheticRouteStamp, true);
    const bool authorized = session_.isCurrent(ticket_);
    active_.store(authorized, std::memory_order_release);
    return authorized;
  }

  void stop() noexcept {
    active_.store(false, std::memory_order_release);
    session_.invalidate(ticket_);
  }

  void invalidateBackground() noexcept { stop(); }

  void invalidateStreamDisconnect() noexcept {
    const auto failedTicket = ticket_;
    invalidateAsyncFailure(failedTicket);
  }

  // Error notifications are scoped to the generation that opened the stream.
  // A late notification from a retired stream cannot revoke a newer session.
  void invalidateAsyncFailure(const NativeSession::Ticket& failedTicket) noexcept {
    const bool wasCurrent = session_.isCurrent(failedTicket);
    session_.invalidate(failedTicket);
    if (wasCurrent) active_.store(false, std::memory_order_release);
  }

  auto currentTicket() const noexcept -> NativeSession::Ticket {
    return ticket_;
  }

  CallbackDisposition processOutput(
      float* outputBuffer, std::int32_t frames, std::int32_t sampleRate,
      Clock::time_point callbackStart = Clock::now(),
      ReadClock now = &Clock::now,
      std::int32_t deadlineFrameBudget = 0,
      bool executeNativeSession = true) noexcept {
    lastDspProcessingNs_.store(0, std::memory_order_relaxed);
    // Output is zeroed before validation or DSP work. The pointer is never
    // passed to NativeSession, and DSP scratch is never copied to this buffer.
    if (outputBuffer != nullptr && frames > 0) {
      std::fill_n(outputBuffer,
                  static_cast<std::size_t>(frames) * kChannels, 0.0F);
    }

    if (outputBuffer == nullptr || frames <= 0 || sampleRate <= 0) {
      failStops_.fetch_add(1, std::memory_order_relaxed);
      invalidateStreamDisconnect();
      return CallbackDisposition::kRejected;
    }
    if (busy_.test_and_set(std::memory_order_acquire)) {
      overlaps_.fetch_add(1, std::memory_order_relaxed);
      invalidateAsyncFailure(ticket_);
      return CallbackDisposition::kOverlap;
    }
    const Lease lease{busy_};

    if (!active_.load(std::memory_order_acquire) ||
        !session_.isCurrent(ticket_)) {
      return CallbackDisposition::kStopped;
    }
    if (static_cast<std::size_t>(frames) > kMaximumCallbackFrames) {
      failStops_.fetch_add(1, std::memory_order_relaxed);
      invalidateAsyncFailure(ticket_);
      return CallbackDisposition::kRejected;
    }
    if (afterEnter_ != nullptr) afterEnter_(hookContext_);

    if (!executeNativeSession) {
      callbackCount_.fetch_add(1, std::memory_order_relaxed);
      return CallbackDisposition::kContinue;
    }

    const auto fixtureFrames = fixturePcm_.size() / kChannels;
    for (std::int32_t frame = 0; frame < frames; ++frame) {
      const auto sourceFrame = (fixtureCursor_ + static_cast<std::size_t>(frame)) %
          fixtureFrames;
      inputScratch_[static_cast<std::size_t>(frame) * kChannels] =
          fixturePcm_[sourceFrame * kChannels];
      inputScratch_[static_cast<std::size_t>(frame) * kChannels + 1] =
          fixturePcm_[sourceFrame * kChannels + 1];
    }
    fixtureCursor_ = (fixtureCursor_ + static_cast<std::size_t>(frames)) %
        fixtureFrames;

    const auto budgetFrames = std::max(
        frames, deadlineFrameBudget > 0 ? deadlineFrameBudget : frames);
    const auto budget = std::chrono::duration_cast<Clock::duration>(
        std::chrono::duration<double>(
            static_cast<double>(budgetFrames) / static_cast<double>(sampleRate)));
    const auto deadline = callbackStart + budget;
    const auto dspStart = Clock::now();
    const auto candidate = session_.process(
        ticket_, kSyntheticRouteStamp, inputScratch_.data(),
        static_cast<std::size_t>(frames) * kChannels, deadline, now);
    const auto dspEnd = Clock::now();
    if (dspEnd >= dspStart) {
      lastDspProcessingNs_.store(static_cast<std::uint64_t>(
          std::chrono::duration_cast<std::chrono::nanoseconds>(
              dspEnd - dspStart).count()), std::memory_order_relaxed);
    }
    nativeSessionInvocations_.fetch_add(1, std::memory_order_relaxed);
    nativeControlUpdates_.store(session_.controlUpdateCount(),
                                std::memory_order_relaxed);
    if (!session_.isCurrent(candidate)) {
      if (now != nullptr && now() >= deadline) {
        dspDeadlineFailures_.fetch_add(1, std::memory_order_relaxed);
      }
      nativeSessionFailStops_.fetch_add(1, std::memory_order_relaxed);
      failStops_.fetch_add(1, std::memory_order_relaxed);
      active_.store(false, std::memory_order_release);
      return CallbackDisposition::kRejected;
    }
    callbackCount_.fetch_add(1, std::memory_order_relaxed);
    return CallbackDisposition::kContinue;
  }

  auto callbackCount() const noexcept -> std::uint64_t {
    return callbackCount_.load(std::memory_order_relaxed);
  }
  auto nativeSessionInvocations() const noexcept -> std::uint64_t {
    return nativeSessionInvocations_.load(std::memory_order_relaxed);
  }
  auto nativeControlUpdates() const noexcept -> std::uint64_t {
    return nativeControlUpdates_.load(std::memory_order_relaxed);
  }
  auto lastDspProcessingNs() const noexcept -> std::uint64_t {
    return lastDspProcessingNs_.load(std::memory_order_relaxed);
  }
  auto dspDeadlineFailureCount() const noexcept -> std::uint64_t {
    return dspDeadlineFailures_.load(std::memory_order_relaxed);
  }
  auto nativeSessionFailStopCount() const noexcept -> std::uint64_t {
    return nativeSessionFailStops_.load(std::memory_order_relaxed);
  }
  auto failStopCount() const noexcept -> std::uint64_t {
    return failStops_.load(std::memory_order_relaxed);
  }
  auto overlapCount() const noexcept -> std::uint64_t {
    return overlaps_.load(std::memory_order_relaxed);
  }
  bool isActive() const noexcept {
    return active_.load(std::memory_order_acquire);
  }

 private:
  static constexpr std::size_t kChannels = 2;
  static_assert(std::atomic<std::uint64_t>::is_always_lock_free);

  struct Lease {
    std::atomic_flag& flag;
    ~Lease() { flag.clear(std::memory_order_release); }
  };

  NativeSession session_;
  std::vector<float> fixturePcm_;
  std::array<float, kMaximumCallbackFrames * kChannels> inputScratch_{};
  NativeSession::Ticket ticket_{};
  Hook afterEnter_ = nullptr;
  void* hookContext_ = nullptr;
  std::size_t fixtureCursor_ = 0;
  std::atomic_flag busy_ = ATOMIC_FLAG_INIT;
  std::atomic<bool> active_{false};
  std::atomic<std::uint64_t> callbackCount_{0};
  std::atomic<std::uint64_t> nativeSessionInvocations_{0};
  std::atomic<std::uint64_t> nativeControlUpdates_{0};
  std::atomic<std::uint64_t> lastDspProcessingNs_{0};
  std::atomic<std::uint64_t> dspDeadlineFailures_{0};
  std::atomic<std::uint64_t> nativeSessionFailStops_{0};
  std::atomic<std::uint64_t> failStops_{0};
  std::atomic<std::uint64_t> overlaps_{0};
};

}  // namespace hearlens::research::aaudio_lab
