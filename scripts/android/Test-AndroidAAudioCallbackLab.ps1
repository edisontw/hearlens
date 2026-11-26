[CmdletBinding()]
param(
    [ValidateRange(100, 300000)]
    [int]$DurationMs = 2000,
    [switch]$DiagnosticMatrix,
    [ValidateRange(100, 300000)]
    [int]$BaselineDurationMs = 20000,
    [ValidateRange(100, 300000)]
    [int]$VariantDurationMs = 10000,
    [switch]$SkipZeroScan,
    [switch]$KeepEmulator
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\Initialize-AndroidEnvironment.ps1"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$appRoot = Join-Path $repoRoot 'apps\android-aaudio-callback-lab'
$resultRoot = 'D:\Dev\Android\test-results\hearlens\aaudio-callback'
$serial = 'emulator-5580'
$packageName = 'org.hearlens.aaudiocallback'
$runner = "$packageName.test/androidx.test.runner.AndroidJUnitRunner"
$testClass = 'org.hearlens.aaudiocallback.AAudioCallbackRuntimeTest'
$mainMethod = 'aaudioCallbackUsesOnlyZeroOutputAndReportsActualFrames'
$lifecycleMethod = 'callbackStopRestartAndBackgroundInvalidationAreRecorded'
$startedHere = $false
$avdName = 'HearLens_API29_x86_64'
$avdConfig = Join-Path $env:ANDROID_AVD_HOME "$avdName.avd\config.ini"
$runStamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$runIdSuffix = [guid]::NewGuid().ToString('N').Substring(0, 8)
$runDir = Join-Path $resultRoot "$runStamp-$runIdSuffix"
$fixtureRoot = Join-Path $runDir 'portable-fixture'
$apkRoot = Join-Path $runDir 'apk'
$scenarioResults = [System.Collections.Generic.List[object]]::new()
$scriptErrors = [System.Collections.Generic.List[string]]::new()
$runIdToDirectory = @{}

if (!(Test-Path -LiteralPath $avdConfig)) {
    throw "Expected isolated AVD config is missing: $avdConfig"
}
$configText = Get-Content -LiteralPath $avdConfig -Raw
if ($configText -notmatch '(?m)^hw\.audioOutput\s*=\s*no\s*$' -or
    $configText -notmatch '(?m)^hw\.audioInput\s*=\s*no\s*$') {
    throw 'AAudio callback test requires the dedicated audio-disabled HearLens AVD.'
}

function Save-TargetDiagnostics {
    param([Parameter(Mandatory)][string]$Directory)

    $commands = @(
        @{ Name = 'device-properties'; Args = @('shell', 'getprop') },
        @{ Name = 'dumpsys-audio'; Args = @('shell', 'dumpsys', 'audio') },
        @{ Name = 'dumpsys-media-audio-flinger'; Args = @('shell', 'dumpsys', 'media.audio_flinger') },
        @{ Name = 'dumpsys-media-audio-policy'; Args = @('shell', 'dumpsys', 'media.audio_policy') }
    )
    $results = [System.Collections.Generic.List[object]]::new()
    foreach ($entry in $commands) {
        $commandArgs = @('-s', $serial) + $entry.Args
        $output = & $env:ANDROID_ADB @commandArgs 2>&1
        $exitCode = $LASTEXITCODE
        $output | Set-Content -LiteralPath (Join-Path $Directory "$($entry.Name).txt") -Encoding utf8
        $results.Add([pscustomobject]@{ name = $entry.Name; exitCode = $exitCode })
    }
    return ,$results.ToArray()
}

function Invoke-Scenario {
    param(
        [Parameter(Mandatory)][string]$ScenarioId,
        [Parameter(Mandatory)][int]$Duration,
        [Parameter(Mandatory)][bool]$RunNativeSession,
        [Parameter(Mandatory)][int]$SampleRate,
        [Parameter(Mandatory)][string]$Sharing,
        [Parameter(Mandatory)][string]$Usage,
        [Parameter(Mandatory)][string]$BufferPolicy,
        [Parameter(Mandatory)][bool]$VerifyZeroSamples,
        [int]$ExpectedReportCount = 1,
        [switch]$LifecycleOnly
    )

    $testStamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $scenarioRunId = [guid]::NewGuid().ToString('N')
    $scenarioDir = Join-Path $runDir "tests\$testStamp-$ScenarioId-$($scenarioRunId.Substring(0, 8))"
    New-Item -ItemType Directory -Force -Path $scenarioDir | Out-Null
    $runIdToDirectory[$scenarioRunId] = $scenarioDir

    $requested = [ordered]@{
        scenarioId = $ScenarioId
        workload = if ($RunNativeSession) { 'NATIVE_SESSION' } else { 'ZERO_ONLY' }
        durationMs = $Duration
        requestedSampleRate = $SampleRate
        requestedSampleRatePolicy = if ($SampleRate -eq 0) { 'SYSTEM_NATIVE_UNSPECIFIED' } else { 'EXPLICIT' }
        requestedSharingMode = $Sharing
        requestedUsage = $Usage
        requestedBufferPolicy = $BufferPolicy
        requestedPerformanceMode = 'LOW_LATENCY'
        zeroSampleVerification = $VerifyZeroSamples
        output = 'zero-only'
        audioInput = 'disabled'
        audioOutput = 'disabled'
        adbSerial = $serial
        avd = $avdName
    }
    $requested | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $scenarioDir 'requested-config.json') -Encoding utf8

    & $env:ANDROID_ADB -s $serial logcat -c -b all 2>&1 | Out-Null
    $adbArguments = @('shell', 'am', 'instrument', '-w', '-r')
    $method = if ($LifecycleOnly) { $lifecycleMethod } else { $mainMethod }
    $adbArguments += @('-e', 'class', "$testClass#$method")
    $adbArguments += @('-e', 'aaudioRunId', $scenarioRunId)
    if (!$LifecycleOnly) {
        $adbArguments += @('-e', 'aaudioDurationMs', "$Duration")
        $verifyText = $VerifyZeroSamples.ToString().ToLowerInvariant()
        $adbArguments += @('-e', 'aaudioVerifyZero', $verifyText)
        $adbArguments += @('-e', 'aaudioWorkload', $(if ($RunNativeSession) { 'NATIVE_SESSION' } else { 'ZERO_ONLY' }))
        $adbArguments += @('-e', 'aaudioSampleRate', "$SampleRate")
        $adbArguments += @('-e', 'aaudioSharing', $Sharing)
        $adbArguments += @('-e', 'aaudioUsage', $Usage)
        $adbArguments += @('-e', 'aaudioBufferPolicy', $BufferPolicy)
    }
    $adbArguments += $runner
    $instrumentationOutput = & $env:ANDROID_ADB -s $serial @adbArguments 2>&1
    $instrumentationExitCode = $LASTEXITCODE
    $instrumentationText = $instrumentationOutput -join "`n"
    $instrumentationText | Set-Content -LiteralPath (Join-Path $scenarioDir 'instrumentation.log') -Encoding utf8

    $logcatOutput = & $env:ANDROID_ADB -s $serial logcat -b all -d -v threadtime 2>&1
    $logcatText = $logcatOutput -join "`n"
    $logcatText | Set-Content -LiteralPath (Join-Path $scenarioDir 'logcat-full.log') -Encoding utf8
    $logcatOutput | Select-String -Pattern 'AAudio|AudioFlinger|AudioPolicy|AudioTrack|audio_hw|audioserver|HearLensAAudioLab' |
        ForEach-Object { $_.Line } |
        Set-Content -LiteralPath (Join-Path $scenarioDir 'logcat-audio-filtered.log') -Encoding utf8
    $diagnosticResults = Save-TargetDiagnostics -Directory $scenarioDir

    $runtimeReports = @()
    for ($index = 0; $index -lt $ExpectedReportCount; $index++) {
        $resultFile = "aaudio-result-$scenarioRunId-$index.json"
        $devicePath = "files/$resultFile"
        $resultOutput = & $env:ANDROID_ADB -s $serial shell run-as $packageName cat $devicePath 2>&1
        $resultExitCode = $LASTEXITCODE
        if ($resultExitCode -ne 0) { break }
        $resultText = $resultOutput -join "`n"
        $resultText | Set-Content -LiteralPath (Join-Path $scenarioDir "native-result-$index.json") -Encoding utf8
        $runtimeReports += ($resultText | ConvertFrom-Json)
    }
    $runtimeReports | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $scenarioDir 'native-results.json') -Encoding utf8

    $instrumentationPassed = $instrumentationExitCode -eq 0 -and
        $instrumentationText -match 'OK \(\d+ test\)' -and
        $instrumentationText -notmatch 'FAILURES!!!|There was \d+ failure'
    if (!$instrumentationPassed) {
        $scriptErrors.Add("$ScenarioId instrumentation failed with exit $instrumentationExitCode")
    }
    if ($runtimeReports.Count -ne $ExpectedReportCount) {
        $scriptErrors.Add("$ScenarioId returned $($runtimeReports.Count) of $ExpectedReportCount full result files")
    }

    return [pscustomobject]@{
        scenarioId = $ScenarioId
        runId = $scenarioRunId
        durationMs = $Duration
        directory = $scenarioDir
        instrumentationExitCode = $instrumentationExitCode
        instrumentationPassed = $instrumentationPassed
        nativeResults = @($runtimeReports)
        deviceDiagnostics = @($diagnosticResults)
    }
}

