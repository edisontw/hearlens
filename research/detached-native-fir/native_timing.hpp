#pragma once

#include <chrono>
#include <cstdint>

namespace hearlens::research {

// Optional, caller-owned instrumentation for offline research. A null pointer
// keeps all extra clock reads out of the production DSP path.
struct NativeDspStageTimings {
  std::uint64_t generationResetNs = 0;
  std::uint64_t initialFirCoefficientSynthesisNs[2] = {0, 0};
  std::uint64_t detectorNs = 0;
  std::uint64_t firConvolutionNs = 0;
  std::uint64_t dynamicControlUpdateNs = 0;
  std::uint64_t scratchValidationNs = 0;
  std::uint64_t scratchClearNs = 0;
};

using NativeTimingClock = std::chrono::steady_clock;

inline std::uint64_t nativeElapsedNs(NativeTimingClock::time_point start,
                                     NativeTimingClock::time_point end) noexcept {
  if (end < start) return 0;
  return static_cast<std::uint64_t>(
      std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count());
}

}  // namespace hearlens::research
