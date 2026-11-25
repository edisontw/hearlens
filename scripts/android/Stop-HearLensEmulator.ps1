$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\Initialize-AndroidEnvironment.ps1"

$avdName = 'HearLens_API29_x86_64'
$serial = 'emulator-5580'
$devices = & $env:ANDROID_ADB devices
$serialState = $devices | Where-Object { $_ -match "^$serial\s" } | Select-Object -First 1
if (!$serialState) { Write-Output "$serial is already stopped."; exit 0 }
$avdInfo = & $env:ANDROID_ADB -s $serial emu avd name 2>&1 | Out-String
if ($avdInfo -notmatch [regex]::Escape($avdName)) {
    throw "Refusing to stop $serial because it is not $avdName."
}
& $env:ANDROID_ADB -s $serial emu kill
if ($LASTEXITCODE -ne 0) { throw "ADB could not stop the dedicated emulator: $LASTEXITCODE" }
Write-Output "Stopped $avdName on $serial."