function Get-PrimaryMeasurement {
    param([Parameter(Mandatory)]$Scenario)
    return $Scenario.nativeResults | Where-Object {
        $_.fault_mode -eq 0 -and $_.requested_duration_ms -eq $Scenario.durationMs
    } | Select-Object -First 1
}

function Test-ClearImprovement {
    param([Parameter(Mandatory)]$Candidate, [Parameter(Mandatory)]$Baseline)

    if (!$Candidate -or !$Baseline -or !$Candidate.dsp_benchmark_valid -or
        $Candidate.run_completion -ne 'COMPLETE' -or
        $Baseline.run_completion -ne 'COMPLETE' -or
        $Candidate.run_wall_ns -le 0 -or $Baseline.run_wall_ns -le 0 -or
        $Candidate.xrun_delta -lt 0 -or $Baseline.xrun_delta -lt 0 -or
        !$Candidate.requested_performance_mode_achieved -or
        !$Candidate.requested_sharing_mode_achieved -or
        !$Candidate.requested_usage_achieved -or
        !$Candidate.requested_buffer_policy_achieved -or
        $Candidate.dsp_deadline_failure_count -ne 0) { return $false }

    $candidateRunNs = [double]$Candidate.run_wall_ns
    $baselineRunNs = [double]$Baseline.run_wall_ns
    $candidateXrunRatePerSecond = [double]$Candidate.xrun_delta * 1e9 / $candidateRunNs
    $baselineXrunRatePerSecond = [double]$Baseline.xrun_delta * 1e9 / $baselineRunNs
    $candidateOverrunRatePerSecond = [double]$Candidate.callback_overrun_count * 1e9 / $candidateRunNs
    $baselineOverrunRatePerSecond = [double]$Baseline.callback_overrun_count * 1e9 / $baselineRunNs
    $baselineExposureOverrunReduction =
        ($baselineOverrunRatePerSecond - $candidateOverrunRatePerSecond) *
        ($baselineRunNs / 1e9)

    $fewerXruns = $candidateXrunRatePerSecond -lt $baselineXrunRatePerSecond
    $fewerCallbackOverruns = $Baseline.callback_overrun_count -ge 5 -and
        $candidateOverrunRatePerSecond -le ($baselineOverrunRatePerSecond * 0.8) -and
        $baselineExposureOverrunReduction -ge 5
    $p99Improvement = $Baseline.callback_wall.p99_ns -gt 0 -and
        $Candidate.callback_wall.p99_ns -le [long]($Baseline.callback_wall.p99_ns * 0.8)
    return ($fewerXruns -or $fewerCallbackOverruns -or $p99Improvement) -and
        $candidateXrunRatePerSecond -le $baselineXrunRatePerSecond
}

