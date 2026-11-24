CXX ?= g++
CXXFLAGS ?= -std=c++17 -O2 -fno-fast-math -ffp-contract=off -Wall -Wextra -Wpedantic -Werror

.PHONY: all verify clean

all: fir bench

fir: fir.cpp fir_core.hpp
	$(CXX) $(CXXFLAGS) fir.cpp -o fir

bench: bench.cpp fir_core.hpp
	$(CXX) $(CXXFLAGS) bench.cpp -o bench

verify: all
	node check.mjs
	./bench

clean:
	rm -f fir bench
