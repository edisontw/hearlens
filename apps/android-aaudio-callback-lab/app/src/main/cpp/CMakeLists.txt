cmake_minimum_required(VERSION 3.22.1)
project(hearlens_aaudio_callback_lab LANGUAGES CXX)

get_filename_component(REPOSITORY_ROOT
    "${CMAKE_CURRENT_SOURCE_DIR}/../../../../../.." ABSOLUTE)
set(NATIVE_RESEARCH_DIR "${REPOSITORY_ROOT}/research/detached-native-fir")
set(AAUDIO_RESEARCH_DIR "${REPOSITORY_ROOT}/research/android-aaudio-callback")

add_library(hearlens_aaudio_callback SHARED
    aaudio_callback_bridge.cpp)

target_include_directories(hearlens_aaudio_callback PRIVATE
    "${NATIVE_RESEARCH_DIR}"
    "${AAUDIO_RESEARCH_DIR}")
target_compile_features(hearlens_aaudio_callback PRIVATE cxx_std_17)
target_compile_options(hearlens_aaudio_callback PRIVATE
    -fno-fast-math -ffp-contract=off -Wall -Wextra -Wpedantic -Werror)
target_link_libraries(hearlens_aaudio_callback PRIVATE aaudio log)
