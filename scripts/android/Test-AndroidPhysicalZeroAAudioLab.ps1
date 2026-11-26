[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('ZY22FWGQTB')][string]$Serial,
    [Parameter(Mandatory)][string]$ApkPath,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-fA-F]{64}$')][string]$ExpectedApkSha256,
    [Parameter(Mandatory)][string]$BuildInfoPath,
    [Parameter(Mandatory)][string]$OwnerAuthorizationRecord,
    [string]$IndependentReviewRecord,
    [string]$OwnerReviewWaiverRecord
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\Initialize-AndroidEnvironment.ps1"

$maxDurationSeconds = 60
$packageName = 'org.hearlens.physicalzero'
$activityName = "$packageName/.MainActivity"
$resultRoot = 'D:\Dev\Android\test-results\hearlens\physical-zero-callback'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$suffix = [guid]::NewGuid().ToString('N').Substring(0, 8)
$runDir = Join-Path $resultRoot "$stamp-device-$suffix"
$startedUtc = [DateTime]::UtcNow
$testStarted = $false
$resultCollected = $false
$installedHere = $false
$adbGatePassed = $false
$reviewGateMode = $null
$resultPath = $null
$errors = [System.Collections.Generic.List[string]]::new()
New-Item -ItemType Directory -Force -Path $runDir | Out-Null

function Invoke-TargetAdb {
    param([Parameter(Mandatory)][string[]]$Arguments)
    $output = & $env:ANDROID_ADB -s $Serial @Arguments 2>&1
    $exitCode = $LASTEXITCODE
    return [pscustomobject]@{ Output = @($output); ExitCode = $exitCode }
}

function Save-TargetDiagnostics {
    param([Parameter(Mandatory)][string]$Directory)
    foreach ($entry in @(
        @{ Name = 'logcat-full.log'; Args = @('logcat', '-b', 'all', '-d', '-v', 'threadtime') },
        @{ Name = 'dumpsys-audio.txt'; Args = @('shell', 'dumpsys', 'audio') },
        @{ Name = 'dumpsys-audio-flinger.txt'; Args = @('shell', 'dumpsys', 'media.audio_flinger') },
        @{ Name = 'dumpsys-audio-policy.txt'; Args = @('shell', 'dumpsys', 'media.audio_policy') },
        @{ Name = 'device-properties.txt'; Args = @('shell', 'getprop') }
    )) {
        $result = Invoke-TargetAdb -Arguments $entry.Args
        $result.Output | Set-Content -LiteralPath (Join-Path $Directory $entry.Name) -Encoding utf8
        if ($result.ExitCode -ne 0) { $errors.Add("ADB diagnostic failed: $($entry.Name)") }
    }
}

