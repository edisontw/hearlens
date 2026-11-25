cmake_minimum_required(VERSION 3.22.1)
project(hearlens_native_dsp_lab LANGUAGES CXX)

get_filename_component(REPOSITORY_ROOT
    "${CMAKE_CURRENT_SOURCE_DIR}/../../../../../.." ABSOLUTE)
set(NATIVE_RESEARCH_DIR "${REPOSITORY_ROOT}/research/detached-native-fir")

add_library(hearlens_native SHARED
    native_bridge_jni.cpp
    "${NATIVE_RESEARCH_DIR}/auto_check.cpp"
    "${NATIVE_RESEARCH_DIR}/native_session_check.cpp")

target_include_directories(hearlens_native PRIVATE "${NATIVE_RESEARCH_DIR}")
target_compile_features(hearlens_native PRIVATE cxx_std_17)
target_compile_definitions(hearlens_native PRIVATE
    HEARLENS_ANDROID_JNI=1
    HEARLENS_DISABLE_ALLOCATION_PROBE=1)
target_compile_options(hearlens_native PRIVATE
    -fno-fast-math -ffp-contract=off -Wall -Wextra -Wpedantic -Werror)
