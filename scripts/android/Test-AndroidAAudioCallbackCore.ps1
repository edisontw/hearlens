[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$source = Join-Path $repoRoot 'research\android-aaudio-callback\callback_core_test.cpp'
$compilerInitCandidates = [System.Collections.Generic.List[string]]::new()
if ($env:VSINSTALLDIR) {
    $compilerInitCandidates.Add((Join-Path $env:VSINSTALLDIR 'VC\Auxiliary\Build\vcvars64.bat'))
}
$compilerInitCandidates.Add('D:\Dev\vs2022-build-tools\VC\Auxiliary\Build\vcvars64.bat')
$compilerInitCandidates.Add('C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat')
$compilerInit = @($compilerInitCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1)
if (!$compilerInit) { throw 'MSVC vcvars64.bat was not found; host callback fault tests were not run.' }

$resultRoot = 'D:\Dev\Android\test-results\hearlens\physical-dsp-shadow'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$runDir = Join-Path $resultRoot "host-callback-core-$stamp"
New-Item -ItemType Directory -Force -Path $runDir | Out-Null
$exe = Join-Path $runDir 'aaudio-callback-core-test.exe'
$obj = Join-Path $runDir 'callback_core_test.obj'
$pdb = Join-Path $runDir 'aaudio-callback-core-test.pdb'
$compileLog = Join-Path $runDir 'compile-and-test.log'
$command = 'call "' + $compilerInit[0] + '" >nul && cl.exe /nologo /std:c++17 /EHsc /W4 /WX /I"' +
    $repoRoot + '" /Fo:"' + $obj + '" /Fd:"' + $pdb + '" /Fe:"' + $exe +
    '" "' + $source + '" && "' + $exe + '"'
$output = & cmd.exe /d /s /c $command 2>&1
$exitCode = $LASTEXITCODE
$output | Set-Content -LiteralPath $compileLog -Encoding utf8
$output | Write-Output
if ($exitCode -ne 0) { throw "Android AAudio callback host fault matrix failed with exit $exitCode. See $compileLog" }
Write-Output "Host callback-core evidence: $runDir"
