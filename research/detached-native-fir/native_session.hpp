#pragma once

#include "auto_fir_core.hpp"

#include <atomic>
#include <chrono>

namespace hearlens::research {

// An offline, metadata-only consumer of the existing synthetic route policy.
// A route stamp represents a fresh accepted observation, bound to the route
// generation and profile. Zero represents unknown or rejected by that policy.
class NativeSession {
 public:
  using Clock = std::chrono::steady_clock;
  using ReadClock = Clock::time_point (*)() noexcept;

  class Ticket {
   public:
    Ticket() = default;

   private:
    friend class NativeSession;
    Ticket(const NativeSession* owner, std::uint64_t generation,
           std::uint64_t routeStamp) noexcept
        : owner_(owner), generation_(generation), routeStamp_(routeStamp) {}
    const NativeSession* owner_ = nullptr;
    std::uint64_t generation_ = 0;
    std::uint64_t routeStamp_ = 0;
  };

  struct Candidate {
    Ticket ticket;
    std::size_t frames = 0;
  };

  NativeSession(const BandBasis& basis, const std::array<BandTargets, 2>& targets,
                double limiterCeiling = 0.3) noexcept
      : dsp_(basis, targets, 15.0, 400.0, 480, 12.0, limiterCeiling),
        configValid_(dsp_.configValid()) {}

  std::uint64_t generation() const noexcept { return state_.load(); }

  Ticket authorizeSynthetic(std::uint64_t expectedGeneration,
                            std::uint64_t acceptedRouteStamp,
                            bool explicitStart) noexcept {
    if (!configValid_ || !explicitStart || acceptedRouteStamp == 0 ||
        (expectedGeneration & 1) || expectedGeneration == kRetired) {
      return {};
    }
    const auto armed = expectedGeneration + 1;
    if (!state_.compare_exchange_strong(expectedGeneration, armed)) return {};
    return Ticket(this, armed, acceptedRouteStamp);
  }

  // Control plane uses this for stop, reset, and settings changes. Settings
  // are immutable here; new DSP parameters require a new, drained instance.
  void invalidate() noexcept {
    auto state = state_.load();
    while (!state_.compare_exchange_weak(state, nextMuted(state))) {}
  }

  // Route loss/change, interruption, or upstream queue overflow for this
  // ticket. Delayed faults from a previous stream cannot revoke a newer one.
  void invalidate(const Ticket& ticket) noexcept {
    if (ticket.owner_ != this) return;
    auto state = ticket.generation_;
    state_.compare_exchange_strong(state, nextMuted(state));
  }

  bool isCurrent(const Candidate& candidate) const noexcept {
    return candidate.frames != 0 && isArmed(candidate.ticket);
  }

  bool isCurrent(const Ticket& ticket) const noexcept {
    return isArmed(ticket);
  }

  // Read only after a callback returns or the caller has drained all callbacks.
  // Both ears share the same control cadence and are advanced as one stereo block.
  std::uint64_t controlUpdateCount() const noexcept {
    return dsp_.left().updates();
  }

  Candidate process(const Ticket& ticket, std::uint64_t observedRouteStamp,
                    const float* interleaved, std::size_t sampleCount,
                    Clock::time_point deadline,
                    ReadClock now = &Clock::now) noexcept {
    if (!isArmed(ticket)) return {};
    if (busy_.test_and_set(std::memory_order_acquire)) {
      invalidate(ticket);
      return {};
    }
    const CallbackLease lease{busy_};
    if (!isArmed(ticket)) return {};

    if (observedRouteStamp != ticket.routeStamp_ || !interleaved ||
        sampleCount == 0 || sampleCount % 2 != 0 ||
        sampleCount > scratch_.size() || !now || now() >= deadline) {
      invalidate(ticket);
      return {};
    }
    if (processedGeneration_ != ticket.generation_) {
      dsp_.reset();
      processedGeneration_ = ticket.generation_;
    }

    const auto frames = sampleCount / 2;
    const bool processed = dsp_.processInto(interleaved, scratch_.data(), frames);
    const bool finite = std::all_of(scratch_.begin(), scratch_.begin() + sampleCount,
                                    [](float sample) { return std::isfinite(sample); });
    std::fill_n(scratch_.begin(), sampleCount, 0.0F);
    if (!processed || !finite || now() >= deadline) {
      invalidate(ticket);
      return {};
    }
    // Commit only after both ears, scratch cleanup and deadline validation.
    // Any later consumer of this metadata must recheck the ticket.
    if (!isArmed(ticket)) return {};
    return {ticket, frames};
  }

 private:
  static constexpr auto kRetired = std::numeric_limits<std::uint64_t>::max() - 1;
  static_assert(std::atomic<std::uint64_t>::is_always_lock_free);

  static std::uint64_t nextMuted(std::uint64_t state) noexcept {
    return state == kRetired ? state : (state | 1) + 1;
  }

  bool isArmed(const Ticket& ticket) const noexcept {
    return ticket.owner_ == this && state_.load() == ticket.generation_;
  }

  struct CallbackLease {
    std::atomic_flag& busy;
    ~CallbackLease() { busy.clear(std::memory_order_release); }
  };

  std::atomic<std::uint64_t> state_{0};
  std::atomic_flag busy_ = ATOMIC_FLAG_INIT;
  StereoAutoFirResearch dsp_;
  const bool configValid_;
  std::array<float, kMaximumCallbackFrames * 2> scratch_{};
  std::uint64_t processedGeneration_ = 0;
};

}  // namespace hearlens::research
