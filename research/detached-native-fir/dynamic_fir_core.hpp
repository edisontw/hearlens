#pragma once

#include "fir_core.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>

namespace hearlens::research {

inline constexpr std::size_t kBandCount = 6;
inline constexpr std::size_t kGainAnchorCount = 3;
inline constexpr std::size_t kMaximumCallbackFrames = 4096;
inline constexpr double kLimiterHeadroom = 1.0e-7;
inline constexpr double kPi = 3.141592653589793238462643383279502884;

using BandBasis = std::array<Coefficients, kBandCount>;
using GainAnchors = std::array<double, kGainAnchorCount>;  // 50, 65 and 80.
using BandTargets = std::array<GainAnchors, kBandCount>;
using BandLevels = std::array<double, kBandCount>;

// Native offline-only dynamic FIR. The immutable basis is caller-owned and
// must outlive this instance. Each instance owns an independent FIR history,
// transition and fault state. It contains no audio-device or output API.
class DynamicFir {
 public:
  DynamicFir(const BandBasis& basis, const BandTargets& targets,
             double maxGainDb = 12.0, double limiterCeiling = 0.3,
             std::size_t transitionSamples = 2400) noexcept
      : basis_(&basis), targets_(targets), maxGainDb_(maxGainDb),
        limiterCeiling_(limiterCeiling), transitionSamples_(transitionSamples) {
    configValid_ = validateConfig();
    faulted_ = !configValid_;
  }

  bool setSyntheticBandLevels(const BandLevels& levels) noexcept {
    if (!configValid_ || faulted_) return false;

    std::array<double, kBandCount> amplitudes{};
    for (std::size_t band = 0; band < kBandCount; ++band) {
      const double level = levels[band];
      if (!std::isfinite(level) || level < 50.0 || level > 80.0) {
        faulted_ = true;
        return false;
      }

      const std::size_t lowerAnchor = level <= 65.0 ? 0 : 1;
      const std::size_t upperAnchor = lowerAnchor + 1;
      const double lowerLevel = lowerAnchor == 0 ? 50.0 : 65.0;
      const double requested = targets_[band][lowerAnchor] +
          (level - lowerLevel) / 15.0 *
              (targets_[band][upperAnchor] - targets_[band][lowerAnchor]);
      amplitudes[band] = std::pow(10.0, std::min(requested, maxGainDb_) / 20.0);
      if (!std::isfinite(amplitudes[band])) {
        faulted_ = true;
        return false;
      }
    }

    Coefficients nextTarget{};
    for (std::size_t tap = 0; tap < kUniqueTapCount; ++tap) {
      for (std::size_t band = 0; band < kBandCount; ++band) {
        nextTarget[tap] += (*basis_)[band][tap] * amplitudes[band];
      }
      if (!std::isfinite(nextTarget[tap])) {
        faulted_ = true;
        return false;
      }
    }

    const double weight = ready_ ? progress() : 1.0;
    if (ready_) {
      for (std::size_t tap = 0; tap < kUniqueTapCount; ++tap) {
        from_[tap] += (to_[tap] - from_[tap]) * weight;
      }
    }
    to_ = nextTarget;
    if (!ready_) from_ = nextTarget;

    ready_ = true;
    fadeSamples_ = updates_ == 0 ? transitionSamples_ : 0;
    ++updates_;
    return true;
  }