New-Item -ItemType Directory -Force -Path @($runDir, $fixtureRoot, $apkRoot) | Out-Null
& "$repoRoot\scripts\android\New-HearLensAvd.ps1"
$devices = & $env:ANDROID_ADB devices
if (!($devices | Where-Object { $_ -match "^$serial\s+device$" })) { $startedHere = $true }

try {
    & "$repoRoot\scripts\android\Start-HearLensEmulator.ps1"
    $api = (& $env:ANDROID_ADB -s $serial shell getprop ro.build.version.sdk).Trim()
    $abi = (& $env:ANDROID_ADB -s $serial shell getprop ro.product.cpu.abi).Trim()
    $qemu = (& $env:ANDROID_ADB -s $serial shell getprop ro.kernel.qemu).Trim()
    $avdInfo = (& $env:ANDROID_ADB -s $serial emu avd name 2>&1 | Select-Object -First 1).Trim()
    if ($api -ne '29' -or $abi -ne 'x86_64' -or $qemu -ne '1' -or $avdInfo -ne $avdName) {
        throw "Unexpected AAudio test target (serial=$serial API=$api ABI=$abi qemu=$qemu AVD=$avdInfo)."
    }
    [ordered]@{
        startedUtc = [DateTime]::UtcNow.ToString('o')
        baselineMainSha = (& git -C $repoRoot rev-parse HEAD).Trim()
        originMainSha = (& git -C $repoRoot rev-parse origin/main).Trim()
        workingTreeStatus = (& git -C $repoRoot status --short --branch) -join "`n"
        androidSdk = $env:ANDROID_HOME
        androidNdk = $env:ANDROID_NDK_HOME
        adbVersion = ((& $env:ANDROID_ADB version) -join "`n")
        emulatorVersion = ((& $env:ANDROID_EMULATOR -version 2>&1 | Select-Object -First 1) -join '')
        target = @{ serial = $serial; avd = $avdName; api = [int]$api; abi = $abi; qemu = $qemu; audioInput = 'disabled'; audioOutput = 'disabled' }
    } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $runDir 'build-info.json') -Encoding utf8

    & node (Join-Path $repoRoot 'research\detached-native-fir\auto-check.mjs') "--export-portable=$fixtureRoot" 2>&1 |
        Set-Content -LiteralPath (Join-Path $runDir 'fixture-generation.log') -Encoding utf8
    if ($LASTEXITCODE -ne 0) { throw 'Portable JS-oracle fixture generation failed.' }
    $assetRoot = Join-Path $appRoot 'app\build\generated\androidTestAssets\portable-fixture'
    New-Item -ItemType Directory -Force -Path $assetRoot | Out-Null
    foreach ($file in @('auto-fir-fixture.bin', 'auto-fir-js-oracle.bin', 'manifest.json')) {
        Copy-Item -LiteralPath (Join-Path $fixtureRoot $file) -Destination (Join-Path $assetRoot $file) -Force
    }

    $gradle = Join-Path $repoRoot 'apps\android-native-dsp-lab\gradlew.bat'
    & $gradle --no-daemon --project-dir $appRoot :app:assembleDebug :app:assembleDebugAndroidTest -PtargetAbis=x86_64
    if ($LASTEXITCODE -ne 0) { throw "x86_64 AAudio APK/instrumentation build failed: $LASTEXITCODE" }
    $x86Apk = Join-Path $appRoot 'app\build\outputs\apk\debug\app-debug.apk'
    $testApk = Join-Path $appRoot 'app\build\outputs\apk\androidTest\debug\app-debug-androidTest.apk'
    $x86ApkCopy = Join-Path $apkRoot 'hearlens-aaudio-callback-x86_64-debug.apk'
    $testApkCopy = Join-Path $apkRoot 'hearlens-aaudio-callback-androidTest-x86_64-debug.apk'
    Copy-Item -LiteralPath $x86Apk -Destination $x86ApkCopy -Force
    Copy-Item -LiteralPath $testApk -Destination $testApkCopy -Force

    & $gradle --no-daemon --project-dir $appRoot :app:assembleDebug -PtargetAbis=arm64-v8a
    if ($LASTEXITCODE -ne 0) { throw "arm64-v8a AAudio APK build failed: $LASTEXITCODE" }
    $armApk = Join-Path $appRoot 'app\build\outputs\apk\debug\app-debug.apk'
    $armApkCopy = Join-Path $apkRoot 'hearlens-aaudio-callback-arm64-v8a-debug.apk'
    Copy-Item -LiteralPath $armApk -Destination $armApkCopy -Force

    $aapt = Join-Path $env:ANDROID_HOME 'build-tools\35.0.0\aapt.exe'
    foreach ($apk in @($x86ApkCopy, $armApkCopy)) {
        $permissions = (& $aapt dump permissions $apk 2>&1 | Out-String)
        if ($permissions -match '(?i)RECORD_AUDIO|BLUETOOTH|MODIFY_AUDIO_SETTINGS') {
            throw "Forbidden microphone/Bluetooth permission in AAudio research APK $apk`n$permissions"
        }
    }
    & node --test (Join-Path $repoRoot 'tools\android-aaudio-callback-lab-contract.test.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'AAudio research safety contract tests failed.' }

    & $env:ANDROID_ADB -s $serial install -r $x86ApkCopy
    if ($LASTEXITCODE -ne 0) { throw 'AAudio callback APK install failed on the isolated AVD.' }
    & $env:ANDROID_ADB -s $serial install -r $testApkCopy
    if ($LASTEXITCODE -ne 0) { throw 'AAudio instrumentation APK install failed on the isolated AVD.' }

    if ($DiagnosticMatrix) {
        $safetySmoke = Invoke-Scenario -ScenarioId 'zero-output-safety-smoke' -Duration 2000 `
            -RunNativeSession $true -SampleRate 48000 -Sharing 'SHARED' -Usage 'MEDIA' `
            -BufferPolicy 'DEFAULT' -VerifyZeroSamples $true
        $scenarioResults.Add($safetySmoke)

        $matrix = @(
            @{ Id = 'baseline-zero-only'; Duration = $BaselineDurationMs; Dsp = $false; Rate = 48000; Sharing = 'SHARED'; Usage = 'MEDIA'; Buffer = 'DEFAULT' },
            @{ Id = 'baseline-native-session'; Duration = $BaselineDurationMs; Dsp = $true; Rate = 48000; Sharing = 'SHARED'; Usage = 'MEDIA'; Buffer = 'DEFAULT' },
            @{ Id = 'system-native-rate'; Duration = $VariantDurationMs; Dsp = $true; Rate = 0; Sharing = 'SHARED'; Usage = 'MEDIA'; Buffer = 'DEFAULT' },
            @{ Id = 'exclusive-sharing'; Duration = $VariantDurationMs; Dsp = $true; Rate = 48000; Sharing = 'EXCLUSIVE'; Usage = 'MEDIA'; Buffer = 'DEFAULT' },
            @{ Id = 'game-usage'; Duration = $VariantDurationMs; Dsp = $true; Rate = 48000; Sharing = 'SHARED'; Usage = 'GAME'; Buffer = 'DEFAULT' },
            @{ Id = 'two-burst-buffer'; Duration = $VariantDurationMs; Dsp = $true; Rate = 48000; Sharing = 'SHARED'; Usage = 'MEDIA'; Buffer = 'TWO_BURSTS' }
        )
        foreach ($entry in $matrix) {
            $scenario = Invoke-Scenario -ScenarioId $entry.Id -Duration $entry.Duration `
                -RunNativeSession $entry.Dsp -SampleRate $entry.Rate -Sharing $entry.Sharing `
                -Usage $entry.Usage -BufferPolicy $entry.Buffer -VerifyZeroSamples $false
            $scenarioResults.Add($scenario)
        }

        $baselineDspScenario = $scenarioResults | Where-Object scenarioId -eq 'baseline-native-session' | Select-Object -First 1
        $baselineDsp = Get-PrimaryMeasurement $baselineDspScenario
        $eligible = [System.Collections.Generic.List[object]]::new()
        foreach ($scenario in $scenarioResults | Where-Object { $_.scenarioId -in @('system-native-rate', 'exclusive-sharing', 'game-usage', 'two-burst-buffer') }) {
            $measurement = Get-PrimaryMeasurement $scenario
            if (Test-ClearImprovement -Candidate $measurement -Baseline $baselineDsp) {
                $eligible.Add([pscustomobject]@{ scenario = $scenario; measurement = $measurement })
            }
        }
        $longRunDecision = [ordered]@{ run = $false; selectedScenario = $null; reason = 'No short candidate met the predeclared improvement criteria.' }
        if ($eligible.Count -gt 0) {
            $selected = $eligible | Sort-Object { $_.measurement.callback_wall.p99_ns } | Select-Object -First 1
            $longRunDecision = [ordered]@{
                run = $true
                selectedScenario = $selected.scenario.scenarioId
                criteria = 'Requested LOW_LATENCY/sharing/usage achieved, compatible DSP sample rate, COMPLETE short run, zero DSP deadline failures, lower elapsed-time-normalized XRun or callback-overrun rate (with minimum reduction), or at least 20% lower wall P99 without a higher XRun rate.'
            }
            $long = Invoke-Scenario -ScenarioId "five-minute-$($selected.scenario.scenarioId)" `
                -Duration 300000 -RunNativeSession $true `
                -SampleRate $selected.scenario.nativeResults[0].requested_sample_rate `
                -Sharing $selected.scenario.nativeResults[0].requested_sharing_mode `
                -Usage $selected.scenario.nativeResults[0].requested_usage `
                -BufferPolicy $selected.scenario.nativeResults[0].requested_buffer_policy `
                -VerifyZeroSamples $false
            $scenarioResults.Add($long)
        }

        $lifecycle = Invoke-Scenario -ScenarioId 'lifecycle-stop-restart' -Duration 500 `
            -RunNativeSession $true -SampleRate 48000 -Sharing 'SHARED' -Usage 'MEDIA' `
            -BufferPolicy 'DEFAULT' -VerifyZeroSamples $true -ExpectedReportCount 4 -LifecycleOnly
        $scenarioResults.Add($lifecycle)
    } else {
        $single = Invoke-Scenario -ScenarioId 'single-run' -Duration $DurationMs `
            -RunNativeSession $true -SampleRate 48000 -Sharing 'SHARED' -Usage 'MEDIA' `
            -BufferPolicy 'DEFAULT' -VerifyZeroSamples (-not $SkipZeroScan)
        $scenarioResults.Add($single)
        $lifecycle = Invoke-Scenario -ScenarioId 'lifecycle-stop-restart' -Duration 500 `
            -RunNativeSession $true -SampleRate 48000 -Sharing 'SHARED' -Usage 'MEDIA' `
            -BufferPolicy 'DEFAULT' -VerifyZeroSamples $true -ExpectedReportCount 4 -LifecycleOnly
        $scenarioResults.Add($lifecycle)
        $longRunDecision = [ordered]@{ run = $false; reason = 'Single-run mode does not trigger long benchmark.' }
    }

    $baselineZeroScenario = $scenarioResults | Where-Object scenarioId -eq 'baseline-zero-only' | Select-Object -First 1
    $baselineZero = if ($baselineZeroScenario) { Get-PrimaryMeasurement $baselineZeroScenario } else { $null }
    $baselineDspScenario = $scenarioResults | Where-Object scenarioId -eq 'baseline-native-session' | Select-Object -First 1
    $baselineDsp = if ($baselineDspScenario) { Get-PrimaryMeasurement $baselineDspScenario } else { $null }
    $abComparison = if ($baselineZero -and $baselineDsp) {
        [ordered]@{
            sameRequestedStream = ($baselineZero.requested_sample_rate -eq $baselineDsp.requested_sample_rate -and
                $baselineZero.requested_sharing_mode -eq $baselineDsp.requested_sharing_mode -and
                $baselineZero.requested_usage -eq $baselineDsp.requested_usage -and
                $baselineZero.requested_buffer_policy -eq $baselineDsp.requested_buffer_policy)
            zeroOnlyXrunDelta = $baselineZero.xrun_delta
            nativeSessionXrunDelta = $baselineDsp.xrun_delta
            zeroOnlyCallbackOverruns = $baselineZero.callback_overrun_count
            nativeSessionCallbackOverruns = $baselineDsp.callback_overrun_count
            zeroOnlyDspDeadlineFailures = $baselineZero.dsp_deadline_failure_count
            nativeSessionDspDeadlineFailures = $baselineDsp.dsp_deadline_failure_count
            zeroOnlyCallbackWall = $baselineZero.callback_wall
            nativeSessionCallbackWall = $baselineDsp.callback_wall
            dspLoadAssociation = if ($baselineZero.xrun_delta -eq 0 -and $baselineDsp.xrun_delta -gt 0) {
                'Observed only with NativeSession workload in this short emulator window.'
            } elseif ($baselineZero.xrun_delta -gt 0 -and $baselineDsp.xrun_delta -gt 0) {
                'Observed with both workloads; platform scheduling/stream path remains a candidate cause.'
            } else {
                'Short window did not isolate the prior long-run failure; compare callback overruns and retain prior evidence.'
            }
        }
    } else { $null }

    $summary = [ordered]@{
        result = if ($scriptErrors.Count -eq 0) { 'RECORDED' } else { 'INCOMPLETE' }
        completedUtc = [DateTime]::UtcNow.ToString('o')
        diagnosticMatrix = [bool]$DiagnosticMatrix
        baselineAB = $abComparison
        longRunDecision = $longRunDecision
        scenarioCount = $scenarioResults.Count
        scenarios = @($scenarioResults)
        errors = @($scriptErrors)
        artifacts = $runDir
    }
    $summary | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath (Join-Path $runDir 'diagnostic-matrix-report.json') -Encoding utf8

    $hashLines = [System.Collections.Generic.List[string]]::new()
    Get-ChildItem -LiteralPath $runDir -File -Recurse | Where-Object { $_.Name -ne 'sha256.manifest' } | Sort-Object FullName | ForEach-Object {
        $relative = $_.FullName.Substring($runDir.Length + 1).Replace('\', '/')
        $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        $hashLines.Add("$hash  $relative")
    }
    $hashLines | Set-Content -LiteralPath (Join-Path $runDir 'sha256.manifest') -Encoding utf8

    Write-Output "AAudio diagnostics result: $($summary.result)"
    Write-Output "Scenario records: $($summary.scenarioCount)"
    Write-Output "Summary: $(Join-Path $runDir 'diagnostic-matrix-report.json')"
    Write-Output "SHA-256 manifest: $(Join-Path $runDir 'sha256.manifest')"
    if ($scriptErrors.Count -gt 0) { throw ($scriptErrors -join "`n") }
} finally {
    if ($startedHere -and !$KeepEmulator) { & "$repoRoot\scripts\android\Stop-HearLensEmulator.ps1" }
}
