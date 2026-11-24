CXX ?= g++
CXXFLAGS ?= -std=c++17 -O2 -fno-fast-math -ffp-contract=off -Wall -Wextra -Wpedantic -Werror

.PHONY: all verify sanitize-check clean

all: fir bench dynamic-check auto-check

fir: fir.cpp fir_core.hpp
	$(CXX) $(CXXFLAGS) fir.cpp -o fir

bench: bench.cpp fir_core.hpp
	$(CXX) $(CXXFLAGS) bench.cpp -o bench

dynamic-check: dynamic_check.cpp dynamic_fir_core.hpp fir_core.hpp
	$(CXX) $(CXXFLAGS) dynamic_check.cpp -o dynamic-check

auto-check: auto_check.cpp auto_fir_core.hpp six_band_level_core.hpp dynamic_fir_core.hpp fir_core.hpp
	$(CXX) $(CXXFLAGS) auto_check.cpp -o auto-check

verify: all
	node check.mjs
	./bench
	node dynamic-check.mjs
	node auto-check.mjs

auto-check-sanitize: auto_check.cpp auto_fir_core.hpp six_band_level_core.hpp dynamic_fir_core.hpp fir_core.hpp
	$(CXX) $(CXXFLAGS) -Wno-mismatched-new-delete -O1 -g -fsanitize=address,undefined -fno-omit-frame-pointer auto_check.cpp -o auto-check-sanitize

sanitize-check: auto-check-sanitize
	ASAN_OPTIONS=detect_leaks=0 NATIVE_AUTO_BINARY=./auto-check-sanitize node auto-check.mjs

clean:
	rm -f fir bench dynamic-check auto-check auto-check-sanitize
