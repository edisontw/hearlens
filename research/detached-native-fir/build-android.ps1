[CmdletBinding()]
param(
    [string]$OutputDirectory = 'D:\Dev\Android\test-results\hearlens\headless',
    [string]$FixtureDirectory
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\..\..\scripts\android\Initialize-AndroidEnvironment.ps1"

$ndkRoot = $env:ANDROID_NDK_HOME
$toolBin = Join-Path $ndkRoot 'toolchains\llvm\prebuilt\windows-x86_64\bin'
$compilerVersion = (& (Join-Path $toolBin 'clang++.exe') --version | Select-Object -First 1).Trim()
$readelf = Join-Path $toolBin 'llvm-readelf.exe'
if (!(Test-Path -LiteralPath $readelf)) { throw "NDK readelf tool missing: $readelf" }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

if (!$FixtureDirectory) {
    $FixtureDirectory = Join-Path $OutputDirectory 'portable-fixture'
    & node (Join-Path $PSScriptRoot 'auto-check.mjs') "--export-portable=$FixtureDirectory"
    if ($LASTEXITCODE -ne 0) { throw 'Portable fixture export failed.' }
}
foreach ($file in @('auto-fir-fixture.bin', 'auto-fir-js-oracle.bin', 'manifest.json')) {
    if (!(Test-Path -LiteralPath (Join-Path $FixtureDirectory $file))) { throw "Portable fixture missing $file" }
}

$targets = @{
    'x86_64' = @{ triple = 'x86_64-linux-android29'; machine = 'X86-64' }
    'arm64-v8a' = @{ triple = 'aarch64-linux-android29'; machine = 'AArch64' }
}
$sourceFlags = @('-std=c++17', '-O2', '-fno-fast-math', '-ffp-contract=off', '-Wall', '-Wextra', '-Wpedantic', '-Werror', '-static-libstdc++', '-pthread', '-DANDROID_API_LEVEL=29')
$report = @()

foreach ($abi in $targets.Keys) {
    $target = $targets[$abi]
    $compiler = Join-Path $toolBin "$($target.triple)-clang++.cmd"
    if (!(Test-Path -LiteralPath $compiler)) { throw "NDK compiler wrapper missing: $compiler" }
    $autoExe = Join-Path $OutputDirectory "auto-check-$abi"
    $sessionExe = Join-Path $OutputDirectory "native-session-check-$abi"
    & $compiler @sourceFlags (Join-Path $PSScriptRoot 'auto_check.cpp') '-o' $autoExe
    if ($LASTEXITCODE -ne 0) { throw "NDK Auto-FIR compile failed: $abi" }
    & $compiler @sourceFlags (Join-Path $PSScriptRoot 'native_session_check.cpp') '-o' $sessionExe
    if ($LASTEXITCODE -ne 0) { throw "NDK Native session compile failed: $abi" }

    $header = & $readelf -h $autoExe 2>&1 | Out-String
    if ($header -notmatch [regex]::Escape($target.machine)) { throw "Unexpected ELF ABI for $abi" }
    $sessionHeader = & $readelf -h $sessionExe 2>&1 | Out-String
    if ($sessionHeader -notmatch [regex]::Escape($target.machine)) { throw "Unexpected session ELF ABI for $abi" }
    $dynamic = & $readelf -d $autoExe 2>&1 | Out-String
    if ($dynamic -match '(?i)aaudio|opensles|oboe|audiotrack|audioflinger') { throw "Forbidden audio dependency in $abi executable" }

    $report += [pscustomobject]@{
        abi = $abi
        apiLevel = 29
        ndkVersion = (Split-Path -Leaf $ndkRoot)
        windowsHostTag = 'windows-x86_64'
        compiler = $compilerVersion
        flags = $sourceFlags -join ' '
        autoCheckSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $autoExe).Hash.ToLowerInvariant()
        sessionCheckSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $sessionExe).Hash.ToLowerInvariant()
        elfClass = if ($header -match 'ELF64') { 'ELF64' } else { 'unexpected' }
        elfMachine = $target.machine
        audioRoute = 'none'
        hearingOutputAuthorized = $false
    }
}

$report | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $OutputDirectory 'build-info.json') -Encoding utf8
$report | Format-Table abi,apiLevel,ndkVersion,elfClass,elfMachine,autoCheckSha256 -AutoSize
