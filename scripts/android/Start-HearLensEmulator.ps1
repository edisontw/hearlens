[CmdletBinding()]
param([int]$BootTimeoutSeconds = 360)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\Initialize-AndroidEnvironment.ps1"

$avdName = 'HearLens_API29_x86_64'
$serial = 'emulator-5580'
$configPath = Join-Path $env:ANDROID_AVD_HOME "$avdName.avd\config.ini"
if (!(Test-Path -LiteralPath $configPath)) { throw "Run New-HearLensAvd.ps1 first: $configPath" }
$config = Get-Content -LiteralPath $configPath -Raw
if ($config -notmatch '(?m)^hw\.audioInput=no\r?$' -or $config -notmatch '(?m)^hw\.audioOutput=no\r?$') {
    throw 'Refusing to start: AVD audio input and output must both be disabled.'
}

& $env:ANDROID_ADB start-server | Out-Null
$devices = & $env:ANDROID_ADB devices
$serialState = $devices | Where-Object { $_ -match "^$serial\s" } | Select-Object -First 1
if ($serialState) {
    $avdInfo = & $env:ANDROID_ADB -s $serial emu avd name 2>&1
    if (($avdInfo -join "`n") -notmatch [regex]::Escape($avdName)) {
        throw "Serial $serial is occupied by another emulator; it was not changed."
    }
    $process = Get-CimInstance Win32_Process -Filter "Name='emulator.exe'" | Where-Object { $_.CommandLine -match '-port\s+5580' } | Select-Object -First 1
    if (!$process -or $process.CommandLine -notmatch '(?i)-no-audio' -or $process.CommandLine -notmatch '(?i)-no-window') {
        throw "The existing $serial process was not started headlessly with -no-audio; it was not changed."
    }
} else {
    $logDir = 'D:\Dev\Android\test-results\hearlens\emulator-logs'
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $stdout = Join-Path $logDir "emulator-$stamp.stdout.log"
    $stderr = Join-Path $logDir "emulator-$stamp.stderr.log"
    $emulatorArgs = @("@$avdName", '-no-window', '-no-audio', '-no-boot-anim', '-no-snapshot', '-no-snapshot-save', '-accel', 'on', '-port', '5580')
    Start-Process -FilePath $env:ANDROID_EMULATOR -ArgumentList $emulatorArgs -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr | Out-Null
}

& $env:ANDROID_ADB -s $serial wait-for-device
if ($LASTEXITCODE -ne 0) { throw "ADB did not connect to $serial" }
$deadline = [DateTime]::UtcNow.AddSeconds($BootTimeoutSeconds)
do {
    $boot = (& $env:ANDROID_ADB -s $serial shell getprop sys.boot_completed 2>$null | Out-String).Trim()
    if ($boot -eq '1') { break }
    Start-Sleep -Seconds 3
} while ([DateTime]::UtcNow -lt $deadline)
if ($boot -ne '1') { throw "AVD boot timed out after $BootTimeoutSeconds seconds; see $logDir" }

$qemu = (& $env:ANDROID_ADB -s $serial shell getprop ro.kernel.qemu).Trim()
$sdk = (& $env:ANDROID_ADB -s $serial shell getprop ro.build.version.sdk).Trim()
$avdInfo = (& $env:ANDROID_ADB -s $serial emu avd name 2>&1 | Out-String)
if ($qemu -ne '1' -or $sdk -ne '29' -or $avdInfo -notmatch [regex]::Escape($avdName)) {
    throw "Unexpected device at $serial (qemu=$qemu api=$sdk avd=$avdInfo)"
}
Write-Output "Booted $avdName on $serial (API $sdk, WHPX; no audio)."
