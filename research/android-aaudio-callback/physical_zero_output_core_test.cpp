#include "../../apps/android-aaudio-physical-zero-lab/app/src/main/cpp/zero_output_core.hpp"

#include <array>
#include <cassert>
#include <cstdint>
#include <iostream>

int main() {
  constexpr std::array<std::int32_t, 5> frameCounts{1, 64, 128, 960, 2048};
  for (const auto frames : frameCounts) {
    std::array<float, 4098> output{};
    output.front() = 17.0F;
    output.back() = -23.0F;
    auto* firstSample = output.data() + 1;
    const auto samples = static_cast<std::size_t>(frames) * 2;
    for (std::size_t index = 0; index < samples; ++index) {
      firstSample[index] = static_cast<float>(index + 1);
    }
    const auto result = hearlens::physical_zero::clearAndVerifyZero(
        firstSample, frames, 2);
    assert(result.valid);
    assert(result.nonZeroSamples == 0);
    assert(output.front() == 17.0F);
    assert(output.back() == -23.0F);
    for (std::size_t index = 0; index < samples; ++index) {
      assert(firstSample[index] == 0.0F);
    }
  }
  assert(!hearlens::physical_zero::clearAndVerifyZero(nullptr, 128, 2).valid);
  std::array<float, 4> unused{};
  assert(!hearlens::physical_zero::clearAndVerifyZero(unused.data(), 0, 2).valid);
  assert(!hearlens::physical_zero::clearAndVerifyZero(unused.data(), 2, 0).valid);
  std::cout << "physical zero-output core: PASS\n";
}
