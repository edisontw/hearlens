$ErrorActionPreference = 'Stop'

$androidRoot = 'D:\Dev\Android'
$env:ANDROID_HOME = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $androidRoot 'sdk' }
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:ANDROID_AVD_HOME = if ($env:ANDROID_AVD_HOME) { $env:ANDROID_AVD_HOME } else { Join-Path $androidRoot 'avd' }
$env:ANDROID_USER_HOME = if ($env:ANDROID_USER_HOME) { $env:ANDROID_USER_HOME } else { Join-Path $androidRoot 'user-home' }
$env:JAVA_HOME = if ($env:JAVA_HOME) { $env:JAVA_HOME } else { Join-Path $androidRoot 'jdk\17.0.21' }
$env:GRADLE_USER_HOME = if ($env:GRADLE_USER_HOME) { $env:GRADLE_USER_HOME } else { Join-Path $androidRoot 'gradle-cache' }
$env:ANDROID_NDK_HOME = if ($env:ANDROID_NDK_HOME) { $env:ANDROID_NDK_HOME } else { Join-Path $env:ANDROID_HOME 'ndk\27.2.12479018' }
$env:ANDROID_NDK_ROOT = $env:ANDROID_NDK_HOME

$requiredPaths = @(
    $env:JAVA_HOME,
    (Join-Path $env:ANDROID_HOME 'cmdline-tools\latest\bin'),
    (Join-Path $env:ANDROID_HOME 'platform-tools'),
    (Join-Path $env:ANDROID_HOME 'emulator'),
    $env:ANDROID_AVD_HOME,
    $env:ANDROID_USER_HOME,
    $env:GRADLE_USER_HOME
)
foreach ($path in $requiredPaths) {
    New-Item -ItemType Directory -Force -Path $path | Out-Null
}

$env:Path = (@(
    (Join-Path $env:JAVA_HOME 'bin'),
    (Join-Path $env:ANDROID_HOME 'cmdline-tools\latest\bin'),
    (Join-Path $env:ANDROID_HOME 'platform-tools'),
    (Join-Path $env:ANDROID_HOME 'emulator')
) + $env:Path.Split(';') | Select-Object -Unique) -join ';'

$sdkManager = Join-Path $env:ANDROID_HOME 'cmdline-tools\latest\bin\sdkmanager.bat'
$env:ANDROID_SDK_MANAGER = $sdkManager
$env:ANDROID_AVDMANAGER = Join-Path $env:ANDROID_HOME 'cmdline-tools\latest\bin\avdmanager.bat'
$env:ANDROID_EMULATOR = Join-Path $env:ANDROID_HOME 'emulator\emulator.exe'
$env:ANDROID_ADB = Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe'