try {
    $apk = (Resolve-Path -LiteralPath $ApkPath).Path
    $buildInfo = Get-Content -LiteralPath $BuildInfoPath -Raw | ConvertFrom-Json
    $owner = Get-Content -LiteralPath $OwnerAuthorizationRecord -Raw | ConvertFrom-Json
    if ([string]::IsNullOrWhiteSpace($IndependentReviewRecord) -eq
        [string]::IsNullOrWhiteSpace($OwnerReviewWaiverRecord)) {
        throw 'Provide exactly one of IndependentReviewRecord or OwnerReviewWaiverRecord.'
    }
    $actualApkSha = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLowerInvariant()
    $expectedSha = $ExpectedApkSha256.ToLowerInvariant()
    if ($actualApkSha -ne $expectedSha -or $buildInfo.apkSha256.ToLowerInvariant() -ne $expectedSha) {
        throw 'APK SHA-256 must match both the explicit expected hash and build-info.'
    }
    if ($buildInfo.nativeAbi -ne 'arm64-v8a' -or $buildInfo.packageName -ne $packageName -or
        $buildInfo.testWorkload -ne 'ZERO_ONLY' -or $buildInfo.maxDurationMs -ne 60000 -or
        $buildInfo.routePolicy -ne 'BUILTIN_SPEAKER_ONLY_EXACT_DEVICE_ID' -or
        $buildInfo.installOrStreamStarted -ne $false) {
        throw 'Build metadata does not match the approved physical zero-only scope.'
    }
    if ($owner.approved -ne $true -or $owner.deviceSerial -ne $Serial -or
        $owner.model -ne 'Moto g62 5G' -or $owner.api -ne 33 -or $owner.abi -ne 'arm64-v8a' -or
        $owner.testMode -ne 'ZERO_ONLY' -or $owner.maxDurationSeconds -ne $maxDurationSeconds -or
        $owner.requestedRoute -ne 'BUILTIN_SPEAKER_ONLY' -or
        $owner.apkSha256.ToLowerInvariant() -ne $expectedSha -or
        $owner.sourceCommit -ne $buildInfo.sourceCommit -or
        $owner.allowMicrophone -ne $false -or $owner.allowBluetooth -ne $false -or
        $owner.allowAudiblePlayback -ne $false -or $owner.allowDspOutput -ne $false) {
        throw 'Owner authorization record is missing or does not bind this exact APK and scope.'
    }
    if ([string]::IsNullOrWhiteSpace([string]$owner.owner) -or
        [string]::IsNullOrWhiteSpace([string]$owner.approvedAtUtc) -or
        [string]::IsNullOrWhiteSpace([string]$owner.authorizationText)) {
        throw 'Owner authorization record must identify the owner, approval time, and explicit authorization.'
    }
    if ($IndependentReviewRecord) {
        $review = Get-Content -LiteralPath $IndependentReviewRecord -Raw | ConvertFrom-Json
        if ($review.reviewStatus -ne 'PASS' -or $review.deviceSerial -ne $Serial -or
            $review.apkSha256.ToLowerInvariant() -ne $expectedSha -or
            $review.sourceCommit -ne $buildInfo.sourceCommit -or
            [string]::IsNullOrWhiteSpace([string]$review.reviewer) -or
            [string]$review.reviewer -eq [string]$owner.owner -or
            [string]::IsNullOrWhiteSpace([string]$review.reviewedAtUtc)) {
            throw 'Independent safety review record must PASS for the exact APK, commit, serial, and a different reviewer.'
        }
        $requiredReviewAreas = @(
            'isolated_arm64_build', 'permissionless_manifest', 'zero_output_callback',
            'builtin_speaker_route_refusal', 'fixed_device_scope', 'hard_duration_cap',
            'visible_stop_and_background_stop', 'callback_allocation_audit',
            'stop_drain_close', 'evidence_capture'
        )
        $missingReviewAreas = @($requiredReviewAreas | Where-Object { $_ -notin @($review.reviewedAreas) })
        if ($missingReviewAreas.Count -gt 0 -or
            [string]::IsNullOrWhiteSpace([string]$review.reviewEvidence)) {
            throw "Independent safety review must cover all required areas and identify review evidence. Missing: $($missingReviewAreas -join ', ')"
        }
        $reviewGateMode = 'INDEPENDENT_HUMAN_REVIEW'
    } else {
        $waiver = Get-Content -LiteralPath $OwnerReviewWaiverRecord -Raw | ConvertFrom-Json
        if ($waiver.waiveIndependentReview -ne $true -or
            [string]$waiver.owner -ne [string]$owner.owner -or
            $waiver.deviceSerial -ne $Serial -or
            $waiver.apkSha256.ToLowerInvariant() -ne $expectedSha -or
            $waiver.sourceCommit -ne $buildInfo.sourceCommit -or
            $waiver.testMode -ne 'ZERO_ONLY' -or
            $waiver.maxDurationSeconds -ne $maxDurationSeconds -or
            $waiver.requestedRoute -ne 'BUILTIN_SPEAKER_ONLY' -or
            $waiver.allowMicrophone -ne $false -or $waiver.allowBluetooth -ne $false -or
            $waiver.allowAudiblePlayback -ne $false -or $waiver.allowDspOutput -ne $false -or
            [string]::IsNullOrWhiteSpace([string]$waiver.waivedAtUtc) -or
            [string]::IsNullOrWhiteSpace([string]$waiver.waiverText)) {
            throw 'Owner review-waiver record must explicitly waive the independent review and bind this exact APK, commit, serial, and zero-only scope.'
        }
        $reviewGateMode = 'OWNER_WAIVER_NO_INDEPENDENT_REVIEW'
    }

    $adbVersion = Invoke-TargetAdb -Arguments @('version')
    if ($adbVersion.ExitCode -ne 0) { throw 'ADB is unavailable.' }
    $state = Invoke-TargetAdb -Arguments @('get-state')
    if ($state.ExitCode -ne 0 -or ($state.Output -join '').Trim() -ne 'device') {
        throw "Selected ADB target is not ready: $Serial"
    }
    $model = (Invoke-TargetAdb -Arguments @('shell', 'getprop', 'ro.product.model')).Output -join ''
    $api = ((Invoke-TargetAdb -Arguments @('shell', 'getprop', 'ro.build.version.sdk')).Output -join '').Trim()
    $abi = ((Invoke-TargetAdb -Arguments @('shell', 'getprop', 'ro.product.cpu.abi')).Output -join '').Trim()
    if ($model -notmatch '(?i)moto[_ ]g62[_ ]5g' -or $api -ne '33' -or $abi -ne 'arm64-v8a') {
        throw "Selected device identity mismatch: model='$model' API=$api ABI=$abi."
    }
    $aapt = Join-Path $env:ANDROID_HOME 'build-tools\35.0.0\aapt.exe'
    $permissions = & $aapt dump permissions $apk 2>&1
    if ($LASTEXITCODE -ne 0 -or (($permissions -join "`n") -match '(?m)^uses-permission:')) {
        throw 'APK permission inspection failed or found a declared permission.'
    }

    $installedBefore = Invoke-TargetAdb -Arguments @('shell', 'pm', 'path', $packageName)
    if ($installedBefore.ExitCode -eq 0 -and ($installedBefore.Output -join '').Contains('package:')) {
        throw "Refusing to replace an existing package $packageName on $Serial."
    }
    $adbGatePassed = $true
    Copy-Item -LiteralPath $apk -Destination (Join-Path $runDir 'hearlens-physical-zero-aaudio-arm64-v8a-debug.apk')
    Copy-Item -LiteralPath $BuildInfoPath -Destination (Join-Path $runDir 'build-info.json')
    Copy-Item -LiteralPath $OwnerAuthorizationRecord -Destination (Join-Path $runDir 'owner-authorization-record.json')
    if ($IndependentReviewRecord) {
        Copy-Item -LiteralPath $IndependentReviewRecord -Destination (Join-Path $runDir 'independent-review-record.json')
    } else {
        Copy-Item -LiteralPath $OwnerReviewWaiverRecord -Destination (Join-Path $runDir 'owner-review-waiver-record.json')
    }
    [ordered]@{
        startedUtc = $startedUtc.ToString('o')
        serial = $Serial
        model = $model.Trim()
        api = [int]$api
        abi = $abi
        expectedApkSha256 = $expectedSha
        maxDurationSeconds = $maxDurationSeconds
        workload = 'ZERO_ONLY'
        route = 'BUILTIN_SPEAKER_ONLY'
        reviewGateMode = $reviewGateMode
        commandsUseExplicitSerial = $true
        microphoneAllowed = $false
        bluetoothAllowed = $false
        audiblePlaybackAllowed = $false
        dspPcmOutputAllowed = $false
        forceStopRecovery = "adb -s $Serial shell am force-stop $packageName"
    } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $runDir 'requested-config.json') -Encoding utf8

    $install = Invoke-TargetAdb -Arguments @('install', (Join-Path $runDir 'hearlens-physical-zero-aaudio-arm64-v8a-debug.apk'))
    $install.Output | Set-Content -LiteralPath (Join-Path $runDir 'adb-install.log') -Encoding utf8
    if ($install.ExitCode -ne 0) { throw 'APK installation failed.' }
    $installedHere = $true
    $logStart = [DateTimeOffset]::Now.ToString('yyyy-MM-dd HH:mm:ss.fff')
    $launch = Invoke-TargetAdb -Arguments @('shell', 'am', 'start', '-n', $activityName)
    $launch.Output | Set-Content -LiteralPath (Join-Path $runDir 'adb-launch.log') -Encoding utf8
    if ($launch.ExitCode -ne 0) { throw 'Activity launch failed.' }

    $uiPath = '/sdcard/hearlens-physical-zero-ui.xml'
    $uiXml = ''
    $match = $null
    $uiDeadline = [DateTime]::UtcNow.AddSeconds(10)
    do {
        $uiDump = Invoke-TargetAdb -Arguments @('shell', 'uiautomator', 'dump', $uiPath)
        if ($uiDump.ExitCode -ne 0) { throw 'Unable to inspect visible Start control.' }
        $uiXmlResult = Invoke-TargetAdb -Arguments @('shell', 'cat', $uiPath)
        $uiXml = $uiXmlResult.Output -join "`n"
        $match = [regex]::Match($uiXml, 'content-desc="Start zero-only AAudio test"[^>]*clickable="true"[^>]*enabled="true"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"')
        if ($match.Success) { break }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $uiDeadline)
    $uiXml | Set-Content -LiteralPath (Join-Path $runDir 'initial-ui.xml') -Encoding utf8
    $null = Invoke-TargetAdb -Arguments @('shell', 'rm', '-f', $uiPath)
    if (!$match.Success) { throw 'Visible Start control is missing or disabled; no callback stream was started.' }
    $x = [int](([int]$match.Groups[1].Value + [int]$match.Groups[3].Value) / 2)
    $y = [int](([int]$match.Groups[2].Value + [int]$match.Groups[4].Value) / 2)
    $tap = Invoke-TargetAdb -Arguments @('shell', 'input', 'tap', "$x", "$y")
    $tap.Output | Set-Content -LiteralPath (Join-Path $runDir 'adb-start-control.log') -Encoding utf8
    if ($tap.ExitCode -ne 0) { throw 'Could not activate the visible Start control.' }
    $testStarted = $true

    $waitDeadline = [DateTime]::UtcNow.AddSeconds($maxDurationSeconds + 15)
    while ([DateTime]::UtcNow -lt $waitDeadline) {
        $files = Invoke-TargetAdb -Arguments @('shell', 'run-as', $packageName, 'ls', 'files')
        $candidate = ($files.Output | Where-Object { $_ -match '^zero-callback-result-.+\.json$' } | Select-Object -Last 1)
        if ($candidate) { $resultPath = "files/$candidate"; break }
        Start-Sleep -Milliseconds 500
    }
    if (!$resultPath) {
        $errors.Add('Timed out waiting for the app-private result; the recovery force-stop was issued.')
        $null = Invoke-TargetAdb -Arguments @('shell', 'am', 'force-stop', $packageName)
    } else {
        $result = Invoke-TargetAdb -Arguments @('shell', 'run-as', $packageName, 'cat', $resultPath)
        if ($result.ExitCode -ne 0) { throw "Could not read app-private result $resultPath." }
        $resultText = $result.Output -join "`n"
        $resultText | Set-Content -LiteralPath (Join-Path $runDir 'native-result.json') -Encoding utf8
        $resultCollected = $true
        $native = $resultText | ConvertFrom-Json
        $histogramCallbacks = 0L
        $histogramSamples = 0L
        foreach ($entry in $native.frame_histogram.PSObject.Properties) {
            $frames = [long]$entry.Name
            $frequency = [long]$entry.Value
            $histogramCallbacks += $frequency
            $histogramSamples += 2L * $frames * $frequency
        }
        if ($native.status -ne 'PASS' -or $native.run_completion -ne 'COMPLETE' -or
            !$native.duration_complete -or !$native.physical_audio_stream_started -or
            !$native.actual_callback_observed -or !$native.stream_stop_confirmed -or
            $native.actual_sample_rate -le 0 -or $native.frames_per_burst -le 0 -or
            $native.buffer_size_frames -le 0 -or $native.buffer_capacity_frames -le 0 -or
            $native.callback_cpu_samples_available -le 0 -or
            $native.frame_histogram_overflow_callbacks -ne 0 -or
            $native.callback_count -ne $histogramCallbacks -or
            $native.callback_records_count -ne $histogramCallbacks -or
            $native.zero_samples_verified -ne $histogramSamples -or
            $native.nonzero_output_samples_observed -ne 0 -or $native.zero_samples_verified -le 0 -or
            $native.actual_output_device_id -ne $native.requested_output_device_id -or
            $native.actual_output_device_type -ne 'TYPE_BUILTIN_SPEAKER' -or
            $native.callback_overlap_count -ne 0 -or $native.native_session_invocations -ne 0 -or
            $native.dsp_to_audio_buffer_path -ne $false -or $native.microphone_used -ne $false -or
            $native.bluetooth_api_used -ne $false -or $native.aaudio_xrun_delta -gt 0 -or
            $native.callback_overrun_count -gt 0 -or
            $native.aaudio_stream_error_code -ne 0 -or
            $native.aaudio_error_callback_count -gt 0) {
            $errors.Add('Native report did not satisfy the zero-output physical acceptance checks.')
        }
    }
    Save-TargetDiagnostics -Directory $runDir
    $null = Invoke-TargetAdb -Arguments @('shell', 'am', 'force-stop', $packageName)
    if ($resultCollected) {
        $uninstall = Invoke-TargetAdb -Arguments @('uninstall', $packageName)
        $uninstall.Output | Set-Content -LiteralPath (Join-Path $runDir 'adb-uninstall.log') -Encoding utf8
        if ($uninstall.ExitCode -ne 0) { $errors.Add('App uninstallation failed after evidence capture.') }
        else { $installedHere = $false }
    }
    [ordered]@{ logCaptureStartedLocal = $logStart; testResultPath = $resultPath; testStarted = $testStarted } |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runDir 'capture-info.json') -Encoding utf8
} catch {
    $errors.Add($_.Exception.Message)
    if ($testStarted) { $null = Invoke-TargetAdb -Arguments @('shell', 'am', 'force-stop', $packageName) }
    if ($installedHere -and !$testStarted) {
        $uninstall = Invoke-TargetAdb -Arguments @('uninstall', $packageName)
        $uninstall.Output | Set-Content -LiteralPath (Join-Path $runDir 'adb-uninstall.log') -Encoding utf8
        if ($uninstall.ExitCode -eq 0) { $installedHere = $false }
    }
    if ($adbGatePassed) {
        try { Save-TargetDiagnostics -Directory $runDir } catch { $errors.Add("Diagnostic capture failed: $($_.Exception.Message)") }
    }
} finally {
    [ordered]@{
        finishedUtc = [DateTime]::UtcNow.ToString('o')
        serial = $Serial
        reviewGateMode = $reviewGateMode
        runStarted = $testStarted
        installedByRunner = $installedHere
        outcome = if ($errors.Count -eq 0) { 'PASS' } else { 'FAIL_OR_NOT_RUN' }
        errors = @($errors)
    } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $runDir 'run-summary.json') -Encoding utf8
    $resultFiles = Get-ChildItem -LiteralPath $runDir -File | Where-Object { $_.Name -ne 'sha256-manifest.json' }
    $manifest = foreach ($file in $resultFiles) {
        [ordered]@{ path = $file.Name; sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
    }
    @($manifest) | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $runDir 'sha256-manifest.json') -Encoding utf8
}

Write-Output "Evidence: $runDir"
if ($errors.Count -gt 0) { throw ($errors -join '; ') }
