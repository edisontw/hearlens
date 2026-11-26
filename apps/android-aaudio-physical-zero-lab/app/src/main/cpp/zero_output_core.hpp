#pragma once

#include <cstddef>
#include <cstdint>

namespace hearlens::physical_zero {

struct ZeroOutputCheck {
  bool valid;
  std::uint64_t nonZeroSamples;
};

// The single PCM operation used by the Android data callback. It has no
// allocation, JNI, locking, DSP, or route-control behavior.
inline ZeroOutputCheck clearAndVerifyZero(float* output, std::int32_t frames,
                                          std::int32_t channels) noexcept {
  if (output == nullptr || frames <= 0 || channels <= 0) return {false, 0};
  const auto sampleCount = static_cast<std::size_t>(frames) *
      static_cast<std::size_t>(channels);
  for (std::size_t index = 0; index < sampleCount; ++index) {
    output[index] = 0.0F;
  }
  std::uint64_t nonZeroSamples = 0;
  for (std::size_t index = 0; index < sampleCount; ++index) {
    if (output[index] != 0.0F) ++nonZeroSamples;
  }
  return {true, nonZeroSamples};
}

}  // namespace hearlens::physical_zero
