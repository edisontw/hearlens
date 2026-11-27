[CmdletBinding()]
param(
    [string]$SdkRoot = 'D:\Dev\Android\sdk',
    [string]$EmulatorSerial = 'emulator-5554',
    [string]$ResultsRoot = 'D:\Dev\Android\test-results\hearlens\n07-first-callback'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$appProject = Join-Path $repoRoot 'apps\android-aaudio-physical-dsp-shadow-lab'
$gradleWrapper = Join-Path $repoRoot 'apps\android-native-dsp-lab\gradlew.bat'
$adb = Join-Path $SdkRoot 'platform-tools\adb.exe'
$node = (Get-Command node -ErrorAction Stop).Source

if (-not (Test-Path -LiteralPath $adb)) { throw "Android platform-tools not found: $adb" }
if (-not (Test-Path -LiteralPath $gradleWrapper)) { throw "Gradle wrapper not found: $gradleWrapper" }
if ($EmulatorSerial -notmatch '^emulator-[0-9]+$') {
    throw 'This no-audio comparison runner accepts emulator serials only.'
}

$deviceLines = & $adb devices
if ($LASTEXITCODE -ne 0) { throw 'adb devices failed.' }
$selected = @($deviceLines | Where-Object { $_ -match "^$([regex]::Escape($EmulatorSerial))\s+device$" })
if ($selected.Count -ne 1) { throw "Selected emulator is not uniquely online: $EmulatorSerial" }
$isEmulator = (& $adb -s $EmulatorSerial shell getprop ro.kernel.qemu).Trim()
$abi = (& $adb -s $EmulatorSerial shell getprop ro.product.cpu.abi).Trim()
if ($LASTEXITCODE -ne 0 -or $isEmulator -ne '1' -or $abi -ne 'x86_64') {
    throw "Refusing non-emulator/non-x86_64 target: serial=$EmulatorSerial qemu=$isEmulator abi=$abi"
}

$env:ANDROID_HOME = $SdkRoot
$env:ANDROID_SDK_ROOT = $SdkRoot
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$runDirectory = Join-Path $ResultsRoot $timestamp
New-Item -ItemType Directory -Path $runDirectory -Force | Out-Null
$fixtureDirectory = Join-Path $runDirectory 'portable-fixture'
New-Item -ItemType Directory -Path $fixtureDirectory -Force | Out-Null

$fixtureCommand = @(
    (Join-Path $repoRoot 'research\detached-native-fir\auto-check.mjs'),
    "--export-portable=$fixtureDirectory"
)
& $node @fixtureCommand
if ($LASTEXITCODE -ne 0) { throw 'Canonical JS-oracle fixture generation failed.' }

foreach ($assetRoot in @(
    (Join-Path $appProject 'app\build\generated\mainAssets\portable-fixture'),
    (Join-Path $appProject 'app\build\generated\androidTestAssets\portable-fixture')
)) {
    New-Item -ItemType Directory -Path $assetRoot -Force | Out-Null
    foreach ($name in @('auto-fir-fixture.bin', 'auto-fir-js-oracle.bin', 'manifest.json')) {
        Copy-Item -LiteralPath (Join-Path $fixtureDirectory $name) -Destination (Join-Path $assetRoot $name) -Force
    }
}

$runRecords = [System.Collections.Generic.List[object]]::new()
$installedApp = $false
$installedTest = $false
try {
    foreach ($profile in @('O0', 'O2')) {
        $level = $profile.Substring(1)
        $profileDirectory = Join-Path $runDirectory $profile
        New-Item -ItemType Directory -Path $profileDirectory -Force | Out-Null
        $gradleLog = Join-Path $profileDirectory 'gradle-build.log'
        $buildOutput = & $gradleWrapper --no-daemon --project-dir $appProject `
            :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest `
            -PtargetAbis=x86_64 "-PnativeOptimizationLevel=$level" 2>&1
        $gradleExit = $LASTEXITCODE
        $buildOutput | Set-Content -LiteralPath $gradleLog -Encoding utf8
        if ($gradleExit -ne 0) { throw "$profile Gradle build failed; see $gradleLog" }

        $mainApk = Join-Path $appProject 'app\build\outputs\apk\debug\app-debug.apk'
        $testApk = Join-Path $appProject 'app\build\outputs\apk\androidTest\debug\app-debug-androidTest.apk'
        if (-not (Test-Path -LiteralPath $mainApk) -or -not (Test-Path -LiteralPath $testApk)) {
            throw "$profile build did not produce both APKs."
        }
        $savedMainApk = Join-Path $profileDirectory 'hearlens-physical-dsp-shadow-x86_64.apk'
        $savedTestApk = Join-Path $profileDirectory 'hearlens-physical-dsp-shadow-androidTest.apk'
        Copy-Item -LiteralPath $mainApk -Destination $savedMainApk -Force
        Copy-Item -LiteralPath $testApk -Destination $savedTestApk -Force

        $compileCandidates = Get-ChildItem -LiteralPath (Join-Path $appProject 'app\.cxx\Debug') `
            -Recurse -Filter compile_commands.json -File |
            Where-Object { $_.FullName -match '[\\/]x86_64[\\/]compile_commands\.json$' }
        $compileCommands = $null
        foreach ($candidate in $compileCandidates) {
            $candidateEntries = Get-Content -Raw -LiteralPath $candidate.FullName | ConvertFrom-Json
            if (@($candidateEntries | Where-Object {
                $_.command -match "-DHEARLENS_NATIVE_OPT_LEVEL=$level(?:\s|$)"
            }).Count -eq 3) {
                $compileCommands = $candidate
                break
            }
        }
        if (-not $compileCommands) { throw "$profile compile_commands.json was not generated." }
        $compileCommandsCopy = Join-Path $profileDirectory 'native-compile-commands.json'
        Copy-Item -LiteralPath $compileCommands.FullName -Destination $compileCommandsCopy -Force
        $verificationPath = Join-Path $profileDirectory 'native-compile-verification.json'
        $verificationOutput = & $node (Join-Path $repoRoot 'tools\android\verify-native-optimization.mjs') `
            $compileCommandsCopy $profile 2>&1
        $verifyExit = $LASTEXITCODE
        $verificationOutput | Set-Content -LiteralPath $verificationPath -Encoding utf8
        if ($verifyExit -ne 0) { throw "$profile native flag verification failed: $($verificationOutput -join ' ')" }

        $appSha = (Get-FileHash -Algorithm SHA256 -LiteralPath $savedMainApk).Hash.ToLowerInvariant()
        $testSha = (Get-FileHash -Algorithm SHA256 -LiteralPath $savedTestApk).Hash.ToLowerInvariant()
        $compileSha = (Get-FileHash -Algorithm SHA256 -LiteralPath $compileCommandsCopy).Hash.ToLowerInvariant()
        $buildInfo = [ordered]@{
            profile = $profile
            sourceCommit = (git -C $repoRoot rev-parse HEAD).Trim()
            appApkSha256 = $appSha
            instrumentationApkSha256 = $testSha
            compileCommandsSha256 = $compileSha
            strictCallbackDeadline = $true
            sampleRate = 48000
            primaryFrames = 192
            physicalStreamOpened = $false
            targetSerial = $EmulatorSerial
            targetAbi = $abi
            targetIsEmulator = $true
        }
        $buildInfo | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $profileDirectory 'build-info.json') -Encoding utf8

        & $adb -s $EmulatorSerial install -r $savedMainApk
        if ($LASTEXITCODE -ne 0) { throw "$profile app install failed on selected emulator." }
        $installedApp = $true
        & $adb -s $EmulatorSerial install -r $savedTestApk
        if ($LASTEXITCODE -ne 0) { throw "$profile instrumentation install failed on selected emulator." }
        $installedTest = $true
        & $adb -s $EmulatorSerial logcat -c
        if ($LASTEXITCODE -ne 0) { throw 'Could not clear selected emulator logcat.' }

        $instrumentLog = Join-Path $profileDirectory 'instrumentation.log'
        $instrumentOutput = & $adb -s $EmulatorSerial shell am instrument -w -r `
            'org.hearlens.physicaldsp.test/androidx.test.runner.AndroidJUnitRunner' 2>&1
        $instrumentExit = $LASTEXITCODE
        $instrumentOutput | Set-Content -LiteralPath $instrumentLog -Encoding utf8
        if ($instrumentExit -ne 0 -or -not ($instrumentOutput -match 'OK \(')) {
            throw "$profile Android instrumentation failed; see $instrumentLog"
        }

        $reportPath = Join-Path $profileDirectory "n07-no-audio-$profile.json"
        $reportOutput = & $adb -s $EmulatorSerial shell run-as `
            org.hearlens.physicaldsp cat "cache/n07-no-audio-$profile.json" 2>&1
        $reportExit = $LASTEXITCODE
        if ($reportExit -ne 0) { throw "$profile benchmark report retrieval failed: $($reportOutput -join ' ')" }
        $reportOutput | Set-Content -LiteralPath $reportPath -Encoding utf8
        $report = Get-Content -Raw -LiteralPath $reportPath | ConvertFrom-Json
        if ($report.physical_stream_opened -ne $false -or $report.nonzero_samples_observed -ne 0) {
            throw "$profile no-audio contract result failed."
        }

        $runRecords.Add([pscustomobject]@{
            profile = $profile
            sourceCommit = $buildInfo.sourceCommit
            apkSha256 = $appSha
            compileCommandsSha256 = $compileSha
            instrumentationExitCode = $instrumentExit
            callbackRecords = $report.records.Count
            deadlineFailures = $report.deadline_failures
            callbackOverruns = $report.callback_overruns
            zeroSamplesVerified = $report.zero_samples_verified
            nonzeroSamplesObserved = $report.nonzero_samples_observed
            physicalStreamOpened = $report.physical_stream_opened
        })
    }

    & $adb -s $EmulatorSerial uninstall org.hearlens.physicaldsp.test | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not uninstall the no-audio instrumentation package.' }
    $installedTest = $false
    & $adb -s $EmulatorSerial uninstall org.hearlens.physicaldsp | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not uninstall the no-audio benchmark package.' }
    $installedApp = $false
    $appPackagePath = & $adb -s $EmulatorSerial shell pm path org.hearlens.physicaldsp 2>&1
    $testPackagePath = & $adb -s $EmulatorSerial shell pm path org.hearlens.physicaldsp.test 2>&1
    if (($appPackagePath -join "`n") -match '^package:' -or
        ($testPackagePath -join "`n") -match '^package:') {
        throw 'No-audio APK uninstall verification failed.'
    }

    $summary = [ordered]@{
        contract = 'NO_AUDIO_NATIVE_DSP_BENCHMARK'
        runStartedAt = $timestamp
        deviceSerial = $EmulatorSerial
        deviceAbi = $abi
        targetIsEmulator = $true
        mainAndTestPackagesUninstalledAfterRun = $true
        profiles = @($runRecords)
    }
    $summary | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $runDirectory 'run-summary.json') -Encoding utf8
    Write-Output "N07 no-audio O0/O2 comparison completed: $runDirectory"
}
finally {
    if ($installedTest) {
        & $adb -s $EmulatorSerial uninstall org.hearlens.physicaldsp.test | Out-Null
    }
    if ($installedApp) {
        & $adb -s $EmulatorSerial uninstall org.hearlens.physicaldsp | Out-Null
    }
}
