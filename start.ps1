<#
  OSGuard one-command launcher (Windows PowerShell 5.1+).
  Usage:  .\start.ps1            # set up (first run), build UI if needed, serve on http://127.0.0.1:8000
          .\start.ps1 -Dev       # API on :8000 + Vite dev server on http://localhost:5173 (hot reload)
          .\start.ps1 -Rebuild   # force a fresh frontend build
#>
param([switch]$Dev, [switch]$Rebuild)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root "backend"
$frontend = Join-Path $root "frontend"
$py = Join-Path $backend ".venv\Scripts\python.exe"

if (-not (Test-Path $py)) {
  Write-Host "Creating Python virtual environment..." -ForegroundColor Cyan
  python -m venv (Join-Path $backend ".venv")
  & $py -m pip install --quiet --upgrade pip
  & $py -m pip install --quiet -r (Join-Path $backend "requirements-dev.txt")
}
if (-not (Test-Path (Join-Path $frontend "node_modules"))) {
  Write-Host "Installing frontend dependencies (first run only)..." -ForegroundColor Cyan
  Push-Location $frontend; npm install --no-audit --no-fund; Pop-Location
}
if ($Dev) {
  Write-Host "Starting API on :8000 and Vite on :5173 ..." -ForegroundColor Cyan
  Start-Process -FilePath $py -ArgumentList "run.py" -WorkingDirectory $backend
  Push-Location $frontend; npm run dev; Pop-Location
  exit
}
if ($Rebuild -or -not (Test-Path (Join-Path $frontend "dist\index.html"))) {
  Write-Host "Building frontend..." -ForegroundColor Cyan
  Push-Location $frontend; npm run build; Pop-Location
}
Write-Host "OSGuard running at http://127.0.0.1:8000  (Ctrl+C to stop)" -ForegroundColor Green
Push-Location $backend; & $py run.py; Pop-Location
