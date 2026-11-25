[CmdletBinding()]
param([switch]$KeepEmulator)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\Initialize-AndroidEnvironment.ps1"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$resultRoot = 'D:\Dev\Android\test-results\hearlens'
$fixtureRoot = Join-Path $resultRoot 'portable-fixture'
$headlessRoot = Join-Path $resultRoot 'headless'
$apkRoot = Join-Path $resultRoot 'apk'
$serial = 'emulator-5580'
$packageName = 'org.hearlens.nativedsplab'
$activityName = "$packageName/.MainActivity"
$runner = "$packageName.test/androidx.test.runner.AndroidJUnitRunner"
$startedHere = $false

New-Item -ItemType Directory -Force -Path @($resultRoot, $fixtureRoot, $apkRoot) | Out-Null
& "$repoRoot\scripts\android\New-HearLensAvd.ps1"
$devices = & $env:ANDROID_ADB devices
if (!($devices | Where-Object { $_ -match "^$serial\s" })) { $startedHere = $true }

try {
    & "$repoRoot\scripts\android\Start-HearLensEmulator.ps1"
    $api = (& $env:ANDROID_ADB -s $serial shell getprop ro.build.version.sdk).Trim()
    $abi = (& $env:ANDROID_ADB -s $serial shell getprop ro.product.cpu.abi).Trim()
    if ($api -ne '29' -or $abi -ne 'x86_64') { throw "Unexpected test runtime (API=$api ABI=$abi)" }

    & node (Join-Path $repoRoot 'research\detached-native-fir\auto-check.mjs') "--export-portable=$fixtureRoot"
    if ($LASTEXITCODE -ne 0) { throw 'Portable JS-oracle fixture generation failed.' }
    & "$repoRoot\research\detached-native-fir\build-android.ps1" -OutputDirectory $headlessRoot -FixtureDirectory $fixtureRoot
    if ($LASTEXITCODE -ne 0) { throw 'Android NDK headless build failed.' }
    $assetRoot = Join-Path $repoRoot 'apps\android-native-dsp-lab\app\build\generated\androidTestAssets\portable-fixture'
    New-Item -ItemType Directory -Force -Path $assetRoot | Out-Null
    foreach ($file in @('auto-fir-fixture.bin', 'auto-fir-js-oracle.bin', 'manifest.json')) {
        Copy-Item -LiteralPath (Join-Path $fixtureRoot $file) -Destination (Join-Path $assetRoot $file) -Force
    }

    Push-Location (Join-Path $repoRoot 'apps\android-native-dsp-lab')
    try {
        & '.\gradlew.bat' --no-daemon :app:assembleDebug :app:assembleDebugAndroidTest -PtargetAbis=x86_64
        if ($LASTEXITCODE -ne 0) { throw "x86_64 APK/instrumentation build failed: $LASTEXITCODE" }
        $debugApk = Join-Path (Get-Location) 'app\build\outputs\apk\debug\app-debug.apk'
        $testApk = Join-Path (Get-Location) 'app\build\outputs\apk\androidTest\debug\app-debug-androidTest.apk'
        if (!(Test-Path -LiteralPath $debugApk) -or !(Test-Path -LiteralPath $testApk)) { throw 'Gradle APK outputs were not found.' }
        $x86Apk = Join-Path $apkRoot 'hearlens-native-dsp-lab-x86_64-debug.apk'
        $testApkCopy = Join-Path $apkRoot 'hearlens-native-dsp-lab-androidTest-x86_64-debug.apk'
        Copy-Item -LiteralPath $debugApk -Destination $x86Apk -Force
        Copy-Item -LiteralPath $testApk -Destination $testApkCopy -Force

        & '.\gradlew.bat' --no-daemon :app:assembleDebug -PtargetAbis=arm64-v8a
        if ($LASTEXITCODE -ne 0) { throw "arm64-v8a APK build failed: $LASTEXITCODE" }
        $armApk = Join-Path $apkRoot 'hearlens-native-dsp-lab-arm64-v8a-debug.apk'
        Copy-Item -LiteralPath $debugApk -Destination $armApk -Force
    } finally { Pop-Location }

    & node --test (Join-Path $repoRoot 'tools\android-native-dsp-lab-contract.test.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Android no-audio safety contract tests failed.' }

    $aapt = Join-Path $env:ANDROID_HOME 'build-tools\35.0.0\aapt.exe'
    $apkAbis = @{}
    foreach ($item in @(@{ name = 'x86_64'; path = $x86Apk }, @{ name = 'arm64-v8a'; path = $armApk })) {
        $permissionText = & $aapt dump permissions $item.path 2>&1 | Out-String
        if ($permissionText -match '(?i)RECORD_AUDIO|MODIFY_AUDIO_SETTINGS|BLUETOOTH') {
            throw "Forbidden audio/Bluetooth permission in $($item.name) APK: $permissionText"
        }
        $zip = [System.IO.Compression.ZipFile]::OpenRead($item.path)
        try {
            $entries = @($zip.Entries | ForEach-Object { $_.FullName })
            $soPath = "lib/$($item.name)/libhearlens_native.so"
            if ($soPath -notin $entries) { throw "Native library missing from $($item.name) APK." }
            $apkAbis[$item.name] = $soPath
        } finally { $zip.Dispose() }
    }

    & $env:ANDROID_ADB -s $serial install -r $x86Apk
    if ($LASTEXITCODE -ne 0) { throw 'Research APK install failed.' }
    & $env:ANDROID_ADB -s $serial install -r $testApkCopy
    if ($LASTEXITCODE -ne 0) { throw 'Instrumentation APK install failed.' }
    $testOutput = & $env:ANDROID_ADB -s $serial shell am instrument -w -r $runner 2>&1
    $testText = $testOutput -join "`n"
    $testText | Set-Content -LiteralPath (Join-Path $resultRoot 'instrumentation-tests.log') -Encoding utf8
    if ($LASTEXITCODE -ne 0 -or $testText -notmatch 'OK\s+\(\d+ tests?\)' -or $testText -match 'FAILURES!!!|There was \d+ failure') {
        throw "Android instrumentation tests failed. See $(Join-Path $resultRoot 'instrumentation-tests.log')"
    }
    $instrumentationCount = [int]([regex]::Match($testText, 'OK\s+\((\d+) tests?\)').Groups[1].Value)

    $remote = '/data/local/tmp/hearlens-native-dsp'
    & $env:ANDROID_ADB -s $serial shell mkdir -p $remote
    foreach ($entry in @(@{ local = Join-Path $headlessRoot 'auto-check-x86_64'; remote = "$remote/auto-check" }, @{ local = Join-Path $headlessRoot 'native-session-check-x86_64'; remote = "$remote/native-session-check" })) {
        & $env:ANDROID_ADB -s $serial push $entry.local $entry.remote
        if ($LASTEXITCODE -ne 0) { throw "ADB push failed: $($entry.local)" }
    }
    foreach ($name in @('auto-fir-fixture.bin', 'auto-fir-js-oracle.bin', 'manifest.json')) {
        & $env:ANDROID_ADB -s $serial push (Join-Path $fixtureRoot $name) "$remote/$name"
        if ($LASTEXITCODE -ne 0) { throw "ADB fixture transfer failed: $name" }
    }
    & $env:ANDROID_ADB -s $serial shell chmod 700 "$remote/auto-check" "$remote/native-session-check"
    & $env:ANDROID_ADB -s $serial shell "cd $remote && ./auto-check auto-fir-fixture.bin > android-result.bin"
    if ($LASTEXITCODE -ne 0) { throw 'Android x86_64 portable runtime executable failed.' }
    $runtimeResult = Join-Path $resultRoot 'android-x86_64-result.bin'
    & $env:ANDROID_ADB -s $serial pull "$remote/android-result.bin" $runtimeResult
    if ($LASTEXITCODE -ne 0) { throw 'Could not collect Android x86_64 result.' }
    $runtimeJson = (& node (Join-Path $repoRoot 'research\detached-native-fir\verify-portable-output.mjs') (Join-Path $fixtureRoot 'manifest.json') (Join-Path $fixtureRoot 'auto-fir-fixture.bin') (Join-Path $fixtureRoot 'auto-fir-js-oracle.bin') $runtimeResult 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { throw "JS oracle did not accept Android runtime output: $runtimeJson" }

    $sessionOutput = & $env:ANDROID_ADB -s $serial shell "$remote/native-session-check" 2>&1
    $sessionText = $sessionOutput -join "`n"
    if ($LASTEXITCODE -ne 0 -or $sessionText -notmatch '2000 concurrent invalidations PASS') { throw "Android native session runtime failed: $sessionText" }

    & "$repoRoot\scripts\android\Test-AndroidSanitizers.ps1"
    $sanitizerReport = Get-Content -LiteralPath (Join-Path $resultRoot 'sanitizer\android-sanitizer-report.json') -Raw | ConvertFrom-Json

    & $env:ANDROID_ADB -s $serial shell am start -W -n $activityName | Out-Null
    $pidBefore = (& $env:ANDROID_ADB -s $serial shell pidof $packageName 2>$null | Out-String).Trim()
    if (!$pidBefore) { throw 'Research app did not stay alive after launch.' }
    & $env:ANDROID_ADB -s $serial shell am force-stop $packageName
    $pidStopped = (& $env:ANDROID_ADB -s $serial shell pidof $packageName 2>$null | Out-String).Trim()
    if ($pidStopped) { throw "App process survived force-stop: $pidStopped" }
    & $env:ANDROID_ADB -s $serial shell am start -W -n $activityName | Out-Null
    $pidAfter = (& $env:ANDROID_ADB -s $serial shell pidof $packageName 2>$null | Out-String).Trim()
    if (!$pidAfter) { throw 'Research app did not relaunch after process termination.' }

    $report = [ordered]@{
        result = 'PASS'
        headlessRuntime = 'Android x86_64 API 29 emulator; exact portable JS oracle parity'
        androidRuntime = ($runtimeJson | ConvertFrom-Json)
        nativeSessionRuntime = $sessionText.Trim()
        sanitizers = $sanitizerReport
        instrumentationTestsPassed = $instrumentationCount
        instrumentationTestsFailed = 0
        appProcessRestart = 'PASS'
        processIds = @($pidBefore, $pidAfter)
        apk = @{
            x86_64 = @{ path = $x86Apk; sha256 = (Get-FileHash -Algorithm SHA256 $x86Apk).Hash.ToLowerInvariant(); nativeLibrary = $apkAbis['x86_64'] }
            'arm64-v8a' = @{ path = $armApk; sha256 = (Get-FileHash -Algorithm SHA256 $armApk).Hash.ToLowerInvariant(); nativeLibrary = $apkAbis['arm64-v8a'] }
        }
        arm64Runtime = 'NOT RUN; cross-build and APK contents only'
        physicalDeviceRuntime = 'NOT RUN'
        audioInputOutput = 'DISABLED / not implemented'
        testArtifacts = $resultRoot
    }
    $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $resultRoot 'android-lab-report.json') -Encoding utf8
    Write-Output "Android instrumentation: $instrumentationCount passed, 0 failed."
    Write-Output "Portable x86_64 runtime: PASS; session regression: PASS; app force-stop/restart: PASS."
    Write-Output "APKs: $x86Apk ; $armApk"
} finally {
    if ($startedHere -and !$KeepEmulator) { & "$repoRoot\scripts\android\Stop-HearLensEmulator.ps1" }
}
