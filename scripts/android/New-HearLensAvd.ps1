$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\Initialize-AndroidEnvironment.ps1"

$name = 'HearLens_API29_x86_64'
$image = 'system-images;android-29;default;x86_64'
$avdPath = Join-Path $env:ANDROID_AVD_HOME "$name.avd"
$iniPath = Join-Path $env:ANDROID_AVD_HOME "$name.ini"

if (!(Test-Path -LiteralPath $iniPath) -and !(Test-Path -LiteralPath $avdPath)) {
    'no' | & $env:ANDROID_AVDMANAGER create avd --name $name --package $image --device pixel_2 --path $avdPath --sdcard 512M
    if ($LASTEXITCODE -ne 0) { throw "AVD creation failed: $LASTEXITCODE" }
}
if (!(Test-Path -LiteralPath $iniPath) -or !(Test-Path -LiteralPath (Join-Path $avdPath 'config.ini'))) {
    throw "AVD $name is only partially present; refusing to overwrite it."
}

$configPath = Join-Path $avdPath 'config.ini'
$settings = [ordered]@{}
foreach ($line in Get-Content -LiteralPath $configPath) {
    if ($line -match '^([^=]+)=(.*)$') { $settings[$Matches[1]] = $Matches[2] }
}
$required = [ordered]@{
    'avd.id' = $name
    'avd.name' = $name
    'disk.dataPartition.path' = 'userdata.img'
    'disk.dataPartition.size' = '4G'
    'fastboot.forceColdBoot' = 'yes'
    'fastboot.forceFastBoot' = 'no'
    'hw.audioInput' = 'no'
    'hw.audioOutput' = 'no'
    'hw.cpu.ncore' = '4'
    'hw.gpu.enabled' = 'yes'
    'hw.gpu.mode' = 'auto'
    'hw.ramSize' = '4096'
    'showDeviceFrame' = 'no'
    'PlayStore.enabled' = 'no'
}
foreach ($key in $required.Keys) { $settings[$key] = $required[$key] }
$lines = foreach ($key in ($settings.Keys | Sort-Object)) { "$key=$($settings[$key])" }
[System.IO.File]::WriteAllLines($configPath, [string[]]$lines, [System.Text.UTF8Encoding]::new($false))

foreach ($key in @('hw.audioInput', 'hw.audioOutput', 'hw.cpu.ncore', 'hw.ramSize', 'PlayStore.enabled')) {
    if ($settings[$key] -ne $required[$key]) { throw "AVD setting failed: $key" }
}
Write-Output "AVD=$name"
Write-Output "Image=$image"
Write-Output "Config=$configPath"
