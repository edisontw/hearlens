cmake_minimum_required(VERSION 3.22.1)
project(hearlens_physical_dsp_shadow LANGUAGES CXX)

set(HEARLENS_NATIVE_OPT_LEVEL "2" CACHE STRING
    "Native compiler optimization profile for the DSP-shadow research library")
if(NOT HEARLENS_NATIVE_OPT_LEVEL STREQUAL "0" AND
   NOT HEARLENS_NATIVE_OPT_LEVEL STREQUAL "2")
    message(FATAL_ERROR "HEARLENS_NATIVE_OPT_LEVEL must be 0 or 2")
endif()

get_filename_component(REPOSITORY_ROOT
    "${CMAKE_CURRENT_SOURCE_DIR}/../../../../../.." ABSOLUTE)
set(NATIVE_RESEARCH_DIR "${REPOSITORY_ROOT}/research/detached-native-fir")
set(AAUDIO_RESEARCH_DIR "${REPOSITORY_ROOT}/research/android-aaudio-callback")

add_library(hearlens_physical_dsp_shadow SHARED
    shadow_callback_bridge.cpp
    "${NATIVE_RESEARCH_DIR}/auto_check.cpp"
    "${NATIVE_RESEARCH_DIR}/native_session_check.cpp")

target_include_directories(hearlens_physical_dsp_shadow PRIVATE
    "${NATIVE_RESEARCH_DIR}"
    "${AAUDIO_RESEARCH_DIR}")
target_compile_features(hearlens_physical_dsp_shadow PRIVATE cxx_std_17)
target_compile_definitions(hearlens_physical_dsp_shadow PRIVATE
    HEARLENS_ANDROID_JNI=1
    HEARLENS_DISABLE_ALLOCATION_PROBE=1
    HEARLENS_NATIVE_OPT_LEVEL=${HEARLENS_NATIVE_OPT_LEVEL})
target_compile_options(hearlens_physical_dsp_shadow PRIVATE
    -O${HEARLENS_NATIVE_OPT_LEVEL}
    -fno-fast-math -ffp-contract=off -Wall -Wextra -Wpedantic -Werror)
target_link_libraries(hearlens_physical_dsp_shadow PRIVATE aaudio log)
