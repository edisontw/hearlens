[CmdletBinding()]
param(
    [ValidateRange(100, 300000)]
    [int]$DurationMs = 2000,
    [switch]$SkipZeroScan,
    [switch]$KeepEmulator
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\Initialize-AndroidEnvironment.ps1"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$appRoot = Join-Path $repoRoot 'apps\android-aaudio-callback-lab'
$resultRoot = 'D:\Dev\Android\test-results\hearlens\aaudio-callback'
$fixtureRoot = Join-Path $resultRoot 'portable-fixture'
$apkRoot = Join-Path $resultRoot 'apk'
$serial = 'emulator-5580'
$packageName = 'org.hearlens.aaudiocallback'
$runner = "$packageName.test/androidx.test.runner.AndroidJUnitRunner"
$startedHere = $false
$avdConfig = 'D:\Dev\Android\avd\HearLens_API29_x86_64.avd\config.ini'

if (!(Test-Path -LiteralPath $avdConfig)) { throw "Expected isolated AVD config is missing: $avdConfig" }
$configText = Get-Content -LiteralPath $avdConfig -Raw
if ($configText -notmatch '(?m)^hw\.audioOutput\s*=\s*no\s*$' -or
    $configText -notmatch '(?m)^hw\.audioInput\s*=\s*no\s*$') {
    throw 'AAudio callback test requires the dedicated audio-disabled HearLens AVD.'
}

New-Item -ItemType Directory -Force -Path @($resultRoot, $fixtureRoot, $apkRoot) | Out-Null
& "$repoRoot\scripts\android\New-HearLensAvd.ps1"
$devices = & $env:ANDROID_ADB devices
if (!($devices | Where-Object { $_ -match "^$serial\s+device$" })) { $startedHere = $true }

try {
    & "$repoRoot\scripts\android\Start-HearLensEmulator.ps1"
    $api = (& $env:ANDROID_ADB -s $serial shell getprop ro.build.version.sdk).Trim()
    $abi = (& $env:ANDROID_ADB -s $serial shell getprop ro.product.cpu.abi).Trim()
    $avdName = (& $env:ANDROID_ADB -s $serial emu avd name 2>&1 | Select-Object -First 1).Trim()
    if ($api -ne '29' -or $abi -ne 'x86_64' -or $avdName -ne 'HearLens_API29_x86_64') {
        throw "Unexpected AAudio test target (API=$api ABI=$abi AVD=$avdName)."
    }

    & node (Join-Path $repoRoot 'research\detached-native-fir\auto-check.mjs') "--export-portable=$fixtureRoot"
    if ($LASTEXITCODE -ne 0) { throw 'Portable JS-oracle fixture generation failed.' }
    $assetRoot = Join-Path $appRoot 'app\build\generated\androidTestAssets\portable-fixture'
    New-Item -ItemType Directory -Force -Path $assetRoot | Out-Null
    foreach ($file in @('auto-fir-fixture.bin', 'auto-fir-js-oracle.bin', 'manifest.json')) {
        Copy-Item -LiteralPath (Join-Path $fixtureRoot $file) -Destination (Join-Path $assetRoot $file) -Force
    }

    $gradle = Join-Path $repoRoot 'apps\android-native-dsp-lab\gradlew.bat'
    & $gradle --no-daemon --project-dir $appRoot :app:assembleDebug :app:assembleDebugAndroidTest -PtargetAbis=x86_64
    if ($LASTEXITCODE -ne 0) { throw "x86_64 AAudio APK/instrumentation build failed: $LASTEXITCODE" }
    $debugApk = Join-Path $appRoot 'app\build\outputs\apk\debug\app-debug.apk'
    $testApk = Join-Path $appRoot 'app\build\outputs\apk\androidTest\debug\app-debug-androidTest.apk'
    $x86Apk = Join-Path $apkRoot 'hearlens-aaudio-callback-x86_64-debug.apk'
    $testApkCopy = Join-Path $apkRoot 'hearlens-aaudio-callback-androidTest-x86_64-debug.apk'
    Copy-Item -LiteralPath $debugApk -Destination $x86Apk -Force
    Copy-Item -LiteralPath $testApk -Destination $testApkCopy -Force

    & $gradle --no-daemon --project-dir $appRoot :app:assembleDebug -PtargetAbis=arm64-v8a
    if ($LASTEXITCODE -ne 0) { throw "arm64-v8a AAudio APK build failed: $LASTEXITCODE" }
    $armApk = Join-Path $appRoot 'app\build\outputs\apk\debug\app-debug.apk'
    $armApkCopy = Join-Path $apkRoot 'hearlens-aaudio-callback-arm64-v8a-debug.apk'
    Copy-Item -LiteralPath $armApk -Destination $armApkCopy -Force

    $aapt = Join-Path $env:ANDROID_HOME 'build-tools\35.0.0\aapt.exe'
    $x86PermissionText = & $aapt dump permissions $x86Apk 2>&1 | Out-String
    $armPermissionText = & $aapt dump permissions $armApkCopy 2>&1 | Out-String
    $permissionText = "$x86PermissionText`n$armPermissionText"
    if ($permissionText -match '(?i)RECORD_AUDIO|BLUETOOTH|MODIFY_AUDIO_SETTINGS') {
        throw "Forbidden microphone/Bluetooth permission in AAudio research APK: $permissionText"
    }
    & node --test (Join-Path $repoRoot 'tools\android-aaudio-callback-lab-contract.test.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'AAudio research safety contract tests failed.' }

    & $env:ANDROID_ADB -s $serial install -r $x86Apk
    if ($LASTEXITCODE -ne 0) { throw 'AAudio callback APK install failed on the isolated AVD.' }
    & $env:ANDROID_ADB -s $serial install -r $testApkCopy
    if ($LASTEXITCODE -ne 0) { throw 'AAudio instrumentation APK install failed on the isolated AVD.' }
    $verifyZero = if ($SkipZeroScan) { 'false' } else { 'true' }
    $runId = [guid]::NewGuid().ToString('N')
    $testOutput = & $env:ANDROID_ADB -s $serial shell am instrument -w -r `
        -e aaudioDurationMs $DurationMs -e aaudioVerifyZero $verifyZero `
        -e aaudioRunId $runId $runner 2>&1
    $instrumentExitCode = $LASTEXITCODE
    $testText = $testOutput -join "`n"
    $testText | Set-Content -LiteralPath (Join-Path $resultRoot 'instrumentation-tests.log') -Encoding utf8
    $logcatOutput = & $env:ANDROID_ADB -s $serial logcat -d 'HearLensAAudioLab:I' '*:S' 2>&1
    $logcatText = $logcatOutput -join "`n"
    $logcatText | Set-Content -LiteralPath (Join-Path $resultRoot 'measurement-logcat.log') -Encoding utf8
    $jsonLines = [regex]::Matches($logcatText, "AAUDIO_LAB_RESULT=$runId\|(\{[^\r\n]*\})")
    $runtimeResults = @()
    foreach ($match in $jsonLines) { $runtimeResults += $match.Groups[1].Value | ConvertFrom-Json }
    $benchmark = $runtimeResults |
        Where-Object { $_.fault_mode -eq 0 -and $_.requested_duration_ms -eq $DurationMs } |
        Select-Object -First 1
    $hasInstrumentationFailure = $instrumentExitCode -ne 0 -or
        $testText -match 'FAILURES!!!|There was \d+ failure'
    $benchmarkOutcome = if (!$benchmark) { 'NO_RESULT' } else { $benchmark.run_completion }
    $reportResult = if ($hasInstrumentationFailure -or $runtimeResults.Count -lt 5) {
        'INCOMPLETE'
    } elseif ($benchmarkOutcome -eq 'EARLY_FAIL_STOP') {
        'RECORDED_FAIL_STOP'
    } elseif ($benchmarkOutcome -in @('COMPLETE', 'FAULT_INJECTED')) {
        'PASS'
    } else {
        'INCOMPLETE'
    }
    $report = [ordered]@{
        result = $reportResult
        instrumentationExitCode = $instrumentExitCode
        instrumentationAssertions = if ($hasInstrumentationFailure) { 'FAIL' } else { 'PASS' }
        benchmarkOutcome = $benchmarkOutcome
        benchmarkDurationComplete = if ($benchmark) { [bool]$benchmark.duration_complete } else { $false }
        callbackObservation = if ($runtimeResults | Where-Object { $_.actual_callback_observed }) { 'PASS: real AAudio callback observed' } else { 'NOT RUN: AAudio stream started without callback delivery on audio-disabled emulator' }
        target = @{ serial = $serial; avd = $avdName; api = [int]$api; abi = $abi; audioInput = 'disabled'; audioOutput = 'disabled' }
        benchmarkDesign = @{ equivalentFrames = 128; durationMs = 300000; scriptDurationMs = $DurationMs; actualFrameCountsComeFromAAudio = $true; zeroOutputSampleScan = !$SkipZeroScan }
        runtimeResults = $runtimeResults
        fixture = @{
            path = (Join-Path $fixtureRoot 'auto-fir-fixture.bin')
            sha256 = (Get-FileHash -Algorithm SHA256 (Join-Path $fixtureRoot 'auto-fir-fixture.bin')).Hash.ToLowerInvariant()
            jsOracle = @{
                path = (Join-Path $fixtureRoot 'auto-fir-js-oracle.bin')
                sha256 = (Get-FileHash -Algorithm SHA256 (Join-Path $fixtureRoot 'auto-fir-js-oracle.bin')).Hash.ToLowerInvariant()
            }
            manifest = @{
                path = (Join-Path $fixtureRoot 'manifest.json')
                sha256 = (Get-FileHash -Algorithm SHA256 (Join-Path $fixtureRoot 'manifest.json')).Hash.ToLowerInvariant()
            }
        }
        apk = @{
            x86_64 = @{ path = $x86Apk; sha256 = (Get-FileHash -Algorithm SHA256 $x86Apk).Hash.ToLowerInvariant() }
            'arm64-v8a' = @{ path = $armApkCopy; sha256 = (Get-FileHash -Algorithm SHA256 $armApkCopy).Hash.ToLowerInvariant() }
            androidTestX86_64 = @{ path = $testApkCopy; sha256 = (Get-FileHash -Algorithm SHA256 $testApkCopy).Hash.ToLowerInvariant() }
        }
        artifacts = $resultRoot
    }
    $report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $resultRoot 'aaudio-callback-report.json') -Encoding utf8
    Write-Output "AAudio instrumentation: $($report.instrumentationAssertions) (exit $instrumentExitCode)"
    Write-Output "AAudio benchmark outcome: $benchmarkOutcome; overall result: $reportResult"
    Write-Output "Run report: $(Join-Path $resultRoot 'aaudio-callback-report.json')"
    if ($hasInstrumentationFailure) {
        throw "AAudio emulator instrumentation failed. See $(Join-Path $resultRoot 'instrumentation-tests.log')"
    }
    if ($runtimeResults.Count -lt 5) {
        throw 'Instrumentation did not return all AAudio run records; report and logs were preserved.'
    }
    if ($reportResult -eq 'INCOMPLETE') {
        throw "AAudio benchmark outcome is $benchmarkOutcome; report and logs were preserved."
    }
} finally {
    if ($startedHere -and !$KeepEmulator) { & "$repoRoot\scripts\android\Stop-HearLensEmulator.ps1" }
}
