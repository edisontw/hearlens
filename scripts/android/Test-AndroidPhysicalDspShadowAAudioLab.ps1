[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('ZY22FWGQTB')][string]$Serial,
    [Parameter(Mandatory)][ValidateRange(1, 9223372036854775807)][long]$ArtifactId,
    [Parameter(Mandatory)][string]$ApkPath,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-fA-F]{64}$')][string]$ExpectedApkSha256,
    [Parameter(Mandatory)][string]$ReleaseArchivePath,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-fA-F]{64}$')][string]$ExpectedArchiveSha256,
    [Parameter(Mandatory)][string]$BuildInfoPath,
    [Parameter(Mandatory)][string]$OwnerAuthorizationRecord,
    [string]$IndependentReviewRecord,
    [string]$OwnerReviewWaiverRecord
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\Initialize-AndroidEnvironment.ps1"

$maxDurationSeconds = 60
$packageName = 'org.hearlens.physicaldsp'
$activityName = "$packageName/.MainActivity"
$resultRoot = 'D:\Dev\Android\test-results\hearlens\physical-dsp-shadow'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$suffix = [guid]::NewGuid().ToString('N').Substring(0, 8)
$runDir = Join-Path $resultRoot "$stamp-device-$suffix"
$startedUtc = [DateTime]::UtcNow
$testStarted = $false
$installedHere = $false
$resultCollected = $false
$reviewGateMode = $null
$resultPath = $null
$diagnosticsSaved = $false
$errors = [System.Collections.Generic.List[string]]::new()
New-Item -ItemType Directory -Force -Path $runDir | Out-Null

