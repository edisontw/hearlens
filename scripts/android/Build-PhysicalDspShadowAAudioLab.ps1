[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\Initialize-AndroidEnvironment.ps1"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$appRoot = Join-Path $repoRoot 'apps\android-aaudio-physical-dsp-shadow-lab'
$gradle = Join-Path $repoRoot 'apps\android-native-dsp-lab\gradlew.bat'
$resultRoot = 'D:\Dev\Android\test-results\hearlens\physical-dsp-shadow'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$suffix = [guid]::NewGuid().ToString('N').Substring(0, 8)
$runDir = Join-Path $resultRoot "$stamp-build-$suffix"
$fixtureDir = Join-Path $runDir 'portable-fixture'
$generatedMain = Join-Path $appRoot 'app\build\generated\mainAssets\portable-fixture'
$generatedTest = Join-Path $appRoot 'app\build\generated\androidTestAssets\portable-fixture'
$payloadDir = Join-Path $runDir 'release-payload'
$apk = Join-Path $payloadDir 'hearlens-physical-dsp-shadow-arm64-v8a-debug.apk'
$archive = Join-Path $runDir 'hearlens-physical-dsp-shadow-arm64-release.zip'

foreach ($path in @($appRoot, $gradle)) {
    if (!(Test-Path -LiteralPath $path)) { throw "Required Android build input is missing: $path" }
}
New-Item -ItemType Directory -Force -Path $fixtureDir, $generatedMain, $generatedTest, $payloadDir | Out-Null

$commit = (& git -C $repoRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Unable to read source commit.' }
$status = (& git -C $repoRoot status --short --branch) -join "`n"

$previousErrorActionPreference = $ErrorActionPreference
try {
    $ErrorActionPreference = 'Continue'
    $fixtureOutput = & node (Join-Path $repoRoot 'research\detached-native-fir\auto-check.mjs') "--export-portable=$fixtureDir" 2>&1
    $fixtureExit = $LASTEXITCODE
} finally {
    $ErrorActionPreference = $previousErrorActionPreference
}
$fixtureOutput | Set-Content -LiteralPath (Join-Path $runDir 'fixture-generation.log') -Encoding utf8
if ($fixtureExit -ne 0) { throw "Canonical portable fixture generation failed with exit $fixtureExit." }

$fixtureNames = @('auto-fir-fixture.bin', 'auto-fir-js-oracle.bin', 'manifest.json')
foreach ($name in $fixtureNames) {
    $source = Join-Path $fixtureDir $name
    if (!(Test-Path -LiteralPath $source)) { throw "Canonical fixture output is missing: $source" }
    Copy-Item -LiteralPath $source -Destination (Join-Path $generatedMain $name) -Force
    Copy-Item -LiteralPath $source -Destination (Join-Path $generatedTest $name) -Force
    Copy-Item -LiteralPath $source -Destination (Join-Path $payloadDir $name) -Force
}

$previousErrorActionPreference = $ErrorActionPreference
try {
    $ErrorActionPreference = 'Continue'
    $buildOutput = & $gradle --no-daemon --project-dir $appRoot `
        :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest 2>&1
    $buildExit = $LASTEXITCODE
} finally {
    $ErrorActionPreference = $previousErrorActionPreference
}
$buildOutput | Set-Content -LiteralPath (Join-Path $runDir 'gradle-build.log') -Encoding utf8
if ($buildExit -ne 0) { throw "Physical DSP-shadow ARM64 build/tests failed with exit $buildExit." }

$builtApk = Join-Path $appRoot 'app\build\outputs\apk\debug\app-debug.apk'
$builtTestApk = Join-Path $appRoot 'app\build\outputs\apk\androidTest\debug\app-debug-androidTest.apk'
if (!(Test-Path -LiteralPath $builtApk)) { throw "Gradle did not produce APK: $builtApk" }
if (!(Test-Path -LiteralPath $builtTestApk)) { throw "Gradle did not produce instrumentation APK: $builtTestApk" }
Copy-Item -LiteralPath $builtApk -Destination $apk
Copy-Item -LiteralPath $builtTestApk -Destination (Join-Path $payloadDir 'hearlens-physical-dsp-shadow-androidTest.apk')

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($apk)
try {
    $entries = @($zip.Entries | ForEach-Object { $_.FullName })
    $nativePath = 'lib/arm64-v8a/libhearlens_physical_dsp_shadow.so'
    if ($nativePath -notin $entries) { throw "ARM64 native library is missing from APK: $nativePath" }
    if ($entries | Where-Object { $_ -match '^lib/(?!arm64-v8a/)[^/]+/' }) {
        throw 'APK unexpectedly contains a non-ARM64 native ABI.'
    }
} finally {
    $zip.Dispose()
}

$aapt = Join-Path $env:ANDROID_HOME 'build-tools\35.0.0\aapt.exe'
if (!(Test-Path -LiteralPath $aapt)) { throw "aapt is missing: $aapt" }
$permissionOutput = & $aapt dump permissions $apk 2>&1
$permissionExit = $LASTEXITCODE
$permissionText = $permissionOutput -join "`n"
$permissionText | Set-Content -LiteralPath (Join-Path $payloadDir 'apk-permissions.txt') -Encoding utf8
if ($permissionExit -ne 0 -or $permissionText -match '(?m)^uses-permission:') {
    throw 'Physical DSP-shadow APK must declare no Android permissions.'
}
$badging = (& $aapt dump badging $apk 2>&1) -join "`n"
if ($LASTEXITCODE -ne 0 -or $badging -notmatch "package: name='org\.hearlens\.physicaldsp'") {
    throw 'APK package identity does not match org.hearlens.physicaldsp.'
}

$apkHash = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLowerInvariant()
$fixtureHash = (Get-FileHash -LiteralPath (Join-Path $fixtureDir 'auto-fir-fixture.bin') -Algorithm SHA256).Hash.ToLowerInvariant()
$oracleHash = (Get-FileHash -LiteralPath (Join-Path $fixtureDir 'auto-fir-js-oracle.bin') -Algorithm SHA256).Hash.ToLowerInvariant()
$manifestHash = (Get-FileHash -LiteralPath (Join-Path $fixtureDir 'manifest.json') -Algorithm SHA256).Hash.ToLowerInvariant()
$sourceFiles = @(
    'apps/android-aaudio-physical-dsp-shadow-lab/app/src/main/AndroidManifest.xml',
    'apps/android-aaudio-physical-dsp-shadow-lab/app/src/main/cpp/CMakeLists.txt',
    'apps/android-aaudio-physical-dsp-shadow-lab/app/src/main/cpp/shadow_callback_bridge.cpp',
    'apps/android-aaudio-physical-dsp-shadow-lab/app/src/main/java/org/hearlens/physicaldsp/MainActivity.kt',
    'apps/android-aaudio-physical-dsp-shadow-lab/app/src/main/java/org/hearlens/physicaldsp/NativeBridge.kt',
    'apps/android-aaudio-physical-dsp-shadow-lab/app/src/main/java/org/hearlens/physicaldsp/PhysicalSpeakerRoutePolicy.kt',
    'research/android-aaudio-callback/callback_core.hpp'
)
$fileHashes = foreach ($relativePath in $sourceFiles) {
    $file = Join-Path $repoRoot $relativePath
    [ordered]@{ path = $relativePath; sha256 = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() }
}
$buildInfo = [ordered]@{
    builtAtUtc = [DateTime]::UtcNow.ToString('o')
    sourceCommit = $commit
    sourceWorkingTreeStatus = $status
    apkSha256 = $apkHash
    nativeAbi = 'arm64-v8a'
    nativeLibrary = 'libhearlens_physical_dsp_shadow.so'
    packageName = 'org.hearlens.physicaldsp'
    requestedSampleRate = 48000
    dspFixtureSampleRate = 48000
    callbackFramesRequest = 'UNSPECIFIED_VARIABLE'
    maxDurationMs = 60000
    testWorkload = 'DSP_SHADOW_ZERO_OUTPUT'
    routePolicy = 'API33_MEDIA_PREDICTION_GENERATION_AND_AAUDIO_ID_MONITOR'
    permissionsDeclared = @()
    fixtureSha256 = $fixtureHash
    jsOracleSha256 = $oracleHash
    fixtureManifestSha256 = $manifestHash
    releaseArchiveSha256 = $null
    nativeSourceFiles = @($fileHashes)
    installOrStreamStarted = $false
}
Compress-Archive -Path (Join-Path $payloadDir '*') -DestinationPath $archive -CompressionLevel Optimal -Force
$archiveHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
$buildInfo.releaseArchiveSha256 = $archiveHash
$buildInfoPath = Join-Path $runDir 'build-info.json'
$buildInfo | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $buildInfoPath -Encoding utf8
[ordered]@{
    apkSha256 = $apkHash
    releaseArchiveSha256 = $archiveHash
    buildInfoSha256 = (Get-FileHash -LiteralPath $buildInfoPath -Algorithm SHA256).Hash.ToLowerInvariant()
    permissionsSha256 = (Get-FileHash -LiteralPath (Join-Path $payloadDir 'apk-permissions.txt') -Algorithm SHA256).Hash.ToLowerInvariant()
    fixtureSha256 = $fixtureHash
    jsOracleSha256 = $oracleHash
    manifestSha256 = $manifestHash
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runDir 'build-sha256.json') -Encoding utf8

Write-Output "APK: $apk"
Write-Output "APK SHA-256: $apkHash"
Write-Output "Release archive: $archive"
Write-Output "Archive SHA-256: $archiveHash"
Write-Output "Build evidence: $runDir"
