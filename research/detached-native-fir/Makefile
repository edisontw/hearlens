CXX ?= g++
CXXFLAGS ?= -std=c++17 -O2 -fno-fast-math -ffp-contract=off -Wall -Wextra -Wpedantic -Werror

.PHONY: all verify benchmark sanitize-check session-check session-sanitize-check session-tsan-check clean

all: fir bench dynamic-check auto-check auto-bench

fir: fir.cpp fir_core.hpp
	$(CXX) $(CXXFLAGS) fir.cpp -o fir

bench: bench.cpp fir_core.hpp
	$(CXX) $(CXXFLAGS) bench.cpp -o bench

dynamic-check: dynamic_check.cpp dynamic_fir_core.hpp fir_core.hpp
	$(CXX) $(CXXFLAGS) dynamic_check.cpp -o dynamic-check

auto-check: auto_check.cpp auto_fir_core.hpp six_band_level_core.hpp dynamic_fir_core.hpp fir_core.hpp
	$(CXX) $(CXXFLAGS) auto_check.cpp -o auto-check

auto-bench: auto_bench.cpp auto_fir_core.hpp six_band_level_core.hpp dynamic_fir_core.hpp fir_core.hpp
	$(CXX) $(CXXFLAGS) auto_bench.cpp -o auto-bench

verify: all session-check
	node check.mjs
	./bench
	node dynamic-check.mjs
	node auto-check.mjs

benchmark: auto-bench
	node auto-bench.mjs

auto-check-sanitize: auto_check.cpp auto_fir_core.hpp six_band_level_core.hpp dynamic_fir_core.hpp fir_core.hpp
	$(CXX) $(CXXFLAGS) -Wno-mismatched-new-delete -O1 -g -fsanitize=address,undefined -fno-omit-frame-pointer auto_check.cpp -o auto-check-sanitize

sanitize-check: auto-check-sanitize session-sanitize-check
	ASAN_OPTIONS=detect_leaks=0 NATIVE_AUTO_BINARY=./auto-check-sanitize node auto-check.mjs

SESSION_SOURCES = native_session_check.cpp native_session.hpp auto_fir_core.hpp six_band_level_core.hpp dynamic_fir_core.hpp fir_core.hpp
SESSION_SANITIZE_FLAGS = -O1 -g -fno-omit-frame-pointer

native-session-check: $(SESSION_SOURCES)
	$(CXX) $(CXXFLAGS) -pthread native_session_check.cpp -o $@

native-session-asan: $(SESSION_SOURCES)
	$(CXX) $(CXXFLAGS) $(SESSION_SANITIZE_FLAGS) -fsanitize=address,undefined -pthread native_session_check.cpp -o $@

native-session-tsan: $(SESSION_SOURCES)
	$(CXX) $(CXXFLAGS) $(SESSION_SANITIZE_FLAGS) -fsanitize=thread -pthread native_session_check.cpp -o $@

session-check: native-session-check
	./native-session-check

session-sanitize-check: native-session-asan
	ASAN_OPTIONS=detect_leaks=0 UBSAN_OPTIONS=halt_on_error=1 ./native-session-asan

session-tsan-check: native-session-tsan
	./native-session-tsan

clean:
	rm -f fir bench dynamic-check auto-check auto-check-sanitize auto-bench native-session-check native-session-asan native-session-tsan
