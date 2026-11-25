[CmdletBinding()]
param(
    [switch]$AcceptLicenses,
    [switch]$PersistUserEnvironment
)

$ErrorActionPreference = 'Stop'
$androidRoot = 'D:\Dev\Android'
$sdkRoot = Join-Path $androidRoot 'sdk'
$downloadRoot = Join-Path $androidRoot 'downloads'
$jdkRoot = Join-Path $androidRoot 'jdk\17.0.21'
$cliZip = Join-Path $downloadRoot 'commandlinetools-win-15859902_latest.zip'
$jdkZip = Join-Path $downloadRoot 'OpenJDK17U-jdk_x64_windows_hotspot_17.0.21.1_2.zip'

New-Item -ItemType Directory -Force -Path @($downloadRoot, $sdkRoot, (Join-Path $androidRoot 'avd'), (Join-Path $androidRoot 'user-home'), (Join-Path $androidRoot 'gradle-cache'), (Join-Path $androidRoot 'test-results\hearlens')) | Out-Null

function Save-VerifiedArchive([string]$Uri, [string]$Path, [string]$Sha256) {
    if (!(Test-Path -LiteralPath $Path)) {
        curl.exe --fail --location --silent --show-error $Uri --output $Path
        if ($LASTEXITCODE -ne 0) { throw "Download failed: $Uri" }
    }
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
    if ($actual -ne $Sha256) { throw "SHA-256 mismatch for $Path ($actual)" }
}

Save-VerifiedArchive 'https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip' $cliZip '90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a'
Save-VerifiedArchive 'https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.21.1%2B2/OpenJDK17U-jdk_x64_windows_hotspot_17.0.21.1_2.zip' $jdkZip 'eafba0944f777abdc74d5aad16049c9b5a1275b6ce99e2939ba9f7f3e6f08c87'

$sdkManager = Join-Path $sdkRoot 'cmdline-tools\latest\bin\sdkmanager.bat'
if (!(Test-Path -LiteralPath $sdkManager)) {
    $stage = Join-Path $downloadRoot ("cmdline-tools-staging-" + [guid]::NewGuid().ToString('N'))
    Expand-Archive -LiteralPath $cliZip -DestinationPath $stage
    $latest = Join-Path $sdkRoot 'cmdline-tools\latest'
    New-Item -ItemType Directory -Force -Path $latest | Out-Null
    Get-ChildItem -LiteralPath (Join-Path $stage 'cmdline-tools') | ForEach-Object {
        Move-Item -LiteralPath $_.FullName -Destination $latest
    }
}

if (!(Test-Path -LiteralPath (Join-Path $jdkRoot 'bin\java.exe'))) {
    $stage = Join-Path $downloadRoot ("jdk-staging-" + [guid]::NewGuid().ToString('N'))
    Expand-Archive -LiteralPath $jdkZip -DestinationPath $stage
    $jdkArchiveRoot = Get-ChildItem -LiteralPath $stage -Directory | Select-Object -First 1
    if (!$jdkArchiveRoot) { throw 'JDK archive has no installation directory.' }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $jdkRoot) | Out-Null
    Move-Item -LiteralPath $jdkArchiveRoot.FullName -Destination $jdkRoot
}

. "$PSScriptRoot\Initialize-AndroidEnvironment.ps1"
if ($AcceptLicenses) {
    1..24 | ForEach-Object { 'y' } | & $env:ANDROID_SDK_MANAGER --licenses --sdk_root=$env:ANDROID_HOME --channel=0 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "SDK license command failed: $LASTEXITCODE" }
}

$packages = @(
    'platform-tools',
    'platforms;android-35',
    'build-tools;35.0.0',
    'emulator',
    'system-images;android-29;default;x86_64',
    'ndk;27.2.12479018',
    'cmake;3.22.1'
)
& $env:ANDROID_SDK_MANAGER --install @packages --sdk_root=$env:ANDROID_HOME --channel=0
if ($LASTEXITCODE -ne 0) { throw "SDK package installation failed: $LASTEXITCODE" }

if ($PersistUserEnvironment) {
    $userValues = @{
        ANDROID_HOME = $env:ANDROID_HOME
        ANDROID_SDK_ROOT = $env:ANDROID_HOME
        ANDROID_AVD_HOME = $env:ANDROID_AVD_HOME
        ANDROID_USER_HOME = $env:ANDROID_USER_HOME
        ANDROID_NDK_HOME = $env:ANDROID_NDK_HOME
        JAVA_HOME = $env:JAVA_HOME
        GRADLE_USER_HOME = $env:GRADLE_USER_HOME
    }
    foreach ($entry in $userValues.GetEnumerator()) {
        [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'User')
    }
    $extraPath = @((Join-Path $env:JAVA_HOME 'bin'), (Join-Path $env:ANDROID_HOME 'platform-tools'), (Join-Path $env:ANDROID_HOME 'emulator'), (Join-Path $env:ANDROID_HOME 'cmdline-tools\latest\bin'))
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $existingPath = if ($userPath) { $userPath.Split(';') } else { @() }
    $merged = @($extraPath + $existingPath | Where-Object { $_ } | Select-Object -Unique) -join ';'
    [Environment]::SetEnvironmentVariable('Path', $merged, 'User')
}

& (Join-Path $env:JAVA_HOME 'bin\java.exe') -version 2>&1
& (Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe') version
& (Join-Path $env:ANDROID_HOME 'emulator\emulator.exe') -version | Select-Object -First 1
Write-Output "SDK=$env:ANDROID_HOME"
Write-Output "NDK=$env:ANDROID_NDK_HOME"
Write-Output "JDK=$env:JAVA_HOME"
