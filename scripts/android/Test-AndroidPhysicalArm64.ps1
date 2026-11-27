[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$DeviceSerial,
    [ValidateRange(1, 3600)]
    [int]$BenchmarkSeconds = 300,
    [ValidateSet(64, 128, 192, 256, 480)]
    [int]$BenchmarkFrames = 128,
    [ValidatePattern('^[A-Za-z0-9_-]+$')]
    [string]$RunId = (Get-Date -Format 'yyyyMMdd-HHmmss'),
    [string]$ResultRoot = 'D:\Dev\Android\test-results\hearlens'
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\Initialize-AndroidEnvironment.ps1"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$adb = $env:ANDROID_ADB
$resultDirectory = Join-Path $ResultRoot "arm64-physical-$RunId"
if (Test-Path -LiteralPath $resultDirectory) {
    throw "Refusing to overwrite existing test results: $resultDirectory"
}

$fixtureRoot = Join-Path $resultDirectory 'portable-fixture'
$headlessRoot = Join-Path $resultDirectory 'headless'
$apkRoot = Join-Path $resultDirectory 'apk'
$benchmarkRoot = Join-Path $resultDirectory 'benchmark'
$remoteRoot = "/data/local/tmp/hearlens-arm64-$RunId"
$packageName = 'org.hearlens.nativedsplab'
$testPackageName = "$packageName.test"
$runner = "$testPackageName/androidx.test.runner.AndroidJUnitRunner"
$installedTarget = $false
$installedTest = $false
$remoteCreated = $false
$reportPath = Join-Path $resultDirectory 'android-arm64-device-report.json'

function Write-JsonFile {
    param([string]$Path, [object]$Value)
    $json = $Value | ConvertTo-Json -Depth 12
    [System.IO.File]::WriteAllText(
        $Path,
        $json + [Environment]::NewLine,
        [System.Text.UTF8Encoding]::new($false))
}

function Invoke-Device {
    param([string[]]$Arguments)
    $output = & $adb -s $DeviceSerial @Arguments 2>&1
    $exitCode = $LASTEXITCODE
    [pscustomobject]@{
        ExitCode = $exitCode
        Text = (($output | Out-String).Trim())
    }
}

function Get-DeviceProperty {
    param([string]$Name)
    $result = Invoke-Device -Arguments @('shell', 'getprop', $Name)
    if ($result.ExitCode -ne 0) {
        throw "Could not read Android property $Name. $($result.Text)"
    }
    return $result.Text.Trim()
}

function Save-DeviceSnapshot {
    param([string]$Label)
    $thermal = Invoke-Device -Arguments @('shell', 'dumpsys', 'thermalservice')
    $battery = Invoke-Device -Arguments @('shell', 'dumpsys', 'battery')
    [System.IO.File]::WriteAllText(
        (Join-Path $resultDirectory "thermal-$Label.txt"),
        $thermal.Text + [Environment]::NewLine,
        [System.Text.UTF8Encoding]::new($false))
    [System.IO.File]::WriteAllText(
        (Join-Path $resultDirectory "battery-$Label.txt"),
        $battery.Text + [Environment]::NewLine,
        [System.Text.UTF8Encoding]::new($false))
    $thermalStatusMatch = [regex]::Match($thermal.Text, '(?m)^Thermal Status:\s*(\d+)\s*$')
    $thermalTemperatures = @([regex]::Matches(
        $thermal.Text,
        'Temperature\{mValue=([+-]?\d+(?:\.\d+)?),\s*mType=(\d+),\s*mName=([^,}]+)'
    ) | ForEach-Object {
        [pscustomobject]@{
            celsius = [double]::Parse($_.Groups[1].Value, [Globalization.CultureInfo]::InvariantCulture)
            typeCode = [int]$_.Groups[2].Value
            name = $_.Groups[3].Value.Trim()
        }
    })
    $batteryTemperatureMatch = [regex]::Match($battery.Text, '(?m)^\s*temperature:\s*(-?\d+)\s*$')
    $batteryLevelMatch = [regex]::Match($battery.Text, '(?m)^\s*level:\s*(\d+)\s*$')
    $batteryStatusMatch = [regex]::Match($battery.Text, '(?m)^\s*status:\s*(\d+)\s*$')
    [pscustomobject]@{
        thermalServiceExitCode = $thermal.ExitCode
        batteryDumpExitCode = $battery.ExitCode
        thermalServiceArtifact = "thermal-$Label.txt"
        batteryArtifact = "battery-$Label.txt"
        thermalStatus = if ($thermalStatusMatch.Success) { [int]$thermalStatusMatch.Groups[1].Value } else { $null }
        temperatures = $thermalTemperatures
        batteryTemperatureCelsius = if ($batteryTemperatureMatch.Success) { [double]$batteryTemperatureMatch.Groups[1].Value / 10 } else { $null }
        batteryLevelPercent = if ($batteryLevelMatch.Success) { [int]$batteryLevelMatch.Groups[1].Value } else { $null }
        batteryStatusCode = if ($batteryStatusMatch.Success) { [int]$batteryStatusMatch.Groups[1].Value } else { $null }
    }
}

function Get-DeadlineMissAnalysis {
    param([object]$Result)
    $periodUs = [double]$Result.deadlineUs
    $threadCpuP99Us = [double]$Result.callbacks.all.threadCpuUs.p99
    $threadCpuMaxUs = [double]$Result.callbacks.all.threadCpuUs.max
    $missCount = [int]$Result.deadlineMisses
    $maxConsecutiveMisses = [int]$Result.maxConsecutiveDeadlineMisses
    $wakeLatenessMaxUs = [double]$Result.scheduledWakeLatenessUs.max
    $deadlineOverrunMaxUs = [double]$Result.deadlineOverrunUs.max
    $threadCpuMaximumBelowDeadline = $threadCpuMaxUs -lt $periodUs

    if (!$threadCpuMaximumBelowDeadline) {
        $interpretation = "At least one measured DSP-thread CPU duration ($threadCpuMaxUs us) reached or exceeded the $periodUs us period; compute time can account for deadline pressure in that callback. This synthetic headless run is not an Android audio-callback result."
    } elseif ($missCount -eq 0) {
        $interpretation = "No deadline misses were observed. Maximum DSP-thread CPU time was $threadCpuMaxUs us against a $periodUs us period. This synthetic headless run is not an Android audio-callback result."
    } elseif ($maxConsecutiveMisses -ge 3) {
        $interpretation = "Observed $missCount deadline misses, with up to $maxConsecutiveMisses consecutive. Maximum DSP-thread CPU time ($threadCpuMaxUs us) stayed below the $periodUs us period; maximum wake lateness was $wakeLatenessMaxUs us. Scheduling or wakeup delay may contribute, but this headless run cannot establish cause or predict an Android audio callback."
    } else {
        $interpretation = "Observed $missCount isolated deadline misses, with at most $maxConsecutiveMisses consecutive. Maximum DSP-thread CPU time ($threadCpuMaxUs us) stayed below the $periodUs us period; maximum wake lateness was $wakeLatenessMaxUs us. Scheduling or wakeup delay may contribute, but this headless run cannot establish cause or predict an Android audio callback."
    }

    [ordered]@{
        threadCpuP99Us = $threadCpuP99Us
        threadCpuMaxUs = $threadCpuMaxUs
        callbackWallP99Us = $Result.callbacks.all.wallUs.p99
        callbackWallMaxUs = $Result.callbacks.all.wallUs.max
        scheduledWakeLatenessMaxUs = $wakeLatenessMaxUs
        deadlineOverrunMaxUs = $deadlineOverrunMaxUs
        threadCpuMaximumBelowDeadline = $threadCpuMaximumBelowDeadline
        interpretation = $interpretation
    }
}

New-Item -ItemType Directory -Force -Path @(
    $ResultRoot, $resultDirectory, $fixtureRoot, $headlessRoot, $apkRoot, $benchmarkRoot
) | Out-Null

$report = [ordered]@{
    result = 'IN_PROGRESS'
    repository = $repoRoot
    gitHead = (& git -C $repoRoot rev-parse HEAD).Trim()
    deviceSerial = $DeviceSerial
    capturedAtUtc = [DateTime]::UtcNow.ToString('o')
    physicalDeviceRuntime = 'IN_PROGRESS'
    portableOracleParity = 'NOT RUN'
    nativeSessionRegression = 'NOT RUN'
    instrumentation = 'NOT RUN'
    syntheticPacedBenchmark = 'NOT RUN'
    audioRoute = 'none'
    hearingOutputAuthorized = $false
    artifacts = $resultDirectory
}
Write-JsonFile -Path $reportPath -Value $report

try {
    $deviceListing = & $adb devices -l
    $devicePattern = '^' + [regex]::Escape($DeviceSerial) + '\s+device(?:\s|$)'
    $deviceLine = $deviceListing | Where-Object { $_ -match $devicePattern } | Select-Object -First 1
    if (!$deviceLine) {
        throw "Explicit ADB device is not authorized/connected: $DeviceSerial. Devices: $($deviceListing -join '; ')"
    }

    $device = [ordered]@{
        serial = $DeviceSerial
        manufacturer = Get-DeviceProperty 'ro.product.manufacturer'
        model = Get-DeviceProperty 'ro.product.model'
        product = Get-DeviceProperty 'ro.product.device'
        abi = Get-DeviceProperty 'ro.product.cpu.abi'
        abiList = Get-DeviceProperty 'ro.product.cpu.abilist'
        api = [int](Get-DeviceProperty 'ro.build.version.sdk')
        androidRelease = Get-DeviceProperty 'ro.build.version.release'
        fingerprint = Get-DeviceProperty 'ro.build.fingerprint'
    }
    if ($device.manufacturer -ne 'motorola' -or
        $device.model -ne 'moto g62 5G' -or
        $device.product -ne 'rhodec' -or
        $device.abi -ne 'arm64-v8a' -or
        $device.api -ne 33) {
        throw "Expected Moto g62 5G / Android 13 API 33 / arm64-v8a; observed $($device | ConvertTo-Json -Compress)"
    }
    Write-JsonFile -Path (Join-Path $resultDirectory 'device-info.json') -Value $device
    $report['device'] = $device
    Write-JsonFile -Path $reportPath -Value $report

    $contractLog = & node --test (Join-Path $repoRoot 'tools\android-native-dsp-lab-contract.test.mjs') 2>&1
    $contractExit = $LASTEXITCODE
    $contractLog | Set-Content -LiteralPath (Join-Path $resultDirectory 'android-lab-contract-tests.log') -Encoding utf8
    if ($contractExit -ne 0) { throw 'Android Native DSP no-audio/fixture contract tests failed.' }

    $fixtureLog = & node (Join-Path $repoRoot 'research\detached-native-fir\auto-check.mjs') "--export-portable=$fixtureRoot" 2>&1
    $fixtureExit = $LASTEXITCODE
    $fixtureLog | Set-Content -LiteralPath (Join-Path $resultDirectory 'portable-fixture-generation.log') -Encoding utf8
    if ($fixtureExit -ne 0) { throw 'Canonical portable JS-oracle fixture generation failed.' }
    foreach ($name in @('auto-fir-fixture.bin', 'auto-fir-js-oracle.bin', 'manifest.json')) {
        if (!(Test-Path -LiteralPath (Join-Path $fixtureRoot $name))) {
            throw "Canonical portable fixture is missing $name"
        }
    }
    $manifest = Get-Content -LiteralPath (Join-Path $fixtureRoot 'manifest.json') -Raw | ConvertFrom-Json
    if ($manifest.samplesPerEar -ne 144000 -or $manifest.controlUpdatesPerEar -ne 300) {
        throw "Unexpected canonical fixture dimensions: samplesPerEar=$($manifest.samplesPerEar), controlUpdatesPerEar=$($manifest.controlUpdatesPerEar)"
    }
    if ($manifest.audioRoute -ne 'none' -or $manifest.hearingOutputAuthorized -ne $false) {
        throw 'Portable fixture unexpectedly authorizes an audio route.'
    }

    & (Join-Path $repoRoot 'research\detached-native-fir\build-android.ps1') -OutputDirectory $headlessRoot -FixtureDirectory $fixtureRoot
    if ($LASTEXITCODE -ne 0) { throw 'Android NDK headless build failed.' }
    $autoCheck = Join-Path $headlessRoot 'auto-check-arm64-v8a'
    $sessionCheck = Join-Path $headlessRoot 'native-session-check-arm64-v8a'
    foreach ($path in @($autoCheck, $sessionCheck)) {
        if (!(Test-Path -LiteralPath $path)) { throw "Required ARM64 ELF is missing: $path" }
    }

    $assetRoot = Join-Path $repoRoot 'apps\android-native-dsp-lab\app\build\generated\androidTestAssets\portable-fixture'
    New-Item -ItemType Directory -Force -Path $assetRoot | Out-Null
    foreach ($name in @('auto-fir-fixture.bin', 'auto-fir-js-oracle.bin', 'manifest.json')) {
        Copy-Item -LiteralPath (Join-Path $fixtureRoot $name) -Destination (Join-Path $assetRoot $name) -Force
    }
    $appRoot = Join-Path $repoRoot 'apps\android-native-dsp-lab'
    Push-Location $appRoot
    try {
        $gradleLog = & '.\gradlew.bat' --no-daemon :app:assembleDebug :app:assembleDebugAndroidTest -PtargetAbis=arm64-v8a 2>&1
        $gradleExit = $LASTEXITCODE
    } finally { Pop-Location }
    $gradleLog | Set-Content -LiteralPath (Join-Path $resultDirectory 'arm64-apk-build.log') -Encoding utf8
    if ($gradleExit -ne 0) { throw "Android arm64-v8a APK/instrumentation build failed: $gradleExit" }

    $debugApkSource = Join-Path $appRoot 'app\build\outputs\apk\debug\app-debug.apk'
    $testApkSource = Join-Path $appRoot 'app\build\outputs\apk\androidTest\debug\app-debug-androidTest.apk'
    if (!(Test-Path -LiteralPath $debugApkSource) -or !(Test-Path -LiteralPath $testApkSource)) {
        throw 'ARM64 APK outputs were not found.'
    }
    $debugApk = Join-Path $apkRoot 'hearlens-native-dsp-lab-arm64-v8a-debug.apk'
    $testApk = Join-Path $apkRoot 'hearlens-native-dsp-lab-androidTest-arm64-v8a-debug.apk'
    Copy-Item -LiteralPath $debugApkSource -Destination $debugApk
    Copy-Item -LiteralPath $testApkSource -Destination $testApk
    $aapt = Join-Path $env:ANDROID_HOME 'build-tools\35.0.0\aapt.exe'
    $permissionText = (& $aapt dump permissions $debugApk 2>&1 | Out-String)
    if ($permissionText -match '(?i)RECORD_AUDIO|MODIFY_AUDIO_SETTINGS|BLUETOOTH') {
        throw "Forbidden audio/Bluetooth permission in the ARM64 research APK: $permissionText"
    }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($debugApk)
    try {
        $entries = @($zip.Entries | ForEach-Object { $_.FullName })
        if ('lib/arm64-v8a/libhearlens_native.so' -notin $entries) {
            throw 'ARM64 research APK is missing libhearlens_native.so.'
        }
    } finally { $zip.Dispose() }

    $existingTarget = Invoke-Device -Arguments @('shell', 'pm', 'path', $packageName)
    $existingTest = Invoke-Device -Arguments @('shell', 'pm', 'path', $testPackageName)
    if ($existingTarget.Text -match 'package:' -or $existingTest.Text -match 'package:') {
        throw "Refusing to replace an already installed test package on $DeviceSerial."
    }

    $remoteCreated = $true
    $mkdirResult = Invoke-Device -Arguments @('shell', 'mkdir', '-p', $remoteRoot)
    if ($mkdirResult.ExitCode -ne 0) { throw "Could not create device test directory: $($mkdirResult.Text)" }

    $pushItems = @(
        @{ Local = $autoCheck; Remote = "$remoteRoot/auto-check-arm64-v8a" },
        @{ Local = $sessionCheck; Remote = "$remoteRoot/native-session-check-arm64-v8a" },
        @{ Local = (Join-Path $fixtureRoot 'auto-fir-fixture.bin'); Remote = "$remoteRoot/auto-fir-fixture.bin" },
        @{ Local = (Join-Path $fixtureRoot 'auto-fir-js-oracle.bin'); Remote = "$remoteRoot/auto-fir-js-oracle.bin" },
        @{ Local = (Join-Path $fixtureRoot 'manifest.json'); Remote = "$remoteRoot/manifest.json" }
    )
    foreach ($item in $pushItems) {
        $pushResult = Invoke-Device -Arguments @('push', $item.Local, $item.Remote)
        if ($pushResult.ExitCode -ne 0) { throw "ADB push failed for $($item.Local): $($pushResult.Text)" }
        $pushResult.Text | Add-Content -LiteralPath (Join-Path $resultDirectory 'adb-transfer.log')
    }
    $chmodResult = Invoke-Device -Arguments @('shell', 'chmod', '700',
        "$remoteRoot/auto-check-arm64-v8a", "$remoteRoot/native-session-check-arm64-v8a")
    if ($chmodResult.ExitCode -ne 0) { throw "Could not mark ARM64 headless ELF files executable: $($chmodResult.Text)" }

    $runNativeCommand = "cd $remoteRoot && ./auto-check-arm64-v8a auto-fir-fixture.bin > android-result.bin"
    $nativeResult = Invoke-Device -Arguments @('shell', $runNativeCommand)
    if ($nativeResult.ExitCode -ne 0) { throw "Android ARM64 Auto-FIR ELF failed: $($nativeResult.Text)" }
    $runtimeResultPath = Join-Path $resultDirectory 'android-arm64-result.bin'
    $pullResult = Invoke-Device -Arguments @('pull', "$remoteRoot/android-result.bin", $runtimeResultPath)
    if ($pullResult.ExitCode -ne 0) { throw "Could not pull Android ARM64 result: $($pullResult.Text)" }
    $verifier = Join-Path $repoRoot 'research\detached-native-fir\verify-portable-output.mjs'
    $oracleLog = & node $verifier (Join-Path $fixtureRoot 'manifest.json') (Join-Path $fixtureRoot 'auto-fir-fixture.bin') (Join-Path $fixtureRoot 'auto-fir-js-oracle.bin') $runtimeResultPath 2>&1
    $oracleExit = $LASTEXITCODE
    $oracleText = ($oracleLog | Out-String).Trim()
    $oracleText | Set-Content -LiteralPath (Join-Path $resultDirectory 'oracle-parity.json') -Encoding utf8
    if ($oracleExit -ne 0) { throw "Existing JS oracle rejected ARM64 Android output: $oracleText" }
    $oracleReport = $oracleText | ConvertFrom-Json
    if ($oracleReport.result -ne 'PASS' -or
        $oracleReport.samplesPerEar -ne 144000 -or
        $oracleReport.controlUpdatesPerEar -ne 300 -or
        !$oracleReport.diagnosticsAndControlIndicesExact -or
        $oracleReport.audioRoute -ne 'none' -or
        $oracleReport.hearingOutputAuthorized -ne $false) {
        throw "Portable verifier output did not meet the required dimensions and no-route contract: $oracleText"
    }
    $report['portableOracleParity'] = 'PASS'
    $report['oracle'] = $oracleReport
    $report['portableFixture'] = @{
        samplesPerEar = $manifest.samplesPerEar
        controlUpdatesPerEar = $manifest.controlUpdatesPerEar
        fixtureSha256 = (Get-FileHash -Algorithm SHA256 (Join-Path $fixtureRoot 'auto-fir-fixture.bin')).Hash.ToLowerInvariant()
        jsOracleSha256 = (Get-FileHash -Algorithm SHA256 (Join-Path $fixtureRoot 'auto-fir-js-oracle.bin')).Hash.ToLowerInvariant()
        manifestSha256 = (Get-FileHash -Algorithm SHA256 (Join-Path $fixtureRoot 'manifest.json')).Hash.ToLowerInvariant()
        androidResultSha256 = (Get-FileHash -Algorithm SHA256 $runtimeResultPath).Hash.ToLowerInvariant()
        autoCheckElfSha256 = (Get-FileHash -Algorithm SHA256 $autoCheck).Hash.ToLowerInvariant()
        sessionCheckElfSha256 = (Get-FileHash -Algorithm SHA256 $sessionCheck).Hash.ToLowerInvariant()
    }
    Write-JsonFile -Path $reportPath -Value $report

    $benchmarkExe = Join-Path $headlessRoot 'auto-bench-arm64-v8a'
    $benchmarkCompiler = Join-Path $env:ANDROID_NDK_HOME 'toolchains\llvm\prebuilt\windows-x86_64\bin\aarch64-linux-android29-clang++.cmd'
    $benchmarkFlags = @('-std=c++17', '-O2', '-fno-fast-math', '-ffp-contract=off',
        '-Wall', '-Wextra', '-Wpedantic', '-Werror', '-static-libstdc++',
        '-pthread', '-DANDROID_API_LEVEL=29')
    $benchmarkBuildLog = & $benchmarkCompiler @benchmarkFlags (Join-Path $repoRoot 'research\detached-native-fir\auto_bench.cpp') '-o' $benchmarkExe 2>&1
    $benchmarkBuildExit = $LASTEXITCODE
    $benchmarkBuildLog | Set-Content -LiteralPath (Join-Path $benchmarkRoot 'arm64-benchmark-build.log') -Encoding utf8
    if ($benchmarkBuildExit -ne 0) { throw "Android ARM64 paced benchmark build failed: $benchmarkBuildExit" }
    $readelf = Join-Path $env:ANDROID_NDK_HOME 'toolchains\llvm\prebuilt\windows-x86_64\bin\llvm-readelf.exe'
    $benchmarkElf = (& $readelf -h $benchmarkExe 2>&1 | Out-String)
    if ($benchmarkElf -notmatch 'AArch64') { throw 'Paced benchmark ELF is not AArch64.' }

    $benchmarkFixture = Join-Path $benchmarkRoot 'auto-fir-benchmark-fixture.bin'
    $benchmarkFixtureLog = & node (Join-Path $repoRoot 'research\detached-native-fir\auto-bench.mjs') "--fixture-output=$benchmarkFixture" --fixture-only 2>&1
    $benchmarkFixtureExit = $LASTEXITCODE
    $benchmarkFixtureText = ($benchmarkFixtureLog | Out-String).Trim()
    $benchmarkFixtureText | Set-Content -LiteralPath (Join-Path $benchmarkRoot 'fixture-generation.json') -Encoding utf8
    if ($benchmarkFixtureExit -ne 0 -or !(Test-Path -LiteralPath $benchmarkFixture)) {
        throw "Could not generate the existing synthetic benchmark fixture: $benchmarkFixtureText"
    }
    $benchmarkFixtureInfo = $benchmarkFixtureText | ConvertFrom-Json
    if ($benchmarkFixtureInfo.result -ne 'FIXTURE_READY') { throw 'Benchmark fixture-only export did not return FIXTURE_READY.' }

    $beforeSnapshot = Save-DeviceSnapshot -Label 'before-benchmark'
    $report['thermalBefore'] = $beforeSnapshot
    $report['syntheticPacedBenchmark'] = 'IN_PROGRESS'
    Write-JsonFile -Path $reportPath -Value $report

    foreach ($item in @(
        @{ Local = $benchmarkExe; Remote = "$remoteRoot/auto-bench-arm64-v8a" },
        @{ Local = $benchmarkFixture; Remote = "$remoteRoot/auto-fir-benchmark-fixture.bin" }
    )) {
        $pushResult = Invoke-Device -Arguments @('push', $item.Local, $item.Remote)
        if ($pushResult.ExitCode -ne 0) { throw "ADB benchmark push failed for $($item.Local): $($pushResult.Text)" }
        $pushResult.Text | Add-Content -LiteralPath (Join-Path $resultDirectory 'adb-transfer.log')
    }
    $chmodResult = Invoke-Device -Arguments @('shell', 'chmod', '700', "$remoteRoot/auto-bench-arm64-v8a")
    if ($chmodResult.ExitCode -ne 0) { throw "Could not mark paced benchmark executable: $($chmodResult.Text)" }
    $benchmarkStartedUtc = [DateTime]::UtcNow.ToString('o')
    $benchmarkCommand = "cd $remoteRoot && ./auto-bench-arm64-v8a auto-fir-benchmark-fixture.bin --paced-seconds=$BenchmarkSeconds --paced-block=$BenchmarkFrames > benchmark-result.json"
    $benchmarkRun = Invoke-Device -Arguments @('shell', $benchmarkCommand)
    $benchmarkFinishedUtc = [DateTime]::UtcNow.ToString('o')
    $benchmarkRun.Text | Set-Content -LiteralPath (Join-Path $benchmarkRoot 'device-run.log') -Encoding utf8
    if ($benchmarkRun.ExitCode -ne 0) { throw "Android ARM64 paced benchmark failed with exit $($benchmarkRun.ExitCode): $($benchmarkRun.Text)" }
    $benchmarkResultPath = Join-Path $benchmarkRoot 'android-arm64-benchmark-result.json'
    $pullResult = Invoke-Device -Arguments @('pull', "$remoteRoot/benchmark-result.json", $benchmarkResultPath)
    if ($pullResult.ExitCode -ne 0) { throw "Could not pull Android benchmark result: $($pullResult.Text)" }
    $benchmarkResult = Get-Content -LiteralPath $benchmarkResultPath -Raw | ConvertFrom-Json
    $expectedCallbacks = [int](($BenchmarkSeconds * 48000) / $BenchmarkFrames)
    $callbackCountDelta = [Math]::Abs([int]$benchmarkResult.measuredCallbacks - $expectedCallbacks)
    if ($benchmarkResult.mode -ne 'paced-complete-auto-fir' -or
        $benchmarkResult.blockFrames -ne $BenchmarkFrames -or
        $benchmarkResult.requestedSeconds -ne $BenchmarkSeconds -or
        $callbackCountDelta -gt 1 -or
        [Math]::Abs([double]$benchmarkResult.wallElapsedSeconds - $BenchmarkSeconds) -gt 0.1 -or
        $benchmarkResult.allocationCount -ne 0 -or
        !$benchmarkResult.allocationProbePositiveControls -or
        !$benchmarkResult.finiteOutput) {
        throw "Paced benchmark report did not meet duration/callback-count/allocation/finite-output checks: $($benchmarkResult | ConvertTo-Json -Depth 8 -Compress)"
    }
    $afterSnapshot = Save-DeviceSnapshot -Label 'after-benchmark'
    $deadlineMissAnalysis = Get-DeadlineMissAnalysis -Result $benchmarkResult
    $report['thermalAfter'] = $afterSnapshot
    $report['syntheticPacedBenchmark'] = 'PASS'
    $report['benchmark'] = @{
        mode = $benchmarkResult.mode
        actualAndroidAudioCallback = $false
        callbackFrames = $benchmarkResult.blockFrames
        deadlinePeriodUs = $benchmarkResult.deadlineUs
        requestedSeconds = $benchmarkResult.requestedSeconds
        measuredCallbacks = $benchmarkResult.measuredCallbacks
        controlUpdates = $benchmarkResult.controlUpdates
        callbackWallUs = $benchmarkResult.callbacks.all.wallUs
        callbackThreadCpuUs = $benchmarkResult.callbacks.all.threadCpuUs
        deadlineMisses = $benchmarkResult.deadlineMisses
        deadlineMissRate = $benchmarkResult.deadlineMissRate
        deadlineMissRatePercent = 100 * $benchmarkResult.deadlineMissRate
        maxConsecutiveDeadlineMisses = $benchmarkResult.maxConsecutiveDeadlineMisses
        deadlineOverrunUs = $benchmarkResult.deadlineOverrunUs
        scheduledWakeLatenessUs = $benchmarkResult.scheduledWakeLatenessUs
        monitoredCallbackAllocations = $benchmarkResult.allocationCount
        dspThreadCpuSeconds = $benchmarkResult.threadCpuSeconds
        dspThreadCpuPercentOfWall = 100 * $benchmarkResult.threadCpuToWallRatio
        deadlineMissAnalysis = $deadlineMissAnalysis
        autoBenchElfSha256 = (Get-FileHash -Algorithm SHA256 $benchmarkExe).Hash.ToLowerInvariant()
        fixtureSha256 = (Get-FileHash -Algorithm SHA256 $benchmarkFixture).Hash.ToLowerInvariant()
        resultSha256 = (Get-FileHash -Algorithm SHA256 $benchmarkResultPath).Hash.ToLowerInvariant()
        startedAtUtc = $benchmarkStartedUtc
        finishedAtUtc = $benchmarkFinishedUtc
        thermalBefore = $beforeSnapshot
        thermalAfter = $afterSnapshot
    }
    Write-JsonFile -Path $reportPath -Value $report

    $sessionRun = Invoke-Device -Arguments @('shell', "$remoteRoot/native-session-check-arm64-v8a")
    $sessionRun.Text | Set-Content -LiteralPath (Join-Path $resultDirectory 'native-session-check.log') -Encoding utf8
    if ($sessionRun.ExitCode -ne 0 -or $sessionRun.Text -notmatch '2000 concurrent invalidations PASS') {
        throw "Android ARM64 Native session regression failed: $($sessionRun.Text)"
    }
    $report['nativeSessionRegression'] = 'PASS'

    $targetInstall = Invoke-Device -Arguments @('install', '-r', $debugApk)
    if ($targetInstall.ExitCode -ne 0) { throw "Could not install isolated research APK: $($targetInstall.Text)" }
    $installedTarget = $true
    $testInstall = Invoke-Device -Arguments @('install', '-r', $testApk)
    if ($testInstall.ExitCode -ne 0) { throw "Could not install ARM64 instrumentation APK: $($testInstall.Text)" }
    $installedTest = $true
    $instrumentation = Invoke-Device -Arguments @('shell', 'am', 'instrument', '-w', '-r', $runner)
    $instrumentation.Text | Set-Content -LiteralPath (Join-Path $resultDirectory 'instrumentation-tests.log') -Encoding utf8
    if ($instrumentation.ExitCode -ne 0 -or
        $instrumentation.Text -notmatch 'OK\s+\(\d+ tests?\)' -or
        $instrumentation.Text -match 'FAILURES!!!|There was \d+ failure') {
        throw "Android ARM64 instrumentation regression failed: $($instrumentation.Text)"
    }
    $report['instrumentation'] = 'PASS'
    $report['instrumentationSummary'] = ([regex]::Match($instrumentation.Text, 'OK\s+\((\d+) tests?\)')).Value

    $report['result'] = 'PASS'
    $report['physicalDeviceRuntime'] = 'PASS: Android API 33 arm64-v8a physical device'
    $report['apkSha256'] = @{
        app = (Get-FileHash -Algorithm SHA256 $debugApk).Hash.ToLowerInvariant()
        instrumentation = (Get-FileHash -Algorithm SHA256 $testApk).Hash.ToLowerInvariant()
    }
    $report['audioRoute'] = $manifest.audioRoute
    $report['hearingOutputAuthorized'] = $manifest.hearingOutputAuthorized
    Write-JsonFile -Path $reportPath -Value $report
    Write-Output "Physical ARM64 oracle parity: PASS; 144000 samples/ear; 300 control updates/ear."
    Write-Output "Native session regression: PASS; instrumentation: $($report['instrumentationSummary'])."
    Write-Output "Synthetic paced benchmark: PASS; $BenchmarkSeconds seconds at $BenchmarkFrames frames; deadline misses=$($benchmarkResult.deadlineMisses)."
    Write-Output "Results: $resultDirectory"
} catch {
    $report['result'] = 'FAIL'
    $report['failure'] = $_.Exception.Message
    $report['failedAtUtc'] = [DateTime]::UtcNow.ToString('o')
    Write-JsonFile -Path $reportPath -Value $report
    throw
} finally {
    if ($installedTest) {
        Invoke-Device -Arguments @('shell', 'am', 'force-stop', $testPackageName) | Out-Null
        Invoke-Device -Arguments @('uninstall', $testPackageName) | Out-Null
    }
    if ($installedTarget) {
        Invoke-Device -Arguments @('shell', 'am', 'force-stop', $packageName) | Out-Null
        Invoke-Device -Arguments @('uninstall', $packageName) | Out-Null
    }
    if ($remoteCreated) {
        Invoke-Device -Arguments @('shell', 'rm', '-rf', $remoteRoot) | Out-Null
    }
}
