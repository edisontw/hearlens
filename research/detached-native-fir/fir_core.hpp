#pragma once

#include <array>
#include <cstddef>

namespace hearlens::research {

inline constexpr std::size_t kTapCount = 513;
inline constexpr std::size_t kUniqueTapCount = 257;

using Coefficients = std::array<double, kUniqueTapCount>;

struct Fir {
  std::array<float, 2 * kTapCount> history{};
  std::size_t writeIndex = 0;

  template <typename CoefficientAt>
  double stepDouble(float sample, CoefficientAt&& coefficientAt) noexcept {
    history[writeIndex] = sample;
    history[writeIndex + kTapCount] = sample;

    const std::size_t newest = writeIndex + kTapCount;
    const std::size_t oldest = newest - (kTapCount - 1);
    double output = 0.0;
    for (std::size_t tap = 0; tap < kTapCount / 2; ++tap) {
      const double pair = static_cast<double>(history[newest - tap]) +
          static_cast<double>(history[oldest + tap]);
      output += static_cast<double>(coefficientAt(tap)) * pair;
    }
    output += static_cast<double>(coefficientAt(kTapCount / 2)) *
        static_cast<double>(history[newest - kTapCount / 2]);

    ++writeIndex;
    if (writeIndex == kTapCount) writeIndex = 0;
    return output;
  }

  float step(float sample, const Coefficients& coefficients) noexcept {
    return static_cast<float>(stepDouble(sample, [&coefficients](std::size_t tap) noexcept {
      return coefficients[tap];
    }));
  }

  void reset() noexcept {
    history.fill(0.0F);
    writeIndex = 0;
  }
};

}  // namespace hearlens::research
