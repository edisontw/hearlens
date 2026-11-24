#include "fir_core.hpp"

#include <array>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <limits>

namespace {

constexpr std::size_t kInputSamplesPerEar = 16'384;
constexpr std::size_t kOutputBytes = 2 * kInputSamplesPerEar * sizeof(float);

bool hasSupportedFloatRepresentation() {
  if (sizeof(float) != sizeof(std::uint32_t) ||
      !std::numeric_limits<float>::is_iec559) {
    return false;
  }
  const float one = 1.0F;
  std::uint32_t bits = 0;
  std::memcpy(&bits, &one, sizeof(bits));
  return bits == 0x3f800000U;
}

void appendFloatLittleEndian(std::array<std::uint8_t, kOutputBytes>& bytes,
                             std::size_t offset, float value) {
  std::uint32_t bits = 0;
  std::memcpy(&bits, &value, sizeof(bits));
  bytes[offset] = static_cast<std::uint8_t>(bits & 0xffU);
  bytes[offset + 1] = static_cast<std::uint8_t>((bits >> 8U) & 0xffU);
  bytes[offset + 2] = static_cast<std::uint8_t>((bits >> 16U) & 0xffU);
  bytes[offset + 3] = static_cast<std::uint8_t>((bits >> 24U) & 0xffU);
}

}  // namespace

int main() {
  if (!hasSupportedFloatRepresentation()) {
    std::fprintf(stderr, "unsupported IEEE-754 float32 representation\n");
    return 2;
  }

  std::array<hearlens::research::Fir, 2> filters{};
  std::array<hearlens::research::Coefficients, 2> coefficients{};
  std::array<std::uint8_t, kOutputBytes> outputBytes{};

  for (std::size_t ear = 0; ear < filters.size(); ++ear) {
    for (std::size_t tap = 0; tap < hearlens::research::kUniqueTapCount; ++tap) {
      const int pattern = static_cast<int>((tap * 13 + ear * 7) % 31) - 15;
      coefficients[ear][tap] = static_cast<double>(pattern) / 8192.0;
    }
  }

  for (std::size_t sample = 0; sample < kInputSamplesPerEar; ++sample) {
    for (std::size_t ear = 0; ear < filters.size(); ++ear) {
      const int pattern = static_cast<int>((sample * 17 + ear * 101) % 997) - 498;
      const float input = static_cast<float>(pattern) / 2048.0F;
      const float output = filters[ear].step(input, coefficients[ear]);
      const std::size_t sampleIndex = sample * filters.size() + ear;
      appendFloatLittleEndian(outputBytes, sampleIndex * sizeof(float), output);
    }
  }

  if (std::fwrite(outputBytes.data(), 1, outputBytes.size(), stdout) != outputBytes.size()) {
    std::fprintf(stderr, "failed to write complete little-endian FIR output\n");
    return 1;
  }
  if (std::fflush(stdout) != 0) {
    std::fprintf(stderr, "failed to flush FIR output\n");
    return 1;
  }
  return 0;
}
