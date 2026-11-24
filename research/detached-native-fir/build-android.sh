#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
output_dir="${1:-$script_dir/android-arm64}"
mkdir -p "$output_dir"

ndk_root="${ANDROID_NDK_HOME:-${ANDROID_NDK_ROOT:-}}"
if [[ -z "$ndk_root" ]]; then
  android_home="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
  if [[ -n "$android_home" && -d "$android_home/ndk" ]]; then
    ndk_root="$(find "$android_home/ndk" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' \
      | sort -V | tail -n 1)"
    ndk_root="$android_home/ndk/$ndk_root"
  fi
fi
if [[ -z "$ndk_root" || ! -d "$ndk_root/toolchains/llvm/prebuilt" ]]; then
  echo "Android NDK not found; set ANDROID_NDK_HOME/ANDROID_NDK_ROOT or ANDROID_HOME" >&2
  exit 2
fi

host_tag="linux-x86_64"
toolchain="$ndk_root/toolchains/llvm/prebuilt/$host_tag/bin"
compiler="$toolchain/aarch64-linux-android29-clang++"
readelf="$toolchain/llvm-readelf"
if [[ ! -x "$compiler" || ! -x "$readelf" ]]; then
  echo "NDK lacks the Linux host arm64-v8a API 29 compiler tools: $toolchain" >&2
  exit 2
fi

binary="$output_dir/hearlens-auto-check-arm64-v8a"
flags=(-std=c++17 -O2 -fno-fast-math -ffp-contract=off -Wall -Wextra
  -Wpedantic -Werror -static-libstdc++ -DANDROID_API_LEVEL=29)
"$compiler" "${flags[@]}" "$script_dir/auto_check.cpp" -o "$binary"

header="$($readelf -h "$binary")"
grep -q 'Class:.*ELF64' <<<"$header"
grep -q 'Machine:.*AArch64' <<<"$header"
dynamic="$($readelf -d "$binary" 2>&1 || true)"
if grep -Eiq 'aaudio|opensles|oboe|audiotrack|audioflinger' <<<"$dynamic"; then
  echo "unexpected audio output dependency in Android Native executable" >&2
  exit 1
fi
dependencies="$(sed -n 's/.*Shared library: \[\([^]]*\)\].*/\1/p' <<<"$dynamic" | paste -sd, -)"
sha256="$(sha256sum "$binary" | cut -d' ' -f1)"
compiler_version="$("$compiler" --version | head -n 1)"
printf '{\n  "abi": "arm64-v8a",\n  "apiLevel": 29,\n  "targetTriple": "aarch64-linux-android29",\n  "ndkVersion": "%s",\n  "compiler": "%s",\n  "flags": "%s",\n  "elfClass": "ELF64",\n  "elfMachine": "AArch64",\n  "neededLibraries": "%s",\n  "forbiddenAudioDependenciesFound": false,\n  "audioRoute": "none",\n  "hearingOutputAuthorized": false,\n  "sha256": "%s"\n}\n' \
  "$(basename "$ndk_root")" "$compiler_version" "${flags[*]}" "$dependencies" "$sha256" \
  >"$output_dir/build-info.json"
printf 'Android NDK headless build PASS: %s\n' "$binary"
cat "$output_dir/build-info.json"

# Keep the native test oracle reproducible and package-ready for later `adb shell` use.
fixture_dir="$output_dir/portable-fixture"
node "$script_dir/auto-check.mjs" "--export-portable=$fixture_dir"
printf 'Android NDK executable is cross-compiled only; no Android runtime is asserted.\n'