function Invoke-TargetAdb {
    param([Parameter(Mandatory)][string[]]$Arguments)
    $output = & $env:ANDROID_ADB -s $Serial @Arguments 2>&1
    $exitCode = $LASTEXITCODE
    [pscustomobject]@{ Output = @($output); ExitCode = $exitCode }
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

function Get-ArchiveEntrySha256 {
    param([Parameter(Mandatory)][string]$Archive, [Parameter(Mandatory)][string]$EntryName)
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($Archive)
    try {
        $matches = @($zip.Entries | Where-Object { $_.Name -eq $EntryName })
        if ($matches.Count -ne 1) { throw "Release archive must contain exactly one $EntryName." }
        $stream = $matches[0].Open()
        try {
            $sha = [System.Security.Cryptography.SHA256]::Create()
            try { return ([Convert]::ToHexString($sha.ComputeHash($stream))).ToLowerInvariant() }
            finally { $sha.Dispose() }
        } finally { $stream.Dispose() }
    } finally { $zip.Dispose() }
}

try {
    if ([string]::IsNullOrWhiteSpace($IndependentReviewRecord) -eq
        [string]::IsNullOrWhiteSpace($OwnerReviewWaiverRecord)) {
        throw 'Provide exactly one matching IndependentReviewRecord or OwnerReviewWaiverRecord.'
    }
    $apk = (Resolve-Path -LiteralPath $ApkPath).Path
    $archive = (Resolve-Path -LiteralPath $ReleaseArchivePath).Path
    $buildInfo = Get-Content -LiteralPath $BuildInfoPath -Raw | ConvertFrom-Json
    $owner = Get-Content -LiteralPath $OwnerAuthorizationRecord -Raw | ConvertFrom-Json
    $apkSha = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLowerInvariant()
    $archiveSha = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    $expectedApk = $ExpectedApkSha256.ToLowerInvariant()
    $expectedArchive = $ExpectedArchiveSha256.ToLowerInvariant()
    if ($apkSha -ne $expectedApk -or $buildInfo.apkSha256.ToLowerInvariant() -ne $expectedApk) {
        throw 'APK SHA-256 must match both the explicit expected hash and build-info.'
    }
    if ($archiveSha -ne $expectedArchive -or
        $buildInfo.releaseArchiveSha256.ToLowerInvariant() -ne $expectedArchive) {
        throw 'Release archive SHA-256 must match the explicit hash and build-info.'
    }
    $archiveEntryHash = Get-ArchiveEntrySha256 -Archive $archive -EntryName 'hearlens-physical-dsp-shadow-arm64-v8a-debug.apk'
    if ($archiveEntryHash -ne $expectedApk) { throw 'APK inside the authorized release archive has a different SHA-256.' }
    if ($buildInfo.nativeAbi -ne 'arm64-v8a' -or
        $buildInfo.nativeLibrary -ne 'libhearlens_physical_dsp_shadow.so' -or
        $buildInfo.packageName -ne $packageName -or
        $buildInfo.testWorkload -ne 'DSP_SHADOW_ZERO_OUTPUT' -or
        $buildInfo.maxDurationMs -ne 60000 -or
        $buildInfo.requestedSampleRate -ne 48000 -or
        $buildInfo.dspFixtureSampleRate -ne 48000 -or
        $buildInfo.callbackFramesRequest -ne 'UNSPECIFIED_VARIABLE' -or
        $buildInfo.routePolicy -ne 'API33_MEDIA_PREDICTION_GENERATION_AND_AAUDIO_ID_MONITOR' -or
        $buildInfo.installOrStreamStarted -ne $false -or
        @($buildInfo.permissionsDeclared).Count -ne 0) {
        throw 'Build metadata does not match the physical DSP-shadow scope.'
    }
    $ownerSourceCommit = [string]$buildInfo.sourceCommit
    if ($owner.approved -ne $true -or $owner.artifactId -ne $ArtifactId -or
        $owner.deviceSerial -ne $Serial -or $owner.model -ne 'Moto g62 5G' -or
        $owner.api -ne 33 -or $owner.abi -ne 'arm64-v8a' -or
        $owner.testMode -ne 'DSP_SHADOW_ZERO_OUTPUT' -or
        $owner.maxDurationSeconds -ne $maxDurationSeconds -or
        $owner.maxExtensionSeconds -ne 0 -or
        $owner.requestedRoute -ne 'BUILTIN_SPEAKER_ONLY' -or
        $owner.apkSha256.ToLowerInvariant() -ne $expectedApk -or
        $owner.archiveSha256.ToLowerInvariant() -ne $expectedArchive -or
        $owner.sourceCommit -ne $ownerSourceCommit -or
        $owner.allowSyntheticDspProcessing -ne $true -or
        $owner.allowMicrophone -ne $false -or $owner.allowBluetooth -ne $false -or
        $owner.allowExternalAudioDevices -ne $false -or
        $owner.allowNonzeroPcmOutput -ne $false -or
        $owner.allowDspOutput -ne $false -or $owner.allowActualHearing -ne $false) {
        throw 'Owner authorization must bind this exact artifact, APK/archive hashes, commit, device and 60-second zero-output DSP-shadow scope.'
    }
    if ([string]::IsNullOrWhiteSpace([string]$owner.owner) -or
        [string]::IsNullOrWhiteSpace([string]$owner.approvedAtUtc) -or
        [string]::IsNullOrWhiteSpace([string]$owner.authorizationText)) {
        throw 'Owner authorization must identify the owner, approval time, and explicit exact-artifact authorization.'
    }
    if ($IndependentReviewRecord) {
        $review = Get-Content -LiteralPath $IndependentReviewRecord -Raw | ConvertFrom-Json
        if ($review.reviewStatus -ne 'PASS' -or $review.artifactId -ne $ArtifactId -or
            $review.deviceSerial -ne $Serial -or
            $review.model -ne 'Moto g62 5G' -or $review.api -ne 33 -or
            $review.abi -ne 'arm64-v8a' -or
            $review.testMode -ne 'DSP_SHADOW_ZERO_OUTPUT' -or
            $review.requestedRoute -ne 'BUILTIN_SPEAKER_ONLY' -or
            $review.maxDurationSeconds -ne $maxDurationSeconds -or
            $review.maxExtensionSeconds -ne 0 -or
            $review.apkSha256.ToLowerInvariant() -ne $expectedApk -or
            $review.archiveSha256.ToLowerInvariant() -ne $expectedArchive -or
            $review.sourceCommit -ne $ownerSourceCommit -or
            $review.allowSyntheticDspProcessing -ne $true -or
            $review.allowMicrophone -ne $false -or $review.allowBluetooth -ne $false -or
            $review.allowExternalAudioDevices -ne $false -or
            $review.allowNonzeroPcmOutput -ne $false -or
            $review.allowDspOutput -ne $false -or $review.allowActualHearing -ne $false -or
            [string]::IsNullOrWhiteSpace([string]$review.reviewer) -or
            [string]$review.reviewer -eq [string]$owner.owner -or
            [string]::IsNullOrWhiteSpace([string]$review.reviewedAtUtc) -or
            [string]::IsNullOrWhiteSpace([string]$review.reviewEvidence)) {
            throw 'Independent review must PASS for this exact artifact, APK/archive hashes, commit, serial, and a different reviewer.'
        }
        $requiredAreas = @(
            'isolated_arm64_build', 'permissionless_manifest', 'private_synthetic_dsp',
            'zero_output_and_verification', 'no_dsp_to_audio_buffer_path',
            'builtin_speaker_route_guard', 'fixed_device_scope', 'hard_60_second_cap',
            'visible_stop_and_background_stop', 'callback_allocation_audit',
            'stop_drain_close', 'evidence_capture', '48khz_before_start'
        )
        $missing = @($requiredAreas | Where-Object { $_ -notin @($review.reviewedAreas) })
        if ($missing.Count -gt 0) { throw "Independent review omitted required areas: $($missing -join ', ')" }
        $reviewGateMode = 'INDEPENDENT_REVIEW_PASS'
    } else {
        $waiver = Get-Content -LiteralPath $OwnerReviewWaiverRecord -Raw | ConvertFrom-Json
        if ($waiver.waiveIndependentReview -ne $true -or
            $waiver.owner -ne $owner.owner -or $waiver.artifactId -ne $ArtifactId -or
            $waiver.deviceSerial -ne $Serial -or $waiver.testMode -ne 'DSP_SHADOW_ZERO_OUTPUT' -or
            $waiver.requestedRoute -ne 'BUILTIN_SPEAKER_ONLY' -or
            $waiver.maxDurationSeconds -ne $maxDurationSeconds -or
            $waiver.maxExtensionSeconds -ne 0 -or
            $waiver.apkSha256.ToLowerInvariant() -ne $expectedApk -or
            $waiver.archiveSha256.ToLowerInvariant() -ne $expectedArchive -or
            $waiver.sourceCommit -ne $ownerSourceCommit -or
            $waiver.allowSyntheticDspProcessing -ne $true -or
            $waiver.allowMicrophone -ne $false -or $waiver.allowBluetooth -ne $false -or
            $waiver.allowExternalAudioDevices -ne $false -or
            $waiver.allowNonzeroPcmOutput -ne $false -or $waiver.allowDspOutput -ne $false -or
            $waiver.allowActualHearing -ne $false -or
            [string]::IsNullOrWhiteSpace([string]$waiver.waivedAtUtc) -or
            [string]::IsNullOrWhiteSpace([string]$waiver.waiverText)) {
            throw 'Owner review-waiver must explicitly waive independent review for this exact artifact, commit, device and scope.'
        }
        $reviewGateMode = 'OWNER_WAIVER_NO_INDEPENDENT_REVIEW'
    }

    $adbVersion = Invoke-TargetAdb -Arguments @('version')
    if ($adbVersion.ExitCode -ne 0) { throw 'ADB is unavailable.' }
    $state = Invoke-TargetAdb -Arguments @('get-state')
    if ($state.ExitCode -ne 0 -or ($state.Output -join '').Trim() -ne 'device') {
        throw "Selected ADB target is not ready: $Serial"
    }
    $model = ((Invoke-TargetAdb -Arguments @('shell', 'getprop', 'ro.product.model')).Output -join '').Trim()
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

    Copy-Item -LiteralPath $apk -Destination (Join-Path $runDir 'hearlens-physical-dsp-shadow-arm64-v8a-debug.apk')
    Copy-Item -LiteralPath $archive -Destination (Join-Path $runDir 'hearlens-physical-dsp-shadow-arm64-release.zip')
    Copy-Item -LiteralPath $BuildInfoPath -Destination (Join-Path $runDir 'build-info.json')
    Copy-Item -LiteralPath $OwnerAuthorizationRecord -Destination (Join-Path $runDir 'owner-authorization-record.json')
    if ($IndependentReviewRecord) {
        Copy-Item -LiteralPath $IndependentReviewRecord -Destination (Join-Path $runDir 'independent-review-record.json')
    } else {
        Copy-Item -LiteralPath $OwnerReviewWaiverRecord -Destination (Join-Path $runDir 'owner-review-waiver-record.json')
    }
    [ordered]@{
        artifactId = $ArtifactId
        sourceCommit = $ownerSourceCommit
        startedUtc = $startedUtc.ToString('o')
        serial = $Serial
        model = $model
        api = [int]$api
        abi = $abi
        apkSha256 = $expectedApk
        archiveSha256 = $expectedArchive
        maxDurationSeconds = $maxDurationSeconds
        testMode = 'DSP_SHADOW_ZERO_OUTPUT'
        route = 'BUILTIN_SPEAKER_ONLY'
        reviewGateMode = $reviewGateMode
        microphoneAllowed = $false
        bluetoothAllowed = $false
        externalAudioDevicesAllowed = $false
        nonzeroPcmOutputAllowed = $false
        dspOutputAllowed = $false
        actualHearingAllowed = $false
        commandsUseExplicitSerial = $true
        stopCommand = "adb -s $Serial shell am force-stop $packageName"
    } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $runDir 'requested-config.json') -Encoding utf8

    $install = Invoke-TargetAdb -Arguments @('install', (Join-Path $runDir 'hearlens-physical-dsp-shadow-arm64-v8a-debug.apk'))
    $install.Output | Set-Content -LiteralPath (Join-Path $runDir 'adb-install.log') -Encoding utf8
    if ($install.ExitCode -ne 0) { throw 'APK installation failed.' }
    $installedHere = $true
    $logStart = [DateTimeOffset]::Now.ToString('yyyy-MM-dd HH:mm:ss.fff')
    $launch = Invoke-TargetAdb -Arguments @('shell', 'am', 'start', '-n', $activityName)
    $launch.Output | Set-Content -LiteralPath (Join-Path $runDir 'adb-launch.log') -Encoding utf8
    if ($launch.ExitCode -ne 0) { throw 'Activity launch failed.' }

    $uiPath = '/sdcard/hearlens-physical-dsp-shadow-ui.xml'
    $uiXml = ''
    $match = $null
    $uiDeadline = [DateTime]::UtcNow.AddSeconds(12)
    do {
        $uiDump = Invoke-TargetAdb -Arguments @('shell', 'uiautomator', 'dump', $uiPath)
        if ($uiDump.ExitCode -ne 0) { throw 'Unable to inspect visible Start control.' }
        $uiXmlResult = Invoke-TargetAdb -Arguments @('shell', 'cat', $uiPath)
        $uiXml = $uiXmlResult.Output -join "`n"
        $match = [regex]::Match($uiXml, '<node(?=[^>]*content-desc="Start DSP-shadow AAudio test")(?=[^>]*clickable="true")(?=[^>]*enabled="true")[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"')
        if ($match.Success) { break }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $uiDeadline)
    $uiXml | Set-Content -LiteralPath (Join-Path $runDir 'initial-ui.xml') -Encoding utf8
    $null = Invoke-TargetAdb -Arguments @('shell', 'rm', '-f', $uiPath)
    if (!$match.Success) { throw 'Visible route-approved Start control is missing or disabled; no stream was started.' }
    $x = [int](([int]$match.Groups[1].Value + [int]$match.Groups[3].Value) / 2)
    $y = [int](([int]$match.Groups[2].Value + [int]$match.Groups[4].Value) / 2)
    $tap = Invoke-TargetAdb -Arguments @('shell', 'input', 'tap', "$x", "$y")
    $tap.Output | Set-Content -LiteralPath (Join-Path $runDir 'adb-start-control.log') -Encoding utf8
    if ($tap.ExitCode -ne 0) { throw 'Could not activate the visible Start control.' }
    $testStarted = $true

    $waitDeadline = [DateTime]::UtcNow.AddSeconds($maxDurationSeconds + 20)
    while ([DateTime]::UtcNow -lt $waitDeadline) {
        $files = Invoke-TargetAdb -Arguments @('shell', 'run-as', $packageName, 'ls', 'files')
        $candidate = ($files.Output | Where-Object { $_ -match '^dsp-shadow-callback-result-.+\.json$' } | Select-Object -Last 1)
        if ($candidate) { $resultPath = "files/$candidate"; break }
        Start-Sleep -Milliseconds 500
    }
    if (!$resultPath) { throw 'Timed out waiting for the app-private DSP-shadow result; recovery force-stop follows.' }
    $result = Invoke-TargetAdb -Arguments @('shell', 'run-as', $packageName, 'cat', $resultPath)
    if ($result.ExitCode -ne 0) { throw "Could not read app-private result $resultPath." }
    $resultText = $result.Output -join "`n"
    $resultText | Set-Content -LiteralPath (Join-Path $runDir 'native-result.json') -Encoding utf8
    $native = $resultText | ConvertFrom-Json
    $resultCollected = $true

    $histogramCallbacks = 0L
    $histogramSamples = 0L
    foreach ($entry in $native.frame_count_distribution.PSObject.Properties) {
        $frames = [long]$entry.Name
        $frequency = [long]$entry.Value
        $histogramCallbacks += $frequency
        $histogramSamples += 2L * $frames * $frequency
    }
    $predicted = @($native.route_policy_final_snapshot.mediaPredictedRoute)
    $records = @($native.callback_records_detail)
    $maximumGapRecords = @($native.maximum_interarrival_event.surrounding_records)
    $callbackRecordsValid = $records.Count -gt 0
    for ($index = 0; $index -lt $records.Count; $index++) {
        $record = $records[$index]
        if ($record.callback_index -ne $index -or $record.frame_count -le 0 -or
            $record.callback_wall_ns -le 0 -or $record.callback_thread_cpu_ns -le 0 -or
            $record.dsp_processing_wall_ns -le 0 -or
            $record.dsp_deadline_budget_ns -le 0 -or $record.callback_budget_ns -le 0 -or
            $record.zero_samples_verified -ne (2L * [long]$record.frame_count) -or
            $record.dsp_deadline_failure -ne $false -or $record.callback_overrun -ne $false) {
            $callbackRecordsValid = $false
            break
        }
    }
    if ($native.status -ne 'PASS' -or $native.run_completion -ne 'COMPLETE' -or
        !$native.duration_complete -or !$native.physical_audio_stream_started -or
        !$native.dsp_benchmark_valid -or $native.dsp_execution_status -ne 'EXECUTED' -or
        !$native.sample_rate_matches_fixture -or !$native.actual_callback_observed -or
        $native.callback_frames_request -ne 'UNSPECIFIED_VARIABLE' -or
        !$native.stream_stop_confirmed -or $native.callbacks_in_flight_after_close -ne 0 -or
        $native.actual_sample_rate -ne 48000 -or $native.dsp_fixture_sample_rate -ne 48000 -or
        $native.frames_per_burst -le 0 -or $native.buffer_size_frames -le 0 -or
        $native.buffer_capacity_frames -le 0 -or $native.callback_log_overflow -ne 0 -or
        $native.callback_records -ne $histogramCallbacks -or $records.Count -ne $histogramCallbacks -or
        $native.frame_count_overflow -ne 0 -or
        $native.zero_samples_verified -ne $histogramSamples -or
        $native.nonzero_output_samples_observed -ne 0 -or $native.zero_samples_verified -le 0 -or
        $native.native_session_invocations -ne $histogramCallbacks -or
        $native.successful_dsp_callbacks -ne $histogramCallbacks -or
        ($native.callback_cpu_samples + $native.callback_cpu_unavailable_samples) -ne $histogramCallbacks -or
        $native.native_control_updates -le 0 -or
        !$callbackRecordsValid -or
        $native.dsp_deadline_failure_count -ne 0 -or $native.callback_overrun_count -ne 0 -or
        $native.callback_overlap_count -ne 0 -or $native.native_session_fail_stop_count -ne 0 -or
        $native.callback_core_fail_stop_count -ne 0 -or
        $native.xrun_start_count -lt 0 -or $native.xrun_count -lt 0 -or $native.xrun_delta -ne 0 -or
        $native.route_mismatch_observed -ne $false -or $native.route_policy_invalidated -ne $false -or
        $native.lifecycle_invalidated -ne $false -or $native.stream_disconnect_observed -ne $false -or
        $native.actual_output_device_id -ne $native.requested_output_device_id -or
        $native.actual_output_device_id_before_start -ne $native.requested_output_device_id -or
        !$native.route_policy_valid_before_open -or !$native.route_policy_valid_before_start -or
        $native.route_policy_control_checks -le 0 -or $native.actual_device_id_control_checks -le 0 -or
        $native.route_policy_scope -ne 'STANDALONE_PHYSICAL_DSP_SHADOW_APK' -or
        $native.route_policy_hardware_guarantee -ne $false -or $native.route_policy_poll_count -le 0 -or
        $native.route_policy_final_snapshot.audioModeBeforeQueries -ne 0 -or
        $native.route_policy_final_snapshot.audioModeAfterQueries -ne 0 -or
        $predicted.Count -ne 1 -or $predicted[0].kind -ne 'BUILTIN_SPEAKER' -or
        $predicted[0].id -ne $native.requested_output_device_id -or
        $native.dsp_to_audio_buffer_path -ne $false -or
        $native.microphone_used -ne $false -or $native.bluetooth_api_used -ne $false -or
        $native.aaudio_open_result -ne 0 -or $native.aaudio_start_result -ne 0 -or
        $native.aaudio_stop_result -ne 0 -or $native.aaudio_close_result -ne 0) {
        $errors.Add('Native report did not satisfy the exact 60-second DSP-shadow zero-output acceptance gates.')
    }
    if ($native.callback_cpu_unavailable_samples -gt 0) {
        $errors.Add('Thread CPU time was unavailable for one or more callback records.')
    }
    if ($native.callback_records -gt 1 -and
        (!$native.maximum_interarrival_event -or $maximumGapRecords.Count -lt 2)) {
        $errors.Add('Maximum callback inter-arrival event is missing its adjacent records.')
    }
    Save-TargetDiagnostics -Directory $runDir
    $diagnosticsSaved = $true
} catch {
    $errors.Add($_.Exception.Message)
} finally {
    if ($testStarted -and !$diagnosticsSaved) {
        Save-TargetDiagnostics -Directory $runDir
    }
    if ($installedHere) {
        $null = Invoke-TargetAdb -Arguments @('shell', 'am', 'force-stop', $packageName)
        $uninstall = Invoke-TargetAdb -Arguments @('uninstall', $packageName)
        $uninstall.Output | Set-Content -LiteralPath (Join-Path $runDir 'adb-uninstall.log') -Encoding utf8
        if ($uninstall.ExitCode -ne 0) { $errors.Add('App uninstallation failed during teardown.') }
        else { $installedHere = $false }
    }
    [ordered]@{
        finishedUtc = [DateTime]::UtcNow.ToString('o')
        artifactId = $ArtifactId
        serial = $Serial
        reviewGateMode = $reviewGateMode
        runStarted = $testStarted
        resultCollected = $resultCollected
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
