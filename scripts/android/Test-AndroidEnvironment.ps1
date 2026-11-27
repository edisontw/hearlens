[CmdletBinding()]
param([switch]$Json)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\Initialize-AndroidEnvironment.ps1"

$disk = Get-PSDrive D
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$computer = Get-CimInstance Win32_ComputerSystem
$os = Get-CimInstance Win32_OperatingSystem
$whpxState = 'NOT READ (Windows feature query requires elevation)'
try {
    $feature = Get-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform -ErrorAction Stop
    $whpxState = $feature.State.ToString()
} catch { $whpxState = 'NOT READ (elevation denied)' }

$javaVersion = if (Test-Path (Join-Path $env:JAVA_HOME 'bin\java.exe')) { (& (Join-Path $env:JAVA_HOME 'bin\java.exe') -version 2>&1 | Select-Object -First 1).ToString() } else { 'MISSING' }
$adbVersion = if (Test-Path $env:ANDROID_ADB) { (& $env:ANDROID_ADB version 2>&1 | Select-Object -First 2) -join ' ' } else { 'MISSING' }
$emulatorVersion = if (Test-Path $env:ANDROID_EMULATOR) { (& $env:ANDROID_EMULATOR -version 2>&1 | Select-Object -First 1).ToString() } else { 'MISSING' }
$accel = if (Test-Path $env:ANDROID_EMULATOR) { (& $env:ANDROID_EMULATOR -accel-check 2>&1 | Out-String).Trim() } else { 'NOT RUN' }
$packages = if (Test-Path $env:ANDROID_SDK_MANAGER) {
    (& $env:ANDROID_SDK_MANAGER --list_installed --sdk_root=$env:ANDROID_HOME --channel=0 2>&1 | Select-String 'platform-tools|platforms;android-35|build-tools;35.0.0|emulator\s|system-images;android-29;default;x86_64|ndk;27.2.12479018|cmake;3.22.1' | ForEach-Object { $_.Line.Trim() })
} else { @('MISSING') }

$result = [pscustomobject]@{
    repository = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
    androidHome = $env:ANDROID_HOME
    androidAvdHome = $env:ANDROID_AVD_HOME
    androidUserHome = $env:ANDROID_USER_HOME
    androidNdkHome = $env:ANDROID_NDK_HOME
    javaHome = $env:JAVA_HOME
    gradleUserHome = $env:GRADLE_USER_HOME
    javaVersion = $javaVersion
    nodeVersion = if (Get-Command node -ErrorAction SilentlyContinue) { (& node --version).Trim() } else { 'MISSING' }
    gitVersion = if (Get-Command git -ErrorAction SilentlyContinue) { (& git --version).Trim() } else { 'MISSING' }
    cpu = $cpu.Name
    logicalProcessors = $cpu.NumberOfLogicalProcessors
    svmEnabled = $cpu.VirtualizationFirmwareEnabled
    windowsHypervisorPresent = $computer.HypervisorPresent
    whpxFeature = $whpxState
    totalMemoryGiB = [math]::Round($computer.TotalPhysicalMemory / 1GB, 1)
    freeMemoryGiB = [math]::Round($os.FreePhysicalMemory * 1KB / 1GB, 1)
    dDriveFreeGiB = [math]::Round($disk.Free / 1GB, 1)
    adbVersion = $adbVersion
    emulatorVersion = $emulatorVersion
    emulatorAcceleration = $accel
    installedPackages = @($packages)
}

if ($Json) { $result | ConvertTo-Json -Depth 4 } else { $result | Format-List }
