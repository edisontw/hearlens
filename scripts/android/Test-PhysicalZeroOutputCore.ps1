[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$source = Join-Path $repoRoot 'research\android-aaudio-callback\physical_zero_output_core_test.cpp'
$compilerInitCandidates = [System.Collections.Generic.List[string]]::new()
if ($env:VSINSTALLDIR) {
    $compilerInitCandidates.Add((Join-Path $env:VSINSTALLDIR 'VC\Auxiliary\Build\vcvars64.bat'))
}
$compilerInitCandidates.Add('D:\Dev\vs2022-build-tools\VC\Auxiliary\Build\vcvars64.bat')
$compilerInitCandidates.Add('C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat')
$compilerInitCandidates = @($compilerInitCandidates | Where-Object { Test-Path -LiteralPath $_ })
if (!$compilerInitCandidates) { throw 'MSVC vcvars64.bat was not found; host test was not run.' }

$resultRoot = 'D:\Dev\Android\test-results\hearlens\physical-zero-callback'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$runDir = Join-Path $resultRoot "host-test-$stamp"
New-Item -ItemType Directory -Force -Path $runDir | Out-Null
$exe = Join-Path $runDir 'physical-zero-output-core-test.exe'
$obj = Join-Path $runDir 'physical_zero_output_core_test.obj'
$pdb = Join-Path $runDir 'physical-zero-output-core-test.pdb'
$compileLog = Join-Path $runDir 'compile.log'
$init = $compilerInitCandidates[0]
$cmd = 'call "' + $init + '" >nul && cl.exe /nologo /std:c++17 /EHsc /W4 /WX /I"' +
    $repoRoot + '" /Fo:"' + $obj + '" /Fd:"' + $pdb + '" /Fe:"' + $exe +
    '" "' + $source + '" && "' + $exe + '"'
$output = & cmd.exe /d /s /c $cmd 2>&1
$exitCode = $LASTEXITCODE
$output | Set-Content -LiteralPath $compileLog -Encoding utf8
$output | Write-Output
if ($exitCode -ne 0) { throw "Host zero-output test failed with exit $exitCode. See $compileLog" }
Write-Output "Host test evidence: $runDir"
