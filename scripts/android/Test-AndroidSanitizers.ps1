[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\Initialize-AndroidEnvironment.ps1"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$serial = 'emulator-5580'
$resultRoot = 'D:\Dev\Android\test-results\hearlens\sanitizer'
$fixtureRoot = 'D:\Dev\Android\test-results\hearlens\portable-fixture'
$remoteRoot = '/data/local/tmp/hearlens-asan'
$ndkPrebuilt = Join-Path $env:ANDROID_NDK_HOME 'toolchains\llvm\prebuilt\windows-x86_64'
$toolBin = Join-Path $ndkPrebuilt 'bin'
$compiler = Join-Path $toolBin 'x86_64-linux-android29-clang++.cmd'
$readelf = Join-Path $toolBin 'llvm-readelf.exe'
$clangVersion = Get-ChildItem (Join-Path $ndkPrebuilt 'lib\clang') -Directory | Sort-Object { [int]$_.Name } -Descending | Select-Object -First 1
if (!$clangVersion) { throw 'Could not locate the NDK Clang sanitizer runtime.' }
$asanRuntime = Join-Path $clangVersion.FullName 'lib\linux\libclang_rt.asan-x86_64-android.so'
$libcxxRuntime = Join-Path $ndkPrebuilt 'sysroot\usr\lib\x86_64-linux-android\libc++_shared.so'
foreach ($required in @($compiler, $readelf, $asanRuntime, $libcxxRuntime)) {
    if (!(Test-Path -LiteralPath $required)) { throw "Required NDK sanitizer file missing: $required" }
}
foreach ($required in @('manifest.json', 'auto-fir-fixture.bin', 'auto-fir-js-oracle.bin')) {
    if (!(Test-Path -LiteralPath (Join-Path $fixtureRoot $required))) { throw "Canonical fixture file missing: $required" }
}

$adb = $env:ANDROID_ADB
$devices = & $adb devices
if (!($devices | Where-Object { $_ -match "^$serial\s+device$" })) { throw "Dedicated emulator $serial is not available; refusing to target another device." }
$api = (& $adb -s $serial shell getprop ro.build.version.sdk).Trim()
$abi = (& $adb -s $serial shell getprop ro.product.cpu.abi).Trim()
$qemu = (& $adb -s $serial shell getprop ro.kernel.qemu).Trim()
$avd = (& $adb -s $serial emu avd name 2>&1 | Out-String)
if ($api -ne '29' -or $abi -ne 'x86_64' -or $qemu -ne '1' -or $avd -notmatch 'HearLens_API29_x86_64') {
    throw "Unexpected sanitizer runtime (AVD=$avd API=$api ABI=$abi)."
}

New-Item -ItemType Directory -Force -Path $resultRoot | Out-Null
$flags = @(
    '-std=c++17', '-O1', '-g', '-fno-fast-math', '-ffp-contract=off',
    '-Wall', '-Wextra', '-Wpedantic', '-Werror', '-Wno-mismatched-new-delete',
    '-pthread', '-fsanitize=address,undefined', '-fno-sanitize=vptr',
    '-shared-libasan', '-fno-omit-frame-pointer'
)
$sources = @(
    @{ name = 'auto-check'; file = 'auto_check.cpp' },
    @{ name = 'native-session-check'; file = 'native_session_check.cpp' }
)
foreach ($source in $sources) {
    $binary = Join-Path $resultRoot "$($source.name)-asan-ubsan"
    & $compiler @flags (Join-Path $repoRoot "research\detached-native-fir\$($source.file)") '-o' $binary
    if ($LASTEXITCODE -ne 0) { throw "ASan/UBSan build failed: $($source.file)" }
    $elf = & $readelf -h $binary 2>&1 | Out-String
    if ($elf -notmatch 'ELF64' -or $elf -notmatch 'X86-64') { throw "Unexpected sanitizer ELF for $($source.name)." }
    & $adb -s $serial push $binary "$remoteRoot/$($source.name)"
    if ($LASTEXITCODE -ne 0) { throw "Could not transfer sanitizer executable: $($source.name)" }
}

& $adb -s $serial push $asanRuntime "$remoteRoot/libclang_rt.asan-x86_64-android.so"
if ($LASTEXITCODE -ne 0) { throw 'Could not transfer the NDK ASan runtime.' }
& $adb -s $serial push $libcxxRuntime "$remoteRoot/libc++_shared.so"
if ($LASTEXITCODE -ne 0) { throw 'Could not transfer the NDK libc++ runtime.' }
& $adb -s $serial push (Join-Path $fixtureRoot 'auto-fir-fixture.bin') "$remoteRoot/auto-fir-fixture.bin"
if ($LASTEXITCODE -ne 0) { throw 'Could not transfer the canonical portable fixture.' }
& $adb -s $serial shell chmod 700 "$remoteRoot/auto-check" "$remoteRoot/native-session-check"
if ($LASTEXITCODE -ne 0) { throw 'Could not set executable permissions on sanitizer binaries.' }

$sessionOutput = & $adb -s $serial shell "cd $remoteRoot && LD_LIBRARY_PATH=. ASAN_OPTIONS=detect_leaks=0 UBSAN_OPTIONS=halt_on_error=1 ./native-session-check" 2>&1
$sessionText = $sessionOutput -join "`n"
if ($LASTEXITCODE -ne 0 -or $sessionText -notmatch '2000 concurrent invalidations PASS') {
    throw "ASan/UBSan Native session regression failed: $sessionText"
}

& $adb -s $serial shell "cd $remoteRoot && LD_LIBRARY_PATH=. ASAN_OPTIONS=detect_leaks=0 UBSAN_OPTIONS=halt_on_error=1 ./auto-check auto-fir-fixture.bin > sanitized-result.bin"
if ($LASTEXITCODE -ne 0) { throw 'ASan/UBSan portable Auto-FIR run failed.' }
$sanitizedResult = Join-Path $resultRoot 'android-x86_64-sanitized-result.bin'
& $adb -s $serial pull "$remoteRoot/sanitized-result.bin" $sanitizedResult
if ($LASTEXITCODE -ne 0) { throw 'Could not retrieve the ASan/UBSan portable result.' }
$oracleReport = (& node (Join-Path $repoRoot 'research\detached-native-fir\verify-portable-output.mjs') `
    (Join-Path $fixtureRoot 'manifest.json') `
    (Join-Path $fixtureRoot 'auto-fir-fixture.bin') `
    (Join-Path $fixtureRoot 'auto-fir-js-oracle.bin') `
    $sanitizedResult 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw "Sanitized result failed the canonical JS oracle: $oracleReport" }

$report = [ordered]@{
    result = 'PASS'
    runtime = 'Android x86_64 API 29 dedicated AOSP emulator'
    sanitizers = @('AddressSanitizer', 'UndefinedBehaviorSanitizer (excluding vptr)')
    vptrExclusion = 'NDK libc++ ostream virtual-base cast reports a false positive in ostreambuf_iterator.h; remaining ASan/UBSan checks stay enabled.'
    nativeSession = $sessionText.Trim()
    autoFir = ($oracleReport | ConvertFrom-Json)
    threadSanitizer = 'NOT RUN on Android NDK build'
    physicalDevice = 'NOT RUN'
    audioInputOutput = 'DISABLED / not implemented'
}
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $resultRoot 'android-sanitizer-report.json') -Encoding utf8
Write-Output 'Android ASan/UBSan Auto-FIR and Native session regressions: PASS.'
