#pragma once

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>

namespace hearlens::research {

inline constexpr std::size_t kDetectorBandCount = 6;
inline constexpr std::size_t kDetectorMaximumFrames = 4096;
inline constexpr std::array<double, kDetectorBandCount> kDetectorCenterHz{
    250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0};
inline constexpr double kDetectorRate = 48000.0;
inline constexpr double kDetectorQ = 1.5;
inline constexpr double kDetectorPowerAverageMs = 12.0;
inline constexpr double kDetectorFloorRms = 1.0e-10;
inline constexpr double kDetectorReferenceDbfs = -37.0;
inline constexpr double kDetectorReferenceNominal = 65.0;

using DetectorLevels = std::array<double, kDetectorBandCount>;

struct BandPassCoefficients {
  double b0 = 0.0;
  double b2 = 0.0;
  double a1 = 0.0;
  double a2 = 0.0;
};

// Offline synthetic PCM level detector. All filter, power and envelope state
// is per instance and Float64. It has no audio-device or output API.
class SixBandLevelDetector {
 public:
  SixBandLevelDetector(double attackMs = 15.0,
                       double releaseMs = 400.0) noexcept
      : attackMs_(attackMs), releaseMs_(releaseMs) {
    configValid_ = std::isfinite(attackMs_) && attackMs_ >= 5.0 &&
        attackMs_ <= 100.0 && std::isfinite(releaseMs_) &&
        releaseMs_ >= 100.0 && releaseMs_ <= 2000.0 &&
        releaseMs_ >= attackMs_;
    if (!configValid_) {
      faulted_ = true;
      return;
    }

    // Preserve JS operation order and expm1 form for parity.
    attack_ = -std::expm1(-1.0 / (kDetectorRate * attackMs_ / 1000.0));
    release_ = -std::expm1(-1.0 / (kDetectorRate * releaseMs_ / 1000.0));
    powerAlpha_ = -std::expm1(
        -1.0 / (kDetectorRate * kDetectorPowerAverageMs / 1000.0));
    for (std::size_t band = 0; band < kDetectorBandCount; ++band) {
      const double omega =
          2.0 * kPi * kDetectorCenterHz[band] / kDetectorRate;
      const double alpha = std::sin(omega) / (2.0 * kDetectorQ);
      const double invA0 = 1.0 / (1.0 + alpha);
      coefficients_[band] = {
          alpha * invA0,
          -alpha * invA0,
          -2.0 * std::cos(omega) * invA0,
          (1.0 - alpha) * invA0,
      };
      const auto& c = coefficients_[band];
      if (!std::isfinite(c.b0) || !std::isfinite(c.b2) ||
          !std::isfinite(c.a1) || !std::isfinite(c.a2)) {
        configValid_ = false;
        faulted_ = true;
      }
    }
    if (!std::isfinite(attack_) || !std::isfinite(release_) ||
        !std::isfinite(powerAlpha_)) {
      configValid_ = false;
      faulted_ = true;
    }
  }

  bool process(const float* input, std::size_t frames) noexcept {
    if (!configValid_ || faulted_) return false;
    if (input == nullptr || frames == 0 || frames > kDetectorMaximumFrames) {
      faulted_ = true;
      return false;
    }
    for (std::size_t frame = 0; frame < frames; ++frame) {
      if (!std::isfinite(input[frame]) || input[frame] < -16.0F ||
          input[frame] > 16.0F) {
        faulted_ = true;
        return false;
      }
    }

    for (std::size_t frame = 0; frame < frames; ++frame) {
      const double x = static_cast<double>(input[frame]);
      for (std::size_t band = 0; band < kDetectorBandCount; ++band) {
        const auto& c = coefficients_[band];
        const double a = c.b0 * x + z1a_[band];
        z1a_[band] = -c.a1 * a + z2a_[band];
        z2a_[band] = c.b2 * x - c.a2 * a;
        const double b = c.b0 * a + z1b_[band];
        z1b_[band] = -c.a1 * b + z2b_[band];
        z2b_[band] = c.b2 * a - c.a2 * b;
        smoothPower_[band] +=
            powerAlpha_ * (b * b - smoothPower_[band]);
        const double alpha =
            smoothPower_[band] > energy_[band] ? attack_ : release_;
        energy_[band] += alpha * (smoothPower_[band] - energy_[band]);
        if (!std::isfinite(energy_[band]) ||
            !std::isfinite(smoothPower_[band])) {
          faulted_ = true;
          return false;
        }
      }
    }
    acceptedSamples_ += frames;
    return true;
  }

  bool readNominalLevelsInto(DetectorLevels& output) const noexcept {
    if (!configValid_ || faulted_) return false;
    for (std::size_t band = 0; band < kDetectorBandCount; ++band) {
      const double dbfs = 20.0 * std::log10(
          std::max(std::sqrt(energy_[band]), kDetectorFloorRms));
      output[band] = std::max(50.0, std::min(80.0,
          kDetectorReferenceNominal + dbfs - kDetectorReferenceDbfs));
    }
    return true;
  }

  void failStop() noexcept { faulted_ = true; }

  void reset() noexcept {
    z1a_.fill(0.0);
    z2a_.fill(0.0);
    z1b_.fill(0.0);
    z2b_.fill(0.0);
    energy_.fill(0.0);
    smoothPower_.fill(0.0);
    acceptedSamples_ = 0;
    faulted_ = !configValid_;
  }

  bool configValid() const noexcept { return configValid_; }
  bool faulted() const noexcept { return faulted_; }
  std::uint64_t acceptedSamples() const noexcept { return acceptedSamples_; }

 private:
  static constexpr double kPi =
      3.141592653589793238462643383279502884;

  double attackMs_ = 0.0;
  double releaseMs_ = 0.0;
  double attack_ = 0.0;
  double release_ = 0.0;
  double powerAlpha_ = 0.0;
  std::array<BandPassCoefficients, kDetectorBandCount> coefficients_{};
  std::array<double, kDetectorBandCount> z1a_{};
  std::array<double, kDetectorBandCount> z2a_{};
  std::array<double, kDetectorBandCount> z1b_{};
  std::array<double, kDetectorBandCount> z2b_{};
  std::array<double, kDetectorBandCount> energy_{};
  std::array<double, kDetectorBandCount> smoothPower_{};
  std::uint64_t acceptedSamples_ = 0;
  bool configValid_ = false;
  bool faulted_ = false;
};

}  // namespace hearlens::research
