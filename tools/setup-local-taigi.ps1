$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$venvPath = Join-Path $repoRoot '.venv-local-taigi'
$python = Join-Path $venvPath 'Scripts\python.exe'
$requirements = Join-Path $PSScriptRoot 'requirements-local-taigi.txt'
$prepareModel = Join-Path $PSScriptRoot 'prepare-local-taigi.py'

if (-not (Test-Path -LiteralPath $python)) {
    $pyLauncher = Get-Command py -ErrorAction SilentlyContinue
    if (-not $pyLauncher) {
        throw 'Install Python 3.12 for Windows, then run this setup script again.'
    }
    & $pyLauncher.Source -3.12 -m venv $venvPath
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the local Taigi virtual environment.' }
}

& $python -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw 'Could not upgrade pip in the local Taigi environment.' }

# Conversion is one-time and CPU-only. The runtime uses CTranslate2 INT8.
& $python -m pip install 'torch==2.8.0' --index-url 'https://download.pytorch.org/whl/cpu'
if ($LASTEXITCODE -ne 0) { throw 'Could not install the CPU-only PyTorch conversion dependency.' }

& $python -m pip install -r $requirements
if ($LASTEXITCODE -ne 0) { throw 'Could not install the local Taigi dependencies.' }

& $python $prepareModel
if ($LASTEXITCODE -ne 0) { throw 'Could not download or convert Breeze-ASR-26.' }

Write-Output "Local Taigi model is ready. Start it with: & '$python' '$PSScriptRoot\local_taigi_server.py'"
