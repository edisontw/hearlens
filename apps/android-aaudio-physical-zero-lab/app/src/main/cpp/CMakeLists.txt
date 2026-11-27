cmake_minimum_required(VERSION 3.22.1)
project(hearlens_physical_zero_aaudio LANGUAGES CXX)

add_library(hearlens_physical_zero SHARED zero_callback.cpp)
target_compile_features(hearlens_physical_zero PRIVATE cxx_std_17)
target_compile_options(hearlens_physical_zero PRIVATE
    -Wall -Wextra -Wpedantic -Werror)
target_link_libraries(hearlens_physical_zero PRIVATE aaudio log)
