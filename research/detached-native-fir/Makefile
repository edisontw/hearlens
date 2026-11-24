CXX ?= g++
CXXFLAGS ?= -std=c++17 -O2 -fno-fast-math -ffp-contract=off -Wall -Wextra -Wpedantic -Werror

.PHONY: all verify clean

all: fir bench dynamic-check

fir: fir.cpp fir_core.hpp
	$(CXX) $(CXXFLAGS) fir.cpp -o fir

bench: bench.cpp fir_core.hpp
	$(CXX) $(CXXFLAGS) bench.cpp -o bench

dynamic-check: dynamic_check.cpp dynamic_fir_core.hpp fir_core.hpp
	$(CXX) $(CXXFLAGS) dynamic_check.cpp -o dynamic-check

verify: all
	node check.mjs
	./bench
	node dynamic-check.mjs

clean:
	rm -f fir bench dynamic-check
