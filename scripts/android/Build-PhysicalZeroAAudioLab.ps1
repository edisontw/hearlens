[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\Initialize-AndroidEnvironment.ps1"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$appRoot = Join-Path $repoRoot 'apps\android-aaudio-physical-zero-lab'
$gradle = Join-Path $repoRoot 'apps\android-native-dsp-lab\gradlew.bat'
$resultRoot = 'D:\Dev\Android\test-results\hearlens\physical-zero-callback'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$suffix = [guid]::NewGuid().ToString('N').Substring(0, 8)
$runDir = Join-Path $resultRoot "$stamp-build-$suffix"
$apkDir = Join-Path $runDir 'apk'
$apk = Join-Path $apkDir 'hearlens-physical-zero-aaudio-arm64-v8a-debug.apk'

if (!(Test-Path -LiteralPath $appRoot)) { throw "Physical zero-only lab is missing: $appRoot" }
if (!(Test-Path -LiteralPath $gradle)) { throw "Gradle wrapper is missing: $gradle" }
New-Item -ItemType Directory -Force -Path $apkDir | Out-Null

$commit = (& git -C $repoRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Unable to read source commit.' }
$status = (& git -C $repoRoot status --short --branch) -join "`n"
$previousErrorActionPreference = $ErrorActionPreference
try {
    # Gradle emits SDK compatibility warnings on stderr. Capture them in the build
    # log and use Gradle's exit code, rather than PowerShell's native-stderr
    # conversion, as the build result.
    $ErrorActionPreference = 'Continue'
    $buildOutput = & $gradle --no-daemon --project-dir $appRoot :app:assembleDebug 2>&1
    $buildExit = $LASTEXITCODE
} finally {
    $ErrorActionPreference = $previousErrorActionPreference
}
$buildOutput | Set-Content -LiteralPath (Join-Path $runDir 'gradle-build.log') -Encoding utf8
if ($buildExit -ne 0) { throw "ARM64 physical zero-only APK build failed with exit $buildExit." }

$builtApk = Join-Path $appRoot 'app\build\outputs\apk\debug\app-debug.apk'
if (!(Test-Path -LiteralPath $builtApk)) { throw "Gradle did not produce APK: $builtApk" }
Copy-Item -LiteralPath $builtApk -Destination $apk
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($apk)
try {
    $entries = @($zip.Entries | ForEach-Object { $_.FullName })
    $nativePath = 'lib/arm64-v8a/libhearlens_physical_zero.so'
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
$permissionText | Set-Content -LiteralPath (Join-Path $runDir 'apk-permissions.txt') -Encoding utf8
if ($permissionExit -ne 0 -or $permissionText -match '(?m)^uses-permission:') {
    throw 'Physical zero-only APK must declare no Android permissions.'
}

$apkHash = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLowerInvariant()
$sourceFiles = @(
    'apps/android-aaudio-physical-zero-lab/app/src/main/AndroidManifest.xml',
    'apps/android-aaudio-physical-zero-lab/app/src/main/cpp/CMakeLists.txt',
    'apps/android-aaudio-physical-zero-lab/app/src/main/cpp/zero_callback.cpp',
    'apps/android-aaudio-physical-zero-lab/app/src/main/cpp/zero_output_core.hpp',
    'apps/android-aaudio-physical-zero-lab/app/src/main/java/org/hearlens/physicalzero/MainActivity.kt',
    'apps/android-aaudio-physical-zero-lab/app/src/main/java/org/hearlens/physicalzero/NativeBridge.kt'
)
$fileHashes = foreach ($relativePath in $sourceFiles) {
    $file = Join-Path $repoRoot $relativePath
    [ordered]@{ path = $relativePath; sha256 = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() }
}
$buildInfo = [ordered]@{
    builtAtUtc = [DateTime]::UtcNow.ToString('o')
    sourceCommit = $commit
    sourceWorkingTreeStatus = $status
    apkPath = $apk
    apkSha256 = $apkHash
    nativeAbi = 'arm64-v8a'
    packageName = 'org.hearlens.physicalzero'
    maxDurationMs = 60000
    testWorkload = 'ZERO_ONLY'
    routePolicy = 'BUILTIN_SPEAKER_ONLY_EXACT_DEVICE_ID'
    permissionsDeclared = @()
    nativeSourceFiles = @($fileHashes)
    installOrStreamStarted = $false
}
$buildInfo | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $runDir 'build-info.json') -Encoding utf8
[ordered]@{
    apkSha256 = $apkHash
    buildInfoSha256 = (Get-FileHash -LiteralPath (Join-Path $runDir 'build-info.json') -Algorithm SHA256).Hash.ToLowerInvariant()
    apkPermissionsSha256 = (Get-FileHash -LiteralPath (Join-Path $runDir 'apk-permissions.txt') -Algorithm SHA256).Hash.ToLowerInvariant()
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runDir 'build-sha256.json') -Encoding utf8

Write-Output "APK: $apk"
Write-Output "SHA256: $apkHash"
Write-Output "Build evidence: $runDir"
