#pragma once

#include "dynamic_fir_core.hpp"
#include "six_band_level_core.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>

namespace hearlens::research {

inline constexpr std::size_t kMinimumControlInterval = 128;
inline constexpr std::size_t kMaximumControlInterval = 2048;

struct UpdateLogView {
  std::uint64_t* sampleIndices = nullptr;
  DetectorLevels* nominalLevels = nullptr;
  std::size_t capacity = 0;
};

// One-ear Native equivalent of offline-auto-fir.mjs. Optional update logs are
// caller-owned preallocated test instrumentation; callbacks never allocate.
class AutoFirResearch {
 public:
  AutoFirResearch(const BandBasis& basis, const BandTargets& targets,
                  double attackMs = 15.0, double releaseMs = 400.0,
                  std::size_t controlIntervalSamples = 480,
                  double maxGainDb = 12.0, double limiterCeiling = 0.3,
                  std::size_t transitionSamples = 2400,
                  UpdateLogView updateLog = {}) noexcept
      : detector_(attackMs, releaseMs),
        fir_(basis, targets, maxGainDb, limiterCeiling, transitionSamples),
        controlIntervalSamples_(controlIntervalSamples),
        updateLog_(updateLog) {
    configValid_ = detector_.configValid() && fir_.configValid() &&
        controlIntervalSamples_ >= kMinimumControlInterval &&
        controlIntervalSamples_ <= kMaximumControlInterval &&
        ((updateLog_.sampleIndices == nullptr &&
          updateLog_.nominalLevels == nullptr && updateLog_.capacity == 0) ||
         (updateLog_.sampleIndices != nullptr &&
          updateLog_.nominalLevels != nullptr && updateLog_.capacity > 0));
    faulted_ = !configValid_;
  }

  bool processInto(const float* input, float* output,
                   std::size_t frames) noexcept {
    if (faulted_ || !configValid_) return false;
    if (input == nullptr || output == nullptr || frames == 0 ||
        frames > kMaximumCallbackFrames || rangesOverlap(input, output, frames)) {
      faulted_ = true;
      return false;
    }
    // Validate the whole callback before initialization or state changes.
    for (std::size_t frame = 0; frame < frames; ++frame) {
      if (!std::isfinite(input[frame]) || input[frame] < -16.0F ||
          input[frame] > 16.0F) {
        faulted_ = true;
        return false;
      }
    }

    if (!initialized_) {
      if (!fir_.setSyntheticBandLevels(kZeroLevels)) {
        return failCallback(output, frames);
      }
      initialized_ = true;
    }

    std::size_t position = 0;
    while (position < frames) {
      const std::size_t untilUpdate = controlIntervalSamples_ - sinceUpdate_;
      const std::size_t count = std::min(frames - position, untilUpdate);
      if (count == 0 ||
          !detector_.process(input + position, count) ||
          !fir_.processInto(input + position, output + position, count)) {
        return failCallback(output, frames);
      }
      position += count;
      sinceUpdate_ += count;
      if (sinceUpdate_ == controlIntervalSamples_) {
        DetectorLevels levels{};
        if (!detector_.readNominalLevelsInto(levels) ||
            !fir_.setSyntheticBandLevels(levels)) {
          return failCallback(output, frames);
        }
        if (updateLog_.sampleIndices != nullptr) {
          if (updates_ >= updateLog_.capacity) {
            return failCallback(output, frames);
          }
          updateLog_.sampleIndices[updates_] =
              acceptedSamples_ + static_cast<std::uint64_t>(position);
          updateLog_.nominalLevels[updates_] = levels;
        }
        sinceUpdate_ = 0;
        ++updates_;
      }
    }
    acceptedSamples_ += frames;
    return true;
  }

  void failStop() noexcept {
    faulted_ = true;
    detector_.failStop();
    fir_.failStop();
  }

  void reset() noexcept {
    detector_.reset();
    fir_.reset();
    acceptedSamples_ = 0;
    sinceUpdate_ = 0;
    updates_ = 0;
    initialized_ = false;
    faulted_ = !configValid_;
  }

  bool configValid() const noexcept { return configValid_; }
  bool initialized() const noexcept { return initialized_; }
  bool faulted() const noexcept { return faulted_; }
  std::uint64_t acceptedSamples() const noexcept { return acceptedSamples_; }
  std::size_t sinceUpdate() const noexcept { return sinceUpdate_; }
  std::uint64_t updates() const noexcept { return updates_; }
  const SixBandLevelDetector& detector() const noexcept { return detector_; }
  const DynamicFir& fir() const noexcept { return fir_; }

 private:
  inline static constexpr BandLevels kZeroLevels{50, 50, 50, 50, 50, 50};

  static bool rangesOverlap(const float* input, const float* output,
                            std::size_t frames) noexcept {
    const std::uintptr_t in =
        reinterpret_cast<std::uintptr_t>(input);
    const std::uintptr_t out =
        reinterpret_cast<std::uintptr_t>(output);
    const std::uintptr_t bytes = frames * sizeof(float);
    if (in > std::numeric_limits<std::uintptr_t>::max() - bytes ||
        out > std::numeric_limits<std::uintptr_t>::max() - bytes) {
      return true;
    }
    return in < out + bytes && out < in + bytes;
  }