  bool processInto(const float* input, float* output,
                   std::size_t frames) noexcept {
    if (faulted_) return false;
    if (!ready_) return false;
    if (input == nullptr || output == nullptr || frames == 0 ||
        frames > kMaximumCallbackFrames) {
      faulted_ = true;
      return false;
    }
    const std::uintptr_t inputStart = reinterpret_cast<std::uintptr_t>(input);
    const std::uintptr_t outputStart = reinterpret_cast<std::uintptr_t>(output);
    const std::uintptr_t bufferBytes = frames * sizeof(float);
    const bool buffersOverlap = inputStart < outputStart + bufferBytes &&
        outputStart < inputStart + bufferBytes;
    if (buffersOverlap) {
      faulted_ = true;
      return false;
    }

    // Validate the whole block before writing any output. A bad sample cannot
    // leave a partially processed callback in the caller's destination.
    for (std::size_t frame = 0; frame < frames; ++frame) {
      if (!std::isfinite(input[frame]) || input[frame] < -16.0F ||
          input[frame] > 16.0F) {
        faulted_ = true;
        return false;
      }
    }

    const double outputCeiling = limiterCeiling_ - kLimiterHeadroom;
    for (std::size_t frame = 0; frame < frames; ++frame) {
      const bool transitioning = fadeSamples_ < transitionSamples_;
      const double weight = progress();
      const double value = history_.stepDouble(input[frame],
          [this, transitioning, weight](std::size_t tap) noexcept {
            if (!transitioning) return to_[tap];
            return from_[tap] + (to_[tap] - from_[tap]) * weight;
          });
      if (!std::isfinite(value)) {
        std::fill(output, output + frames, 0.0F);
        faulted_ = true;
        return false;
      }

      if (std::abs(value) > limiterCeiling_) ++limitedSamples_;
      const double limited = std::max(-outputCeiling, std::min(outputCeiling, value));
      output[frame] = static_cast<float>(limited);
      maxAbsOutput_ = std::max(maxAbsOutput_, std::abs(static_cast<double>(output[frame])));
      if (fadeSamples_ < transitionSamples_) ++fadeSamples_;
    }
    acceptedSamples_ += frames;
    return true;
  }

  void reset() noexcept {
    history_.reset();
    from_.fill(0.0);
    to_.fill(0.0);
    ready_ = false;
    faulted_ = !configValid_;
    fadeSamples_ = transitionSamples_;
    acceptedSamples_ = 0;
    limitedSamples_ = 0;
    updates_ = 0;
    maxAbsOutput_ = 0.0;
  }

  bool ready() const noexcept { return ready_; }
  bool faulted() const noexcept { return faulted_; }
  bool configValid() const noexcept { return configValid_; }
  std::size_t transitionRemainingSamples() const noexcept {
    return transitionSamples_ > fadeSamples_ ? transitionSamples_ - fadeSamples_ : 0;
  }
  std::size_t acceptedSamples() const noexcept { return acceptedSamples_; }
  std::size_t limitedSamples() const noexcept { return limitedSamples_; }
  std::size_t updates() const noexcept { return updates_; }
  double maxAbsOutput() const noexcept { return maxAbsOutput_; }

 private:
  bool validateConfig() const noexcept {
    if (!std::isfinite(maxGainDb_) || maxGainDb_ < 0.0 || maxGainDb_ > 12.0 ||
        !std::isfinite(limiterCeiling_) || limiterCeiling_ < 0.05 ||
        limiterCeiling_ > 0.8 || transitionSamples_ < 480 ||
        transitionSamples_ > 9600) {
      return false;
    }
    for (const auto& band : *basis_) {
      for (const double coefficient : band) {
        if (!std::isfinite(coefficient)) return false;
      }
    }
    for (const auto& anchors : targets_) {
      for (const double gain : anchors) {
        if (!std::isfinite(gain)) return false;
      }
    }
    return true;
  }

  double progress() const noexcept {
    if (fadeSamples_ >= transitionSamples_) return 1.0;
    const double t = static_cast<double>(fadeSamples_) /
        static_cast<double>(transitionSamples_);
    return 0.5 - 0.5 * std::cos(kPi * t);
  }

  const BandBasis* basis_;
  BandTargets targets_;
  double maxGainDb_;
  double limiterCeiling_;
  std::size_t transitionSamples_;
  Fir history_{};
  Coefficients from_{};
  Coefficients to_{};
  std::size_t fadeSamples_ = 0;
  std::size_t acceptedSamples_ = 0;
  std::size_t limitedSamples_ = 0;
  std::size_t updates_ = 0;
  double maxAbsOutput_ = 0.0;
  bool configValid_ = false;
  bool ready_ = false;
  bool faulted_ = false;
};

}  // namespace hearlens::research