  bool failCallback(float* output, std::size_t frames) noexcept {
    std::fill(output, output + frames, 0.0F);
    failStop();
    return false;
  }

  SixBandLevelDetector detector_;
  DynamicFir fir_;
  std::size_t controlIntervalSamples_ = 0;
  UpdateLogView updateLog_{};
  std::uint64_t acceptedSamples_ = 0;
  std::size_t sinceUpdate_ = 0;
  std::uint64_t updates_ = 0;
  bool configValid_ = false;
  bool initialized_ = false;
  bool faulted_ = false;
};

// Stereo wrapper contract: both channels are validated before either processor
// state changes. If either channel fails, both output channels are zero-filled
// and both ears fail-stop until reset. This intentionally strengthens the JS
// reference's single-ear behavior to prevent partial-valid binaural output.
class StereoAutoFirResearch {
 public:
  StereoAutoFirResearch(
      const BandBasis& basis,
      const std::array<BandTargets, 2>& targets,
      double attackMs = 15.0, double releaseMs = 400.0,
      std::size_t controlIntervalSamples = 480,
      double maxGainDb = 12.0, double limiterCeiling = 0.3,
      std::size_t transitionSamples = 2400,
      const std::array<UpdateLogView, 2>& updateLogs = {}) noexcept
      : left_(basis, targets[0], attackMs, releaseMs, controlIntervalSamples,
              maxGainDb, limiterCeiling, transitionSamples, updateLogs[0]),
        right_(basis, targets[1], attackMs, releaseMs, controlIntervalSamples,
               maxGainDb, limiterCeiling, transitionSamples, updateLogs[1]) {
    configValid_ = left_.configValid() && right_.configValid();
    faulted_ = !configValid_;
  }

  bool processInto(const float* interleavedInput, float* interleavedOutput,
                   std::size_t frames) noexcept {
    if (faulted_ || !configValid_) {
      return failCallback(interleavedOutput, frames);
    }
    if (interleavedInput == nullptr || interleavedOutput == nullptr ||
        frames == 0 || frames > kMaximumCallbackFrames ||
        rangesOverlap(interleavedInput, interleavedOutput, frames)) {
      return failCallback(interleavedOutput, frames);
    }
    for (std::size_t frame = 0; frame < frames; ++frame) {
      const float left = interleavedInput[2 * frame];
      const float right = interleavedInput[2 * frame + 1];
      if (!std::isfinite(left) || left < -16.0F || left > 16.0F ||
          !std::isfinite(right) || right < -16.0F || right > 16.0F) {
        return failCallback(interleavedOutput, frames);
      }
      leftInput_[frame] = left;
      rightInput_[frame] = right;
    }

    if (!left_.processInto(leftInput_.data(), leftOutput_.data(), frames) ||
        !right_.processInto(rightInput_.data(), rightOutput_.data(), frames)) {
      return failCallback(interleavedOutput, frames);
    }
    for (std::size_t frame = 0; frame < frames; ++frame) {
      interleavedOutput[2 * frame] = leftOutput_[frame];
      interleavedOutput[2 * frame + 1] = rightOutput_[frame];
    }
    acceptedSamples_ += frames;
    return true;
  }

  void reset() noexcept {
    left_.reset();
    right_.reset();
    acceptedSamples_ = 0;
    faulted_ = !configValid_;
  }

  bool configValid() const noexcept { return configValid_; }
  bool faulted() const noexcept { return faulted_; }
  std::uint64_t acceptedSamples() const noexcept { return acceptedSamples_; }
  const AutoFirResearch& left() const noexcept { return left_; }
  const AutoFirResearch& right() const noexcept { return right_; }

 private:
  static bool rangesOverlap(const float* input, const float* output,
                            std::size_t frames) noexcept {
    if (frames > std::numeric_limits<std::size_t>::max() / (2 * sizeof(float))) {
      return true;
    }
    const std::uintptr_t in =
        reinterpret_cast<std::uintptr_t>(input);
    const std::uintptr_t out =
        reinterpret_cast<std::uintptr_t>(output);
    const std::uintptr_t bytes = frames * 2 * sizeof(float);
    if (in > std::numeric_limits<std::uintptr_t>::max() - bytes ||
        out > std::numeric_limits<std::uintptr_t>::max() - bytes) {
      return true;
    }
    return in < out + bytes && out < in + bytes;
  }

  bool failCallback(float* output, std::size_t frames) noexcept {
    if (output != nullptr && frames <= kMaximumCallbackFrames) {
      std::fill(output, output + frames * 2, 0.0F);
    }
    faulted_ = true;
    left_.failStop();
    right_.failStop();
    return false;
  }

  AutoFirResearch left_;
  AutoFirResearch right_;
  std::array<float, kMaximumCallbackFrames> leftInput_{};
  std::array<float, kMaximumCallbackFrames> rightInput_{};
  std::array<float, kMaximumCallbackFrames> leftOutput_{};
  std::array<float, kMaximumCallbackFrames> rightOutput_{};
  std::uint64_t acceptedSamples_ = 0;
  bool configValid_ = false;
  bool faulted_ = false;
};

}  // namespace hearlens::research
